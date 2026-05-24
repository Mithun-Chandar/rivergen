import fs from "node:fs";
import path from "node:path";

// ─── Config shape ──────────────────────────────────────────────────────────────

export interface GeneratorConfig {
  api: {
    /** Root source dir of the API app. e.g. "apps/api/src" */
    srcRoot: string;
    /** Where EventBus listener files live. */
    listenersDir: string;
    /**
     * @deprecated Phase 2 upsert target — kept for gate compat.
     * Gen:domain now writes to schemasDir slices instead.
     */
    schemasFile: string;
    /** Slice directory for EventFactory payload schemas. */
    schemasDir: string;
    /** Barrel file for EventFactory payload schemas. */
    schemasBarrelFile: string;
    /** Base Zod schemas file (EventEnvelopeSchema etc.) */
    schemasBaseFile: string;
    /** EventFactory service file (written by gen:init). */
    eventFactoryFile: string;
    /** EventBus service file (written by gen:init). */
    eventBusFile: string;
    /** package.json for the api app (dep enforcement). */
    packageJsonPath: string;
  };
  web: {
    /** Root source dir of the web app. e.g. "apps/web/src" */
    srcRoot: string;
    /**
     * @deprecated Phase 2 upsert target — kept for gate compat.
     * WebSocketProvider is now loop-based (written by gen:init).
     */
    providerFile: string;
    /**
     * @deprecated Phase 2 upsert target — kept for gate compat.
     * State-cache is now a lookup table (written by gen:init).
     */
    dispatcherFile: string;
    /**
     * @deprecated Phase 2 upsert target — kept for gate compat.
     * Gen:domain now writes to queryKeysDir slices instead.
     */
    queryKeysFile: string;
    /** Slice directory for per-domain dispatch maps. */
    dispatchersDir: string;
    /** Barrel file for domain dispatcher index. */
    dispatchersBarrelFile: string;
    /** Slice directory for WebSocket event bindings. */
    wsBindingsDir: string;
    /** Barrel file for ws-bindings index. */
    wsBindingsBarrelFile: string;
    /** Slice directory for per-domain query key factories. */
    queryKeysDir: string;
    /** Barrel file for query-keys index. */
    queryKeysBarrelFile: string;
    /** entity-cache.ts (written by gen:init). */
    entityCacheFile: string;
    /** state-cache.ts — thin lookup table (written by gen:init). */
    stateCacheFile: string;
    /** Directory for domain projection files. */
    projectionsDir: string;
    /** Directory for domain hook files. */
    hooksDir: string;
    /** Directory for per-domain Witness files (field continuity audit). */
    witnessDir: string;
    /** package.json for the web app (dep enforcement). */
    packageJsonPath: string;
  };
  packages: {
    /**
     * @deprecated Phase 2 upsert target — kept for gate compat.
     */
    typesEventsFile: string;
    /**
     * @deprecated Phase 2 upsert target — kept for gate compat.
     * Gen:domain now writes to entityProjectionsDir slices instead.
     */
    sharedEntityRegistryFile: string;
    /** Slice directory for per-domain entity projection entries. */
    entityProjectionsDir: string;
    /** Barrel file for entity projections index. */
    entityProjectionsBarrelFile: string;
    /** Types file for EntityProjectionEntry etc. */
    entityProjectionsTypesFile: string;
  };
  /** Where apply records are written for reversibility. */
  applyRecordsDir: string;
  /**
   * Import line for the DB client used in generated mutations.
   * e.g. '{ prisma } from "../lib/db"'
   * When omitted, a TODO comment is generated instead.
   */
  dbImport?: string;
  /**
   * Package name for the shared package that exports ENTITY_PROJECTIONS.
   * Defaults to "@rivergen/shared" — matches what gen:init creates.
   */
  sharedPackage?: string;
  /**
   * Directory containing the three payload audit files:
   *   phase4-payload-continuity-audit.ts
   *   phase5-test-payloads.ts
   *   phase6-retained-slice-audit.ts
   * Defaults to "witness". Override in rivergen.config.json if your project
   * stores the audit files in a different directory.
   * If none of the three files exist at this path, the audit gate skips silently.
   */
  auditDir?: string;
}

