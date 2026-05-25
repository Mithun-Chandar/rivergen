# Entity Cache

## What entity-cache is

`entity-cache.ts` is written once by `rivergen init` and never modified by `rivergen gen`. It is the single file in the entire frontend codebase that is allowed to call `queryClient.setQueryData` and `queryClient.setQueriesData` for entity arrays.

All domain projections must go through entity-cache helpers. Gate #4 enforces this — raw `queryClient.setQueryData()` calls in projection files are errors.

---

## The three helpers

### `applyEntityCreate(entityType, entity, context, queryClient)`

Inserts a new entity into the cache. Also handles ghost reconciliation: if `context.clientTempId` is set, removes the ghost entry with that ID before inserting the real entity.

The entity object is built by spreading the WS payload:

```typescript
applyEntityCreate("task", { id: taskId, ...payload }, context, queryClient);
```

Steps internally:

1. Resolves the `EntityProjectionEntry` for `"task"` from `ENTITY_PROJECTIONS`
2. Extracts `clientTempId` from context
3. For each key in `onCreate.required`: calls `updateProjectionKey()` which uses `setQueriesData` with a key-prefix predicate
4. In the updater: removes ghost by ID if `clientTempId` is set, then upserts the real entity
5. Runs `onCreate.invalidate` entries with `invalidateQueries()`

### `applyEntityUpdate(entityType, entity, context, queryClient)`

Merges updated fields into an existing cached entity. Does the same key-resolution and `setQueriesData` predicate pattern as create, without ghost removal.

```typescript
applyEntityUpdate("task", { id: taskId, ...payload }, context, queryClient);
```

The entity object is a partial merge — only fields present in the payload are updated. Fields not in the payload retain their cached values.

### `applyEntityDelete(entityType, entityId, context, queryClient)`

Removes an entity from all active cached collections.

```typescript
applyEntityDelete("task", taskId, context, queryClient);
```

Steps internally:

1. Runs `onDelete.invalidate` entries with `invalidateQueries()`
2. Also calls `queryClient.setQueriesData({ type: "active" }, ...)` to remove the entity from all currently active queries — this covers cases where the delete projection does not know the exact query key structure

---

## The EntityProjectionEntry structure

Each domain's `entity-projections/<domain>.ts` slice registers its entities in `ENTITY_PROJECTIONS`. For a domain with `room.template: "project:${projectId}"` the generated entry is:

```typescript
export const taskProjections: Record<string, EntityProjectionEntry> = {
  task: {
    ownedKeyFactories: ["taskKeys"],
    onCreate: {
      required: [
        (_entity, context) => [
          "tasks",
          "list",
          ((context as Record<string, unknown>)?.projectId as string) ?? "",
        ],
      ],
      invalidate: [],
    },
    onUpdate: {
      required: [
        (_entity, context) => [
          "tasks",
          "list",
          ((context as Record<string, unknown>)?.projectId as string) ?? "",
        ],
      ],
      invalidate: [],
    },
    onDelete: {
      invalidate: [["tasks"]],
    },
  },
};
```

The room variable (`projectId`) is extracted from the spec's `room.template` at generation time — the generated factory already matches the key shape the hook's `onMutate` produces. In most cases this file requires no developer edits.

**What each field means:**

`ownedKeyFactories` — string array naming the query key factory objects this entity is associated with. Currently informational — used for documentation and future tooling.

`onCreate.required` — array of key-factory functions. Each function receives `(entity, context)` and returns a query key. Entity-cache calls each factory and uses `setQueriesData` with a prefix predicate to update all matching cache entries. If no matching query exists, entity-cache creates it.

`onCreate.invalidate` — array of key-factory functions. Called after `required` writes are done. Each returns a query key passed to `invalidateQueries()`. Use for paginated lists that must refetch rather than be updated by upsert.

`onUpdate.required` and `onUpdate.invalidate` — same pattern as `onCreate` for update events.

