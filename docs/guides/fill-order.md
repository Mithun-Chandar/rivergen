# Fill Order

## Overview

After `rivergen gen` produces 12 domain files, each file contains `// TODO` markers. The order you fill them matters: later files depend on decisions made in earlier ones. Filling in the wrong order means you will revisit already-filled files to fix mismatches.

The canonical fill order is:

```
a. mutations.ts            → Zod input schema + DB call + eventFactory.publish() payload
b. schemas/<domain>.ts     → add fields BEFORE adding them to eventFactory.publish()
c. <domain>.listener.ts    → wire eventBus.subscribe() → broadcastX()
d. use-<domain>.ts         → add query key context in onMutate
e. <domain>-projections.ts → add list key context in applyEntity*()
f. <domain>.witness.ts     → fill payload type, requiredFields, testPayloads, lifecycle(), signals{}
```

---

## a. mutations.ts — establish the payload contract

**Why first:** The mutation file defines what fields exist in the event payload. Every file that follows (`schemas`, `projections`, `witness`) depends on this contract.

The core decision here is which fields go into `eventFactory.publish({..., payload: { ... } })`. These must be the same field names the REST API response uses — because the projection will spread the WS payload into the TanStack Query cache, and the UI reads cache data by field name.

Check the Prisma `select` shape in the API route handler before writing the payload:

```typescript
// API route handler — the select shape is ground truth
const task = await prisma.task.findUnique({
  where: { id },
  select: {
    id: true,
    title: true, // ← field is named "title" in the API response
    projectId: true,
  },
});
```

The WS payload must use the same names:

```typescript
await eventFactory.publish({
  type: "task.created",
  resourceId: task.id,
  actor: { id: userId, type: "user" },
  context: { realmId: projectId },
  correlationId: randomUUID(),
  eventVersion: "1.0",
  payload: {
    taskId: task.id,
    title: task.title, // ✓ matches REST API shape
    projectId: task.projectId,
    clientTempId: (data.clientTempId as string) ?? null,
  },
});
```

**The `eventFactory.publish()` call shape is a hard rule.** It takes a **single object** — not positional args. `eventFactory.publish("task.created", payload)` compiles but crashes at runtime because `input.type` resolves to `undefined`.

**`clientTempId` must be in the payload** for ghost reconciliation to work. If you omit it from the payload, the Zod schema will strip it (`.strict()`), and the optimistic ghost in the UI cache will never be replaced by the real entity.

---

## b. schemas/<domain>.ts — lock the payload shape before publishing

**Why second (before adding fields to `eventFactory.publish()`):** The Zod schema has `.strict()` — any field in the payload that is not declared in the schema is silently stripped. If you add a field to the mutation's publish call before adding it to the schema, the field is stripped before it reaches the broadcast and the WS client never sees it.

The workflow is:

1. Decide you need a new field (e.g. `title`)
2. **Add it to the schema first:**

```typescript
// schemas/task.ts
export const taskCreatedSchema = z
  .object({
    taskId: z.string(),
    title: z.string(), // ← add here first
    projectId: z.string(),
    clientTempId: z.string().nullable(),
  })
  .strict();
```

3. **Then** add it to the `eventFactory.publish()` payload in `mutations.ts`

The schema is also what Gate #6: EventFactory Schema Coverage checks (every event has a schema) and what Gate #7: Schema .strict() Enforcement checks.

---

## c. <domain>.listener.ts — wire the EventBus to the broadcast helper

**Why third:** The listener connects the backend event flow (`EventBus`) to the socket broadcast. It depends on the broadcast helper that was generated, and both depend on the schema being defined (so EventFactory can validate the payload when it publishes).

The generated listener already contains the correct stub:

```typescript
// task.listener.ts
eventBus.subscribe("task.*", (envelope) => {
  broadcastTaskEvent(io, envelope.type, envelope.payload);
});
```

In most cases you do not need to change this file at all. Situations where you might:

- The domain has events with different broadcast patterns (some events go to a different room)
- You need to filter events before broadcasting (e.g. only broadcast to admins)

If the room template uses a visibility field, the generated `broadcastTaskEvent` already includes the `isPrivate` guard — but the two room strings in the guard are placeholder stubs you must fill in:

```typescript
const isPrivate = payload.visibility === "PRIVATE";
const room = isPrivate
  ? `user:${userId}` // TODO: fill in scoped room for private entities
  : `workspace:${workspaceId}`;
```

---

## d. use-<domain>.ts — add query key context in onMutate

**Why fourth (after listener):** The hook's `onMutate` writes the optimistic ghost to the cache using the list key. This list key must match what the entity-projection slice will use in step (e). Getting the key right before filling the projection avoids having to change both files.

