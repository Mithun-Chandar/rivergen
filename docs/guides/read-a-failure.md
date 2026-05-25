# Read a Failure

## Overview

`rivergen verify` runs 12 gates and prints a single formatted report. This guide teaches you to read that report, understand what each symbol means, and locate the fix.

---

## The report structure

```
  RiverGen — Gate Verification Report
  Project: /path/to/project
  Run at:  2025-11-01T09:00:00.000Z

  ────────────────────────────────────────────────────────────────────────
  ✓  Gate #1: Mutation → EventFactory.publish
     1/1 mutation files wired to eventFactory.publish().

  ────────────────────────────────────────────────────────────────────────
  ✗  Gate #4: Projection → entity-cache helpers
     0/1 projection files use entity-cache helpers correctly.

     ✗  [ERROR] apps/web/src/lib/projections/task-projections.ts:42
            Direct queryClient.setQueryData() in projection file is forbidden. Use applyEntityCreate/Update/Delete from entity-cache.

  ────────────────────────────────────────────────────────────────────────
  ✗  2/12 GATE(S) FAILED — 1 error(s), 0 warning(s)

  Gates must pass before the scaffold is considered lawful.
  Add the missing pipeline stages then re-run: rivergen verify
  ────────────────────────────────────────────────────────────────────────
```

Each gate block contains three things:

1. **Status line** — `✓  GateName` or `✗  GateName` or `○  GateName` (skipped)
2. **Summary** — one line describing how many files passed the gate
3. **Violations** (only shown when the gate fails) — one entry per error or warning

The final summary line counts gates, errors, and warnings.

---

## The four symbols

| Symbol | Meaning                                                            |
| ------ | ------------------------------------------------------------------ |
| `✓`    | Gate passed — no error-severity violations                         |
| `✗`    | Gate failed — at least one error-severity violation                |
| `⚠`    | Advisory — appears inline as a note or warning-severity violation  |
| `○`    | Skipped — gate requires files that don't exist yet (not a failure) |

A gate with only warning-severity violations is counted as `✓` (passed). `allPassed` is true when every active gate has no error-severity violations.

---

## How to read a violation

Each violation entry has two lines:

```
     ✗  [ERROR] apps/api/src/task/task.mutations.ts:18
            Direct socket.emit() in mutation file is forbidden. Use eventFactory.publish().
```

- **`[ERROR]`** or **`[WARN]`** — severity level
- **`file:line`** — relative path from project root, and the exact line number where the violation occurs (line numbers are omitted when the gate detects a file-level problem rather than a specific location)
- **Indented message** — what was found and what to do instead

Open the file at the given line, read the message, and apply the fix described.

---

## Gate-by-gate failure reference

### Gate #1: Mutation → EventFactory.publish

**What it scans:** `*.mutations.ts` files  
**What it checks:** Each file imports `eventFactory` and calls `.publish()`; no direct `socket.emit()` or `eventBus.publish()`

**`Missing eventFactory import`**

```
     ✗  [ERROR] apps/api/src/task/task.mutations.ts
            Missing eventFactory import. Every mutation must import and use eventFactory.publish().
```

Fix: add `import { eventFactory } from "../lib/event-factory/event-factory"`.

**`No .publish() call found`**

```
     ✗  [ERROR] apps/api/src/task/task.mutations.ts
            No .publish() call found. Every mutation must emit an event via eventFactory.publish().
```

Fix: add the `await eventFactory.publish({ type: "...", ... })` call (single object, not positional args).

**`Direct socket.emit() in mutation file`**

```
     ✗  [ERROR] apps/api/src/task/task.mutations.ts:18
            Direct socket.emit() in mutation file is forbidden. Use eventFactory.publish().
```

Fix: remove the direct socket call. Route through `eventFactory.publish()` — the EventBus listener handles socket emission.

Note: Gate #1 skips comment lines when scanning for `socket.emit`. Gate #3 **does not** — `socket.emit` in code comments is still a violation in Gate #3.