// ─── Defaults (matches standard v2 monorepo layout) ────────────────────────────

const DEFAULTS: GeneratorConfig = {
  api: {
    srcRoot: "apps/api/src",
    listenersDir: "apps/api/src/lib/event-bus-listeners",
    // @deprecated upsert target — slice pattern replaces this
    schemasFile: "apps/api/src/lib/event-factory/schemas.ts",
    schemasDir: "apps/api/src/lib/event-factory/schemas",
    schemasBarrelFile: "apps/api/src/lib/event-factory/schemas/_index.ts",
    schemasBaseFile: "apps/api/src/lib/event-factory/schemas/_base.ts",
    eventFactoryFile: "apps/api/src/lib/event-factory/event-factory.service.ts",
    eventBusFile: "apps/api/src/lib/event-bus.service.ts",
    packageJsonPath: "apps/api/package.json",
  },
  web: {
    srcRoot: "apps/web/src",
    // @deprecated upsert targets — loop/lookup pattern replaces these
    providerFile: "apps/web/src/providers/WebSocketProvider.tsx",
    dispatcherFile: "apps/web/src/lib/cache/state-cache.ts",
    queryKeysFile: "apps/web/src/lib/query-keys.ts",
    dispatchersDir: "apps/web/src/lib/cache/domain-dispatchers",
    dispatchersBarrelFile:
      "apps/web/src/lib/cache/domain-dispatchers/_index.ts",
    wsBindingsDir: "apps/web/src/providers/ws-bindings",
    wsBindingsBarrelFile: "apps/web/src/providers/ws-bindings/_index.ts",
    queryKeysDir: "apps/web/src/lib/query-keys",
    queryKeysBarrelFile: "apps/web/src/lib/query-keys/_index.ts",
    entityCacheFile: "apps/web/src/lib/cache/entity-cache.ts",
    stateCacheFile: "apps/web/src/lib/cache/state-cache.ts",
    projectionsDir: "apps/web/src/lib/projections",
    hooksDir: "apps/web/src/hooks",
    witnessDir: "apps/web/src/witness",
    packageJsonPath: "apps/web/package.json",
  },
  packages: {
    // @deprecated upsert targets — slice pattern replaces these
    typesEventsFile: "packages/types/src/realtime-events.ts",
    sharedEntityRegistryFile: "packages/shared/src/entity-projections.ts",
    entityProjectionsDir: "packages/shared/src/entity-projections",
    entityProjectionsBarrelFile:
      "packages/shared/src/entity-projections/_index.ts",
    entityProjectionsTypesFile:
      "packages/shared/src/entity-projections/_types.ts",
  },
  applyRecordsDir: "artifacts/gen-apply-records",
};

// ─── Loader ────────────────────────────────────────────────────────────────────

/**
 * Loads generator config from rivergen.config.json at the project root.
 * Falls back to DEFAULTS for any key not specified.
 * Deep-merges at one level — top-level keys (api, web, packages) are merged
 * with defaults, not replaced entirely.
 */
export function loadConfig(projectRoot: string): GeneratorConfig {
  const configPath = path.join(projectRoot, "rivergen.config.json");

  if (!fs.existsSync(configPath)) {
    return DEFAULTS;
  }

  let raw: Partial<GeneratorConfig>;
  try {
    raw = JSON.parse(
      fs.readFileSync(configPath, "utf-8"),
    ) as Partial<GeneratorConfig>;
  } catch {
    console.warn(
      `[gen-v2] rivergen.config.json is not valid JSON — using defaults.`,
    );
    return DEFAULTS;
  }

  return {
    api: { ...DEFAULTS.api, ...(raw.api ?? {}) },
    web: { ...DEFAULTS.web, ...(raw.web ?? {}) },
    packages: { ...DEFAULTS.packages, ...(raw.packages ?? {}) },
    applyRecordsDir: raw.applyRecordsDir ?? DEFAULTS.applyRecordsDir,
    dbImport: raw.dbImport,
    sharedPackage: raw.sharedPackage,
    auditDir: raw.auditDir ?? "witness",
  };
}

export { DEFAULTS as DEFAULT_CONFIG };
