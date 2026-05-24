import fs from "node:fs";
import path from "node:path";
import { validateSpec } from "./schema";
import { deriveNames, type DomainNames } from "./naming";
import { loadConfig, type GeneratorConfig } from "./config";
import { checkDependencies, type DepEnforcerResult } from "./dep-enforcer";
import { detectCollisions } from "./barrel";
import { renderBackendRouter } from "./templates/backend-router";
import { renderBackendMutations } from "./templates/backend-mutations";
import { renderBackendListener } from "./templates/backend-listener";
import { renderBackendBroadcast } from "./templates/backend-broadcast";
import { renderFrontendProjection } from "./templates/frontend-projection";
import { renderFrontendHook } from "./templates/frontend-hook";
import { renderDomainSchemaSlice } from "./templates/domain-slice-schemas";
import { renderDomainDispatcherSlice } from "./templates/domain-slice-dispatchers";
import { renderDomainWsBindingsSlice } from "./templates/domain-slice-ws-bindings";
import { renderDomainEntityProjectionSlice } from "./templates/domain-slice-entity-projection";
import { renderDomainQueryKeysSlice } from "./templates/domain-slice-query-keys";
import { renderWitnessFile } from "./templates/domain-witness";

// ─── Plan shape ────────────────────────────────────────────────────────────────

export interface PlannedFile {
  /** Relative path from project root. */
  filePath: string;
  /** Content to write. */
  content: string;
  /** Whether the file already exists (would require --force to overwrite). */
  exists: boolean;
}

export interface GeneratorPlan {
  ok: boolean;
  /** Human-readable domain info. */
  domainKey: string;
  domainDisplay: string;
  specFile: string;
  projectRoot: string;
  /** Derived names for all templates and executors. */
  names: DomainNames;
  /** 12 files to be CREATED: 6 domain files + 5 domain slices + 1 witness file. */
  filesToCreate: PlannedFile[];
  /**
   * 5 barrel _index.ts files that will be regenerated (not created from scratch —
   * they are atomically rewritten to include the new domain key).
   * Listed here so renderPlan() can display them.
   */
  barrelsToRegenerate: string[];
  /**
   * Satellite files that exist in this project and will be updated with the
   * new domain's entries. Empty for projects that don't have these files.
   */
  satelliteFiles: string[];
  /** Dependency check results. */
  deps: DepEnforcerResult;
  /** Error messages (non-empty → plan should not be executed). */
  errors: string[];
}

// ─── Plan builder ──────────────────────────────────────────────────────────────

/**
 * Reads a spec file, validates it, derives names, checks dependencies,
 * and produces a fully-populated GeneratorPlan.
 *
 * Does NOT write any files.
 * Call renderPlan(plan) for a human-readable preview.
 * Call execute(plan) to actually write files.
 */