**`Direct eventBus.publish() bypass`**

```
     ✗  [ERROR] apps/api/src/task/task.mutations.ts:22
            Direct eventBus.publish() in mutation file is forbidden. EventFactory.publish() is the only legal event emission path.
```

Fix: replace `eventBus.publish(...)` with `eventFactory.publish({ type: "...", payload: { ... } })`. EventFactory validates the schema before delegating to EventBus — bypassing it means the payload is never validated.

---

### Gate #2: Event → Listener → Broadcaster → socket.emit

**What it scans:** `*.listener.ts` files  
**What it checks:** Each file subscribes to the EventBus and calls the corresponding broadcast helper

Failure means the listener file either doesn't subscribe or doesn't call a broadcast function. Check the generated stub — the listener should contain `eventBus.subscribe("domain.*", (envelope) => { broadcastDomainEvent(io, envelope.type, envelope.payload); })`.

---

### Gate #3: WS socket.on → Dispatcher → Projection call

**What it scans:** `ws-bindings/*.ts` files and `domain-dispatchers/*.ts` files  
**What it checks:** Each socket event binding routes to a dispatcher, which routes to a projection

**`socket.emit in code comment`**
Gate #3 scans all lines including comments. If you wrote a comment like `// socket.emit('task.created', payload)` as documentation, Gate #3 will flag it. Rephrase: `// event emission goes through EventFactory`.

---

### Gate #4: Projection → entity-cache helpers

**What it scans:** `*-projections.ts` files  
**What it checks:** Each file imports and calls entity-cache helpers; no bare `queryClient.setQueryData()`

**`Direct queryClient.setQueryData() in projection`**

```
     ✗  [ERROR] apps/web/src/lib/projections/task-projections.ts:42
            Direct queryClient.setQueryData() in projection file is forbidden. Use applyEntityCreate/Update/Delete from entity-cache.
```

Fix: replace the direct call with `applyEntityCreate`/`applyEntityUpdate`/`applyEntityDelete`. These helpers route through the `ENTITY_PROJECTIONS` registry and handle prefix-matching, ghost removal, and the removal law internally.

**`No entity-cache helpers imported`**

```
     ✗  [ERROR] apps/web/src/lib/projections/task-projections.ts
            No entity-cache helpers imported. Projection files must import applyEntityCreate, applyEntityUpdate, or applyEntityDelete from entity-cache. For map-type projections, add // gate4:map-projection to the top of the file.
```

Fix: add `import { applyEntityCreate, applyEntityUpdate, applyEntityDelete } from "../entity-cache"`. If this is a map-type projection (e.g. `Record<taskId, commentCount>`), add `// gate4:map-projection` as the first line of the file instead.

**`Map projection uses non-generic setQueryData()`**

```
     ✗  [ERROR] apps/web/src/lib/projections/task-projections.ts:28
            Map projection uses non-generic setQueryData(). Use setQueryData<MapType>() with an explicit type parameter.
```

Fix: change `queryClient.setQueryData(key, updater)` to `queryClient.setQueryData<Record<string, number>>(key, updater)`. Map projections must use the typed generic form.

---

### Gate #5: Broadcast Room Scoping (PRIVATE entities → scoped rooms)

**What it scans:** `*.broadcast.ts` files  
**What it checks:** No bare `io.emit()`; private-entity functions have visibility guards

**`[ERROR] Bare io.emit()`**

```
     ✗  [ERROR] apps/api/src/task/task.broadcast.ts:15
            io.emit() without room scoping is forbidden. Use io.to(room).emit().
```

Fix: change `io.emit(eventName, payload)` to `io.to(room).emit(eventName, payload)` where `room` is derived from the payload.

**`[WARN] workspace-wide emit — verify PRIVATE concern`**

```
     ⚠  [WARN]  apps/api/src/task/task.broadcast.ts:19
            workspace-wide emit detected. Verify this entity cannot be PRIVATE. If it can, add a visibility guard.
```

