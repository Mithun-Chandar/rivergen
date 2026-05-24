import type { DomainNames } from "../naming";

/**
 * Generates the domain projection file for the frontend.
 *
 * LAW: All cache mutations for this entity go through entity-cache helpers.
 * No direct queryClient.setQueryData() calls — ever.
 * Called by: state-cache dispatcher (switch/case).
 *
 * STUB — fill in context derivation where marked TODO.
 */
export function renderFrontendProjection(n: DomainNames): string {
  const E = n.entityPascal;
  const e = n.entityKey;
  const d = n.domainKey;

  const createdEvent =
    n.events.find((ev) => ev.endsWith(".created")) ?? n.events[0];
  const updatedEvent = n.events.find((ev) => ev.endsWith(".updated"));
  const deletedEvent = n.events.find((ev) => ev.endsWith(".deleted"));

  const updateProjection = updatedEvent
    ? `
// ── ${updatedEvent} ──────────────────────────────────────────────────────────
export function apply${E}Updated(
  payload: AnyPayload,
  queryClient: QueryClient,
): void {
  const ${e}Id = payload.${e}Id as string | undefined;
  if (!${e}Id) return;

  // TODO: derive context — which collection does this entity belong to?
  const context = {
    // e.g. workspaceId: payload.workspaceId as string,
  };

  applyEntityUpdate("${e}", { id: ${e}Id, ...payload }, context, queryClient);
}
`
    : "";

  const deleteProjection = deletedEvent
    ? `
// ── ${deletedEvent} ──────────────────────────────────────────────────────────
export function apply${E}Deleted(
  payload: AnyPayload,
  queryClient: QueryClient,
): void {
  const ${e}Id = payload.${e}Id as string | undefined;
  if (!${e}Id) return;

  const context = {
    // TODO: same context shape as create/update
  };

  applyEntityDelete("${e}", String(${e}Id), context, queryClient);
}
`
    : "";

  return `import { QueryClient } from "@tanstack/react-query";
import {
  applyEntityCreate,
  applyEntityUpdate,
  applyEntityDelete,
} from "../cache/entity-cache";

// TODO: import your ${E} entity type once defined
// import type { ${E} } from "your-types-package";

type AnyPayload = Record<string, unknown>;

// ── ${createdEvent} ──────────────────────────────────────────────────────────
export function apply${E}Created(
  payload: AnyPayload,
  queryClient: QueryClient,
): void {
  const ${e}Id = payload.${e}Id as string | undefined;
  if (!${e}Id) return;

  // TODO: derive context — which collection does this entity belong to?
  // context is used by entity-cache to find the correct query key(s) to update
  const context = {
    // e.g. workspaceId: payload.workspaceId as string,
    clientTempId: payload.clientTempId as string | undefined,
  };

  applyEntityCreate("${e}", { id: ${e}Id, ...payload }, context, queryClient);
}
${updateProjection}${deleteProjection}`;
}
