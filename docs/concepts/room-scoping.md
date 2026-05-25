# Room Scoping

## What socket.io rooms are

Socket.io rooms are server-side groupings of socket connections. When a client joins a room (`socket.emit("join:task", projectId)`), the server tracks that socket as a member of that room. A broadcast to `io.to("project:proj-001")` is delivered only to sockets that have joined `"project:proj-001"`.

RiverGen uses rooms to scope realtime events. Without rooms, every connected client would receive every event from every user — a privacy and performance problem at scale.

---

## The room template

The spec's `room.template` field defines the socket.io room pattern:

```json
{
  "room": {
    "template": "workspace:${workspaceId}",
    "visibilityField": "visibility",
    "privateRoomTemplate": "user:${assigneeId}"
  }
}
```

The template uses `${varName}` placeholders. RiverGen extracts the variable names with a regex (`/\$\{(\w+)\}/g`) and uses them throughout the generated code.

**What each placeholder becomes:**

| Where                                        | What it generates                                                   |
| -------------------------------------------- | ------------------------------------------------------------------- |
| Broadcast helper (`broadcast.ts`)            | function parameter: `const projectId = payload.projectId as string` |
| Query key factory (`query-keys/<domain>.ts`) | typed context: `list: (ctx: { projectId: string }) => [...]`        |
| Hook (`use-<domain>.ts`)                     | `onMutate` list key: `taskKeys.list({ projectId })`                 |
| Hook comment                                 | Room join pattern documentation                                     |

The room is resolved at broadcast time from the event payload. If the payload does not contain the expected variable, the broadcast drops the event with a `console.warn`.

---

## The visibility field

When `room.visibilityField` is set, the generated broadcast helper adds a PRIVATE entity guard. The private room expression comes from `room.privateRoomTemplate` in the spec.

**With `privateRoomTemplate: "user:${assigneeId}"`:**

```typescript
export function broadcastTicketEvent(
  io: SocketServerLike,
  eventName: string,
  payload: AnyPayload,
): void {
  const workspaceId = payload.workspaceId as string | undefined;
  if (!workspaceId) {
    console.warn(`[broadcast:ticket] ${eventName} dropped — no workspaceId in payload`);
    return;
  }
  const assigneeId = payload.assigneeId as string | undefined;
  const isPrivate = payload.visibility === "PRIVATE";
  const room = isPrivate
    ? `user:${assigneeId}`
    : `workspace:${workspaceId}`;
  io.to(room).emit(eventName, payload);
}
```

The private room variable (`assigneeId`) is declared automatically when it differs from the public room variable. No manual edits needed when `privateRoomTemplate` is set.

**With `visibilityField` set but `privateRoomTemplate` omitted:**

```typescript
  const isPrivate = payload.visibility === "PRIVATE";
  const room = isPrivate
    ? `TODO_private_room` /* TODO: set room.privateRoomTemplate in your spec, e.g. "user:${assigneeId}" */
    : `workspace:${workspaceId}`;
```

Gate 5 passes (it only checks for a guard structure), but PRIVATE entities are broadcast to a non-existent room. Always set `privateRoomTemplate` alongside `visibilityField`.

When `visibilityField` is omitted from the spec, the broadcast generates a simpler helper with no visibility guard — all events go to the public room unconditionally.

---

## Gate #5: Broadcast Room Scoping — room scoping enforcement

Gate #5: Broadcast Room Scoping (PRIVATE entities → scoped rooms) scans all `*.broadcast.ts` files for two violation patterns:

**Bare global emit:**

```typescript
io.emit(eventName, payload); // ✗ broadcasts to ALL connected sockets
```

`io.emit()` with no room scope is always an error. Use `io.to(room).emit()`.

**Visibility-aware function emitting to workspace without a guard:**

```typescript
function broadcastTicketCreated(io, payload) {
  // function parameter includes "visibility" or "isPrivate"
  io.to(`workspace:${workspaceId}`).emit(eventName, payload); // ✗ no guard
}
```

If a broadcast function accepts a `visibility` or `isPrivate` parameter but emits to `workspace:` without an `if`/`else` guard, the gate fires.

**Advisory warning:**

```
⚠  workspace-wide emit detected. Verify this entity cannot be PRIVATE.
   If it can, add a visibility guard.
```

A `workspace:` emit without any visible guard also generates a warning (not an error) — it requires human review to confirm the entity has no privacy concern.

---

## The room join pattern

Clients must join the room to receive events scoped to it. If a client does not join `project:proj-001`, it will never receive `task.created` events for that project — even if it is subscribed to the socket.

The generated hook file includes a comment block showing the pattern:

```typescript
// ── useJoinTaskRoom ────────────────────────────────────────────────────────────
// LAW: the server broadcasts task events to a scoped socket.io room.
// The client MUST join that room or it will never receive those events.
// Call this hook on the page/component that owns the task context.
//
// Pattern:
//   const { socket, connected } = useWebSocket();
//   useEffect(() => {
//     if (connected && socket) socket.emit("join:task", projectId);
//   }, [connected, socket, projectId]);
//
// TODO: replace the useEffect above with the correct room variable from your route.
// The room template for this domain is: project:${projectId}
```

This is a comment pattern, not a generated function. You implement the join hook in the component that mounts for a given room context (typically a page or layout component).

The server-side handler for `"join:task"` must call `socket.join(room)`. This is outside RiverGen's scope — it belongs in your WebSocket connection setup code.

---

## Query key scoping

The room template variables become the context object for the `list()` query key factory. The generated factory:

```typescript
export const taskKeys = {
  all: () => ["tasks"] as const,
  list: (ctx: { projectId: string }) =>
    ["tasks", "list", ctx.projectId] as const,
  detail: (id: string) => ["tasks", "detail", id] as const,
};
```

The list key includes `projectId` so that task lists for different projects are cached independently. The hook's `onMutate` uses the same scoped key:

```typescript
const listKey = taskKeys.list({ projectId });
```

The entity-projection slice must use the same key shape in its `onCreate.required` array. If the query key factory and the entity-projection entry are misaligned, `applyEntityCreate` writes to a key that the hook is not watching — the WS update never appears in the UI.

---

## Multi-tenancy patterns

**Per-project scope** (`project:${projectId}`): each project's tasks are isolated. Users only receive WS events for projects they have joined. This is the most common pattern for task management, document collaboration, and similar domains.

**Per-workspace scope** (`workspace:${workspaceId}`): events go to all users in the workspace. Use for entities that are visible to the entire workspace (e.g. workspace settings, member changes).

**Per-user scope** (`user:${userId}`): events go to a single user. Use for personal notifications, user-specific state. Room template: `user:${userId}`.

A single domain can only have one room template. If an entity needs different broadcast scopes depending on its state (e.g. some notifications are workspace-wide, some are user-scoped), that is modelled as separate domains or handled with the `visibilityField` guard.

---

## Related

- [docs/concepts/one-river.md](one-river.md) — where room scoping fits in the full pipeline
- [docs/reference/spec.md](../reference/spec.md) — `room.template`, `room.visibilityField`, and `room.privateRoomTemplate` reference
- [docs/reference/gates.md](../reference/gates.md) — Gate #5 full reference with failure examples
