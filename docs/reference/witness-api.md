# @rivergen/witness API Reference

## Import

```typescript
import type { DomainWitness, WitnessAssertion } from "@rivergen/witness";
```

Both types are imported as `type`-only. They carry no runtime behavior — `@rivergen/witness` is a pure type package.

---

## WitnessAssertion

```typescript
type WitnessAssertion = {
  name: string; // Human-readable assertion description
  ok: boolean; // true = pass, false = fail
  detail?: string; // Optional error detail shown in Gate #12 Layer 3 failure output
};
```

`name` should identify both the event and the field being checked so failures are self-describing without reading the assertion code:

```typescript
{ name: "task.created.title preserved", ok: created?.title === "Fix bug" }
{ name: "task.deleted removes entity", ok: deleted }
{ name: "task.created replaces ghost (clientTempId reconciliation)", ok: ghostGone && realPresent }
```

`detail` is appended to the violation message in Gate #12 output. Use it for values that help diagnose mismatches:

```typescript
{
  name: "task.created.title preserved",
  ok: created?.title === "Fix bug",
  detail: `Expected "Fix bug", got ${JSON.stringify(created?.title)}`,
}
```

---

## DomainWitness\<T\>

```typescript
type DomainWitness<T> = {
  domain: string;
  events: string[];
  requiredFields: Record<string, string[]>;
  testPayloads: Record<string, T & { _meta?: Record<string, unknown> }>;
  lifecycle(queryClient: unknown): Promise<WitnessAssertion[]>;
  signals: Record<
    string,
    (queryClient: unknown) => Promise<WitnessAssertion[]>
  >;
};
```

The type parameter `T` is the payload interface for this domain. TypeScript enforces that every entry in `testPayloads` satisfies `T`.

Complete example:

```typescript
export const taskWitness: DomainWitness<TaskPayload> = {
  domain: "task",
  events: ["task.created", "task.updated", "task.deleted"],

  requiredFields: {
    "task.created": ["taskId", "title", "projectId", "clientTempId"],
    "task.updated": ["taskId", "title"],
    "task.deleted": ["taskId"],
  },

  testPayloads: {
    "task.created": {
      taskId: "test-task-001",
      title: "Test Task",
      projectId: "test-project-001",
      clientTempId: null,
      _meta: {
        resourceId: "test-task-001",
        actor: { id: "user-001", type: "user" },
        context: { realmId: "test-project-001" },
        correlationId: "corr-001",
        eventVersion: "1.0",
      },
    },
    // ...one entry per event in events[]
  },

  async lifecycle(queryClient): Promise<WitnessAssertion[]> {
    const assertions: WitnessAssertion[] = [];
    // ...apply projections, assert cache state...
    return assertions;
  },

  signals: {
    "task.archived": async (queryClient) => {
      const assertions: WitnessAssertion[] = [];
      // ...per-signal assertions...
      return assertions;
    },
  },
};
```

---

## domain

```typescript
domain: string;
```

The kebab-case domain key. Must match the domain name used for the schema file (`schemas/<domain>.ts`) and broadcast file (`<domain>.broadcast.ts`).

Gate #12 Layer 1 uses this value to locate the schema file when checking `requiredFields`.

---

## events

```typescript
events: string[];
```

All broadcast events for this domain. Every event in every `*.broadcast.ts` file for the domain must appear here.

Gate #12 Layer 4 scans `*.broadcast.ts` files and checks that every emitted event name appears in some witness file's `events[]`. A missing entry is a Layer 4 error.

---

## requiredFields

```typescript
requiredFields: Record<string, string[]>;
```

One entry per event in `events[]`. Each array lists the field names that the projection reads from the incoming payload.

Rules:

