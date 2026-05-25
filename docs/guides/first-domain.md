# First Domain

## Overview

This guide walks through adding a new domain from scratch: writing the spec, running the generator, filling the TODOs, and passing all 12 gates. The running example is a `task` domain scoped to a project room.

---

## Prerequisites

- RiverGen is installed and available as `rivergen`
- `rivergen init` has been run once for this project (see below)
- `@rivergen/witness` is installed in the package where witness files live

---

## Step 0: rivergen init (one-time setup)

`rivergen init` is run **once** per project, before any domain is generated. It writes 17 files that form the static infrastructure shared by all domains:

**5 static infrastructure files** (written once, never modified by `rivergen gen`):

- `EventFactory` service — validates and publishes domain events
- `EventBus` service — Node.js EventEmitter for backend event routing
- `entity-cache.ts` — the only file allowed to call `queryClient.setQueryData` for entity arrays
- `state-cache.ts` — `applyRealtimeEventToCache` dispatch entry point
- `WebSocketProvider.tsx` — connects the socket, calls `applyRealtimeEventToCache` per event

**2 base type files**:

- `schemas/_base.ts` — `EventEnvelope` and `AnyPayload` Zod schemas
- `entity-projections/_types.ts` — `EntityProjectionEntry`, `ProjectionFn`, `QueryKey` types

**5 barrel stubs** (regenerated on every `rivergen gen`):

- `schemas/_index.ts`, `domain-dispatchers/_index.ts`, `ws-bindings/_index.ts`, `query-keys/_index.ts`, `entity-projections/_index.ts`