export function buildPlan(
  specFile: string,
  projectRoot: string,
): GeneratorPlan {
  const errors: string[] = [];

  // 1. Read spec file
  const absSpec = path.isAbsolute(specFile)
    ? specFile
    : path.join(projectRoot, specFile);

  if (!fs.existsSync(absSpec)) {
    return {
      ok: false,
      domainKey: "unknown",
      domainDisplay: "unknown",
      specFile,
      projectRoot,
      names: {} as DomainNames,
      filesToCreate: [],
      barrelsToRegenerate: [],
      satelliteFiles: [],
      deps: { ok: false, missing: [], summary: ["Spec file not found."] },
      errors: [`Spec file not found: ${absSpec}`],
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(absSpec, "utf-8"));
  } catch (err) {
    return {
      ok: false,
      domainKey: "unknown",
      domainDisplay: "unknown",
      specFile,
      projectRoot,
      names: {} as DomainNames,
      filesToCreate: [],
      barrelsToRegenerate: [],
      satelliteFiles: [],
      deps: { ok: false, missing: [], summary: [] },
      errors: [`Failed to parse spec JSON: ${(err as Error).message}`],
    };
  }

  // 2. Validate spec
  const validation = validateSpec(raw);
  if (!validation.ok) {
    return {
      ok: false,
      domainKey: "unknown",
      domainDisplay: "unknown",
      specFile,
      projectRoot,
      names: {} as DomainNames,
      filesToCreate: [],
      barrelsToRegenerate: [],
      satelliteFiles: [],
      deps: { ok: false, missing: [], summary: [] },
      errors: validation.errors,
    };
  }

  const spec = validation.spec;

  // 3. Load config + derive names
  const config: GeneratorConfig = loadConfig(projectRoot);
  const names = deriveNames(spec, config);

  // 4. Check dependencies
  const deps = checkDependencies(projectRoot, config);

  // 5. Collision detection — scan existing dispatcher slices
  const absDispatchersDir = path.join(projectRoot, config.web.dispatchersDir);
  const collisions = detectCollisions(
    spec.events,
    absDispatchersDir,
    names.domainKey,
  );
  if (collisions.length > 0) {
    for (const c of collisions) {
      errors.push(
        `Event collision: "${c.event}" already registered in ${c.file} (domain: ${c.existingDomain}).`,
      );
    }
  }

  // 6. Build file list (6 domain files + 5 domain slices + 1 witness = 12 total)
  const renderPairs: Array<[string, () => string]> = [
    [names.apiRouterFile, () => renderBackendRouter(names)],
    [names.apiMutationsFile, () => renderBackendMutations(names, config.dbImport)],
    [names.apiBroadcastFile, () => renderBackendBroadcast(names)],
    [names.apiListenerFile, () => renderBackendListener(names)],
    [names.webProjectionFile, () => renderFrontendProjection(names)],
    [names.webHookFile, () => renderFrontendHook(names)],
    // Domain slice files
    [names.schemasSliceFile, () => renderDomainSchemaSlice(names)],
    [names.dispatcherSliceFile, () => renderDomainDispatcherSlice(names)],
    [names.wsBindingsSliceFile, () => renderDomainWsBindingsSlice(names)],
    [
      names.entityProjectionSliceFile,
      () => renderDomainEntityProjectionSlice(names),
    ],
    [names.queryKeysSliceFile, () => renderDomainQueryKeysSlice(names)],
    // Witness file — field continuity audit scaffold
    [names.webWitnessFile, () => renderWitnessFile(names)],
  ];

  const filesToCreate: PlannedFile[] = renderPairs.map(
    ([filePath, render]) => ({
      filePath,
      content: render(),
      exists: fs.existsSync(path.join(projectRoot, filePath)),
    }),
  );

  const blockers = filesToCreate.filter((f) => f.exists);
  if (blockers.length > 0) {
    errors.push(
      `${blockers.length} file(s) already exist. Use --force to overwrite:\n` +
        blockers.map((f) => `  • ${f.filePath}`).join("\n"),
    );
  }

  if (!deps.ok) {
    errors.push(
      `Missing required packages (run with --install to fix):\n` +
        deps.missing
          .map((m) => `  • [${m.workspace}] ${m.packageName}`)
          .join("\n"),
    );
  }

  const barrelsToRegenerate = [
    config.api.schemasBarrelFile,
    config.web.dispatchersBarrelFile,
    config.web.wsBindingsBarrelFile,
    config.web.queryKeysBarrelFile,
    config.packages.entityProjectionsBarrelFile,
  ];

  // Satellite files: only shown if they already exist in this project.
  const SATELLITE_PATHS = [
    "packages/shared/src/event-entity-map.ts",
    "apps/web/src/providers/ws-event-cache-audit.ts",
    "tools/dark-knight/phase5-trace-coverage-audit.ts",
  ];
  const satelliteFiles = SATELLITE_PATHS.filter((p) =>
    fs.existsSync(path.join(projectRoot, p)),
  );

  return {
    ok: errors.length === 0,
    domainKey: names.domainKey,
    domainDisplay: names.domainDisplay,
    specFile,
    projectRoot,
    names,
    filesToCreate,
    barrelsToRegenerate,
    satelliteFiles,
    deps,
    errors,
  };
}

// ─── Plan renderer (stdout) ────────────────────────────────────────────────────

const CHECK = "✓";
const WARN = "⚠";
const CROSS = "✗";
const INFO = "·";

export function renderPlan(plan: GeneratorPlan): string {
  const lines: string[] = [];
  const SEP = "─".repeat(72);

  lines.push("");
  lines.push(`  RiverGen — Domain Plan`);
  lines.push(`  Domain : ${plan.domainDisplay} (${plan.domainKey})`);
  lines.push(`  Spec   : ${plan.specFile}`);
  lines.push("");

  // Files to create
  lines.push(SEP);
  lines.push("  FILES TO CREATE");
  lines.push(SEP);
  for (const f of plan.filesToCreate) {
    const icon = f.exists ? CROSS : CHECK;
    const note = f.exists ? " ← EXISTS (blocked until --force)" : "";
    lines.push(`  ${icon}  ${f.filePath}${note}`);
  }

  lines.push("");
  lines.push(`  BARRELS TO REGENERATE (automatic)`);
  lines.push(SEP);
  for (const b of plan.barrelsToRegenerate) {
    lines.push(`  ${INFO}  ${b}`);
  }

  // Satellite files (only shown when they exist in this project)
  if (plan.satelliteFiles.length > 0) {
    lines.push("");
    lines.push(`  SATELLITE FILES TO UPDATE`);
    lines.push(SEP);
    for (const s of plan.satelliteFiles) {
      lines.push(`  ${INFO}  ${s}`);
    }
  }

  // Dependencies
  lines.push("");
  lines.push(SEP);
  lines.push("  DEPENDENCIES");
  lines.push(SEP);
  if (plan.deps.ok) {
    lines.push(`  ${CHECK}  All required packages present.`);
  } else {
    for (const s of plan.deps.summary) {
      lines.push(`  ${WARN}  ${s}`);
    }
    lines.push(`       Run with --install to install missing packages.`);
  }

  // Errors / ready status
  lines.push("");
  lines.push(SEP);
  if (plan.ok) {
    lines.push(`  ${CHECK}  READY — run: rivergen gen <specFile>`);
  } else {
    lines.push(
      `  ${CROSS}  NOT READY — resolve errors before running: rivergen gen`,
    );
    for (const e of plan.errors) {
      lines.push(`       ${e}`);
    }
  }
  lines.push(SEP);
  lines.push("");

  return lines.join("\n");
}