This is advisory. Review whether the entity has a privacy concern. If it does, add `const isPrivate = payload.visibility === "PRIVATE"` and route to the appropriate scoped room.

---

### Gate #6: EventFactory Schema Coverage

**What it scans:** `schemas/*.ts` domain slices vs. broadcast calls  
**What it checks:** Every event emitted by broadcast helpers has a corresponding Zod schema

Failure means a new event was added to `events[]` but `schemas/<domain>.ts` was not updated. Add the missing schema entry.

---

### Gate #7: Schema .strict() Enforcement

**What it scans:** `schemas/*.ts` domain slices  
**What it checks:** Every `z.object()` call in schema files uses `.strict()`

```
     ✗  [ERROR] apps/api/src/lib/event-factory/schemas/task.ts:8
            z.object() without .strict() — unknown fields pass silently. Add .strict() to enforce the payload contract.
```

Fix: change `z.object({ ... })` to `z.object({ ... }).strict()`. Without `.strict()`, fields not in the schema are silently allowed through — payload fields added before the schema is updated will appear to work but are unvalidated.

---

### Gate #8: WebSocketProvider Entity-Cache Isolation

**What it scans:** `WebSocketProvider.tsx`  
**What it checks:** No import of `entity-cache` in the provider file

```
     ✗  [ERROR] apps/web/src/providers/WebSocketProvider.tsx:3
            entity-cache imported in WebSocketProvider. WebSocketProvider must only call applyRealtimeEventToCache — it must not call entity-cache directly.
```

Fix: remove the entity-cache import from the provider. The provider must call `applyRealtimeEventToCache(eventName, payload, queryClient)` only. Entity-cache is an implementation detail of the projections, not the provider.

---

### Gate #9: No Cache Writes in onSuccess

**What it scans:** `use-*.ts` hook files  
**What it checks:** No `queryClient.setQueryData()`, `queryClient.setQueriesData()`, or `invalidateQueries()` inside `onSuccess` callbacks

```
     ✗  [ERROR] apps/web/src/hooks/use-task.ts:67
            Cache write in onSuccess is forbidden. The WS projection owns cache convergence — writing in onSuccess creates a second convergence path.
```

Fix: remove the cache write from `onSuccess`. If you need the entity to appear in the cache after creation, the WS projection handles it when the server event arrives. If you need to navigate after creation (e.g. push to a detail page), that is a side effect — it does not need to touch the cache.

---

### Gate #10: Optimistic UI Coverage (onMutate + onError)

**What it scans:** `use-*.ts` hook files  
**What it checks:** Every `useMutation` call has both `onMutate` and `onError` handlers

```
     ✗  [ERROR] apps/web/src/hooks/use-task.ts:45
            useMutation missing onMutate handler. Optimistic updates require onMutate to insert the ghost.
```

```
     ✗  [ERROR] apps/web/src/hooks/use-task.ts:45
            useMutation missing onError handler. Without onError, a failed mutation leaves the ghost permanently in the cache.
```

Fix: add both handlers. `onMutate` inserts the ghost and returns `{ prev, listKey, clientTempId }`. `onError` restores the pre-ghost cache state using `context.prev`.

---

### Gate #11: Event Audit Coverage

**What it checks:** Every event appears in audit artifact files (Phase 4/5/6)  
**Skipped (`○`) when:** No audit files exist in the project

```
  ○  Gate: Audit Coverage
     No audit artifact files found — gate skipped.
```

This gate only activates when `phase4-payload-continuity-audit.ts`, `phase5-test-payloads.ts`, or `phase6-retained-slice-audit.ts` are present. If you see this gate failing, it means an event was added to the domain but the audit files were not updated. Update the relevant audit files to include the new event.

---

### Gate #12: Witness — Field Continuity Coverage

**What it checks:** Every broadcast event has a witness entry; `requiredFields` are in the Zod schema and forwarded by the broadcast helper; Layer 3 projection proof passes

**`[ERROR] No witness file for domain`**