`onDelete.invalidate` — array of raw query keys passed directly to `invalidateQueries()`. `applyEntityDelete` also removes the entity from all `{ type: "active" }` queries globally, so this field is for additional specific invalidations.

**When to edit the generated entry:**

Entity-cache uses prefix matching: a factory returning `["tasks", "list"]` matches `["tasks", "list", "proj-001"]` and `["tasks", "list", "proj-002"]` — updating all project lists. If your list key structure differs from the generated default (e.g. a nested key with additional segments), update the `required` factory to match.

---

## The applyRealtimeEventToCache function

`applyRealtimeEventToCache` lives in `state-cache.ts` (written once by `rivergen init`). It is the single frontend dispatch entry point — the client-side equivalent of the EventBus listener on the backend.

```typescript
export function applyRealtimeEventToCache(
  eventName: string,
  payload: AnyPayload,
  queryClient: QueryClient,
): void {
  const handler = domainDispatchers[eventName];
  if (handler) {
    handler(payload, queryClient);
  } else if (process.env.NODE_ENV !== "production") {
    console.warn("[Dispatcher] No handler registered for event:", eventName);
  }
}
```

`domainDispatchers` is the merged flat map from all `domain-dispatchers/<domain>.ts` slice files. The barrel `domain-dispatchers/_index.ts` is regenerated on every `rivergen gen` to include new domains automatically.

WebSocketProvider calls `applyRealtimeEventToCache` for every WS event — it never calls entity-cache directly. Gate #8: WebSocketProvider Entity-Cache Isolation enforces this isolation.

---

## The gate4:map-projection annotation

Some projections manage aggregate state that cannot be modelled as an entity array — for example, a map of `{ taskId: commentCount }`. These projections cannot use `applyEntityCreate/Update/Delete` because those helpers expect entities with an `id` field.

To exempt a projection file from Gate #4's entity-cache requirement, add this annotation comment:

```typescript
// gate4:map-projection
```

Gate #4 detects this annotation and switches to a weaker check: the file may call `queryClient.setQueryData<T>()` (typed generic form) but must **not** call the bare untyped `queryClient.setQueryData(` (without type parameter). Untyped `setQueryData` in a map projection is still a Gate #4 error.

```typescript
// gate4:map-projection

export function applyTaskCommentCountChanged(
  payload: AnyPayload,
  queryClient: QueryClient,
): void {
  const taskId = payload.taskId as string;
  const count = payload.count as number;
  queryClient.setQueryData<Record<string, number>>(
    taskKeys.commentCounts(),
    (prev) => ({ ...(prev ?? {}), [taskId]: count }),
  );
}
```

Map projections are not covered by Witness's `applyEntityCreate/Update/Delete` path — you write lifecycle assertions directly using `queryClient.setQueryData` and `queryClient.getQueryData` in the witness `signals` block.

---

## The ENTITY_PROJECTIONS registry

The entity-projection barrel `packages/shared/src/entity-projections/_index.ts` exports `ENTITY_PROJECTIONS` — the merged map from all domain slices. Entity-cache resolves `ENTITY_PROJECTIONS["task"]` at runtime when `applyEntityCreate("task", ...)` is called.

If `ENTITY_PROJECTIONS["task"]` is missing, entity-cache throws:

```
Error: Unknown entity projection: "task". Register it in packages/shared/src/entity-projections/<entity>.ts
```

This happens when the entity-projection slice was not generated or when the barrel was not regenerated after adding a new domain.

---

## Related

- [docs/concepts/one-river.md](one-river.md) — entity-cache's place in the full pipeline
- [docs/concepts/ghost-reconciliation.md](ghost-reconciliation.md) — how `applyEntityCreate` removes ghosts
- [docs/concepts/field-shape-law.md](field-shape-law.md) — why payload field names must match the REST API shape
- [docs/reference/generated-files.md](../reference/generated-files.md) — the entity-projection slice format
