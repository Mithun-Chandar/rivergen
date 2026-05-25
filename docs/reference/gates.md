# Gate Reference

This document is the authoritative reference for all twelve RiverGen verification gates. Run them with:

```
rivergen verify
```

Each gate is a static (or, for Gate #12 Layer 3, dynamic) assertion about the project's realtime pipeline. A gate failure blocks the scaffold from being considered lawful. Warnings are advisory and do not block the build.

---

## Summary Table

| #   | GATE_NAME                                                         | Kind                       | Skip-eligible                                      |
| --- | ----------------------------------------------------------------- | -------------------------- | -------------------------------------------------- |
| 1   | Gate #1: Mutation → EventFactory.publish                          | static                     | no                                                 |
| 2   | Gate #2: Event → Listener → Broadcaster → socket.emit             | static                     | no                                                 |
| 3   | Gate #3: WS socket.on → Dispatcher → Projection call              | static                     | no                                                 |
| 4   | Gate #4: Projection → entity-cache helpers                        | static                     | no                                                 |
| 5   | Gate #5: Broadcast Room Scoping (PRIVATE entities → scoped rooms) | static                     | no                                                 |
| 6   | Gate #6: EventFactory Schema Coverage                             | static                     | no                                                 |
| 7   | Gate #7: Schema .strict() Enforcement                             | static                     | no                                                 |
| 8   | Gate #8: WebSocketProvider Entity-Cache Isolation                 | static                     | no                                                 |
| 9   | Gate #9: No Cache Writes in onSuccess                             | static                     | no                                                 |
| 10  | Gate #10: Optimistic UI Coverage (onMutate + onError)             | static                     | no                                                 |
| 11  | Gate #11: Event Audit Coverage                                    | static                     | yes — skipped when no phase4/5/6 audit files exist |
| 12  | Gate #12: Witness — Field Continuity Coverage                     | static + dynamic (Layer 3) | yes — skipped when `witnessDir` is absent          |

**Violation format**

Errors:

```
     ✗  [ERROR] apps/api/src/task/task.mutations.ts:14
                Direct socket.emit() call bypasses EventFactory — use eventFactory.publish()
```

Warnings:

```
     ⚠  [WARN]  apps/api/src/task/task.broadcast.ts:8
                workspace-wide emit detected. Verify this entity cannot be PRIVATE.
```

---

## Gate #1: Mutation → EventFactory.publish

**Scan scope:** `apps/api/src/**/*.mutations.ts`

### What it checks

Every mutation file must:

1. Import `eventFactory` (the singleton) or `EventFactory` (the class).
2. Call `.publish(` at least once.

In addition, every non-comment line is scanned for three banned patterns:

- `io.to(...).emit(` — direct Socket.IO room emit
- `socket.emit(` — direct socket emit
- `eventBus.publish(` — direct EventBus bypass

Any of these banned patterns is an error regardless of whether `.publish()` is also called.

### What it does NOT check

- The shape of the payload passed to `eventFactory.publish()`.
- Whether the event name is registered in `EventPayloadSchemas` (that is Gate #6).
- Mutation files outside `apps/api/src/` (or the configured `api.srcRoot`).
- Comment lines — a `socket.emit(` on a line that starts with `//` is ignored.

### Example violation

```
     ✗  [ERROR] apps/api/src/task/task.mutations.ts:14
                Direct socket.emit() in mutation file is forbidden. Use eventFactory.publish().
```

```
     ✗  [ERROR] apps/api/src/notification/notification.mutations.ts:22
                Direct eventBus.publish() in mutation file is forbidden. EventFactory.publish()
                is the only legal event emission path. EventFactory validates the payload
                schema and then delegates to EventBus internally.
```

### How to fix

Replace the direct call with `eventFactory.publish("event.name", payload)`. Add the `eventFactory` import from `~/lib/event-factory` if it is absent. The EventBus listener registered in the corresponding `*.listener.ts` file is responsible for forwarding the event to Socket.IO — the mutation file must not do this itself.

---

## Gate #2: Event → Listener → Broadcaster → socket.emit

**Scan scopes:**

- Events: `EventPayloadSchemas` keys in the configured `api.schemasFile`
- Listeners: `apps/api/src/lib/event-bus-listeners/**/*.listener.ts`
- Broadcasters: `apps/api/src/**/*.broadcast.ts`

### What it checks

For every event type registered in `EventPayloadSchemas` the gate verifies two things:

1. At least one listener file subscribes to it via `eventBus.subscribe(...)`. Any of the three subscription forms are recognised:
   - `eventBus.subscribe(WorkspaceEvent.CONSTANT, …)` (v1 legacy)
   - `eventBus.subscribe(RealtimeEvent.PascalCase, …)` (v2 current)
   - `eventBus.subscribe("dot.notation.event", …)` (string literal)

2. That event string is emitted in a broadcast file via one of:
   - `.emit("event.name")`
   - `broadcastXxx(io, "event.name", …)` — the two-argument helper form

The gate also warns (advisory, non-blocking) when a broadcast file emits an event string that has no corresponding entry in `EventPayloadSchemas`.

### What it does NOT check

- The payload shape at publish or emit time (Gate #6 checks schema coverage; Gate #7 checks `.strict()`).
- Whether `socket.emit` is called inside the broadcast function body — only the string literal at the call site is matched.
- Events that are emitted only via a non-string-literal variable (e.g. `io.emit(eventName)` where `eventName` is a variable).
- Listener files that import events from paths other than `WorkspaceEvent` or `RealtimeEvent` constants, or that use non-`eventBus.subscribe` subscription APIs.

### Example violation

```
     ✗  [ERROR] apps/api/src/lib/event-factory/schemas.ts
                "task.assigned": registered in EventPayloadSchemas but has no listener
                (eventBus.subscribe) and no broadcast emit. The full pipeline is broken.
```

```
     ✗  [ERROR] apps/api/src/lib/event-bus-listeners/
                "task.assigned": no listener found. Add
                eventBus.subscribe(WorkspaceEvent.TASK_ASSIGNED) in a *.listener.ts file.
```

```
     ⚠  [WARN]  apps/api/src/task/task.broadcast.ts:8
                "task.legacy-ping": emitted via socket.emit but not registered in
                EventPayloadSchemas. Add a schema entry.
```

### How to fix

**No listener:** Generate or add a `*.listener.ts` file that calls `eventBus.subscribe("event.name", handler)`. The handler is responsible for calling the broadcast helper.

**No broadcast emit:** Add a broadcast helper function in a `*.broadcast.ts` file that calls `io.to(room).emit("event.name", payload)`. Wire the listener to call that helper.

**Both missing:** Add both the listener and the broadcast helper. Run `rivergen gen` to scaffold them from the domain spec.

**Orphan schema warning:** Either add the missing broadcast call, or remove the schema entry if the event is no longer used.

---

## Gate #3: WS socket.on → Dispatcher → Projection call

**Scan scopes:**

- Provider: `apps/web/src/providers/WebSocketProvider.tsx` (configured via `web.providerFile`)
- Dispatcher: `apps/web/src/lib/cache/state-cache.ts` (configured via `web.stateCacheFile`)
- Projections: `apps/web/src/lib/projections/**/*-projections.ts` (configured via `web.projectionsDir`)
- WS bindings slices: `web.wsBindingsDir` (scanned when `getAllWsBindings()` is present in the provider)
- Domain dispatcher slices: `web.dispatchersDir` (scanned when `domainDispatchers` pattern is present)

### What it checks

The frontend realtime pipeline has three stages that must all be connected:

1. **Provider binds the event** — `WebSocketProvider.tsx` calls `socket.on("event.name", ...)`. The gate resolves all three binding forms: `socket.on(WS_EVENT_CONSTANT, ...)`, `socket.on(RealtimeEvent.Foo, ...)`, and `socket.on("event.name", ...)`. If the provider uses `getAllWsBindings()`, the gate scans the ws-bindings slice files for bound event strings instead.

2. **Dispatcher handles the event** — `state-cache.ts` has a `switch` case for the event string, or a domain-dispatchers slice maps it via `domainDispatchers[event]?.()`. The gate resolves `RealtimeEvent.Foo` constants to their string values.

3. **Dispatcher calls a projection function** — the case block (or the domain-dispatchers entry) calls an `apply*Projection(` function. For domain-dispatchers slices, the mapping must be of the form `"event.name": (payload, qc) => applyXxx(...)`.

The gate also warns (advisory) when a dispatcher case covers an event that is not bound in the provider.

Socket.IO lifecycle events (`connect`, `disconnect`, `connect_error`, etc.) are automatically excluded from all checks.

### What it does NOT check

- Whether the `apply*Projection` function is defined in a projection file that is correctly imported by the dispatcher. Exported function names are collected from projection files but the gate only verifies that a call by that name exists in the dispatcher scope.
- The correctness of the projection logic itself (Gate #12 Layer 3 covers that).
- WS bindings that are registered via runtime code paths other than the patterns described above.

### Example violation

```
     ✗  [ERROR] apps/web/src/lib/cache/state-cache.ts
                "task.assigned": bound in WebSocketProvider but not dispatched to a
                projection. Add it to a domain-dispatchers slice or as a switch case
                in state-cache.ts.
```

```
     ✗  [ERROR] apps/web/src/lib/cache/state-cache.ts
                "task.assigned": dispatcher case exists but does not call an
                apply*Projection() function.
```

```
     ⚠  [WARN]  apps/web/src/providers/WebSocketProvider.tsx
                "task.legacy": in dispatcher switch but not bound via socket.on in
                WebSocketProvider.
```

### How to fix

**Bound but not dispatched:** Add a case in `state-cache.ts` or a new entry in the relevant domain-dispatchers slice file.

**Dispatched but no projection call:** Add an `apply*Projection(payload, queryClient)` call inside the dispatcher case or domain-dispatchers entry. The function must be imported from the corresponding projection file.

**In dispatcher but not bound (warning):** Add `socket.on("event.name", routeEvent)` in `WebSocketProvider.tsx`, or in the relevant ws-bindings slice if the provider uses `getAllWsBindings()`. Alternatively, remove the stale dispatcher case.

---

## Gate #4: Projection → entity-cache helpers

**Scan scope:** `apps/web/src/lib/projections/**/*-projections.ts` (configured via `web.projectionsDir`)

### What it checks

Every projection file must:

1. Import at least one of `applyEntityCreate`, `applyEntityUpdate`, or `applyEntityDelete` from the entity-cache module.
2. Call at least one of those helpers inside an exported function.
3. Not call `queryClient.setQueryData(` without an explicit generic type argument. The bare form `queryClient.setQueryData(` — without `<T>` — is always an error, even in annotated map-projection files.

**Map-projection exemption:** A file annotated with the comment `// gate4:map-projection` anywhere in its source is exempt from requirements (1) and (2) — it does not need to import or call entity-cache helpers. Such files store data as a map (e.g. `Record<key, count>`) and manage the cache directly. However, requirement (3) still applies: they must use `queryClient.setQueryData<MapType>(...)` with an explicit type argument.

### What it does NOT check

- Whether the entity-cache helpers are imported from the correct path (only the presence of the identifier is checked).
- Projection files that export no functions — a file with zero `export function` declarations is not reported as a violation even if no helper calls are present.
- Files outside the `web.projectionsDir` tree.

### Example violation

```
     ✗  [ERROR] apps/web/src/lib/projections/task-projections.ts
                No entity-cache helpers imported. Projection files must import
                applyEntityCreate, applyEntityUpdate, or applyEntityDelete from
                entity-cache. For map-type projections, add // gate4:map-projection
                to the top of the file.
```

```
     ✗  [ERROR] apps/web/src/lib/projections/task-count-projections.ts:34
                Map projection uses non-generic setQueryData(). Use
                setQueryData<MapType>() with an explicit type parameter.
```

### How to fix

**Standard projection file:** Import the entity-cache helpers and call the appropriate one in every exported projection function. Example:

```ts
import {
  applyEntityCreate,
  applyEntityUpdate,
  applyEntityDelete,
} from "~/lib/entity-cache";

export function applyTaskCreatedProjection(
  payload: TaskCreatedPayload,
  qc: QueryClient,
) {
  applyEntityCreate(qc, taskKeys.lists(), payload.task);
}
```

**Map-projection file:** Add `// gate4:map-projection` at the top of the file, then ensure every `setQueryData` call includes a generic type argument:

```ts
// gate4:map-projection
qc.setQueryData<Record<string, number>>(taskKeys.counts(), updater);
```

---

## Gate #5: Broadcast Room Scoping (PRIVATE entities → scoped rooms)

**Scan scope:** `apps/api/src/**/*.broadcast.ts`

### What it checks

Every broadcast file is inspected for two categories of violation:

1. **Bare `io.emit(...)`** — broadcasting to all connected sockets with no room is always an error. Every emit must be scoped to a room via `io.to(room).emit(...)`.

2. **Workspace-wide emit without a visibility guard** — when a broadcaster function accepts a parameter named `visibility` or `isPrivate` AND emits to a room matching `` `workspace:${...}` `` or `` `realm:${...}` `` without a guard branch, the gate reports an error. A guard branch is any conditional (`if/else`, ternary) that checks `visibility ===`, `isPrivate ===`, `if.*visibility`, or `if.*private` within approximately 300 characters before the emit call.

Additionally, the gate emits an advisory warning (non-blocking) for every `` `workspace:${...}` `` emit that lacks a visibility guard in the surrounding context, even when the function signature does not include a named visibility parameter.

### What it does NOT check

- Whether the room string resolves to a valid, non-empty value at runtime. Filling in the room TODO in the template stub is the developer's responsibility.
- Broadcasters that use a variable for the room string rather than a template literal.
- File scope or imports — only the function body content is inspected.

### Example violation

```
     ✗  [ERROR] apps/api/src/task/task.broadcast.ts:12
                io.emit() with no room is forbidden — broadcasts to ALL connected sockets.
                Always use io.to(room).emit().
```

```
     ✗  [ERROR] apps/api/src/task/task.broadcast.ts:8
                Broadcaster function accepts a visibility parameter but emits to
                workspace-wide room. Add a visibility guard:
                if (visibility === 'PRIVATE') io.to(scopedRoom); else io.to(workspaceRoom).
```

```
     ⚠  [WARN]  apps/api/src/task/task.broadcast.ts:8
                workspace-wide emit detected. Verify this entity cannot be PRIVATE.
                If it can, add a visibility guard.
```

### How to fix

**Bare `io.emit`:** Replace with `io.to(room).emit(eventName, payload)` where `room` identifies the appropriate audience (workspace, project, or user scope).

**Missing visibility guard:** Add a guard before the workspace-scoped emit:

```ts
if (visibility === "PRIVATE") {
  io.to(`project:${projectId}`).emit(eventName, payload);
} else {
  io.to(`workspace:${workspaceId}`).emit(eventName, payload);
}
```

**Advisory warning:** Confirm the entity type cannot be PRIVATE. If it can, add the guard. If it cannot, the warning is safe to leave in place — it is not a blocking error.

---

## Gate #6: EventFactory Schema Coverage

**Scan scopes:**

- Schemas: `EventPayloadSchemas` in the configured `api.schemasFile`
- Emitters: `apps/api/src/**/*.broadcast.ts`

### What it checks

This gate verifies coverage in both directions:

1. **Every broadcast emit has a schema** — for each event string found in a `*.broadcast.ts` file (via `.emit("event.name")` or `broadcastXxx(io, "event.name", ...)`), a corresponding key must exist in `EventPayloadSchemas`. Missing schemas are errors because `EventFactory.publish()` cannot validate an unregistered event.

2. **Every schema has a broadcast emit** — for each key in `EventPayloadSchemas`, at least one broadcast file must emit it. Schemas with no corresponding emit are advisory warnings (non-blocking). They suggest a registered event that is no longer reachable.

### What it does NOT check

- Whether the schema uses `.strict()` (that is Gate #7).
- Events emitted via a variable rather than a string literal (e.g. `io.emit(eventVar)` where `eventVar` is not a string literal at the call site).
- Schema files other than `api.schemasFile`.

### Example violation

```
     ✗  [ERROR] apps/api/src/task/task.broadcast.ts:21
                "task.unassigned": emitted via socket.emit but not registered in
                EventPayloadSchemas. Add a .strict() Zod schema entry.
```

```
     ⚠  [WARN]  apps/api/src/lib/event-factory/schemas.ts
                "task.bulk-reassigned": registered in EventPayloadSchemas but never
                emitted in any *.broadcast.ts file. Either add a broadcast helper or
                remove the schema entry.
```

### How to fix

**Missing schema:** Add an entry to `EventPayloadSchemas` for the new event, including a `.strict()` Zod schema:

```ts
"task.unassigned": z.object({
  taskId: z.string().uuid(),
  workspaceId: z.string().uuid(),
}).strict(),
```

**Orphan schema warning:** Either add the broadcast helper that emits this event, or delete the schema entry if the event is intentionally retired.

---

## Gate #7: Schema .strict() Enforcement

**Scan scope:** `apps/api/src/lib/event-factory/schemas/**/*.ts` (configured via `api.schemasDir`; excludes `_index.ts`)

### What it checks

Every `z.object(` call in a schema file must chain `.strict()` within a 25-line forward window. A `z.object(` that is not followed by `.strict()` within that window is an error.

The 25-line window accommodates schemas whose fields are written one per line.

### What it does NOT check

- Schemas defined outside `api.schemasDir`.
- Nested `z.object()` calls used for sub-fields — each `z.object(` is checked individually. If a nested object also needs `.strict()`, it must include it.
- Schema values that are assembled programmatically rather than written as `z.object({...})` literals.

### Example violation

```
     ✗  [ERROR] apps/api/src/lib/event-factory/schemas/task.ts:14
                z.object() schema entry is missing .strict(). Every EventFactory schema
                must use .strict() to prevent silent extra-field acceptance at publish time.
```

### How to fix

Append `.strict()` to the `z.object({...})` call:

```ts
// Before
"task.created": z.object({
  taskId: z.string().uuid(),
  workspaceId: z.string().uuid(),
}),

// After
"task.created": z.object({
  taskId: z.string().uuid(),
  workspaceId: z.string().uuid(),
}).strict(),
```

Without `.strict()`, Zod silently accepts payloads with extra fields. This means a field added to `eventFactory.publish()` but forgotten in the schema will appear to publish successfully while the extra field is stripped from the broadcast payload, causing silent data loss at the frontend.

---

## Gate #8: WebSocketProvider Entity-Cache Isolation

**Scan scope:** `apps/web/src/providers/WebSocketProvider.tsx` (single file, configured via `web.providerFile`)

### What it checks

`WebSocketProvider.tsx` is the entry point for all realtime events on the frontend. Its only job is to receive socket events and forward them to the dispatcher via `applyRealtimeEventToCache()`. It must not touch the entity cache directly.

The gate reports an error for any of the following in `WebSocketProvider.tsx`:

1. Any import statement whose module path contains `entity-cache`.
2. Any call to `applyEntityCreate(`, `applyEntityUpdate(`, `applyEntityDelete(`, or `applyEntityUpsert(`.
3. Any call to `queryClient.setQueryData(` on a non-comment line.

If `WebSocketProvider.tsx` does not exist (before `rivergen gen:init` has run), the gate passes silently.

### What it does NOT check

- Other provider files outside `web.providerFile`.
- Entity-cache imports in files that `WebSocketProvider.tsx` imports from — only the provider file itself is scanned.
- Lines that begin with `//` (comment lines) are skipped for the `setQueryData` check.

### Example violation

```
     ✗  [ERROR] apps/web/src/providers/WebSocketProvider.tsx:7
                WebSocketProvider.tsx must not import from entity-cache. Route all events
                through applyRealtimeEventToCache() (state-cache dispatcher). Entity-cache
                imports belong only in projection files.
```

```
     ✗  [ERROR] apps/web/src/providers/WebSocketProvider.tsx:42
                WebSocketProvider.tsx must not call applyEntityCreate() directly. All domain
                events must route through applyRealtimeEventToCache() → dispatcher →
                projection → entity-cache.
```

### How to fix

Move all entity-cache logic into projection files. The provider should only call `applyRealtimeEventToCache(event, payload, queryClient)`. The dispatcher (state-cache) maps the event to the correct projection function, which is the only place allowed to call entity-cache helpers or write to the query cache.

Correct provider pattern:

```ts
socket.on(RealtimeEvent.TaskCreated, (payload) => {
  applyRealtimeEventToCache(RealtimeEvent.TaskCreated, payload, queryClient);
});
```

---

## Gate #9: No Cache Writes in onSuccess

**Scan scope:** `apps/web/src/hooks/**/*.ts`, `apps/web/src/hooks/**/*.tsx` (configured via `web.hooksDir`)

### What it checks

Inside every `onSuccess:` block in every hook file, the gate scans for direct React Query cache writes:

- `queryClient.setQueryData(`
- `queryClient.invalidateQueries(`
- `queryClient.removeQueries(`
- `queryClient.resetQueries(`
- `queryClient.setQueriesData(`

Any of these inside an `onSuccess` block is an error. The gate tracks brace depth to determine when the `onSuccess` block ends, so multi-line callbacks are correctly detected. Comment lines (those starting with `//`) are excluded.

### Why this is a law

Server truth arrives via the WebSocket projection pipeline. Writing to cache in `onSuccess` creates a dual-write race: the optimistic state set in `onMutate` and the WebSocket projection arriving milliseconds later may apply conflicting updates, producing flickering UI or stale data stuck in the cache. The canonical pattern is:

- `onMutate` — apply the optimistic update and snapshot the previous state.
- `onError` — roll back to the snapshot.
- WS projection — apply the authoritative server state when the event arrives.

`onSuccess` must remain a side-effect-only callback (analytics, toast notifications, navigation) — never a cache writer.

### What it does NOT check

- Cache writes outside `onSuccess` blocks (e.g. direct writes in event handlers or `useEffect`).
- Hook files outside `web.hooksDir`.
- `onSuccess` blocks in non-hook files.

### Example violation

```
     ✗  [ERROR] apps/web/src/hooks/use-task-mutations.ts:58
                queryClient.setQueryData() in onSuccess is forbidden. Cache convergence
                must arrive via the WebSocket projection pipeline (onMutate → optimistic;
                WS event → projection → entity-cache). Remove from onSuccess.
```

### How to fix

Remove the cache write from `onSuccess`. If the mutation needs to reflect a result immediately, apply an optimistic update in `onMutate` instead. The WebSocket event produced by the mutation's server handler will converge the cache to authoritative state.

If the `onSuccess` block is performing cleanup work unrelated to caching (e.g. resetting form state), that is fine — only the direct cache-write calls listed above are forbidden.

---

## Gate #10: Optimistic UI Coverage (onMutate + onError)

**Scan scope:** `apps/web/src/hooks/**/*.ts`, `apps/web/src/hooks/**/*.tsx` (configured via `web.hooksDir`)

**Domain hooks only** — files that do not import from a `query-keys` path are skipped. Auth, session, and server-action hooks are fire-and-forget and do not need optimistic handling.

### What it checks

Every `useMutation({...})` block in a domain hook must contain both:

1. `onMutate:` — sets up optimistic state before the API call and returns a rollback context.
2. `onError:` — restores the previous cache snapshot from context when the API call fails.

The gate collects the full brace-balanced block starting from `useMutation(` and checks for the presence of `onMutate:` and `onError:` within that block.

### What it does NOT check

- Non-domain hooks (those that do not import from `query-keys`).
- Whether `onMutate` actually performs an optimistic update — only the presence of the key is checked.
- Whether `onError` correctly accesses the rollback context — only the presence of the key is checked.

### Example violation

```
     ✗  [ERROR] apps/web/src/hooks/use-task-mutations.ts:12
                useMutation is missing onMutate. All mutations must set up optimistic state
                immediately (Real-Time Trinity law). Add onMutate to apply an optimistic
                update and return rollback context.
```

```
     ✗  [ERROR] apps/web/src/hooks/use-task-mutations.ts:12
                useMutation is missing onError. All mutations must roll back optimistic state
                on failure. Add onError to restore the previous cache snapshot from context.
```

### How to fix

Add both callbacks to the `useMutation` configuration:

```ts
useMutation({
  mutationFn: (variables) => api.createTask(variables),
  onMutate: async (variables) => {
    await queryClient.cancelQueries({ queryKey: taskKeys.lists() });
    const previous = queryClient.getQueryData<Task[]>(taskKeys.lists());
    queryClient.setQueryData<Task[]>(taskKeys.lists(), (old = []) => [
      ...old,
      { ...variables, id: "optimistic", status: "pending" },
    ]);
    return { previous };
  },
  onError: (_err, _variables, context) => {
    if (context?.previous !== undefined) {
      queryClient.setQueryData(taskKeys.lists(), context.previous);
    }
  },
  // onSuccess: intentionally omitted
});
```

---

## Gate #11: Event Audit Coverage

**Scan scope:** `config.auditDir` (default: `witness/`)

**Skip condition:** This gate is skipped entirely when none of the three phase files exist at `config.auditDir`. This is the default state for projects that have not yet set up payload audit files. Once any one file is present, the gate becomes active for all three.

### What it checks

When the audit files are present, the gate discovers every broadcast event (using the same scan as Gates #2 and #6) and verifies that each event appears in all three audit artifacts:

| File                                 | Required coverage                                        |
| ------------------------------------ | -------------------------------------------------------- |
| `phase4-payload-continuity-audit.ts` | A `REQUIRED_FIELDS` entry keyed by `"event.name": [...]` |
| `phase5-test-payloads.ts`            | A `publish("event.name", ...)` call                      |
| `phase6-retained-slice-audit.ts`     | Any occurrence of the `"event.name"` string literal      |

All three files must cover every broadcast event. A missing entry in any one file is an error.

### What it does NOT check

- Whether the `REQUIRED_FIELDS` list is complete or accurate — only presence of the key is checked.
- Whether the Phase 5 test payload matches the schema shape.
- Whether the Phase 6 assertion is semantically meaningful — only string-literal presence is checked.

### Example violation

```
     ✗  [ERROR] witness/phase4-payload-continuity-audit.ts
                Event "task.assigned" has no REQUIRED_FIELDS entry in Phase 4.
                Add the projection-required fields.
```

```
     ✗  [ERROR] witness/phase5-test-payloads.ts
                Event "task.assigned" has no test payload in Phase 5. Add a publish()
                entry to the domain's payload array.
```

```
     ✗  [ERROR] witness/phase6-retained-slice-audit.ts
                Event "task.assigned" is not referenced in Phase 6 retained slice audit.
                Add a lifecycle or signal assertion.
```

### How to fix

For each missing event, add the corresponding entry to each failing phase file:

**Phase 4** — add to the `REQUIRED_FIELDS` map:

```ts
"task.assigned": ["taskId", "assigneeId", "workspaceId"],
```

**Phase 5** — add a test payload call:

```ts
publish("task.assigned", { taskId: "...", assigneeId: "...", workspaceId: "..." }),
```

**Phase 6** — add a lifecycle assertion or signal reference that includes the event name string `"task.assigned"`.

---

## Gate #12: Witness — Field Continuity Coverage

**Scan scope:**

- Witness files: `apps/web/src/witness/**/*.witness.ts` (configured via `web.witnessDir`)
- Schemas: `apps/api/src/lib/event-factory/schemas/` (configured via `api.schemasDir`)
- Broadcast files: `apps/api/src/**/*.broadcast.ts`

**Skip condition:** This gate is skipped entirely when the `witnessDir` directory does not exist. Run `rivergen gen` to scaffold witness files once a domain spec exists.

**Kind:** Layer 1, 2, and 4 are static. Layer 3 is dynamic (async) — it spawns a subprocess.

### What it checks

Gate #12 runs four layers of verification:

---

#### Layer 1: requiredFields ⊆ Zod schema

For each event listed in a witness file's `requiredFields` map, every named field must be declared as a key inside the corresponding `z.object({...})` in the domain's schema file.

A field present in `requiredFields` but absent from the schema will be silently stripped by `EventFactory.publish()` at runtime — it will never reach the frontend projection. Layer 1 catches this class of regression before deployment.

**Violation:** The gate reports an error on the schema file, pointing to the missing field and event name.

---

#### Layer 2: requiredFields ⊆ broadcast emit payload

For each event listed in a witness file's `requiredFields` map, every named field must be forwarded in the corresponding broadcast emit payload.

This layer only applies to **selective broadcasts** — broadcast files where individual fields are manually picked into the emit payload object. **Pass-through broadcasts** (the generator default, where the full payload is forwarded as-is) satisfy Layer 2 automatically.

If the broadcast file cannot be detected as selective or pass-through, Layer 2 is skipped for that file with a warning.

**Violation:** The gate reports an error on the broadcast file, identifying which field is dropped for which event.

---

#### Layer 3: dynamic projection proof (async, subprocess)

Layer 3 dynamically imports each witness file and calls its `lifecycle()` function and `signals{}` map assertions in an isolated subprocess (`layer3-worker.ts`), invoked via `tsx`.

- If a `lifecycle()` call returns an assertion with `ok: false`, it is an error.
- If `lifecycle()` returns an empty array `[]`, the gate records a note that the file is a stub — Layer 3 cannot verify field survival through the projection until the function is implemented. This is a warning, not an error.
- If the subprocess times out (30 s) or fails to execute, a single warning is recorded for the worker file.

The subprocess isolation prevents ESM cycle errors that would occur if the web-app's React-dependent modules were imported into the gate runner's module graph.

**Violation:** An assertion failure from within the witness file's `lifecycle()` or `signals{}`:

```
     ✗  [ERROR] apps/web/src/witness/task.witness.ts:18
                Layer 3: assertion failed — "task.created" projection did not set
                taskId on the returned entity.
```

---

#### Layer 4: coverage completeness

Every broadcast event discovered from `*.broadcast.ts` files must appear in at least one witness file's `events[]` array (identified by presence of the `"event.name"` string in the witness file source).

If the expected witness file (`{witnessDir}/{domain}.witness.ts`) does not exist at all, the error message instructs the developer to run `rivergen gen` to scaffold it.

**Violation:**

```
     ✗  [ERROR] apps/web/src/witness/task.witness.ts
                Event "task.bulk-reassigned" is not covered — add "task.bulk-reassigned"
                to the witness file's events[], requiredFields, and testPayloads.
```

```
     ✗  [ERROR] apps/web/src/witness/notification.witness.ts
                Event "notification.created" has no witness file. Run:
                rivergen gen specs/notification.json --force
```

---

### What it does NOT check

- Whether `requiredFields` is a complete description of the event payload — partial coverage is not flagged. The gate only verifies that what is declared in `requiredFields` is consistent with schema and broadcast.
- Layer 2 does not check broadcast files that use a runtime-computed payload object without any detectable field-level structure.
- Layer 3 assertions are only as strong as the witness author's implementation of `lifecycle()`. An empty stub passes with a note.

### How to fix

**Layer 1 — field absent from schema:** Add the missing field to the event's `z.object({...}).strict()` entry in the schema file. Run `rivergen verify` to confirm.

**Layer 2 — field dropped in broadcast:** Add the missing field to the payload object in the broadcast helper:

```ts
// Before (field dropped)
io.to(room).emit("task.assigned", { taskId: payload.taskId });

// After (field forwarded)
io.to(room).emit("task.assigned", {
  taskId: payload.taskId,
  assigneeId: payload.assigneeId,
});
```

**Layer 3 — assertion failed:** Read the assertion message from the witness file and fix the projection function so the field survives. The projection test itself is in the witness file's `lifecycle()` function — update the assertion or the projection implementation.

**Layer 3 — stub warning:** Implement the `lifecycle()` function in the witness file. Replace the empty array return with actual projection calls and field assertions.

**Layer 4 — event not covered:** Add the event to the witness file's `events[]` array and add corresponding entries in `requiredFields` and `testPayloads`. If the witness file does not exist, run:

```
rivergen gen specs/<domain>.json --force
```
