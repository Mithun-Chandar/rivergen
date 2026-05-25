# Ghost Reconciliation

## What an optimistic ghost is

When a user creates a new entity, the UI should respond immediately — before the HTTP request completes and before the WebSocket event arrives. RiverGen calls this a "ghost": a temporary entry in the TanStack Query cache that looks like a real entity but has a temporary ID and is visually distinguishable as in-flight.

When the server confirms the creation and the WebSocket event arrives, the ghost is replaced by the real entity. This replacement — and specifically how it happens without a flicker or a duplicate — is ghost reconciliation.

---

## The clientTempId invariant

The ghost and the server must agree on the same temporary ID. RiverGen enforces this through a single invariant: **`clientTempId` is stamped on the mutation data in `onMutate`, before `mutationFn` runs.**

The generated `useCreate${E}` hook:

```typescript
onMutate: async (data) => {
  // LAW: stamp clientTempId onto data — mutationFn sends data as-is, so the
  // server receives the same ID the ghost uses. Never generate it independently
  // in mutationFn — that produces a divergent ID and the ghost never reconciles.
  if (!data.clientTempId) data.clientTempId = `temp-task-${Date.now()}`;
  const clientTempId = data.clientTempId;

  const listKey = taskKeys.list({ projectId });
  await queryClient.cancelQueries({ queryKey: listKey });
  const prev = queryClient.getQueryData<Task[]>(listKey);

  // Array.isArray guard required — a plain object under a cold cache passes
  // a bare if(prev) truthy check and causes [...prev, ghost] to throw TypeError
  const ghost: Task = { id: clientTempId, ...data, _isOptimistic: true } as Task;
  queryClient.setQueryData<Task[]>(listKey, [...(Array.isArray(prev) ? prev : []), ghost]);

  return { prev, listKey, clientTempId };
},
```

The `clientTempId` format is `temp-${entityKey}-${Date.now()}` — not `randomUUID()`. The mutation's `mutationFn` sends `data` as-is (data already has `clientTempId` stamped on it by `onMutate`), so the server receives the same temp ID.

The generated mutation on the server:

```typescript
await eventFactory.publish({
  type: "task.created",
  payload: {
    taskId: task.id,
    // ...other fields
    clientTempId: (data.clientTempId as string) ?? null,
  },
});
```

The server passes `clientTempId` through to the event payload.

**If `clientTempId` is not included in the `eventFactory.publish()` payload**, the Zod schema will strip it (because the generated schema has `.strict()`), and the ghost will never reconcile. The field must be explicitly declared in the schema slice.

---

## How entity-cache removes the ghost

When the WS event arrives, the projection calls `applyEntityCreate`. Inside entity-cache:

```typescript
export function applyEntityCreate(
  entityType,
  entity,
  context,
  queryClient,
): void {
  const entry = resolveProjectionEntry(entityType);
  const clientTempId = context?.clientTempId as string | undefined;

  for (const projection of entry.onCreate.required) {
    for (const key of toProjectionKeys(projection(entity, context))) {
      updateProjectionKey(queryClient, key, (current) => {
        // Remove the ghost first, then upsert the real entity
        const withoutGhost = clientTempId
          ? deleteFromUnknownData(current, clientTempId)
          : current;
        return upsertInUnknownData(withoutGhost, entity, key);
      });
    }
  }
}
```

`deleteFromUnknownData(current, clientTempId)` filters out any item in the cached array whose `id === clientTempId`. After that, `upsertInUnknownData` inserts the real entity (which has a real ID from the database).

The result: the ghost disappears, the real entity appears, and no duplicate is visible — all in a single synchronous cache update.

---

## The Array.isArray guard

The generated `onMutate` includes a guard that the template comments explain explicitly:

```typescript
queryClient.setQueryData<Task[]>(listKey, [
  ...(Array.isArray(prev) ? prev : []),
  ghost,
]);
```

If the cache is cold (no prior query run), `prev` is `undefined`. A bare `if (prev)` check would pass if `prev` were accidentally a plain object, causing `[...prev, ghost]` to throw a `TypeError`. The `Array.isArray` guard ensures the spread is always safe.

---

## The onError rollback

If the mutation fails (HTTP error, network timeout), `onError` restores the pre-ghost cache state:

```typescript
onError: (_err, _vars, context) => {
  if (context?.prev !== undefined) {
    queryClient.setQueryData(context.listKey, context.prev);
  }
},
```

`context.prev` is the snapshot taken before the ghost was inserted. Rolling back removes the ghost from the cache as if the mutation never ran.

---

## Why onSuccess is intentionally omitted

The generated hook has this comment:

```typescript
// onSuccess: intentionally omitted — WS projection handles ID reconciliation
```

If `onSuccess` wrote to the cache (e.g. `queryClient.invalidateQueries()`), it would run when the HTTP response arrives. The WS event may arrive around the same time. The two cache writes would race — one could overwrite the other, producing a stale state or a duplicate.

Removing `onSuccess` entirely means there is exactly one writer after the optimistic ghost: the WS projection. Gate #9: No Cache Writes in onSuccess enforces this — cache operations in `onSuccess` are gate errors.

---

## When ghosts do not reconcile

**Ghost stays in list (not replaced):**

- `clientTempId` is not in the `eventFactory.publish()` payload — check the mutation
- `clientTempId` is in the payload but stripped by `.strict()` — add it to the schema slice
- The projection's `context.clientTempId` is not being passed — check the `applyTask*Created` function

**Duplicate visible (ghost and real entity both appear):**

- The ghost ID and real entity ID do not match — `clientTempId` was regenerated in `mutationFn` instead of being taken from `data.clientTempId`

**Ghost disappears but real entity not shown:**

- The query key used in `onMutate` (list key) does not match the key in `entity-projection/<domain>.ts` `onCreate.required` — the projection writes to a different key than the hook watches

---

## Verifying ghost reconciliation with Witness

The generated `lifecycle()` stub includes a ghost reconciliation assertion:

```typescript
assertions.push({
  name: "task.created replaces ghost (clientTempId reconciliation)",
  ok: false /* TODO */,
});
```

Fill this assertion by:

1. Seeding a ghost in the cache: `queryClient.setQueryData(listKey, [{ id: "ghost-temp-01", _isOptimistic: true }])`
2. Applying the create event with `clientTempId: "ghost-temp-01"` in the payload
3. Asserting the list no longer contains the ghost ID and does contain the real ID

See [docs/guides/write-a-witness.md](../guides/write-a-witness.md) for the full pattern.
