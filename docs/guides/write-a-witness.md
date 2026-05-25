# Write a Witness

## Overview

A witness file is the field continuity contract for a domain. It proves — at runtime, in a Node.js subprocess — that every field declared in `requiredFields` actually survives the full path from `eventFactory.publish()` through the WS projection into the TanStack Query cache.

`rivergen gen` writes a witness stub that compiles with zero TypeScript errors and passes Gate #12 structurally. Layer 3 (the projection proof) is stubbed with `// TODO` — it fails the `⚠ stub` check until you fill it. This guide walks from stub to fully passing Gate #12.

---

## What a witness file contains

The generated stub for a `task` domain looks like this (slightly simplified):

```typescript
import type { DomainWitness, WitnessAssertion } from "@rivergen/witness";
// DO NOT import projection functions at the top level here.
// Projection files import React, which cannot load in the Node.js subprocess
// that runs Layer 3. Use dynamic import() inside lifecycle() instead.
//
// import type { QueryClient } from "@tanstack/react-query"; // safe — types only

export interface TaskPayload {
  taskId: string;
  // TODO: add remaining fields
}

export const taskWitness: DomainWitness<TaskPayload> = {
  domain: "task",
  events: ["task.created", "task.updated", "task.deleted"],

  requiredFields: {
    "task.created": ["taskId"], // TODO: list every field the projection reads
    "task.updated": ["taskId"],
    "task.deleted": ["taskId"],
  },

  testPayloads: {
    "task.created": {
      taskId: "test-task-001",
      // TODO: add all fields from TaskPayload
      _meta: {
        resourceId: "test-task-001",
        actor: { id: "user-test-01", type: "user" },
        context: { realmId: "realm-test-01" },
        correlationId: "corr-task-created-01",
        eventVersion: "1.0",
      },
    },
    // ... other events
  },

  async lifecycle(_queryClient): Promise<WitnessAssertion[]> {
    const assertions: WitnessAssertion[] = [];
    // TODO: Implement create → update → delete assertion sequence.
    return assertions;
  },

  signals: {
    // No custom signal events for this domain
  },
};
```

The four things you must fill in:

1. `TaskPayload` interface — all fields the projection reads
2. `requiredFields` — list of fields per event
3. `testPayloads` — fixed-value test payloads (no `randomUUID()`, no `new Date()`)
4. `lifecycle()` — the dynamic projection proof

---

## Step 1: Fill the TaskPayload interface

`TaskPayload` declares the shape of a payload as it arrives over the socket. Every field that any projection reads must be declared here.

Copy the field names from the `.strict()` Zod schema (not the DB model — the DB model may use different names):

```typescript
export interface TaskPayload {
  taskId: string;
  title: string;
  projectId: string;
  clientTempId: string | null;
  // For update events, all fields are optional merges:
  // status?: string;
}
```

**Field shape law:** these field names must match the REST API response shape — the same names `useQuery` returns. If the API returns `task.title` and the payload uses `taskTitle`, the projection writes `taskTitle` to the cache but the UI reads `title` — the update is invisible, no error thrown.

---

## Step 2: Fill requiredFields

`requiredFields` is a map of event name → array of field names. Gate #12 Layer 1 checks that every field in this list exists in the Zod schema. Gate #12 Layer 2 checks that the broadcast helper forwards these fields.

Include every field the projection reads:

```typescript
requiredFields: {
  "task.created": ["taskId", "title", "projectId", "clientTempId"],
  "task.updated": ["taskId", "title"],
  "task.deleted": ["taskId"],
},
```

For update events, you only need to list the fields that the update event actually carries — not all fields. If `task.updated` only ever updates `title` and `status`, declare those two.

For delete events, `taskId` alone is usually sufficient — `applyEntityDelete` only needs the entity ID.

---

## Step 3: Fill testPayloads

`testPayloads` provides one realistic payload per event, used by Layer 3 to drive the projection. Two strict rules:

1. **No `randomUUID()` or `new Date()`** — every value must be a fixed literal. Non-deterministic values make Layer 3 assertions non-reproducible.
2. **Every `requiredField` must appear in its event's payload** — if `title` is in `requiredFields["task.created"]`, it must be in `testPayloads["task.created"]`.

