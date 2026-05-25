# RiverGen CLI — Test Suite Plan

`@rivergen/cli` is a published npm package with zero test coverage. Any regression in gate regex patterns, template output, or name derivation ships silently. This document is the authoritative plan for the test suite that lives in `tests/` — local only, never shipped.

**Test files are excluded from npm publish** via the `files` whitelist in `package.json`. Tests are tracked in git for continuity across sessions.

---

## Quick Start (after npm install)

```bash
npm test                                          # run all tests once
npm run test:watch                                # re-run on save
npm run test:coverage                             # coverage report (target: ≥70%)
npx vitest run -u tests/snapshots/templates.test.ts                  # first-time snapshot generation
npx tsc --noEmit                                  # type-check source + tests
npx tsc --noEmit -p tests/fixtures/tsconfig.json  # fixture-only editor/typecheck boundary
npx vitest run tests/integration/runner.test.ts   # verify broken fixtures still fail only the intended gate
```

---

## Infrastructure

| File                             | Purpose                                                     |
| -------------------------------- | ----------------------------------------------------------- |
| `vitest.config.ts`               | Test runner — node env, 30 s timeout for Layer 3 subprocess |
| `tsconfig.json`                  | NodeNext/strict, noEmit, covers all `.ts`                   |
| `package.json` `scripts`         | `test`, `test:watch`, `test:coverage`                       |
| `package.json` `devDependencies` | `vitest`, `@vitest/coverage-v8`, `typescript`, `zod`        |

---

## Test Levels

### Level 1 — Unit: pure functions

**Files:** `tests/unit/naming.test.ts`, `tests/unit/schema.test.ts`, `tests/unit/config.test.ts`

No disk I/O (except `config.test.ts` which uses a real tmpdir for `rivergen.config.json`).

#### `naming.test.ts` — `deriveNames()`

| Input                               | Field                     | Expected output                           |
| ----------------------------------- | ------------------------- | ----------------------------------------- |
| `domain.key: "work-order"`          | `domainPascal`            | `"WorkOrder"`                             |
| `domain.key: "project-folder-item"` | `domainPascal`            | `"ProjectFolderItem"`                     |
| `entity.key: "workOrder"`           | `entityPascal`            | `"WorkOrder"`                             |
| event `"task.priority-changed"`     | `eventConstants[0]`       | `"TASK_PRIORITY_CHANGED"`                 |
| event `"task.priority-changed"`     | `eventPascalConstants[0]` | `"TaskPriorityChanged"` ← hyphen critical |
| event `"project-folder.created"`    | `eventPascalConstants[0]` | `"ProjectFolderCreated"`                  |

> **Regression target in template (not in naming.ts):** `templates/backend-broadcast.ts` must normalize hyphenated action segments when building broadcast helper names, so `task.priority-changed` emits `broadcastTaskPriorityChanged`. Snapshot coverage in `tests/snapshots/templates.test.ts` guards this.

#### `schema.test.ts` — `validateSpec()`

| Case                                          | Expected                                              |
| --------------------------------------------- | ----------------------------------------------------- |
| Valid single-event spec                       | no errors                                             |
| Events with hyphens `"task.priority-changed"` | no errors                                             |
| `version: 1`                                  | error at `[version]`                                  |
| `domain.key: "WorkOrder"` (PascalCase)        | error at `[domain.key]`                               |
| `entity.key: "work-order"` (kebab)            | error at `[entity.key]`                               |
| Event `"task:created"` (colon)                | error at `[events.0]`                                 |
| `events: []`                                  | error                                                 |
| Extra top-level field                         | passes (outer object not `.strict()`) — document this |

#### `config.test.ts` — `loadConfig()`

| Case                             | Expected                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| No config file                   | returns `DEFAULT_CONFIG` exactly                                                                |
| Invalid JSON                     | warns via `console.warn`, returns `DEFAULT_CONFIG`                                              |
| Partial `api` override           | only specified fields change                                                                    |
| `auditDir` override              | appears in config                                                                               |
| Empty `{}`                       | preserves nested defaults; runtime `auditDir` defaults to `"witness"` when a config file exists |
| `dbImport` + `sharedPackage` set | appear in output                                                                                |

---

### Level 2 — Unit: gate regex

**Shared helper:** `tests/unit/gates/_helpers.ts`

```ts
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

export function makeTmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rivergen-test-"));
  return {
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

export function writeFile(
  root: string,
  relPath: string,
  content: string,
): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
}
```

