import type { DomainNames } from "../naming.js";

/**
 * Generates the Witness file for a domain.
 *
 * Scaffold rules:
 *  - Compiles immediately with zero TypeScript errors.
 *  - lifecycle() and all signals return [] — Gate #12 fails until filled.
 *  - testPayloads and requiredFields are empty — developer fills them.
 *  - Developer must not use randomUUID() or new Date() in test payloads.
 */
export function renderWitnessFile(n: DomainNames): string {
  const E = n.entityPascal;
  const e = n.entityKey;
  const d = n.domainKey;

  // Identify event roles
  const createdEvent = n.events.find((ev) => ev.endsWith(".created"));
  const updatedEvent = n.events.find((ev) => ev.endsWith(".updated"));
  const deletedEvent = n.events.find((ev) => ev.endsWith(".deleted"));
  const signalEvents = n.events.filter(
    (ev) =>
      !ev.endsWith(".created") &&
      !ev.endsWith(".updated") &&
      !ev.endsWith(".deleted"),
  );

  // requiredFields stubs — one entry per event
  const requiredFieldLines = n.events
    .map(
      (ev) =>
        `    "${ev}": ["${e}Id"], // TODO: list every field the projection reads`,
    )
    .join("\n");

  // testPayload stubs for lifecycle events
  const lifecyclePayloadStubs = [createdEvent, updatedEvent, deletedEvent]
    .filter(Boolean)
    .map(
      (ev) => `    "${ev}": {
      ${e}Id: "test-${d}-001",
      // TODO: add all fields from ${E}Payload
      _meta: {
        resourceId: "test-${d}-001",
        actor: { id: "user-test-01", type: "user" },
        context: { realmId: "realm-test-01" },
        correlationId: "corr-${ev!.replace(".", "-")}-01",
        eventVersion: "1.0",
      },
    },`,
    )
    .join("\n");

  // testPayload stubs for signal events
  const signalPayloadStubs = signalEvents
    .map(
      (ev) => `    "${ev}": {
      ${e}Id: "test-${d}-001",
      // TODO: add all fields this event needs
      _meta: {
        resourceId: "test-${d}-001",
        actor: { id: "user-test-01", type: "user" },
        context: { realmId: "realm-test-01" },
        correlationId: "corr-${ev.replace(".", "-")}-01",
        eventVersion: "1.0",
      },
    },`,
    )
    .join("\n");

  const allPayloadStubs = [lifecyclePayloadStubs, signalPayloadStubs]
    .filter(Boolean)
    .join("\n");

  // Signal function stubs
  const signalFunctionStubs = signalEvents.length
    ? signalEvents
        .map(
          (ev) => `
    "${ev}": async (_queryClient) => {
      // TODO: seed cache, apply the "${ev}" event, assert the expected state change
      return [];
    },`,
        )
        .join("")
    : "\n    // No custom signal events for this domain";

  // Projection import for lifecycle
  const projectionImports = [
    createdEvent ? `apply${E}Created` : null,
    updatedEvent ? `apply${E}Updated` : null,
    deletedEvent ? `apply${E}Deleted` : null,
  ]
    .filter(Boolean)
    .join(", ");

  // Lifecycle body — stubbed but structured so the TODO is clear
  const lifecycleBody = `
    // TODO: Implement create → update → delete assertion sequence.
    //
    // Pattern:
    //   const qc = queryClient as QueryClient;
    //   await qc.prefetchQuery({ queryKey: [TODO: list key], queryFn: () => [] });
    //
    //   // 1. Apply create event — assert entity lands in list
    //   apply${E}Created(testPayloads["${createdEvent ?? `${d}.created`}"]!, qc);
    //   const list = qc.getQueryData<${E}[]>([TODO: list key]) ?? [];
    //   const created = list.find(x => x.id === "test-${d}-001");
    //   assertions.push({ name: "${d}.created lands in list", ok: !!created });
    //   assertions.push({ name: "${d}.created.${e}Id preserved", ok: created?.id === "test-${d}-001" });
    //   // TODO: add one assertion per requiredField
    //
    //   // Ghost reconciliation (mandatory for create events)
    //   // Seed a ghost with id === "ghost-temp-01", apply created with clientTempId: "ghost-temp-01"
    //   // Assert ghost is replaced (list has real id, not ghost id)
    //   assertions.push({ name: "${d}.created replaces ghost (clientTempId reconciliation)", ok: false /* TODO */ });
    //
    //   // 2. Apply update event — assert field changed
    //   // 3. Apply delete event — assert entity is gone`;

  return `import type { DomainWitness, WitnessAssertion } from "@rivergen/witness";
// DO NOT import projection functions at the top level here.
// Projection files import React, which cannot load in the Node.js subprocess
// that runs Layer 3. Importing them here will cause Gate #12 Layer 3 to report
// a warning and silently drop all assertions for this witness file.
// Instead, use dynamic import() inside lifecycle() if you need a projection fn,
// or copy the apply* call inline after seeding the query client directly.
//
// import type { QueryClient } from "@tanstack/react-query"; // safe — types only
// import { ${projectionImports} } from "../lib/projections/${d}-projections"; // ← BREAKS Layer 3

// ── Payload type ───────────────────────────────────────────────────────────────
// TODO: Add every field that eventFactory.publish() sends for ${E} events.
//       Field names here MUST match the REST API response shape exactly — the
//       same names the UI reads from useQuery data. A mismatch means the WS
//       projection writes a field the UI never reads, causing silent data loss.
//
// TYPING RULE: testPayloads must satisfy this full type for every event.
//   Fields present on ALL events  → required  (e.g. ${e}Id: string)
//   Fields present on SOME events → optional  (e.g. clientTempId?: string | null)
//   This lets each testPayload omit fields that particular event doesn't carry.
//   Example: if .deleted only sends ${e}Id, mark title/status/etc as optional here.
export interface ${E}Payload {
  ${e}Id: string;
  // TODO: add remaining fields (copy from the API response type, not the DB model)
}

// ── Witness ────────────────────────────────────────────────────────────────────
export const ${e}Witness: DomainWitness<${E}Payload> = {
  domain: "${d}",
  events: ${JSON.stringify(n.events)},

  // TODO: For each event, list every field the projection reads from the payload.
  //       These are validated against the Zod schema (Layer 1) and broadcast
  //       helper (Layer 2) — any missing hop makes Gate #12 fail.
  requiredFields: {
${requiredFieldLines}
  },

  // TODO: One realistic test payload per event.
  //       Use fixed IDs and timestamps — no randomUUID() or new Date().
  //       Each payload must include all requiredFields for that event.
  testPayloads: {
${allPayloadStubs}
  },

  async lifecycle(_queryClient): Promise<WitnessAssertion[]> {
    const assertions: WitnessAssertion[] = [];
${lifecycleBody}
    return assertions;
  },

  signals: {${signalFunctionStubs}
  },
};
`;
}