```typescript
testPayloads: {
  "task.created": {
    taskId: "test-task-001",
    title: "Fix bug",
    projectId: "proj-001",
    clientTempId: null,
    _meta: {
      resourceId: "test-task-001",
      actor: { id: "user-test-01", type: "user" },
      context: { realmId: "realm-test-01" },
      correlationId: "corr-task-created-01",
      eventVersion: "1.0",
    },
  },
  "task.updated": {
    taskId: "test-task-001",
    title: "Fix bug (revised)",
    _meta: {
      resourceId: "test-task-001",
      actor: { id: "user-test-01", type: "user" },
      context: { realmId: "realm-test-01" },
      correlationId: "corr-task-updated-01",
      eventVersion: "1.0",
    },
  },
  "task.deleted": {
    taskId: "test-task-001",
    _meta: {
      resourceId: "test-task-001",
      actor: { id: "user-test-01", type: "user" },
      context: { realmId: "realm-test-01" },
      correlationId: "corr-task-deleted-01",
      eventVersion: "1.0",
    },
  },
},
```

`_meta` is a scaffold convention that stores envelope-level fields (actor, correlationId, etc.) alongside the payload for test realism. It is not a field that travels over the socket — the actual socket message carries only `envelope.payload`.

---

## Step 4: Fill lifecycle()

`lifecycle()` is the dynamic projection proof. It runs in a Node.js subprocess (the Layer 3 worker). It must:

1. Seed the query client with an initial cache state
2. Apply the projection function(s)
3. Read back the cache and assert the expected state

**Critical: dynamic import rule.** Projection files import React components (directly or transitively). React cannot load in a Node.js subprocess. If you import a projection file at the top of the witness file, Layer 3 fails with an import error and all assertions are silently dropped.

Always use `await import()` inside `lifecycle()`:

```typescript
// ✓ CORRECT — dynamic import inside lifecycle()
async lifecycle(queryClient): Promise<WitnessAssertion[]> {
  const assertions: WitnessAssertion[] = [];
  const qc = queryClient as QueryClient;

  const { applyTaskCreated, applyTaskUpdated, applyTaskDeleted } =
    await import("../lib/projections/task-projections");
  // ...
}

// ✗ WRONG — top-level import breaks Layer 3
import { applyTaskCreated } from "../lib/projections/task-projections";
```

The witness stub includes this warning as a comment block at the top of the file.

**The assertion pattern for lifecycle events:**

```typescript
async lifecycle(queryClient): Promise<WitnessAssertion[]> {
  const assertions: WitnessAssertion[] = [];
  const qc = queryClient as QueryClient;

  const { applyTaskCreated, applyTaskUpdated, applyTaskDeleted } =
    await import("../lib/projections/task-projections");

  // Seed the cache with the list key the hook uses
  await qc.prefetchQuery({
    queryKey: taskKeys.list({ projectId: "proj-001" }),
    queryFn: () => [],
  });

  // ── 1. Create ────────────────────────────────────────────────────────────────

  applyTaskCreated(testPayloads["task.created"]!, qc);

  const afterCreate = qc.getQueryData<Task[]>(
    taskKeys.list({ projectId: "proj-001" })
  ) ?? [];
  const created = afterCreate.find((t) => t.id === "test-task-001");

  assertions.push({ name: "task.created lands in list", ok: !!created });
  assertions.push({ name: "task.created.title preserved", ok: created?.title === "Fix bug" });
  assertions.push({ name: "task.created.projectId preserved", ok: created?.projectId === "proj-001" });

  // ── Ghost reconciliation (mandatory for create events) ────────────────────

  // Seed a ghost, apply create with matching clientTempId, assert ghost is gone
  qc.setQueryData<Task[]>(taskKeys.list({ projectId: "proj-001" }), [
    { id: "ghost-temp-01", _isOptimistic: true } as Task,
  ]);

  applyTaskCreated(
    { ...testPayloads["task.created"]!, clientTempId: "ghost-temp-01" },
    qc,
  );

  const afterReconcile = qc.getQueryData<Task[]>(
    taskKeys.list({ projectId: "proj-001" })
  ) ?? [];
  const ghostGone = !afterReconcile.find((t) => t.id === "ghost-temp-01");
  const realPresent = !!afterReconcile.find((t) => t.id === "test-task-001");

  assertions.push({
    name: "task.created replaces ghost (clientTempId reconciliation)",
    ok: ghostGone && realPresent,
  });

  // ── 2. Update ────────────────────────────────────────────────────────────────

  applyTaskUpdated(testPayloads["task.updated"]!, qc);

  const afterUpdate = qc.getQueryData<Task[]>(
    taskKeys.list({ projectId: "proj-001" })
  ) ?? [];
  const updated = afterUpdate.find((t) => t.id === "test-task-001");

  assertions.push({ name: "task.updated.title preserved", ok: updated?.title === "Fix bug (revised)" });

  // ── 3. Delete ────────────────────────────────────────────────────────────────

  applyTaskDeleted(testPayloads["task.deleted"]!, qc);

  const afterDelete = qc.getQueryData<Task[]>(
    taskKeys.list({ projectId: "proj-001" })
  ) ?? [];
  const deleted = !afterDelete.find((t) => t.id === "test-task-001");

  assertions.push({ name: "task.deleted removes entity", ok: deleted });

  return assertions;
},
```