Each gate test: `makeTmpProject()` in `beforeEach`, write inline TS strings, call the gate function directly, assert `passed`, `violations.length`, `severity`, message fragments. Cleanup in `afterEach`.

#### `gate1.test.ts` — Mutation → EventFactory

| Scenario                                   | Expected                            |
| ------------------------------------------ | ----------------------------------- |
| Imports `eventFactory` + calls `.publish(` | `passed: true`                      |
| Missing eventFactory import                | error "Missing eventFactory import" |
| Missing `.publish(` call                   | error "No .publish() call found"    |
| `io.to(room).emit(` in mutation            | error "Direct socket.emit"          |
| `socket.emit(` on non-comment line         | error violation                     |
| `eventBus.publish(`                        | error violation                     |
| `// socket.emit(` on comment line          | no violation                        |
| No mutation files in dir                   | `passed: true`, `testedCount: 0`    |

#### `gate4.test.ts` — Projection → entity-cache helpers

| Scenario                                              | Expected                                 |
| ----------------------------------------------------- | ---------------------------------------- |
| Imports `applyEntityCreate`, calls it                 | `passed: true`                           |
| No entity-cache import                                | error "No entity-cache helpers imported" |
| `queryClient.setQueryData(key, d)` bare               | error                                    |
| `queryClient.setQueryData<Invoice[]>(key, d)` generic | **no violation** (`<` before `(`)        |
| `// gate4:map-projection` comment + bare form         | error "non-generic setQueryData()"       |
| `// gate4:map-projection` comment + generic form      | no violation                             |
| No projection files                                   | `passed: true`, `testedCount: 0`         |

#### `gate-schema-strict.test.ts`

| Scenario                                          | Expected                              |
| ------------------------------------------------- | ------------------------------------- |
| `z.object({}).strict()` single line               | pass                                  |
| Multi-line z.object + `.strict()` within 25 lines | pass                                  |
| `z.object({})` no `.strict()` within 25 lines     | error "missing .strict()"             |
| `.strict()` on line 26 (beyond window)            | error — known 25-line limit, document |
| No schema files                                   | pass, `testedCount: 0`                |

#### `gate-provider-isolation.test.ts`

| Scenario                                             | Expected                                  |
| ---------------------------------------------------- | ----------------------------------------- |
| Provider uses `applyRealtimeEventToCache()` only     | pass                                      |
| `import { applyEntityCreate } from "..entity-cache"` | error "must not import from entity-cache" |
| Direct `applyEntityCreate(` call                     | error "must not call applyEntity\*()"     |
| `queryClient.setQueryData(` on non-comment line      | error                                     |
| No `WebSocketProvider.tsx`                           | pass + "skipped" in summary               |

#### `gate-onsuccess-ban.test.ts`

| Scenario                                              | Expected                        |
| ----------------------------------------------------- | ------------------------------- |
| `onSuccess: () => { console.log() }`                  | pass                            |
| `onSuccess: () => { queryClient.setQueryData(`        | error forbidden                 |
| `onSuccess: () => { queryClient.invalidateQueries(`   | error forbidden                 |
| `// queryClient.setQueryData(` inside onSuccess block | no violation                    |
| One-liner `onSuccess: () => {}`                       | no violation, exits immediately |
| No `onSuccess` in file                                | `testedCount: 0`, pass          |
| No hook files                                         | pass                            |

#### `gate-optimistic-coverage.test.ts`

| Scenario                                                  | Expected                        |
| --------------------------------------------------------- | ------------------------------- |
| Domain hook (imports query-keys) + `onMutate` + `onError` | pass                            |
| Missing `onMutate`                                        | error "missing onMutate"        |
| Missing `onError`                                         | error "missing onError"         |
| Non-domain hook (no query-keys import)                    | skipped, `testedCount: 0`       |
| Two `useMutation` blocks, second missing `onError`        | one violation with correct line |
| No hook files                                             | pass                            |

#### `gate-broadcast-room.test.ts`

