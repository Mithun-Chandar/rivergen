# Failure Lab

Real `rivergen verify` output for each gate violation, with the broken code and the fix.

Every example below is run against a minimal isolated fixture. In a real project some gates co-fire (e.g. a missing listener also triggers Gate #2 even if Gate #7 is the violation you care about). Where that happens, the relevant gate is called out and the co-fire is noted.

---

## How to read the output

```
  ✗  Gate #1: Mutation → EventFactory.publish
     1/1 mutation files wired to eventFactory.publish().

     ✗  [ERROR] apps\api\src\task\task.mutations.ts:12
            Direct socket.emit() in mutation file is forbidden. …
```

- `✗` = gate failed; `✓` = passed; `○` = skipped (skip-eligible gate, nothing to check)
- `[ERROR]` violations fail the run (exit code 1); `[WARN]` violations do not
- The file path and line number point directly to the offending code

---

## Gate #1 — Mutation → EventFactory.publish

### Variant A: direct `socket.emit` in a mutation file

**Broken code** (`apps/api/src/task/task.mutations.ts`):

```typescript
export async function createTask(io: Server, data: CreateTaskInput) {
  const task = await db.task.create({ data });
  // wrong: bypasses EventFactory and its schema validation
  io.emit("task.created", { taskId: task.id });
  return task;
}
```

**Verify output:**

```
  ✗  Gate #1: Mutation → EventFactory.publish
     1/1 mutation files wired to eventFactory.publish().

     ✗  [ERROR] apps\api\src\task\task.mutations.ts:12
            Direct socket.emit() in mutation file is forbidden. Use eventFactory.publish().
```

**Fix:** Remove the `io.emit` call and use `eventFactory.publish()`:

```typescript
export async function createTask(
  eventFactory: EventFactory,
  data: CreateTaskInput,
) {
  const task = await db.task.create({ data });
  await eventFactory.publish("task.created", {
    taskId: task.id,
    projectId: task.projectId,
  });
  return task;
}
```

---

### Variant B: direct `eventBus.publish` in a mutation file

**Broken code** (`apps/api/src/task/task.mutations.ts`):

```typescript
export async function createTask(eventBus: EventBus, data: CreateTaskInput) {
  const task = await db.task.create({ data });
  // wrong: skips EventFactory's schema validation and goes straight to the bus
  await eventBus.publish("task.created", { taskId: task.id });
  return task;
}
```

**Verify output:**

```
  ✗  Gate #1: Mutation → EventFactory.publish
     1/1 mutation files wired to eventFactory.publish().

     ✗  [ERROR] apps\api\src\task\task.mutations.ts:13
            Direct eventBus.publish() in mutation file is forbidden. EventFactory.publish() is the only
            legal event emission path. EventFactory validates the payload schema and then delegates to
            EventBus internally.
```

**Fix:** Same as Variant A — replace `eventBus.publish` with `eventFactory.publish`.

---

## Gate #2 — Event → Listener → Broadcaster → socket.emit

### Missing EventBus listener

**Broken state:** A schema entry exists for `task.created` (so EventFactory can publish it), and a broadcast helper exists, but there is no `*.listener.ts` file that subscribes to the event.

**Verify output:**

```
  ✗  Gate #2: Event → Listener → Broadcaster → socket.emit
     0/1 events have complete listener→broadcast chain.

     ✗  [ERROR] apps/api/src/lib/event-bus-listeners/
            "task.created": no listener found. Add eventBus.subscribe(WorkspaceEvent.TASK_CREATED)
            in a *.listener.ts file.
```

**Fix:** Create `apps/api/src/lib/event-bus-listeners/task.listener.ts`:

```typescript
import { eventBus } from "../event-bus.service";
import { broadcastTaskCreated } from "../../task/task.broadcast";

eventBus.subscribe("task.created", (payload) => {
  broadcastTaskCreated(io, payload);
});
```

---

## Gate #4 — Projection → entity-cache helpers

### Projection does not call entity-cache helpers

**Broken code** (`apps/web/src/lib/projections/task-projections.ts`):

```typescript
export function applyTaskProjection(
  payload: unknown,
  queryClient: unknown,
): void {
  // wrong: no call to applyEntityCreate / applyEntityUpdate / applyEntityDelete
  // data is discarded — cache never updates
}
```

**Verify output:**

```
  ✗  Gate #4: Projection → entity-cache helpers
     0/1 projection files use entity-cache helpers correctly.

     ✗  [ERROR] apps\web\src\lib\projections\task-projections.ts
            No entity-cache helpers imported. Projection files must import applyEntityCreate,
            applyEntityUpdate, or applyEntityDelete from entity-cache. For map-type projections,
            add // gate4:map-projection to the top of the file.
     ✗  [ERROR] apps\web\src\lib\projections\task-projections.ts
            Exports 1 function(s) but none call applyEntityCreate/Update/Delete. Wire at least
            one entity-cache helper call.
```

**Fix:**

```typescript
import { applyEntityCreate } from "../cache/entity-cache";

export function applyTaskProjection(
  payload: Record<string, unknown>,
  queryClient: unknown,
): void {
  applyEntityCreate(queryClient, ["tasks", payload.projectId], payload);
}
```

---

## Gate #5 — Broadcast Room Scoping

### `io.emit()` with no room target

**Broken code** (`apps/api/src/task/task.broadcast.ts`):

```typescript
export function broadcastTaskCreated(
  io: Server,
  payload: TaskCreatedPayload,
): void {
  // wrong: emits to ALL connected sockets, ignoring room scoping
  io.emit("task.created", payload);
}
```

**Verify output:**

```
  ✗  Gate #5: Broadcast Room Scoping (PRIVATE entities → scoped rooms)
     0/1 broadcast files comply with room scoping law.

     ✗  [ERROR] apps\api\src\task\task.broadcast.ts:9
            io.emit() with no room is forbidden — broadcasts to ALL connected sockets.
            Always use io.to(room).emit().
```

**Fix:**

```typescript
export function broadcastTaskCreated(
  io: Server,
  payload: TaskCreatedPayload,
): void {
  const room = `project:${payload.projectId}`;
  io.to(room).emit("task.created", payload);
}
```

---

## Gate #6 — EventFactory Schema Coverage

### Event emitted but not registered in `EventPayloadSchemas`

**Broken state:** The broadcast helper calls `.emit("task.created", ...)` but there is no matching entry in `EventPayloadSchemas`. EventFactory has no schema to validate against.

**Verify output:**

```
  ✗  Gate #6: EventFactory Schema Coverage
     0/1 emitted events have schema entries. 0 total schemas registered.

     ✗  [ERROR] apps\api\src\task\task.broadcast.ts:11
            "task.created": emitted via socket.emit but not registered in EventPayloadSchemas.
            Add a .strict() Zod schema entry.
```

**Fix:** Add an entry in `apps/api/src/lib/event-factory/schemas/task.ts`:

```typescript
import { z } from "zod";

export const taskSchemas = {
  "task.created": z
    .object({
      taskId: z.string(),
      projectId: z.string(),
      title: z.string(),
    })
    .strict(),
};
```

Then import and spread `taskSchemas` into `EventPayloadSchemas` in `schemas/_index.ts`.

---

## Gate #7 — Schema `.strict()` Enforcement

### Schema uses `z.object()` without `.strict()`

> Note: in the fixture below, Gate #2 also fires because the listener file is absent. In a real project where Gate #2 already passes, only Gate #7 would fire.

**Broken code** (`apps/api/src/lib/event-factory/schemas/task.ts`):

```typescript
import { z } from "zod";

export const taskSchemas = {
  "task.created": z.object({
    taskId: z.string(),
    projectId: z.string(),
  }),
  // missing .strict() — extra fields are silently accepted and forwarded
};
```

**Verify output:**

```
  ✗  Gate #7: Schema .strict() Enforcement
     0/1 schema entries use .strict().

     ✗  [ERROR] apps\api\src\lib\event-factory\schemas\task.ts:5
            z.object() schema entry is missing .strict(). Every EventFactory schema must use .strict()
            to prevent silent extra-field acceptance at publish time.
```

**Fix:** Chain `.strict()` after every `z.object()` in schema files:

```typescript
"task.created": z.object({
  taskId: z.string(),
  projectId: z.string(),
}).strict(),
```

---

## Gate #8 — WebSocketProvider Entity-Cache Isolation

### WebSocketProvider imports entity-cache directly

**Broken code** (`apps/web/src/providers/WebSocketProvider.tsx`):

```typescript
import { applyEntityCreate } from "../lib/cache/entity-cache";

socket.on("task.created", (payload) => {
  // wrong: projection logic lives here instead of in a projection file
  applyEntityCreate(queryClient, ["tasks", payload.projectId], payload);
});
```

**Verify output:**

```
  ✗  Gate #8: WebSocketProvider Entity-Cache Isolation
     2 isolation violation(s) in WebSocketProvider.tsx.

     ✗  [ERROR] apps/web/src/providers/WebSocketProvider.tsx:1
            WebSocketProvider.tsx must not import from entity-cache. Route all events through
            applyRealtimeEventToCache() (state-cache dispatcher). Entity-cache imports belong
            only in projection files.
     ✗  [ERROR] apps/web/src/providers/WebSocketProvider.tsx:6
            WebSocketProvider.tsx must not call applyEntity*() directly. All domain events must
            route through applyRealtimeEventToCache() → dispatcher → projection → entity-cache.
```

**Fix:** Remove the import and the direct call. Route through `applyRealtimeEventToCache`:

```typescript
import { applyRealtimeEventToCache } from "../lib/cache/state-cache";

socket.on("task.created", (payload) => {
  applyRealtimeEventToCache("task.created", payload, queryClient);
});
```

The dispatcher maps `"task.created"` to `applyTaskProjection`, which calls entity-cache. `WebSocketProvider` never touches entity-cache directly.

---

## Gate #9 — No Cache Writes in `onSuccess`

### `queryClient.invalidateQueries` inside `onSuccess`

**Broken code** (`apps/web/src/hooks/use-task.ts`):

```typescript
useMutation({
  mutationFn: createTask,
  onMutate: async (data) => {
    /* optimistic */
  },
  onSuccess: () => {
    // wrong: manually forcing a cache refresh — this competes with the
    // WebSocket projection and creates a duplicate update path
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  },
  onError: (_, __, context) => {
    /* rollback */
  },
});
```

**Verify output:**

```
  ✗  Gate #9: No Cache Writes in onSuccess
     0/1 hook file(s) free of onSuccess cache writes. 1 onSuccess block(s) scanned.

     ✗  [ERROR] apps\web\src\hooks\use-task.ts:24
            queryClient.invalidateQueries() in onSuccess is forbidden. Cache convergence must arrive
            via the WebSocket projection pipeline (onMutate → optimistic; WS event → projection →
            entity-cache). Remove from onSuccess.
```

**Fix:** Delete the `onSuccess` callback entirely. Cache convergence arrives through the WebSocket event:

```typescript
useMutation({
  mutationFn: createTask,
  onMutate: async (data) => {
    /* stamp optimistic ghost */
  },
  onError: (_, __, context) => {
    /* roll back ghost */
  },
  // no onSuccess — the WS event triggers the projection, which updates the cache
});
```

---

## Gate #10 — Optimistic UI Coverage

### `useMutation` missing `onMutate`

**Broken code** (`apps/web/src/hooks/use-task.ts`):

```typescript
useMutation({
  mutationFn: createTask,
  // wrong: no onMutate — the UI shows no immediate feedback;
  // the cache only updates when the WS event arrives (100-300 ms later)
  onError: (error) => {
    console.error("create failed", error);
  },
});
```

**Verify output:**

```
  ✗  Gate #10: Optimistic UI Coverage (onMutate + onError)
     0/1 useMutation block(s) have both onMutate and onError.

     ✗  [ERROR] apps\web\src\hooks\use-task.ts:5
            useMutation is missing onMutate. All mutations must set up optimistic state immediately
            (Real-Time Trinity law). Add onMutate to apply an optimistic update and return rollback context.
```

**Fix:** Add `onMutate` that stamps an optimistic entry and returns rollback context:

```typescript
useMutation({
  mutationFn: createTask,
  onMutate: async (data) => {
    await queryClient.cancelQueries({ queryKey: ["tasks", data.projectId] });
    const previous = queryClient.getQueryData(["tasks", data.projectId]);
    queryClient.setQueryData(["tasks", data.projectId], (old: Task[]) => [
      ...old,
      {
        ...data,
        id: `temp-task-${Date.now()}`,
        clientTempId: data.clientTempId,
      },
    ]);
    return { previous };
  },
  onError: (_, data, context) => {
    queryClient.setQueryData(["tasks", data.projectId], context?.previous);
  },
});
```

---

## Gate #12 — Witness: Field Continuity Coverage

Gate #12 runs four layers of checks. Each layer has its own failure mode.

---

### Layer 1 — Schema contract: required field missing from Zod schema

**What happened:** The witness `requiredFields` for `task.created` includes `"title"`, but the Zod schema for `task.created` only declares `taskId` and `projectId`. EventFactory's `.strict()` will strip `title` at publish time — the field never enters the pipeline.

**Broken schema** (`apps/api/src/lib/event-factory/schemas/task.ts`):

```typescript
export const taskSchemas = {
  "task.created": z
    .object({
      taskId: z.string(),
      projectId: z.string(),
      // "title" is absent — .strict() will reject or strip any payload that includes it
    })
    .strict(),
};
```

**Broken witness** (`apps/web/src/witness/task.witness.ts`):

```typescript
requiredFields: {
  "task.created": ["taskId", "projectId", "title"],  // "title" is not in the schema
},
```

**Verify output (Gate #12 section):**

```
  ✗  Gate #12: Witness — Field Continuity Coverage
     1 schema/broadcast contract error(s)

     ✗  [ERROR] apps/api/src/lib/event-factory/schemas/task.ts
            Layer 1: witness requiredField "title" for "task.created" is not declared in the Zod schema.
            EventFactory will strip it silently at publish time.
```

**Fix:** Add `title` to the schema, or remove `"title"` from `requiredFields` if it genuinely is not required.

```typescript
"task.created": z.object({
  taskId: z.string(),
  projectId: z.string(),
  title: z.string(),   // ← add
}).strict(),
```

---

### Layer 2 — Broadcast contract: required field dropped in selective emit

**What happened:** The broadcast helper only forwards `taskId` in the payload object. The witness requires both `taskId` and `title`, but `title` is never sent over the WebSocket.

**Broken broadcast** (`apps/api/src/task/task.broadcast.ts`):

```typescript
io.to(`project:${projectId}`).emit("task.created", {
  taskId: payload.taskId,
  // "title" is dropped — it never reaches the client
});
```

**Verify output (Gate #12 section):**

```
  ✗  Gate #12: Witness — Field Continuity Coverage
     1 schema/broadcast contract error(s)

     ✗  [ERROR] apps/api/src/task/task.broadcast.ts
            Layer 2: witness requiredField "title" for "task.created" is not forwarded in the
            selective broadcast emit. Add it to the payload object.
```

**Fix:** Forward all required fields:

```typescript
io.to(`project:${projectId}`).emit("task.created", {
  taskId: payload.taskId,
  title: payload.title, // ← add
});
```

---

### Layer 3 — Dynamic projection proof: static import of a React-dependent file

**What happened:** The witness file statically imports the projection function at the top of the file. The projection file imports React. When Gate #12 Layer 3 spawns a Node.js subprocess to run `lifecycle()`, it tries to load the witness module — which triggers the static import — which tries to import React — which fails in a plain Node.js environment.

**Broken witness** (`apps/web/src/witness/task.witness.ts`):

```typescript
// wrong: static import at module scope — the subprocess fails on this line
import { applyTaskProjection } from "../lib/projections/task-projections";

export const taskWitness = {
  // ...
  async lifecycle(queryClient: unknown) {
    applyTaskProjection({ taskId: "test-task-001" }, queryClient);
    return [{ name: "taskId preserved", ok: true }];
  },
};
```

**Verify output (Gate #12 section):**

```
  ✓  Gate #12: Witness — Field Continuity Coverage
     1/1 events covered, schema+broadcast contracts satisfied.

     ⚠  [WARN]  apps\web\src\witness\task.witness.ts
            Layer 3: cannot import witness file — Error: Cannot find package 'react' imported from
            E:\…\task-projections.ts. The projection file imports React or browser globals,
            which cannot run in Node.js. Keep the projection import lines commented out in the witness
            file and call the projection functions directly inside lifecycle() without importing them
            at the top level.
```

> Note: Layer 3 failures appear as `⚠ [WARN]` (not `[ERROR]`), so the gate shows `✓` but with a warning. The violation is still reported so it cannot be missed.

**Fix:** Remove the static import. Call the projection inline inside `lifecycle()` without importing it at the top level, or restructure the projection so it has no React dependency:

```typescript
// No top-level import of task-projections

export const taskWitness = {
  // ...
  async lifecycle(queryClient: unknown) {
    // Apply projection logic directly, without a static import
    const payload = { taskId: "test-task-001", title: "Test Task" };
    applyEntityCreate(queryClient, ["tasks", "test-project-001"], payload);
    const cached = (queryClient as any).getQueryData([
      "tasks",
      "test-project-001",
    ]);
    const entity = Array.isArray(cached) ? cached[0] : undefined;
    return [
      {
        name: "title in cache",
        ok: entity?.title === "Test Task",
        detail: `got ${entity?.title}`,
      },
    ];
  },
};
```

---

### Layer 4 — Projection assertion failure: field shape law violation

**What happened:** `lifecycle()` seeds a payload, calls the projection, then reads back from the cache. The projection writes `creatorId` but the witness asserts that `title` lands in cache. The assertion fails.

**Broken `lifecycle()`** (`apps/web/src/witness/task.witness.ts`):

```typescript
async lifecycle(_queryClient: unknown) {
  return [
    {
      name: "task.created preserves title in cache",
      ok: false,
      detail:
        "expected 'Test Task' in cache but got undefined — check applyTaskCreated spreads payload.title into the cached entity",
    },
  ];
},
```

**Verify output (Gate #12 section):**

```
  ✗  Gate #12: Witness — Field Continuity Coverage
     Layer 3: 1 projection assertion(s) failed

     ✗  [ERROR] apps\web\src\witness\task.witness.ts
            Layer 3: assertion "task.created preserves title in cache" failed.
            expected 'Test Task' in cache but got undefined — check applyTaskCreated spreads
            payload.title into the cached entity
```

**Fix:** The assertion detail tells you exactly what to check — the projection is not forwarding `title` into the cached entity. Open the projection file and verify that `payload.title` is spread or explicitly assigned:

```typescript
export function applyTaskCreated(
  payload: TaskCreatedPayload,
  queryClient: QueryClient,
): void {
  applyEntityCreate(queryClient, ["tasks", payload.projectId], {
    id: payload.taskId,
    title: payload.title, // ← ensure this is forwarded
    projectId: payload.projectId,
  });
}
```

Then update `lifecycle()` to run the projection and assert the result dynamically:

```typescript
async lifecycle(queryClient: unknown) {
  const payload = { taskId: "t-001", projectId: "p-001", title: "Test Task" };
  applyTaskCreated(payload, queryClient as QueryClient);
  const list = (queryClient as QueryClient).getQueryData<Task[]>(["tasks", "p-001"]) ?? [];
  const entity = list.find((t) => t.id === "t-001");
  return [
    {
      name: "task.created preserves title in cache",
      ok: entity?.title === "Test Task",
      detail: `got ${entity?.title}`,
    },
  ];
},
```

---

## Gates not demonstrated here

| Gate                                          | Why not demonstrated                                                                                                                                                                                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#3** WS socket.on → Dispatcher → Projection | Requires a complete ws-bindings + dispatcher + projection stack. Violations occur when a `socket.on` binding exists but the event name is not routed through `applyRealtimeEventToCache`. The error message names the missing event and the file it should appear in. |
| **#11** Event Audit Coverage                  | Requires the three Phase 4/5/6 audit artifact files to exist. When they are absent, Gate #11 skips silently. When present but incomplete, it reports each missing event by name.                                                                                      |

For full descriptions of every gate including skip conditions, see [docs/reference/gates.md](../reference/gates.md).
