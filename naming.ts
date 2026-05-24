import type { V2DomainSpec } from "./schema";
import type { GeneratorConfig } from "./config";

// ─── Output shape ──────────────────────────────────────────────────────────────

/**
 * All derived names, identifiers, and file paths for a single domain spec.
 * Computed once; passed to all templates, plan builders, and executors.
 */
export interface DomainNames {
  // ── Domain ─────────────────────────────────────────────────────────────────
  domainKey: string; // "invoice" | "work-order"
  domainPascal: string; // "Invoice" | "WorkOrder"
  domainDisplay: string; // "Invoice" | "Work Order"

  // ── Entity ─────────────────────────────────────────────────────────────────
  entityKey: string; // camelCase: "invoice" | "workOrder"
  entityPascal: string; // PascalCase: "Invoice" | "WorkOrder"
  entityEventPrefix: string; // kebab: "invoice" | "work-order"

  // ── Events ─────────────────────────────────────────────────────────────────
  events: string[]; // ["invoice.created", "invoice.updated", ...]
  /** UPPER_SNAKE_CASE constant names parallel to events[]. */
  eventConstants: string[]; // ["INVOICE_CREATED", "INVOICE_UPDATED", ...]
  /** PascalCase constant names parallel to events[] — matches RealtimeEvent keys. */
  eventPascalConstants: string[]; // ["InvoiceCreated", "InvoiceUpdated", ...]

  // ── Room ───────────────────────────────────────────────────────────────────
  roomTemplate: string;
  roomVisibilityField: string | undefined;

  // ── Backend files (relative to project root) ───────────────────────────────
  apiRouterFile: string; // "apps/api/src/invoice/invoice.router.ts"
  apiMutationsFile: string; // "apps/api/src/invoice/invoice.mutations.ts"
  apiBroadcastFile: string; // "apps/api/src/invoice/invoice.broadcast.ts"
  apiListenerFile: string; // "apps/api/src/lib/event-bus-listeners/invoice.listener.ts"

  // ── Frontend files (relative to project root) ──────────────────────────────
  webProjectionFile: string; // "apps/web/src/lib/projections/invoice-projections.ts"
  webHookFile: string; // "apps/web/src/hooks/use-invoice.ts"
  webWitnessFile: string; // "apps/web/src/witness/invoice.witness.ts"

  // ── Shared upsert targets (deprecated — kept for gate compat) ────────────
  schemasFile: string;
  queryKeysFile: string;
  providerFile: string;
  dispatcherFile: string;
  typesEventsFile: string;
  entityRegistryFile: string;

  // ── Domain slice files (Phase 3 — generated, then barrel regenerated) ────
  /** apps/api/src/lib/event-factory/schemas/<domain>.ts */
  schemasSliceFile: string;
  /** apps/web/src/lib/cache/domain-dispatchers/<domain>.ts */
  dispatcherSliceFile: string;
  /** apps/web/src/providers/ws-bindings/<domain>.ts */
  wsBindingsSliceFile: string;
  /** packages/shared/src/entity-projections/<domain>.ts */
  entityProjectionSliceFile: string;
  /** apps/web/src/lib/query-keys/<domain>.ts */
  queryKeysSliceFile: string;
}

// ─── Conversion helpers ────────────────────────────────────────────────────────

/** "work-order" → "WorkOrder" */
function kebabToPascal(kebab: string): string {
  return kebab
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/** "workOrder" → "WorkOrder" */
function camelToPascal(camel: string): string {
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/**
 * "invoice.created" → "INVOICE_CREATED"
 * "work-order.line-item.added" → "WORK_ORDER_LINE_ITEM_ADDED"
 */
function eventToConstant(event: string): string {
  return event.replace(/[.-]/g, "_").toUpperCase();
}

/**
 * "invoice.created" → "InvoiceCreated"
 * "project-folder.created" → "ProjectFolderCreated"
 * "task.priority-changed" → "TaskPriorityChanged"
 *
 * Matches the PascalCase keys used in the RealtimeEvent object.
 */
function eventToPascalConstant(event: string): string {
  return event
    .split(/[.-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

// ─── Main deriver ──────────────────────────────────────────────────────────────

export function deriveNames(
  spec: V2DomainSpec,
  config: GeneratorConfig,
): DomainNames {
  const domainKey = spec.domain.key;
  const domainPascal = kebabToPascal(domainKey);
  const entityKey = spec.entity.key;
  const entityPascal = camelToPascal(entityKey);

  return {
    // Domain
    domainKey,
    domainPascal,
    domainDisplay: spec.domain.displayName,

    // Entity
    entityKey,
    entityPascal,
    entityEventPrefix: spec.entity.eventPrefix,

    // Events
    events: spec.events,
    eventConstants: spec.events.map(eventToConstant),
    eventPascalConstants: spec.events.map(eventToPascalConstant),

    // Room
    roomTemplate: spec.room.template,
    roomVisibilityField: spec.room.visibilityField,

    // Backend
    apiRouterFile: `${config.api.srcRoot}/${domainKey}/${domainKey}.router.ts`,
    apiMutationsFile: `${config.api.srcRoot}/${domainKey}/${domainKey}.mutations.ts`,
    apiBroadcastFile: `${config.api.srcRoot}/${domainKey}/${domainKey}.broadcast.ts`,
    apiListenerFile: `${config.api.listenersDir}/${domainKey}.listener.ts`,

    // Frontend
    webProjectionFile: `${config.web.projectionsDir}/${domainKey}-projections.ts`,
    webHookFile: `${config.web.hooksDir}/use-${domainKey}.ts`,
    webWitnessFile: `${config.web.witnessDir}/${domainKey}.witness.ts`,

    // Upsert targets (deprecated — kept for gate compat)
    schemasFile: config.api.schemasFile,
    queryKeysFile: config.web.queryKeysFile,
    providerFile: config.web.providerFile,
    dispatcherFile: config.web.dispatcherFile,
    typesEventsFile: config.packages.typesEventsFile,
    entityRegistryFile: config.packages.sharedEntityRegistryFile,

    // Domain slice files (Phase 3)
    schemasSliceFile: `${config.api.schemasDir}/${domainKey}.ts`,
    dispatcherSliceFile: `${config.web.dispatchersDir}/${domainKey}.ts`,
    wsBindingsSliceFile: `${config.web.wsBindingsDir}/${domainKey}.ts`,
    entityProjectionSliceFile: `${config.packages.entityProjectionsDir}/${domainKey}.ts`,
    queryKeysSliceFile: `${config.web.queryKeysDir}/${domainKey}.ts`,
  };
}