- Every field listed here must exist as a top-level key in the corresponding `z.object()` entry in `schemas/<domain>.ts`. If a field is in `requiredFields` but absent from the schema, `EventFactory.publish()` validates and strips it with `.strict()` before the event reaches the broadcast layer. The field disappears silently — Gate #12 Layer 1 catches this.
- For selective broadcast helpers (where `.emit()` receives an object literal instead of the full payload variable), every field listed here must be forwarded in the emit payload — Gate #12 Layer 2 checks this. Pass-through broadcasts (the generator default, `io.to(room).emit(eventName, payload)`) satisfy Layer 2 automatically.
- Fields in `_meta` (the envelope-level fields stored in `testPayloads`) are not in `requiredFields` unless the projection explicitly reads `payload._meta` or one of its sub-fields.
- An empty array for a given event (`"task.updated": []`) means the scaffold has not been filled yet. Gate #12 Layer 1 skips empty entries — it is not an error, but the protection is inactive until fields are added.

Example:

```typescript
requiredFields: {
  "task.created": ["taskId", "title", "projectId", "clientTempId"],
  "task.updated": ["taskId", "title"],
  "task.deleted": ["taskId"],
},
```

For update events, only list the fields that the update event actually carries. For delete events, the entity ID is usually sufficient.

---

## testPayloads

```typescript
testPayloads: Record<string, T & { _meta?: Record<string, unknown> }>;
```

One entry per event in `events[]`. The entries are typed by `T` — TypeScript enforces that every field declared in `T` is present in each payload.

Rules:

- One entry required per event in `events[]`.
- Every field in `requiredFields[event]` must appear in the corresponding `testPayloads[event]` entry. Layer 3 passes this payload directly to the projection function.
- Use fixed, deterministic string IDs: `"test-task-001"`, `"test-project-001"`. Never use `randomUUID()` or `new Date()`. Non-deterministic values make Layer 3 assertions non-reproducible across runs.
- The `_meta` block mirrors `EventEnvelope` fields (`resourceId`, `actor`, `context`, `correlationId`, `eventVersion`). It is a scaffold convention for test realism. These fields do not travel over the socket — the actual socket message carries only `envelope.payload`. Include `_meta` if your projection or test setup reads envelope-level data; otherwise it is optional.
- The `correlationId` value in `_meta` should be unique per event to distinguish events in logs and assertions: `"corr-task-created-01"`, `"corr-task-updated-01"`.

Example:

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

---

## lifecycle()

```typescript
lifecycle(queryClient: unknown): Promise<WitnessAssertion[]>;
```

The dynamic projection proof. Runs in a Node.js subprocess (the Layer 3 worker). Receives a fresh `QueryClient` instance on each run — either a real `@tanstack/query-core` `QueryClient` if that package is resolvable in the subprocess environment, or a `MinimalQueryClient` fallback (see below).

### What lifecycle() must do

1. Seed the query client with an initial cache state using `prefetchQuery` or `setQueryData`.
2. Apply the projection function(s) to the test payloads from `testPayloads`.
3. Read back the cache with `getQueryData` or `getQueriesData`.
4. Push `WitnessAssertion` entries for each field and behavior being verified.
5. Return the assertions array.

The standard pattern covers the full create → update → delete sequence, with one assertion per `requiredField` per event:

```typescript
async lifecycle(queryClient): Promise<WitnessAssertion[]> {
  const assertions: WitnessAssertion[] = [];
  const qc = queryClient as QueryClient;

  const { applyTaskCreated, applyTaskUpdated, applyTaskDeleted } =
    await import("../lib/projections/task-projections");

  await qc.prefetchQuery({
    queryKey: taskKeys.list({ projectId: "proj-001" }),
    queryFn: () => [],
  });

  // 1. Create
  applyTaskCreated(testPayloads["task.created"]!, qc);
  const afterCreate = qc.getQueryData<Task[]>(taskKeys.list({ projectId: "proj-001" })) ?? [];
  const created = afterCreate.find((t) => t.id === "test-task-001");
  assertions.push({ name: "task.created lands in list", ok: !!created });
  assertions.push({ name: "task.created.title preserved", ok: created?.title === "Fix bug" });

  // 2. Update
  applyTaskUpdated(testPayloads["task.updated"]!, qc);
  const afterUpdate = qc.getQueryData<Task[]>(taskKeys.list({ projectId: "proj-001" })) ?? [];
  const updated = afterUpdate.find((t) => t.id === "test-task-001");
  assertions.push({ name: "task.updated.title preserved", ok: updated?.title === "Fix bug (revised)" });

  // 3. Delete
  applyTaskDeleted(testPayloads["task.deleted"]!, qc);
  const afterDelete = qc.getQueryData<Task[]>(taskKeys.list({ projectId: "proj-001" })) ?? [];
  assertions.push({ name: "task.deleted removes entity", ok: !afterDelete.find((t) => t.id === "test-task-001") });

  return assertions;
},
```