**3 Vite proxy files** (thin `export * from "./_index"` shims that bridge Vite's directory-import resolution to the `_index.ts` barrels):

- `query-keys/index.ts`, `domain-dispatchers/index.ts`, `ws-bindings/index.ts`

**2 agent rules files** (written to project root):

- `AGENTS.md` — teaches AI agents the One River architecture rules
- `CLAUDE.md` — auto-loads `AGENTS.md` into Claude Code context

`rivergen init` aborts if any of these files already exist. Run with `--force` to overwrite.

```bash
rivergen init
```

---

## Step 1: Write the spec

Create a JSON spec file describing the domain. Specs live in `specs/` by convention.

```json
// specs/task.json
{
  "version": 2,
  "domain": {
    "key": "task",
    "displayName": "Task"
  },
  "entity": {
    "key": "task",
    "eventPrefix": "task"
  },
  "events": ["task.created", "task.updated", "task.deleted"],
  "room": {
    "template": "project:${projectId}"
  }
}
```

**Spec rules:**

- `version` must be `2` — v1 specs are rejected
- `domain.key` — kebab-case: `"task"`, `"work-order"`, `"support-ticket"`
- `entity.key` — camelCase: `"task"`, `"workOrder"`, `"supportTicket"`
- `entity.eventPrefix` — must match the prefix of every entry in `events[]`
- `events[]` — dot notation only (`entity.action`); colons are rejected
- `room.template` — uses `${varName}` placeholders; these become function parameters in broadcast helpers and context fields in query key factories
- `room.visibilityField` — add this if the entity can be `PRIVATE`; omitting it for a private entity broadcasts private data to public rooms

For multi-word domains, the key pair `"domain.key": "work-order"` / `"entity.key": "workOrder"` is the standard pattern.

---

## Step 2: Dry-run with rivergen plan

Before writing any files, run `rivergen plan` to see exactly what will be generated:

```bash
rivergen plan specs/task.json
```

The plan output shows:

```
Task (task)
Spec: specs/task.json

FILES TO CREATE
  apps/api/src/task/task.router.ts
  apps/api/src/task/task.mutations.ts
  apps/api/src/task/task.broadcast.ts
  apps/api/src/lib/event-bus-listeners/task.listener.ts
  apps/web/src/lib/projections/task-projections.ts
  apps/web/src/hooks/use-task.ts
  apps/web/src/witness/task.witness.ts
  apps/api/src/lib/event-factory/schemas/task.ts
  apps/web/src/lib/cache/domain-dispatchers/task.ts
  apps/web/src/providers/ws-bindings/task.ts
  packages/shared/src/entity-projections/task.ts
  apps/web/src/lib/query-keys/task.ts

BARRELS TO REGENERATE
  schemas/_index.ts
  domain-dispatchers/_index.ts
  ws-bindings/_index.ts
  query-keys/_index.ts
  entity-projections/_index.ts

DEPENDENCIES
  ✓ All required packages present

Status: READY
```

`rivergen plan` never writes anything. If any file already exists, the plan shows `✗ EXISTS` next to it and marks the status as `NOT READY`. Fix by removing the conflicting file or running `rivergen gen --force`.

---

## Step 3: Generate the domain files

```bash
rivergen gen specs/task.json
```

This writes the 12 domain files listed in the plan and regenerates the 5 barrel files. The generated code:

- Compiles with zero TypeScript errors immediately
- Passes all 12 gates except Gate #12 Layer 3 (which is stubbed with `⚠ TODO`)
- Contains `// TODO` comments marking every place you must fill in

**The 12 generated files and what each does:**

| File                                 | Layer    | Purpose                                                                |
| ------------------------------------ | -------- | ---------------------------------------------------------------------- |
| `task.router.ts`                     | Backend  | tRPC/Express route handler; calls `eventFactory.publish()`             |
| `task.mutations.ts`                  | Backend  | Zod input schema, Prisma call, `eventFactory.publish()` call           |
| `task.broadcast.ts`                  | Backend  | Receives `AnyPayload`, resolves room, calls `io.to(room).emit()`       |
| `task.listener.ts`                   | Backend  | `eventBus.subscribe("task.*", broadcastTaskEvent)` wiring              |
| `task.ts` (schemas slice)            | Backend  | `.strict()` Zod schema for the `task.*` event payload                  |
| `task-projections.ts`                | Frontend | `applyTaskCreated/Updated/Deleted` functions                           |
| `use-task.ts`                        | Frontend | `useTaskList`, `useCreateTask`, `useUpdateTask`, `useDeleteTask` hooks |
| `task.ts` (domain-dispatchers slice) | Frontend | `{ "task.created": applyTaskCreated, ... }` map                        |
| `task.ts` (ws-bindings slice)        | Frontend | `getTaskWsBindings()` for socket event subscriptions                   |
| `task.ts` (entity-projections slice) | Shared   | `EntityProjectionEntry` for cache key routing                          |
| `task.ts` (query-keys slice)         | Frontend | `taskKeys.all/list/detail` factory                                     |
| `task.witness.ts`                    | Frontend | `taskWitness` — the field continuity contract                          |

**Never generate these files by hand.** Writing them manually guarantees a gate failure because the barrel files and naming conventions must stay synchronized.

---

## Step 4: Fill the TODOs

The generated files contain structural stubs. You fill them in a specific order (see [fill-order.md](fill-order.md) for the full reasoning). The order is:

**a. `task.mutations.ts`** — add the Zod input schema, DB call, and `eventFactory.publish()` payload fields.

```typescript
// Fill the eventFactory.publish() call — single object, not positional args
await eventFactory.publish({
  type: "task.created",
  resourceId: task.id,
  actor: { id: userId, type: "user" },
  context: { realmId: projectId },
  correlationId: randomUUID(),
  eventVersion: "1.0",
  payload: {
    taskId: task.id,
    title: task.title, // field name MUST match REST API response shape
    projectId: task.projectId,
    clientTempId: (data.clientTempId as string) ?? null,
  },
});
```

> **`eventFactory.publish()` takes a single object.** Positional arguments `eventFactory.publish("task.created", payload)` compile but crash at runtime because `input.type` resolves to `undefined`.

> **`clientTempId`** is the optimistic ghost ID. The hook's `onMutate` stamps a temporary ID (`temp-task-${Date.now()}`) onto the mutation data before the HTTP request fires, and the UI shows a ghost row immediately. When `clientTempId` reaches the server and is included in the event payload, the WebSocket projection uses it to replace the ghost with the real entity. If you omit `clientTempId` from the payload here (or from the schema in step b), the ghost will stay in the list permanently.

**b. `schemas/task.ts`** — add every field to the `.strict()` Zod schema **before** adding it to `eventFactory.publish()`. Fields not in the schema are silently stripped at runtime.

```typescript
export const taskCreatedSchema = z
  .object({
    taskId: z.string(),
    title: z.string(),
    projectId: z.string(),
    clientTempId: z.string().nullable(),
  })
  .strict();
```

**c. `task.listener.ts`** — wire the `eventBus.subscribe()` call to the broadcast helper. The generated stub already has the correct structure; you may not need to change this file at all.

**d. `use-task.ts`** — check the query key used in `onMutate`. The generated stub reads:

```typescript
const listKey = taskKeys.list({ projectId });
```

If your room template is `project:${projectId}`, this is already correct — no change needed. If your template uses a different variable (e.g. `workspace:${workspaceId}`), update the context object to match: `taskKeys.list({ workspaceId })`. The key here and the key in step (e) must be identical — a mismatch means WS updates write to a key the hook is not watching and will never appear in the UI.

**e. `task-projections.ts`** — add the room context to `applyTaskCreated/Updated/Deleted`. The list key here must match the list key in the hook's `onMutate`:

```typescript
const context = { projectId: payload.projectId as string };
applyEntityCreate("task", { id: taskId, ...payload }, context, queryClient);
```

**f. `task.witness.ts`** — fill the field continuity contract.

A witness file is a static + dynamic proof that your event payload fields actually survive the full pipeline (mutation → schema → broadcast → projection → cache). Without it, Gate #12 passes structurally but Layer 3 is a stub. See [write-a-witness.md](write-a-witness.md) for the full walkthrough.

At minimum, fill three things:
- `requiredFields` — every field name from the `eventFactory.publish()` payload
- `testPayloads` — a sample payload for each event
- `lifecycle()` assertions — prove the projection puts the right data in the cache

---

## Step 5: Verify all gates

```bash
rivergen verify
```

A passing run looks like:

```
  RiverGen — Gate Verification Report
  Project: /path/to/project
  Run at:  2025-11-01T09:00:00.000Z

  ─────────────────────────────────────────────────────────
  ✓ Gate #1: Mutation → EventFactory.publish
     1 mutation file checked, 0 violations.

  ✓ Gate #2: Event → Listener → Broadcaster → socket.emit
     1 listener file checked, 0 violations.

  ...

  ⚠ Gate #12: Witness — Field Continuity Coverage
     task.witness.ts: lifecycle() returns [] (Layer 3 stub not filled)

  ─────────────────────────────────────────────────────────
  ✓ ALL GATES PASSED (11/12, 0 skipped)
  ⚠  Gate #12 passed with warnings — fill lifecycle() before marking production-ready.
```

Gate #12 passes structurally after gen (the witness file exists and has the correct shape). The `⚠` warning on Layer 3 means the `lifecycle()` assertions are still stubs. Fill `lifecycle()` to prove fields survive the projection before calling the domain production-ready.

---

## Step 6: Join the room on the client

The generated hook includes a comment block showing the room join pattern. This is a comment, not an exported hook — you implement it in the component that mounts for a given room context:

```typescript
// In the page component that owns task context:
const { socket, connected } = useWebSocket();
useEffect(() => {
  if (connected && socket) socket.emit("join:task", projectId);
}, [connected, socket, projectId]);
```

The server-side handler for `"join:task"` must call `socket.join(\`project:${projectId}\`)`. This belongs in your WebSocket server setup — typically a `socket.on("join:task", ...)` handler registered when each client connects:

```typescript
// In your WebSocket server connection handler (outside RiverGen's scope):
socket.on("join:task", (projectId: string) => {
  socket.join(`project:${projectId}`);
});
```

Without this, the client socket never joins the room and receives no `task.*` events — even if the broadcast and projection are wired correctly.

---

## Quick reference: generated file paths

| Template variable       | Default path                                            |
| ----------------------- | ------------------------------------------------------- |
| `domain.key = "task"`   | —                                                       |
| Router                  | `apps/api/src/task/task.router.ts`                      |
| Mutations               | `apps/api/src/task/task.mutations.ts`                   |
| Broadcast               | `apps/api/src/task/task.broadcast.ts`                   |
| Listener                | `apps/api/src/lib/event-bus-listeners/task.listener.ts` |
| Schema slice            | `apps/api/src/lib/event-factory/schemas/task.ts`        |
| Projections             | `apps/web/src/lib/projections/task-projections.ts`      |
| Hook                    | `apps/web/src/hooks/use-task.ts`                        |
| Dispatcher slice        | `apps/web/src/lib/cache/domain-dispatchers/task.ts`     |
| WS bindings slice       | `apps/web/src/providers/ws-bindings/task.ts`            |
| Entity projection slice | `packages/shared/src/entity-projections/task.ts`        |
| Query keys slice        | `apps/web/src/lib/query-keys/task.ts`                   |
| Witness                 | `apps/web/src/witness/task.witness.ts`                  |

Paths are configurable via `rivergen.config.ts` — see [docs/reference/config.md](../reference/config.md).

---

## Related

- [docs/guides/fill-order.md](fill-order.md) — why the TODOs must be filled in a specific order
- [docs/guides/write-a-witness.md](write-a-witness.md) — completing Gate #12 in detail
- [docs/guides/read-a-failure.md](read-a-failure.md) — what to do when `rivergen verify` fails
- [docs/reference/spec.md](../reference/spec.md) — full spec field reference
