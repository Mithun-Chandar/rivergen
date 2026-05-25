# Witness Layers

## What Witness proves

The 11 structural gates verify that the realtime pipeline is wired correctly. They check that the right files exist, the right imports are present, and the right function calls are made.

They do not verify that the data inside the pipeline is correct.

Witness fills that gap. It answers the question: **after a `task.created` event travels from the mutation through EventFactory, the bus, the broadcast, the socket, the dispatcher, and the projection — did the `title` field survive and land in the TanStack Query cache?**

Gate #12 runs four layers of checks to answer that question.

---

## Layer 1: Schema contract (static)

**Question:** is every field listed in `requiredFields` actually declared in the domain's Zod schema?

If a field is in `requiredFields` but absent from the schema, `EventFactory.publish()` will strip it when it validates the payload with `.strict()`. The field disappears before it even reaches the EventBus — it never makes it to the broadcast, the socket, or the projection.

Layer 1 reads the domain schema slice (`schemas/<domain>.ts`) and checks that each field in `requiredFields` appears as a top-level key in the corresponding `z.object()` declaration.

**Example violation:**

```
Gate #12 Layer 1: witness requiredField "priority" for "task.created" is not
declared in the Zod schema. EventFactory will strip it silently at publish time.
File: apps/api/src/lib/event-factory/schemas/task.ts
```

**Fix:** add `priority: z.string()` to the `"task.created"` schema entry.

Layer 1 only runs for `requiredFields` entries that are non-empty. An empty array (`[]`) means "scaffold not filled yet" and is skipped.

---

## Layer 2: Broadcast contract (static)

**Question:** if the broadcast helper was manually edited to filter fields, are all `requiredFields` still forwarded in the emit payload?

The generator produces pass-through broadcasts by default:

```typescript
io.to(room).emit(eventName, payload); // entire payload object forwarded
```

A pass-through broadcast satisfies Layer 2 automatically — all fields survive.

If a developer edits the broadcast to emit a selective payload:

```typescript
io.to(room).emit(eventName, { taskId: payload.taskId, title: payload.title });
```

Layer 2 checks that every field in `requiredFields` appears in that object literal. A selective broadcast that omits a required field is a Layer 2 error.

**Broadcast style detection:** Layer 2 uses `detectBroadcastStyle()` — if any `.emit()` argument list contains `, {` (a second argument starting with an object literal), the file is classified as "selective." Otherwise it is "pass-through."

---

## Layer 3: Projection proof (dynamic)

**Question:** when the `lifecycle()` function seeds a QueryClient, applies the projection function, and inspects the cache — do the required fields actually appear there?

Layer 3 is the only dynamic gate in RiverGen. It spawns `layer3-worker.ts` as a subprocess using the `tsx` CLI, dynamically imports each `*.witness.ts` file, creates a QueryClient, and runs the assertions.

### The lifecycle function

`lifecycle(queryClient)` receives a fresh QueryClient. It must:

1. Seed the cache (e.g. `queryClient.prefetchQuery(...)`)
2. Apply the projection function to a test payload
3. Inspect the cache and assert that fields survived
4. Return a `WitnessAssertion[]`

A `WitnessAssertion` is `{ name: string; ok: boolean; detail?: string }`. Failed assertions (`ok: false`) become Gate #12 errors, with `detail` shown in the output if present.

Returning an empty array means the stub has not been filled — Layer 3 skips the file and shows a notice. This is not an error.

### The signals block

`signals` covers non-lifecycle events (anything that is not `.created`, `.updated`, or `.deleted`). Each signal function receives its own independent fresh QueryClient and follows the same seed → apply → assert pattern as `lifecycle()`.

```typescript
signals: {
  "task.priority-changed": async (queryClient) => {
    const assertions: WitnessAssertion[] = [];
    // seed cache with an existing task
    // apply the priority-changed projection
    // assert the priority field changed in cache
    return assertions;
  },
},
```

The worker runs `lifecycle()` first, then iterates `Object.entries(witness.signals)` and runs each signal function.

### The subprocess and the dynamic import constraint

Layer 3 runs in a subprocess for isolation — a crashing witness file cannot kill the gate runner, and React-dependent modules do not create ESM cycle errors in the parent context.

The worker imports each witness file with `import(fileUrl)`. If the import fails, Layer 3 reports a warning and skips that file's assertions.

**Critical rule:** do not statically import projection files at the top of the witness file. Projection files import React (via TanStack Query hooks or other UI modules), and React cannot load in the Node.js subprocess context. A top-level projection import will cause the import to fail:

```typescript
// ✗ BREAKS Layer 3 — React cannot load in the worker subprocess
import { applyTaskCreated } from "../lib/projections/task-projections";

// ✓ CORRECT — use dynamic import inside lifecycle()
async lifecycle(queryClient) {
  const { applyTaskCreated } = await import("../lib/projections/task-projections");
  // ...
}
```

The generated scaffold includes this rule as a comment. The worker reports a warning with a hint if the import fails due to a React-related error.

### The QueryClient in Layer 3

The worker tries to resolve `@tanstack/query-core` for a real QueryClient. If it is not available (e.g. in environments without the frontend packages installed), it falls back to `MinimalQueryClient` — an in-process implementation that supports `getQueryData`, `setQueryData`, `prefetchQuery`, `setQueriesData` (with prefix predicate matching), and `getQueriesData`. This fallback is sufficient for witness assertions that use the standard entity-cache patterns.

---

## Layer 4: Coverage completeness (static)

**Question:** does every event emitted by the broadcast layer appear in at least one witness file?

Layer 4 discovers all broadcast events by scanning `*.broadcast.ts` files for `.emit("event.name", ...)` patterns. It then scans all `*.witness.ts` files for quoted event strings. Every broadcast event must be covered in some witness file's `events[]` array.

This is the gate that fails immediately after `rivergen gen` until the witness scaffolds are present. Gate #12 passes (on Layer 4) as soon as the scaffold is generated — but Layer 3 will show a stub notice until `lifecycle()` is filled with real assertions.

**Two cases for a Layer 4 failure:**

1. The witness file exists but the event is not listed in `events[]` — add the event to the array and fill `requiredFields` and `testPayloads` for it
2. No witness file exists for the domain at all — run `rivergen gen specs/<domain>.json` to scaffold it

---

## Gate #12 summary output

When all layers pass:

```
✓  Gate #12: Witness — Field Continuity Coverage
   3/3 events covered, schema+broadcast contracts satisfied.
   ⚠  Layer 3: 1 witness file(s) are stubs — fill the lifecycle() function to
      activate the projection proof.
      Until then, Layer 3 cannot verify that fields survive the projection.
```

When Layer 3 assertions are running and passing:

```
✓  Gate #12: Witness — Field Continuity Coverage
   3/3 events covered, schema+broadcast contracts satisfied.
   ⚠  Layer 3: 9/9 projection assertions passed.
```

When a layer fails:

```
✗  Gate #12: Witness — Field Continuity Coverage
   2/3 events covered (1 domain missing); Layer 3: 1 projection assertion(s) failed

   ✗  [ERROR] apps/web/src/witness/task.witness.ts
              Layer 3: assertion "task.created.title preserved" failed. Expected
              "Fix bug" in cache but found undefined.
```

---

## Writing a witness file

See [docs/guides/write-a-witness.md](../guides/write-a-witness.md) for a step-by-step guide.

See [docs/reference/witness-api.md](../reference/witness-api.md) for the full `DomainWitness<T>` and `WitnessAssertion` type reference.