| Scenario                                                    | Expected                       |
| ----------------------------------------------------------- | ------------------------------ |
| ``io.to(`project:${projectId}`).emit(``                     | pass                           |
| `io.emit("event.name", payload)`                            | error "io.emit() with no room" |
| Function with `visibility` param + ``io.to(`workspace:...`` | error "Add a visibility guard" |
| Workspace room + `if (visibility === 'PRIVATE')` guard      | pass (warning only)            |
| No broadcast files                                          | pass                           |

#### `gate-schema-coverage.test.ts`

| Scenario                                           | Expected                                      |
| -------------------------------------------------- | --------------------------------------------- |
| Schema entry + broadcast `.emit("invoice.created"` | pass                                          |
| Broadcast emits event with no schema entry         | error "not registered in EventPayloadSchemas" |
| Schema registered but no broadcast emit            | warning (not error)                           |
| Broadcast helper pattern `(io, "invoice.created"`  | detected, pass                                |
| Both dirs empty                                    | pass, "No events registered or emitted"       |
| Slice pattern (`schemas/invoice.ts`)               | detected by `loadRegisteredEventTypes`        |

#### `gate2.test.ts` — Event → Listener → Broadcaster → socket.emit

| Scenario                                                                    | Expected                        |
| --------------------------------------------------------------------------- | ------------------------------- |
| Schema + `eventBus.subscribe("invoice.created"` + `.emit("invoice.created"` | pass                            |
| Schema + emit but no listener                                               | error "no listener found"       |
| Schema + listener but no emit                                               | error "no broadcaster calls"    |
| Schema only, neither                                                        | error "full pipeline is broken" |
| `RealtimeEvent.InvoiceCreated` in listener (with realtime-events.ts map)    | pass                            |
| Emitted event with no schema                                                | warning severity                |
| No schemas registered                                                       | pass, "No events registered"    |
| Slice schema pattern (`schemas/invoice.ts`)                                 | pass                            |

#### `gate3.test.ts` — WebSocket event → Dispatcher → Projection

| Scenario                                                                                | Expected                                  |
| --------------------------------------------------------------------------------------- | ----------------------------------------- |
| `getAllWsBindings()` in provider + ws-bindings slice + dispatcher slice + projection fn | pass                                      |
| Switch/case pattern in state-cache                                                      | pass                                      |
| Event bound in provider but no dispatcher case                                          | error "not dispatched"                    |
| Dispatcher case with no `apply*Projection(` call                                        | error "does not call apply\*Projection()" |
| Dispatcher case not in provider                                                         | warning                                   |
| `socket.on("connect", ...)` lifecycle event                                             | no violation                              |

#### `gate-audit-coverage.test.ts`

| Scenario                                    | Expected                        |
| ------------------------------------------- | ------------------------------- |
| No audit files present                      | `skipped: true`, `passed: true` |
| All three files present, all events covered | pass                            |
| Phase 4 missing event entry                 | error                           |
| Phase 5 missing `publish("event.name"`      | error                           |
| Phase 6 missing event string literal        | error                           |

#### `gate-witness-coverage.test.ts` ← async (15 s timeout)

| Scenario                                                    | Expected                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| No witness directory                                        | pass + "gate skipped"                                           |
| Broadcast emits event, witness lists it                     | pass, `passedCount: 1`                                          |
| Broadcast emits event, witness dir exists but event missing | error "has no witness file" or "add to witness file's events[]" |
| Layer 1: field in requiredFields not in Zod schema          | error                                                           |
| Layer 2: selective broadcast missing requiredField          | error                                                           |
| Stub witness (`lifecycle` returns `[]`)                     | Layer 3 skipped, no error                                       |

---

### Level 3 — Fixture-based integration

All fixtures are **hand-authored** minimal TypeScript files — just enough content to satisfy gate regex patterns.

#### `tests/fixtures/vanilla/` — All 12 gates green

```
apps/api/package.json
apps/api/src/lib/event-factory/schemas/
  _index.ts, _base.ts, task.ts          # "task.created": z.object({taskId:z.string()}).strict()
apps/api/src/lib/event-bus-listeners/
  task.listener.ts                       # eventBus.subscribe("task.created", ...)
apps/api/src/task/
  task.mutations.ts                      # import EventFactory + .publish()
  task.broadcast.ts                      # io.to(room).emit("task.created", payload)
apps/web/package.json
apps/web/src/providers/
  WebSocketProvider.tsx                  # getAllWsBindings(), no entity-cache import
  ws-bindings/_index.ts, task.ts        # ["task.created"]
apps/web/src/lib/cache/
  entity-cache.ts                        # exports applyEntityCreate/Update/Delete
  state-cache.ts                         # exports domainDispatchers
  domain-dispatchers/_index.ts, task.ts # "task.created": (...) => applyTaskCreated(...)
apps/web/src/lib/projections/
  task-projections.ts                    # imports applyEntityCreate, exports applyTaskCreated
apps/web/src/lib/query-keys/_index.ts, task.ts
apps/web/src/hooks/
  use-task.ts                            # useMutation + onMutate + onError, no onSuccess cache ops
apps/web/src/witness/
  task.witness.ts                        # lists "task.created" in events[]
packages/types/src/realtime-events.ts   # RealtimeEvent const (for gate2 PascalCase pattern)
packages/shared/src/entity-projections/_index.ts, task.ts
```

#### `tests/fixtures/custom-layout/` — Non-default paths

```json
{
  "api": {
    "srcRoot": "backend/src",
    "listenersDir": "backend/src/lib/event-bus-listeners",
    "schemasFile": "backend/src/lib/event-factory/schemas.ts",
    "schemasDir": "backend/src/lib/event-factory/schemas",
    "schemasBarrelFile": "backend/src/lib/event-factory/schemas/_index.ts",
    "schemasBaseFile": "backend/src/lib/event-factory/schemas/_base.ts"
  },
  "web": {
    "srcRoot": "frontend/src",
    "providerFile": "frontend/src/providers/WebSocketProvider.tsx",
    "dispatchersDir": "frontend/src/lib/cache/domain-dispatchers",
    "dispatchersBarrelFile": "frontend/src/lib/cache/domain-dispatchers/_index.ts",
    "wsBindingsDir": "frontend/src/providers/ws-bindings",
    "wsBindingsBarrelFile": "frontend/src/providers/ws-bindings/_index.ts",
    "queryKeysDir": "frontend/src/lib/query-keys",
    "queryKeysBarrelFile": "frontend/src/lib/query-keys/_index.ts",
    "entityCacheFile": "frontend/src/lib/cache/entity-cache.ts",
    "stateCacheFile": "frontend/src/lib/cache/state-cache.ts",
    "projectionsDir": "frontend/src/lib/projections",
    "hooksDir": "frontend/src/hooks",
    "witnessDir": "frontend/src/witness"
  }
}
```

Mirror vanilla under `backend/src` and `frontend/src`.

> `loadConfig()` currently deep-merges literal path fields; it does not derive sibling dirs from `srcRoot`, so the fixture overrides the full path family rather than only `srcRoot`.

#### `tests/fixtures/broken-gate1/`

Mutation uses `io.to(room).emit(` directly — no `eventFactory` import, no `.publish(`.

#### `tests/fixtures/broken-gate2/`

Schema registered. Broadcast exists. No listener file.

#### `tests/fixtures/broken-gate4/`

Projection file exists but does not import any entity-cache helpers.

#### `tests/fixtures/broken-gate-onsuccess/`

`onSuccess: () => { queryClient.invalidateQueries(` in a domain hook.

#### `tests/fixtures/broken-gate-optimistic/`

Domain hook missing `onMutate`.

#### `tests/integration/runner.test.ts`

```ts
import { runAllGates } from "../../gates/runner.ts";
// vanilla       → allPassed === true
// broken-gate1  → only gate1 fails
// broken-gate2  → only gate2 fails
// broken-gate4  → only gate4 fails
// broken-gate-onsuccess  → only gate-onsuccess-ban fails
// broken-gate-optimistic → only gate-optimistic-coverage fails
// custom-layout → allPassed === true (config-aware paths)
```

#### `tests/integration/execute.test.ts`

Uses `scaffoldMinimalInfra()` helper (writes package.json files with all required deps listed so `checkDependencies` returns `ok: true`).

| Assertion                                                                             |
| ------------------------------------------------------------------------------------- |
| `result.filesWritten.length === 12`                                                   |
| Second run without `--force` → `result.ok === false`, error `/Refusing to overwrite/` |
| Second run with `--force` → `result.ok === true`                                      |
| Generated `task.mutations.ts` contains `import.*EventFactory` and `.publish(`         |
| Generated `task-projections.ts` imports `applyEntityCreate`                           |
| Generated barrel `schemas/_index.ts` references `task`                                |
| Nonexistent spec → `result.ok === false`, error `/not found/i`                        |
| Invalid spec → `result.ok === false`                                                  |

> Always pass `{ install: false }` — never let execute() run `pnpm add` in tests.

#### `tests/integration/barrel.test.ts`

- `scanDomainKeys`: ignores `_index.ts`, `_base.ts`, `_types.ts`; returns sorted domain keys
- `regenerateBarrel`: writes correct barrel content to disk
- `detectCollisions`: finds cross-domain event collisions, excludes same-domain slices

---

### Level 4 — Template snapshots

**File:** `tests/snapshots/templates.test.ts`

Uses a hardcoded `FIXED_NAMES: DomainNames` (invoice domain, 3 events, no `visibilityField`). One `toMatchSnapshot()` per template render function. Run with `-u` on first execution.

Templates to snapshot:

- `renderBackendRouter`
- `renderBackendMutations` (with and without `dbImport`)
- `renderBackendBroadcast` (with and without `visibilityField`)
- `renderBackendListener`
- `renderFrontendProjection`
- `renderFrontendHook`
- All 5 domain slice renders (`dispatchers`, `entityProjection`, `queryKeys`, `schemas`, `wsBindings`)
- `renderWitnessFile`

**Hyphenated action snapshot:** `renderBackendBroadcast` with `events: ["task.priority-changed"]` → expects `broadcastTaskPriorityChanged` (valid TS identifier).

---

## Known Traps

| #   | Trap                                                                                      | Mitigation                                                                                                           |
| --- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | `layer3-runner` uses `execSync` — slow                                                    | 30 s `testTimeout` in vitest config                                                                                  |
| 2   | gate3 has module-level `_realtimeEventMapCache`                                           | Resets at start of each `runGate3()` call — safe                                                                     |
| 3   | `execute()` runs `pnpm add` if `install: true`                                            | Always pass `{ install: false }` in tests                                                                            |
| 4   | `execute()` requires package.json files to pass dep check                                 | `scaffoldMinimalInfra()` writes them with all deps listed                                                            |
| 5   | gate-onsuccess brace-balance: one-liner `onSuccess: () => {}` exits on same line          | Test this explicitly                                                                                                 |
| 6   | Hyphenated action segments in `backend-broadcast.ts` can regress into invalid TS identifiers | Keep snapshot coverage for `task.priority-changed`; expect `broadcastTaskPriorityChanged`                             |
| 7   | gate2 reads BOTH legacy `schemas.ts` AND `schemas/` slices                                | Test both paths in gate2 test                                                                                        |
| 8   | `vitest` + `zod` + `typescript` are peerDeps not devDeps — not installed by default       | Added as `devDependencies` in package.json                                                                           |
| 9   | This Vitest version rejects `--update-snapshots`                                          | Use `npx vitest run -u tests/snapshots/templates.test.ts`                                                            |
| 10  | Repo-wide `npx tsc --noEmit` will pick up intentionally broken fixture source if included | Keep `tests/fixtures/**` excluded from the repo tsconfig; validate real source/tests with NodeNext-compliant imports |
| 11  | Fixture files are intentionally incomplete/broken, but editor noise still needs containment | Keep a dedicated `tests/fixtures/tsconfig.json` plus shared ambient stubs; validate negative fixtures via `tests/integration/runner.test.ts` |
| 12  | `loadConfig()` deep-merges literal fields only — it does not derive sibling dirs from `srcRoot` | `custom-layout` must override the full path family it depends on, not just `srcRoot` |
| 13  | Template source files can accidentally pull app-only dependencies into the CLI import graph | Keep template-render modules dependency-free at import time; emit app/runtime imports only inside returned strings |

---

## Findings And Review Targets

**Fixed findings**

- `loadConfig()` behavior is literal/deep-merge based. `srcRoot` does not derive sibling directories, and an empty config file still receives runtime `auditDir: "witness"`. Tests and planner expectations were aligned to the real behavior.
- `execute()` overwrite handling is intentionally split: plan-time existing-file conflicts are filtered so the dedicated runtime guard returns the expected `Refusing to overwrite...` error path. `tests/integration/execute.test.ts` locks this behavior.
- `templates/init-barrel-dispatchers.ts` must stay dependency-free at template-render time. The template source should not import `@tanstack/react-query`; the generated output may still emit the runtime `QueryClient` import inside the returned string.
- `templates/backend-broadcast.ts` now normalizes hyphenated action segments when constructing helper names, so `task.priority-changed` generates `broadcastTaskPriorityChanged` instead of an invalid identifier. The snapshot suite was refreshed to lock this in.
- Repo typecheck is green because the source now follows NodeNext ESM rules: internal source imports use `.js` specifiers where required, `@types/node` is installed, and `allowImportingTsExtensions` is enabled for test imports that intentionally reference `.ts` files.
- Fixture diagnostics are isolated with `tests/fixtures/tsconfig.json` and `tests/fixtures/fixtures.d.ts`, so the intentionally broken negative fixtures no longer pollute the main repo typecheck or editor diagnostics.

**Intentional findings**

- Green results on `tests/fixtures/broken-gate*` are expected. Those fixtures are supposed to be invalid; a green integration result means `runAllGates()` isolated the exact failing gate correctly.
- `tests/fixtures/broken-gate4/` still fails Gate 4 for the intended rule violation (missing entity-cache helper usage). The projection signature was only loosened enough to prevent an unrelated TypeScript arity diagnostic from masking that real gate failure.
- The snapshot suite now guards hyphenated action normalization in `renderBackendBroadcast()` by expecting `broadcastTaskPriorityChanged` for `task.priority-changed`.

**Verification guardrails**

- Keep `tests/fixtures/**` excluded from the main repo `tsconfig.json`.
- If fixture diagnostics, ambient stubs, or fixture source shapes change, rerun `npx tsc --noEmit -p tests/fixtures/tsconfig.json` and `npx vitest run tests/integration/runner.test.ts`.
- Do not "fix" the `broken-gate*` fixtures into valid application code. They are negative-test inputs and must remain broken in the specific way each gate expects.

---

## Progress Tracker

| Item                                                | Status                        |
| --------------------------------------------------- | ----------------------------- |
| `vitest.config.ts`                                  | ✓ done                        |
| `tsconfig.json`                                     | ✓ done                        |
| `package.json` scripts + devDeps                    | ✓ done                        |
| `tests/fixtures/tsconfig.json`                      | ✓ done                        |
| `tests/fixtures/fixtures.d.ts`                      | ✓ done                        |
| `tests/unit/naming.test.ts`                         | ✓ done                        |
| `tests/unit/schema.test.ts`                         | ✓ done                        |
| `tests/unit/config.test.ts`                         | ✓ done                        |
| `tests/unit/gates/_helpers.ts`                      | ✓ done                        |
| `tests/unit/gates/gate1.test.ts`                    | ✓ done                        |
| `tests/unit/gates/gate4.test.ts`                    | ✓ done                        |
| `tests/unit/gates/gate-schema-strict.test.ts`       | ✓ done                        |
| `tests/unit/gates/gate-onsuccess-ban.test.ts`       | ✓ done                        |
| `tests/unit/gates/gate-optimistic-coverage.test.ts` | ✓ done                        |
| `tests/unit/gates/gate-provider-isolation.test.ts`  | ✓ done                        |
| `tests/unit/gates/gate-broadcast-room.test.ts`      | ✓ done                        |
| `tests/unit/gates/gate-schema-coverage.test.ts`     | ✓ done                        |
| `tests/unit/gates/gate2.test.ts`                    | ✓ done                        |
| `tests/unit/gates/gate3.test.ts`                    | ✓ done                        |
| `tests/unit/gates/gate-audit-coverage.test.ts`      | ✓ done                        |
| `tests/unit/gates/gate-witness-coverage.test.ts`    | ✓ done (async — 15 s timeout) |
| `tests/snapshots/templates.test.ts`                 | ✓ done                        |
| `tests/integration/execute.test.ts`                 | ✓ done                        |
| `tests/integration/barrel.test.ts`                  | ✓ done                        |
| `tests/integration/runner.test.ts`                  | ✓ done                        |
| `tests/fixtures/vanilla/`                           | ✓ done                        |
| `tests/fixtures/custom-layout/`                     | ✓ done                        |
| `tests/fixtures/broken-gate1/`                      | ✓ done                        |
| `tests/fixtures/broken-gate2/`                      | ✓ done                        |
| `tests/fixtures/broken-gate4/`                      | ✓ done                        |
| `tests/fixtures/broken-gate-onsuccess/`             | ✓ done                        |
| `tests/fixtures/broken-gate-optimistic/`            | ✓ done                        |

---

## Current Validation Status

- `npm test` → 19 test files passed, 113 tests passed
- `npm run test:coverage` → passed at 75.69% statements / 80.50% branches / 89.42% functions / 75.69% lines
- `npx tsc --noEmit` → passed after excluding `tests/fixtures/**` from the repo tsconfig, adding `@types/node`, and converting repo source imports to NodeNext-compliant `.js` specifiers
- `npx tsc --noEmit -p tests/fixtures/tsconfig.json` → passed with the dedicated fixture-only tsconfig and ambient stubs
- `npx vitest run tests/integration/runner.test.ts` → passed (1 file, 7 tests) after fixture hardening; broken fixtures still fail only their intended gate