```
     ✗  [ERROR]
            No witness file found for domain "task". Add a task.witness.ts file.
```

Fix: run `rivergen gen specs/task.json` if the domain was not generated yet. If the witness file exists but is not being found, check that the file is in the configured witness directory.

**`[ERROR] Layer 1 — field not in schema`**

```
     ✗  [ERROR] apps/web/src/witness/task.witness.ts
            task.created: requiredField "title" not found in domain schema. Add it to schemas/task.ts.
```

Fix: add `title: z.string()` to the `.strict()` Zod schema in `schemas/task.ts`.

**`[ERROR] Layer 2 — field not forwarded by broadcast`**

```
     ✗  [ERROR] apps/web/src/witness/task.witness.ts
            task.created: requiredField "title" not forwarded in broadcast. Check task.broadcast.ts.
```

Fix: the broadcast helper is selective (re-assembles fields manually) but does not include `title`. Either switch to pass-through style or add the missing field to the broadcast.

**`⚠  Layer 3 — stub not filled`**

```
     ⚠  task.witness.ts: lifecycle() returns [] (Layer 3 stub not filled)
```

This is a note, not an error — Gate #12 still passes. It means `lifecycle()` returns an empty array. Fill the assertions before marking the domain production-ready. See [write-a-witness.md](write-a-witness.md).

**`[ERROR] Layer 3 — assertion failed`**

```
     ✗  [ERROR] apps/web/src/witness/task.witness.ts
            Layer 3 assertion "task.created.title preserved": FAIL
```

The cache after `applyTaskCreated` did not contain a `title` field with the expected value. Common causes:

- The payload used `taskTitle` but `requiredFields` declares `title` — the projection wrote `taskTitle` to the cache, not `title`
- `applyEntityCreate` wrote to a different query key than `lifecycle()` is reading from — check that the `context.projectId` in the projection matches `taskKeys.list({ projectId: "proj-001" })` in the assertion
- `clientTempId` was not included in the schema, so it was stripped and the ghost was never removed — the create assertion fails because the entity is under the ghost ID

**`[ERROR] Layer 4 — uncovered broadcast event`**

```
     ✗  [ERROR]
            Broadcast event "task.priority-changed" has no witness coverage. Add it to a witness file.
```

Fix: add `"task.priority-changed"` to the `events` array in `task.witness.ts` and add an entry in `requiredFields` and `testPayloads`. If it is a signal event (not create/update/delete), add it to `signals{}`.

---

## Reading a multi-gate failure

When multiple gates fail, the report lists all of them. Start with the **lowest-numbered gate that failed** — its fix often resolves dependent gate failures automatically.

Example:

```
  ✗  Gate #1: Mutation → EventFactory.publish
     0/1 mutation files wired to eventFactory.publish().

     ✗  [ERROR] apps/api/src/task/task.mutations.ts
            Missing eventFactory import.

  ✗  Gate #6: EventFactory Schema Coverage
     1 event(s) emitted without a schema entry.

     ✗  [ERROR] apps/api/src/lib/event-factory/schemas/task.ts
            No schema found for event "task.created".
```

Gate #1 fails because the mutation doesn't import EventFactory at all. Gate #6 fails because the schema file is empty. Fixing Gate #1 (adding the import and filling the mutation) may also require filling the schema — but the root cause to address first is the unfilled mutation.

---

## The all-passed confirmation

```
  ✓  ALL GATES PASSED (12/12)
  ────────────────────────────────────────────────────────────────────────
```

When all 12 gates pass with no errors, the domain is architecturally correct. If Gate #12 passes with a `⚠ Layer 3 stub` note, the structure is correct but the projection proof is incomplete — safe to ship in development, but fill `lifecycle()` before production.

---

## Related

- [docs/guides/write-a-witness.md](write-a-witness.md) — fixing Gate #12 failures in detail
- [docs/reference/gates.md](../reference/gates.md) — full gate reference with all violation patterns
- [docs/concepts/one-river.md](../concepts/one-river.md) — the pipeline each gate protects
