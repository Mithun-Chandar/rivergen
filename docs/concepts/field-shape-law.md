# Field Shape Law

## The law

**Field names in `eventFactory.publish()` payload must match the REST API response field names that the UI reads from `useQuery` data.**

This is stated as a law in every generated projection file:

```typescript
// FIELD SHAPE LAW: the payload object spread into applyEntity* becomes what
// useQuery returns. Field names in eventFactory.publish() payload MUST match
// the REST API response shape — the same names the UI reads from useQuery data.
// A mismatch (e.g. "creatorId" in WS but "authorId" in REST) causes the WS
// projection to write a field the UI never reads, silently losing the update.
// Cross-check with your API route's select/include shape before adding fields.
```

---

## Why the law exists

The projection function spreads the WS payload directly into the cached entity:

```typescript
export function applyTaskCreated(payload: AnyPayload, queryClient: QueryClient): void {
  const taskId = payload.taskId as string | undefined;
  if (!taskId) return;

  const context = { projectId: payload.projectId as string };
  applyEntityCreate("task", { id: taskId, ...payload }, context, queryClient);
}
```

The `{ id: taskId, ...payload }` object becomes the cached entity. Every field in the payload becomes a field on the cached entity.

The UI reads cached entities from `useQuery`:

```typescript
const { data: tasks } = useTaskList(projectId);
// tasks[0].title — reads the "title" field
```

If the payload had `taskTitle` instead of `title`, the WS projection would cache a `taskTitle` field. The UI reading `task.title` would get `undefined`. The entity "updated" but the visible data did not change.

This failure is silent. No error is thrown. The HTTP fetch response (which uses the correct field names) shows the right data. Only the WS-triggered cache update fails silently.

---

## Where the mismatch can occur

**Server-side (mutations → publish):**

```typescript
// REST API response uses: task.title
// Mutation incorrectly uses: taskTitle in the event payload

await eventFactory.publish({
  payload: {
    taskId: task.id,
    taskTitle: task.title,  // ✗ wrong name — will mismatch the REST API shape
  },
});
```

**Frontend (projection):**

The projection spreads whatever arrives in the WS payload. If the payload uses `taskTitle`, the cache gets `taskTitle`. The component reads `title` and gets `undefined`.

---

## How to verify the field shape

Before adding a field to `eventFactory.publish()`, check what name the REST API uses for it. For a Prisma-backed API, this means checking the `select` or `include` shape in the route handler:

```typescript
// API route handler
const task = await prisma.task.findUnique({
  where: { id },
  select: {
    id: true,
    title: true,       // ← the field is named "title" in the API response
    projectId: true,
    createdAt: true,
  },
});
```

The `select` shape is the ground truth. The WS payload must use the same names:

```typescript
await eventFactory.publish({
  payload: {
    taskId: task.id,
    title: task.title,       // ✓ matches the API response shape
    projectId: task.projectId,
  },
});
```

---

## How Witness enforces the law

Witness runs a three-layer check that catches field shape violations:

**Layer 1** verifies that every field in `requiredFields` exists in the domain's Zod schema. If you added `title` to `requiredFields` but the schema still only has `taskId`, Layer 1 fails.

**Layer 3** verifies that every field in `requiredFields` actually appears in the cache after the projection runs. If the payload uses `taskTitle` but `requiredFields` declares `title`, the Layer 3 assertion `task.created.title preserved` will fail because the cache contains `taskTitle`, not `title`.

The `lifecycle()` assertion pattern for field survival:

```typescript
async lifecycle(queryClient) {
  const assertions: WitnessAssertion[] = [];

  const { applyTaskCreated } = await import("../lib/projections/task-projections");

  await queryClient.prefetchQuery({
    queryKey: taskKeys.list({ projectId: "proj-001" }),
    queryFn: () => [],
  });

  applyTaskCreated(testPayloads["task.created"], queryClient);

  const list = queryClient.getQueryData<Task[]>(taskKeys.list({ projectId: "proj-001" })) ?? [];
  const created = list.find(t => t.id === "test-task-001");

  assertions.push({ name: "task.created lands in list", ok: !!created });
  // Field survival assertions — one per requiredField
  assertions.push({ name: "task.created.title preserved", ok: created?.title === "Fix bug" });
  assertions.push({ name: "task.created.projectId preserved", ok: created?.projectId === "proj-001" });

  return assertions;
},
```

If `title` is missing from the cache (because the payload used a different field name), the assertion `task.created.title preserved` fails with a precise Layer 3 error.

---

## The mismatch that is hardest to catch

The most dangerous form of the field shape law violation is a **partial name mismatch on update events**.

Example: a task has a `status` field. The REST response returns `status: "OPEN"`. The WS payload uses `taskStatus`. The initial page load via REST shows `status: "OPEN"` correctly. When another user changes the status, the WS event arrives and the projection runs — but it writes `taskStatus: "CLOSED"` into the cached entity, not `status`. The UI is reading `task.status`, which still shows `"OPEN"`. The update is invisible.

This class of bug is particularly hard to catch because:
- The initial load is correct (REST uses the right names)
- The mutation appears to succeed (HTTP 200)
- The WS event arrives (network inspector shows the message)
- The UI does not update (but no error is thrown)

Layer 3 Witness assertion catches this exactly — the assertion `task.updated.status preserved` would fail because the cache's `status` field was not updated.

---

## Related

- [docs/concepts/event-envelope.md](event-envelope.md) — how EventFactory strips unknown fields before they reach the broadcast
- [docs/concepts/witness-layers.md](witness-layers.md) — how Layer 1 and Layer 3 enforce field survival
- [docs/guides/write-a-witness.md](../guides/write-a-witness.md) — writing assertions that catch field shape violations