The key decision is which context variables the list key needs. These come from the room template:

```typescript
// Room template: "project:${projectId}"
// → list key must include projectId

const listKey = taskKeys.list({ projectId });
```

If the room template is `workspace:${workspaceId}`, the list key uses `workspaceId`. The shape must be consistent across: the query key factory, the hook's `onMutate`, and the entity-projection slice.

The generated hook also has a `// TODO` comment on the `Array.isArray(prev)` guard:

```typescript
// Array.isArray guard — required. A plain object under a cold cache passes
// a bare if(prev) truthy check and causes [...prev, ghost] to throw TypeError.
queryClient.setQueryData<Task[]>(listKey, [
  ...(Array.isArray(prev) ? prev : []),
  ghost,
]);
```

Do not simplify this to `if (prev)`. The guard is there to protect against the cold-cache case.

---

## e. <domain>-projections.ts — wire the list key context in applyEntity\*

**Why fifth (after hook):** The projection uses the same list key shape as the hook. Because you established that shape in step (d), you can now fill the projection confidently.

The projection extracts the context from the WS payload:

```typescript
export function applyTaskCreated(
  payload: AnyPayload,
  queryClient: QueryClient,
): void {
  const taskId = payload.taskId as string | undefined;
  if (!taskId) return;

  const context = { projectId: payload.projectId as string };
  applyEntityCreate("task", { id: taskId, ...payload }, context, queryClient);
}
```

`context.projectId` is how the entity-cache knows which list keys to write. The entity-projection slice (`packages/shared/src/entity-projections/task.ts`) must use the same key shape in `onCreate.required`:

```typescript
onCreate: {
  required: [
    (entity, context) => ["tasks", "list", (context as { projectId: string }).projectId],
  ],
  invalidate: [],
},
```

**Projection removal law:** When an entity is deleted, the projection must use synchronous cache mutation — not `invalidateQueries`. Two rapid deletions with `invalidateQueries` can race: the first refetch response lands after the second deletion, reinserting the first deleted item. `applyEntityDelete` uses `setQueriesData` with a synchronous filter internally, which is always safe.

```typescript
// CORRECT — synchronous filter via entity-cache
applyEntityDelete("task", taskId, context, queryClient);

// WRONG — async refetch races with rapid deletions
queryClient.invalidateQueries({ queryKey: taskKeys.list({ projectId }) });
```

---

## f. <domain>.witness.ts — lock the field continuity contract

**Why last:** The witness tests the projection. It can only be written once you know what fields the projection reads (from the payload) and what keys it writes to (from the entity-projection slice). Filling the witness last means you are describing a path that already exists and has been verified by running it.

The witness is covered in full in [write-a-witness.md](write-a-witness.md).

---

## Why this order is not optional

The six files form a **directed dependency chain**:

```
mutations (payload contract)
  ↓
schemas (locks the contract)
  ↓
listener (publishes through the locked schema)
  ↓
hook (reads query key shape)
  ↓
projections (writes to same query key shape)
  ↓
witness (tests the projection)
```

Filling in a different order creates feedback loops:

- Filling `projections` before `hook` means you choose a list key that the hook may not match — you then fix the hook, and may need to re-fix the projection.
- Filling `witness` before `projections` means you are writing tests for behavior that doesn't exist yet — the tests will fail, and after you fill the projection you may need to update the test payloads.
- Adding a field to `eventFactory.publish()` before `schemas` means the field is stripped at runtime; the UI appears correct (REST fetch works) but WS updates silently drop the field.

The fill order removes these loops by ensuring each file is written at the point when its dependencies are finalized.

---

## Schema-first discipline for adding fields later

The same schema-first rule applies after the initial fill, whenever you add a new field to an existing domain:

1. Add the field to `schemas/<domain>.ts` (the `.strict()` Zod schema)
2. Add the field to `eventFactory.publish()` in `mutations.ts`
3. Update `requiredFields` in `<domain>.witness.ts` to include the new field
4. Run `rivergen verify` — Gate #12 Layer 1 will confirm the field is in the schema

If you skip step 1 and add the field to `eventFactory.publish()` first, the schema strips it. The mutation appears to succeed, but the WS event arrives at the projection with the field missing. Layer 3 of Gate #12 will catch this — the `<field> preserved` assertion will fail.

---

## Related

- [docs/guides/first-domain.md](first-domain.md) — the full workflow this order applies to
- [docs/guides/write-a-witness.md](write-a-witness.md) — step (f) in detail
- [docs/concepts/field-shape-law.md](../concepts/field-shape-law.md) — why payload field names must match REST API shape
- [docs/concepts/ghost-reconciliation.md](../concepts/ghost-reconciliation.md) — why `clientTempId` must be in both the mutation and the schema