### Stub behavior

Returning an empty array (`return assertions` with no entries pushed, or `return []`) marks the witness as a stub. Gate #12 skips Layer 3 for that file and shows a notice:

```
Layer 3: 1 witness file(s) are stubs — fill the lifecycle() function to activate the projection proof.
Until then, Layer 3 cannot verify that fields survive the projection.
```

This is not an error — it does not fail Gate #12. But Layer 3 cannot verify field survival until at least one assertion is returned.

### CRITICAL: dynamic import rule

**Never import projection files at the top level of a witness file.** Projection files import React (directly or via TanStack Query hooks or other UI modules). React cannot load in the Node.js subprocess that runs Layer 3. A top-level import of a projection file causes the subprocess to fail when importing the witness file. The failure is silent from the gate runner's perspective — Layer 3 drops all assertions for that witness and reports a warning.

```typescript
// WRONG: top-level import — React cannot load in Node.js subprocess
import { applyTaskCreated } from "../lib/projections/task-projections";

// CORRECT: dynamic import inside lifecycle()
async lifecycle(queryClient): Promise<WitnessAssertion[]> {
  const { applyTaskCreated } = await import("../lib/projections/task-projections");
  // ...
}
```

Type-only imports (`import type { QueryClient } from "@tanstack/react-query"`) are safe at the top level because they are erased at compile time and never evaluated by the subprocess loader.

The generated scaffold includes this rule as a comment block at the top of the witness file.

---

## signals{}

```typescript
signals: Record<string, (queryClient: unknown) => Promise<WitnessAssertion[]>>;
```

One entry per non-lifecycle event — events that are not covered by the create/update/delete sequence in `lifecycle()`. Examples: `"task.assigned"`, `"task.priority-changed"`, `"task.comment-count-updated"`.

Rules:

- Each entry key must be an event name from `events[]`.
- Each function receives its own independent fresh `QueryClient` instance — not shared with `lifecycle()` and not shared with other signal entries. State seeded in `lifecycle()` is not visible in `signals{}` functions.
- Runs after `lifecycle()` in the worker. Each signal function is called independently via `Object.entries(witness.signals)`.
- The same dynamic import rule applies: import projection functions inside the signal function using `await import()`, not at the top of the file.
- The same stub behavior applies: returning an empty array skips that signal's assertions without error.
- If all domain events are covered in `lifecycle()`, `signals` must still be present but can be an empty object: `signals: {}`.

Example:

```typescript
signals: {
  "task.archived": async (queryClient) => {
    const assertions: WitnessAssertion[] = [];
    const qc = queryClient as QueryClient;

    const { applyTaskArchived } = await import("../lib/projections/task-projections");

    qc.setQueryData<Task[]>(taskKeys.list({ projectId: "proj-001" }), [
      { id: "test-task-001", title: "Fix bug", archived: false, projectId: "proj-001" } as Task,
    ]);

    applyTaskArchived(testPayloads["task.archived"]!, qc);

    const list = qc.getQueryData<Task[]>(taskKeys.list({ projectId: "proj-001" })) ?? [];
    const task = list.find((t) => t.id === "test-task-001");

    assertions.push({ name: "task.archived.archived field set", ok: task?.archived === true });

    return assertions;
  },
},
```

---

## MinimalQueryClient fallback

