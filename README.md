# RiverGen

[![npm](https://img.shields.io/npm/v/@rivergen/cli)](https://www.npmjs.com/package/@rivergen/cli)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Verifiable realtime architecture for collaborative applications.**

---

Realtime systems fail quietly.

Your mutation succeeds. Your WebSocket event fires. Your cache updates. But somewhere between the mutation, the event envelope, the listener, the broadcast, the dispatcher, and the projection — the data drifts.

A field disappears. A ghost card never reconciles. A private entity leaks into the wrong room. The UI slowly stops matching reality — and you usually won't know until a user reports it.

---

## The problem

As realtime apps grow, they accumulate competing data paths. An `onSuccess` cache write here. A manual `invalidateQueries` there. A projection that handles most events but not all. Multiple contributors each solving their piece without knowing what the others touched.

Eventually nobody knows which path is authoritative. The realtime layer becomes something only one engineer fully understands. New team members are warned: *"don't touch the WebSocket stuff."* Every fix risks introducing another silent failure. The architecture becomes haunted.

This is not a beginner mistake. It happens to experienced teams. And it gets worse as the product grows.

**The core problem is not complexity — it is the absence of accountability.** When there is no single authoritative path, there is no way to know which path introduced the drift without instrumenting everything. And most teams never do.

---

## What RiverGen is

An open-source scaffold and enforcement framework for realtime architectures that need to stay understandable as they scale.

You keep your own backend. Your own database. Your own transport. RiverGen enforces the architecture around them.

---

## One River

The core idea: **one verified path from mutation to cache.**

```
mutation
  → EventFactory.publish()
    → EventBus listener
      → broadcast helper
        → WebSocket
          → dispatcher
            → projection
              → TanStack Query cache ✓
```

When there is one path, accountability is possible. When there are two — an `onSuccess` write here, a `setQueryData` patch there — accountability disappears.

One River means: if data arrives wrong at the cache, you know exactly where to look. The path is deterministic, structural, and enforced.

> **The gates prove the pipeline exists. Witness proves the data survived it.**

---

## Workflow

```bash
# 1. Initialize once per project
rivergen init

# 2. Write a spec
# specs/task.json

# 3. Inspect before writing
rivergen plan specs/task.json

# 4. Scaffold all 12 files + regenerate barrels
rivergen gen specs/task.json

# 5. Fill business logic in this order:
#    a. mutations.ts          → DB call + input validation
#    b. schemas/task.ts       → event payload fields (before adding to publish())
#    c. task.listener.ts      → wire subscribe → broadcast
#    d. use-task.ts           → query key context in onMutate
#    e. task-projections.ts   → list key context in applyEntity*()
#    f. task.witness.ts       → field continuity contract

# 6. Verify — all 12 gates must pass
rivergen verify
```

After `rivergen gen`, the architecture exists. You fill in business logic. The gates tell you when it is correctly wired. You do not need to reason about the realtime path — it is generated, constrained, and verified.

---

## Gates

12 structural gates run on every `rivergen verify`. They turn architectural drift from a production surprise into a build error.

| Gate | What it enforces |
|------|-----------------|
| **#1** Mutation → EventFactory | Mutations publish through EventFactory — no direct eventBus or socket calls |
| **#2** Listener → broadcast chain | The full subscribe → broadcast → emit path is wired |
| **#3** Dispatcher → projection | Every WS event routes through a dispatcher to a projection function |
| **#4** Projection → entity-cache | Projections use entity-cache helpers — no raw `setQueryData` |
| Schema coverage | Every emitted event has a registered Zod schema |
| Schema `.strict()` | Every schema uses `.strict()` — prevents silent field stripping at publish time |
| Room scoping | Private entities are scoped to rooms, not broadcast globally |
| Provider isolation | `WebSocketProvider` does not import entity-cache |
| No `onSuccess` writes | Cache convergence belongs to projections only |
| Optimistic coverage | Every mutation has `onMutate` + `onError` |
| Event Audit Coverage | Every event is covered in payload continuity audit artifacts (skipped if no artifacts present) |
| **#12** Witness coverage | Every broadcast event has a complete witness entry |

**Gate #12 is the progress signal** — after `rivergen gen` it passes immediately but Layer 3 (the projection proof) shows as a stub until you fill the `lifecycle()` function. All other gates pass immediately after generation.

---

## Witness

Gates verify that the realtime pipeline is structurally wired. Witness verifies that the data actually survived it — every field, every hop, every projection, every ghost reconciliation.

```ts
// task.witness.ts — generated scaffold, you fill the assertions
export const lifecycle: WitnessLifecycle<TaskPayload> = async (qc) => {
  // optimistic ghost appears immediately
  await applyTaskCreated(CREATE_PAYLOAD, qc);
  assertListContains(qc, taskKeys.list(PROJECT_ID), CREATE_PAYLOAD.clientTempId);

  // confirmed entity arrives — ghost is removed, no duplicate
  await applyTaskCreated(CONFIRMED_PAYLOAD, qc);
  assertListContains(qc, taskKeys.list(PROJECT_ID), CONFIRMED_PAYLOAD.taskId);
  assertListNotContains(qc, taskKeys.list(PROJECT_ID), CREATE_PAYLOAD.clientTempId);

  // update arrives — correct field reaches the cache
  await applyTaskUpdated(UPDATE_PAYLOAD, qc);
  assertFieldEquals(qc, taskKeys.list(PROJECT_ID), CONFIRMED_PAYLOAD.taskId, "title", "Updated title");
};
```

Witness is a companion package: [`@rivergen/witness`](https://github.com/mithunchandrakanth/rivergen-witness)

---

## Getting started

**Requirements:** Node.js ≥ 18, TypeScript, Express + socket.io on the backend, React + TanStack Query on the frontend.

```bash
# Global install
npm install -g @rivergen/cli

# Or without a global install
npx @rivergen/cli init
```

### 1. Initialize

```bash
rivergen init
```

Writes the infrastructure layer once: EventFactory, EventBus, entity-cache, WebSocketProvider, and barrel stubs. Do not run again after initialization.

### 2. Write a spec

```json
{
  "version": 2,
  "domain": { "key": "task", "displayName": "Task" },
  "entity": { "key": "task", "eventPrefix": "task" },
  "events": ["task.created", "task.updated", "task.deleted", "task.assigned"],
  "room": {
    "template": "project:${projectId}",
    "visibilityField": "visibility"
  }
}
```

### 3. Generate

```bash
rivergen plan specs/task.json   # inspect what will be written
rivergen gen specs/task.json    # write 12 files + regenerate barrels
```

### 4. Fill and verify

Fill in the business logic TODOs generated in each file. Then:

```bash
rivergen verify
# ✓ ALL GATES PASSED (11/11, 1 skipped)
```

---

## What gets generated

`rivergen gen specs/task.json` writes 12 files from a single spec:

| # | File | What it is |
|---|------|------------|
| 1 | `apps/api/src/task/task.router.ts` | Express router — HTTP endpoints |
| 2 | `apps/api/src/task/task.mutations.ts` | Business logic + EventFactory.publish() calls |
| 3 | `apps/api/src/task/task.broadcast.ts` | socket.io emit helper — one function per event |
| 4 | `apps/api/src/lib/event-bus-listeners/task.listener.ts` | EventBus subscriber → calls broadcaster |
| 5 | `apps/web/src/hooks/use-task.ts` | TanStack Query hooks with optimistic mutations |
| 6 | `apps/web/src/lib/projections/task-projections.ts` | WS event → cache convergence via entity-cache |
| 7 | `apps/api/src/lib/event-factory/schemas/task.ts` | Zod `.strict()` payload schema slice |
| 8 | `apps/web/src/lib/cache/domain-dispatchers/task.ts` | Event string → projection function dispatcher |
| 9 | `apps/web/src/providers/ws-bindings/task.ts` | WebSocket event binding slice |
| 10 | `packages/shared/src/entity-projections/task.ts` | Entity projection entry (list + detail keys) |
| 11 | `apps/web/src/lib/query-keys/task.ts` | TanStack Query key factory |
| 12 | `apps/web/src/witness/task.witness.ts` | Witness field continuity scaffold |

Plus 5 barrel `_index.ts` files are regenerated automatically.

---

## Spec reference

```json
{
  "version": 2,
  "domain": {
    "key": "invoice",           // kebab-case — used in filenames
    "displayName": "Invoice"    // used in generated comments
  },
  "entity": {
    "key": "invoice",           // camelCase — used in type and function names
    "eventPrefix": "invoice"    // must match the prefix of every event below
  },
  "events": [
    "invoice.created",          // dot notation only — colons rejected
    "invoice.updated",
    "invoice.sent",
    "invoice.voided"
  ],
  "room": {
    "template": "workspace:${workspaceId}",  // socket.io room pattern
    "visibilityField": "visibility"          // required for private entities — omit to broadcast publicly
  }
}
```

The spec is the single source of truth for a domain. Not a wiki page. Not a Notion doc. A machine-readable contract the gates enforce.

| Field | Type | Rule |
|-------|------|------|
| `version` | `2` | Must be exactly `2` |
| `domain.key` | `string` | kebab-case: `"task"`, `"work-order"` |
| `domain.displayName` | `string` | Human-readable: `"Task"`, `"Work Order"` |
| `entity.key` | `string` | camelCase: `"task"`, `"workOrder"` |
| `entity.eventPrefix` | `string` | Must match the prefix of every event in `events[]` |
| `events[]` | `string[]` | Dot notation only. Min 1 event. |
| `room.template` | `string` | socket.io room: `"project:${projectId}"` |
| `room.visibilityField` | `string?` | Required for private entities — omitting it broadcasts private data publicly |

---

## Config reference

Create `rivergen.config.json` at your project root to override path defaults:

```json
{
  "dbImport": "{ prisma } from \"../lib/db\"",
  "sharedPackage": "@myapp/shared",
  "api": { "srcRoot": "apps/api/src" },
  "web": { "srcRoot": "apps/web/src" }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `dbImport` | *(TODO comment)* | DB client import injected into generated mutations |
| `sharedPackage` | `"@rivergen/shared"` | Shared package — must export `ENTITY_PROJECTIONS` |
| `api.srcRoot` | `"apps/api/src"` | API source root |
| `web.srcRoot` | `"apps/web/src"` | Web source root |

---

## Stack

RiverGen generates code for this stack. Templates are stubs — bring your own DB, auth, and business logic.

| Layer | Required |
|-------|----------|
| API runtime | Node.js ≥ 18 |
| API framework | Express 5 |
| WebSocket | socket.io 4 |
| Schema validation | Zod ≥ 3 |
| Web framework | React |
| Server state | TanStack Query v5 |
| Language | TypeScript ≥ 5 |

Support for Hono, Fastify, and additional frontend frameworks is planned.

---

## CLI reference

```
rivergen init                   Write infrastructure files (once per project)
rivergen plan  <spec>           Dry-run: show what would be generated
rivergen gen   <spec>           Write domain files + regenerate barrels
rivergen verify                 Run all 12 gates

Options:
  --force                       Overwrite existing files
  --install                     Auto-install missing packages via pnpm
  --root <path>                 Project root (default: cwd)
```

---

## Why this exists

RiverGen came out of building [Sodium](https://github.com/mithunchandrakanth/sodium), a collaborative workspace product. In v1, realtime worked — until it didn't.

Ghost cards that wouldn't go away. Stale data that only corrected on navigation. Fields the backend sent that the frontend never rendered. Each fix added another competing data path. The architecture became something only one person on the team fully understood. Nobody wanted to add new realtime domains.

v2 started with a single constraint: **one path, enforced.** Every mutation through EventFactory. Every event through a listener and broadcast. Every broadcast through a dispatcher and projection to the cache. No exceptions, no shortcuts.

The gates were added so that constraint cannot be violated silently. Witness was added so the data inside the pipeline can be verified, not just the pipeline itself.

Pain crystallized into architecture. That is what RiverGen is.

---

## License

Apache 2.0