**One assertion per `requiredField`** — `task.created.title preserved`, `task.created.projectId preserved`, etc. These assertions prove field survival: that the field in `requiredFields` actually exists in the cache after the projection runs.

If the payload used `taskTitle` instead of `title`, the cache would have `taskTitle`, not `title`. The assertion `task.created.title preserved` would fail (`created?.title === undefined`), revealing the field name mismatch.

---

## Step 5: Fill signals{} for non-lifecycle events

The `signals` map is for events that do not fit the create/update/delete lifecycle: `task.assigned`, `task.priority-changed`, `task.comment-count-updated`, etc.

Each signal entry is an async function that seeds the cache, applies the projection, and returns assertions:

```typescript
signals: {
  "task.priority-changed": async (queryClient) => {
    const assertions: WitnessAssertion[] = [];
    const qc = queryClient as QueryClient;

    const { applyTaskPriorityChanged } =
      await import("../lib/projections/task-projections");

    // Seed an existing task in cache
    qc.setQueryData<Task[]>(taskKeys.list({ projectId: "proj-001" }), [
      { id: "test-task-001", title: "Fix bug", priority: "LOW", projectId: "proj-001" } as Task,
    ]);

    applyTaskPriorityChanged(testPayloads["task.priority-changed"]!, qc);

    const list = qc.getQueryData<Task[]>(
      taskKeys.list({ projectId: "proj-001" })
    ) ?? [];
    const task = list.find((t) => t.id === "test-task-001");

    assertions.push({
      name: "task.priority-changed.priority preserved",
      ok: task?.priority === "HIGH",
    });

    return assertions;
  },
},
```

If the domain has no signal events, `signals` stays as the generated empty object `{}`.

---

## What Gate #12 checks and when it passes

| Layer   | What it checks                       | Passes when                                                                                  |
| ------- | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| Layer 1 | `requiredFields` ⊆ domain Zod schema | Every field in `requiredFields[event]` exists in `schemas/<domain>.ts`                       |
| Layer 2 | `requiredFields` ⊆ broadcast payload | The broadcast helper forwards every required field (pass-through style passes automatically) |
| Layer 3 | Dynamic projection proof             | All assertions in `lifecycle()` and `signals{}` return `ok: true`                            |
| Layer 4 | Coverage completeness                | Every event in every `*.broadcast.ts` file has a witness file                                |

After `rivergen gen`, the witness compiles and has the correct shape — Gate #12 passes Layer 1, 2, and 4. Layer 3 shows `⚠` because `lifecycle()` returns `[]`. Once you fill `lifecycle()` with real assertions and they all pass, Gate #12 passes completely.

Run `rivergen verify` after filling the witness to see the Layer 3 results.

---

## Common Layer 3 failures and fixes

**`lifecycle() returns [] (stub not filled)`**

The `lifecycle()` function returns an empty array. Fill it with at least one assertion.

**`[Layer 3] import error: Cannot find module 'react'`**

A projection file was imported at the top of the witness file (not inside `lifecycle()`). Move the import inside `lifecycle()` using `await import()`.

**`task.created.title preserved: FAIL`**

The payload used a different field name than what the cache has. Check the field name in `eventFactory.publish()` against the REST API response. The assertion `created?.title === "Fix bug"` fails when the cache has `taskTitle: "Fix bug"` instead of `title: "Fix bug"`.

**`task.created replaces ghost: FAIL`**

`clientTempId` is not reaching `applyEntityCreate`. Verify that:

1. `clientTempId` is in the `eventFactory.publish()` payload
2. `clientTempId` is declared in the `.strict()` Zod schema (otherwise it's stripped)
3. The projection passes `context.clientTempId` through to `applyEntityCreate`

---

## Related

- [docs/concepts/witness-layers.md](../concepts/witness-layers.md) — how Layer 1–4 work internally
- [docs/concepts/field-shape-law.md](../concepts/field-shape-law.md) — why field name matching is essential
- [docs/concepts/ghost-reconciliation.md](../concepts/ghost-reconciliation.md) — the ghost reconciliation assertion pattern
- [docs/guides/read-a-failure.md](read-a-failure.md) — how to read Gate #12 failure output