When `@tanstack/query-core` is not resolvable in the Layer 3 subprocess environment (for example, in monorepos where the frontend packages are not installed in the API package's `node_modules`), the worker falls back to `MinimalQueryClient` — an in-process implementation backed by a `Map<string, unknown>`.

`MinimalQueryClient` is sufficient for all standard entity-cache assertion patterns. Its API surface:

| Method              | Signature                                                                                     | Behavior                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `getQueryData`      | `getQueryData<T>(key: unknown[]): T \| undefined`                                             | Returns cached value for the serialized key, or `undefined` if not set.                |
| `setQueryData`      | `setQueryData(key: unknown[], data: unknown): void`                                           | Stores `data` under the serialized key. Overwrites any existing value.                 |
| `prefetchQuery`     | `prefetchQuery(opts: { queryKey: unknown[]; queryFn: () => unknown }): Promise<void>`         | Calls `queryFn()` and stores the result via `setQueryData`.                            |
| `invalidateQueries` | `invalidateQueries(): Promise<void>`                                                          | No-op. Returns a resolved promise.                                                     |
| `setQueriesData`    | `setQueriesData(filters: { predicate?, queryKey?, type? }, updater: (data) => unknown): void` | Applies `updater` to all cache entries matching the filter. See prefix matching below. |
| `getQueriesData`    | `getQueriesData<T>(filters?: { predicate?, queryKey? }): [unknown[], T \| undefined][]`       | Returns all `[queryKey, data]` pairs matching the filter.                              |

### Prefix matching in setQueriesData and getQueriesData

When `filters.queryKey` is provided (and `filters.predicate` is not), `MinimalQueryClient` uses prefix matching: a filter key of `["tasks", "list"]` matches any cached key whose entries begin with `["tasks", "list"]` — including `["tasks", "list", "proj-001"]` and `["tasks", "list", "proj-002"]`.

This is equivalent to TanStack Query's `setQueriesData` with a prefix predicate (`queryKey.every((v, i) => cachedKey[i] === v)`).

When `filters.predicate` is provided, it receives `{ queryKey: unknown[] }` and the entry is included if the predicate returns `true`. This matches the entity-cache helpers' predicate-based patterns.

When `filters.type` is `"active"` (as used by `applyEntityDelete`), all entries in the in-memory cache are treated as active — the filter is satisfied for all keys.

---

## Layer 3 execution

Gate #12 spawns `layer3-worker.ts` as a subprocess using the `tsx` CLI:

```
node --import tsx/esm layer3-worker.ts <projectRoot> <relPath1> [relPath2] ...
```

The subprocess outputs a single JSON object to stdout containing all violations, assertion counts, and skip/import-failure summaries.

For each witness file the worker:

1. Dynamically imports the file via `import(fileUrl)`.
2. Locates the exported `DomainWitness` object by scanning all named exports for an object with `domain: string`, `lifecycle: function`, and `signals: object`.
3. Resolves the `QueryClient` constructor (real `@tanstack/query-core` or `MinimalQueryClient`).
4. Calls `lifecycle(new Ctor())` and collects the returned assertions.
5. For each entry in `signals`, calls `signalFn(new Ctor())` and collects the assertions.
6. Each call gets its own independent `new Ctor()` instance — state does not carry over.

If step 1 fails (the file cannot be imported), the worker records a warning and skips all assertions for that file. This is the silent failure mode caused by top-level projection imports. The worker includes a hint in the warning message if the error message mentions React, JSX, `document`, `window`, or `navigator`.

If `lifecycle()` or a signal function throws an exception, the worker records it as a failing assertion with `name` set to `"lifecycle() threw an exception"` or `"signals[\"event\"]() threw an exception"` and `detail` set to the error string.

If all assertions across `lifecycle()` and `signals{}` total zero, the file is counted as skipped (stub) rather than active.

---

## Related

- [docs/concepts/witness-layers.md](../concepts/witness-layers.md) — how Gate #12 Layers 1–4 work internally
- [docs/guides/write-a-witness.md](../guides/write-a-witness.md) — step-by-step guide from scaffold to fully passing Gate #12
- [docs/concepts/event-envelope.md](../concepts/event-envelope.md) — what fields travel over the socket versus what stays in the envelope
- [docs/concepts/entity-cache.md](../concepts/entity-cache.md) — the `applyEntityCreate/Update/Delete` helpers used in lifecycle assertions
- [docs/concepts/ghost-reconciliation.md](../concepts/ghost-reconciliation.md) — the `clientTempId` reconciliation assertion pattern
