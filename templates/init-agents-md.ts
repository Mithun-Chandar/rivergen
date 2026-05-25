/**
 * Template: AGENTS.md
 *
 * Written once by `rivergen init` to the project root.
 * Teaches every AI agent (Claude Code, GitHub Copilot, Cursor, Windsurf)
 * the One River architecture rules before it touches a single file.
 */
export function renderAgentsMd(): string {
  return `# RiverGen — Agent Rules

This project uses **RiverGen** to scaffold full-stack realtime domains and enforces the
**One River architecture** via static analysis gates. Read this file before writing any code.

---

## Generator workflow — never create domain files by hand

Every router, mutations file, broadcast, listener, hook, projection, schema slice,
dispatcher slice, ws-bindings slice, query-keys slice, entity-projection slice, and
witness file MUST be scaffolded by the generator. Writing them by hand guarantees a gate failure.

\`\`\`bash
# 1. Write a spec file
specs/<domain>.json       # version:2, kebab domain.key, camelCase entity.key

# 2. Dry-run — always inspect before writing
rivergen plan specs/<domain>.json

# 3. Scaffold all 12 files + regenerate 5 barrels
rivergen gen specs/<domain>.json

# 4. Fill TODOs in this order:
#    a. mutations.ts              → Zod input schema + DB call
#    b. schemas/<domain>.ts       → add fields BEFORE adding them to eventFactory.publish()
#    c. <domain>.listener.ts      → wire eventBus.subscribe() → broadcastX()
#    d. use-<domain>.ts           → add query key context in onMutate
#    e. <domain>-projections.ts   → add list key context in applyEntity*()
#    f. <domain>.witness.ts       → fill payload type, requiredFields, testPayloads,
#                                   lifecycle(), and signals{} — this is the field
#                                   continuity contract; Gate #12 enforces it

# 5. Verify — all 12 gates must pass before the task is done
rivergen verify
\`\`\`

---

## One River — the only allowed post-mutation data path

\`\`\`
onMutate ghost
  → HTTP mutation
  → EventFactory.publish()
  → EventBus listener
  → broadcast helper
  → WebSocket (socket.io)
  → WS projection applyEntity*()
  → TanStack Query cache
  → ghost replaced ✓
\`\`\`

Never create a second convergence path through \`onSuccess\`, ad-hoc \`setQueryData\`,
or page-level refetch logic. One river, one path.

---

## Hard prohibitions (all caught by gates)

- **Never** call \`eventBus.publish()\` directly in a mutation — use \`EventFactory\`
- **Never** call \`socket.emit()\` in a router or controller
- **Never** write \`socket.emit\` in code **comments** either — Gate #3 scans all lines
  including comments; use phrasing like "event emission goes through EventFactory" instead
- **Never** add a field to \`eventFactory.publish()\` payload before adding it to the
  domain's \`.strict()\` Zod schema — mismatches are silently stripped at runtime
- **Never** write to TanStack Query cache in \`onSuccess\` — WS projection owns convergence
- **Never** import \`entity-cache\` in \`WebSocketProvider.tsx\`
- **Never** hand-edit \`_index.ts\` barrel files — overwritten on every \`rivergen gen\`

---

## EventFactory.publish() call shape — CRITICAL

Takes a **single \`PublishInput\` object** — NOT positional \`(eventName, payload)\` args.
Positional calls compile but \`input.type\` resolves to \`undefined\` at runtime, crashing silently.

\`\`\`ts
// CORRECT — single object
await eventFactory.publish({
  type: "entity.created",
  resourceId: entity.id,
  actor: { id: userId, type: "user" },
  context: { realmId: projectId },
  correlationId: randomUUID(),
  eventVersion: "1.0",
  payload: { entityId: entity.id, ...fields },
});

// WRONG — positional args, crashes at runtime
eventFactory.publish("entity.created", { entityId: entity.id });
\`\`\`

---

## clientTempId sharing law

\`onMutate\` stamps \`data.clientTempId\` if missing. \`mutationFn\` sends \`data\` as-is.
**Never** generate \`clientTempId\` independently in \`mutationFn\` — it produces a different
ID, the WS projection cannot find the ghost, and a duplicate entity appears until refresh.

\`\`\`ts
// CORRECT — onMutate stamps, mutationFn inherits
useMutation({
  mutationFn: async (data) => apiFetch(url, { body: JSON.stringify(data) }),
  onMutate: async (data) => {
    if (!data.clientTempId) data.clientTempId = createId();
    // ghost uses data.clientTempId as id
  },
});

// WRONG — divergent IDs, ghost never removed
useMutation({
  mutationFn: async (data) => {
    const clientTempId = data.clientTempId ?? createId(); // NEW ID — breaks reconciliation
    return apiFetch(url, { body: JSON.stringify({ ...data, clientTempId }) });
  },
  onMutate: async (data) => {
    const clientTempId = data.clientTempId ?? createId(); // DIFFERENT ID
  },
});
\`\`\`

In every \`onMutate\` that reads a list from cache, guard with \`Array.isArray(prev)\` —
never a bare \`if (prev)\` truthy check. A plain object under a cold cache passes the
truthy check and causes \`[...prev, ghost]\` to throw a \`TypeError\`.

---

## Projection removal law

When a WS event means an item is leaving a list (deleted, archived, moved out),
the projection **MUST** use \`setQueryData\` with a synchronous filter — **never**
\`invalidateQueries\`. Two rapid removals + async refetch can reinsert the second
removed item when the first refetch response lands after it was already removed.

\`\`\`ts
// CORRECT — synchronous filter
applyEntityDelete("task", taskId, context, queryClient);
// entity-cache calls setQueriesData({ type: "active" }, filter) internally

// WRONG — async refetch races with rapid removals
queryClient.invalidateQueries({ queryKey: taskKeys.list(projectId) });
\`\`\`

---

## Gate signals

| Gate | What it checks | When it fails |
|------|---------------|---------------|
| Gate #1 | Mutations call \`eventFactory.publish()\` | You bypassed EventFactory |
| Gate #2 | Listener → broadcast → emit chain | Wiring is structurally incomplete |
| Gate #3 | socket.on → dispatcher → projection chain | WS client side is incomplete |
| Gate #4 | Projections use entity-cache helpers | Direct \`setQueryData\` calls found |
| Gate #5 | Private entities are scoped to rooms | Private data leaking to public room |
| Gate #6 | All emitted events have schemas | You added an event without a schema |
| Gate #7 | All schemas use \`.strict()\` | Schema is too loose — fields leak silently |
| Gate #8 | WebSocketProvider doesn't touch entity-cache | Convergence path is split |
| Gate #9 | No cache writes in \`onSuccess\` | Second convergence path added |
| Gate #10 | All mutations have \`onMutate\` + \`onError\` | Missing rollback handler |
| Gate #11 | Every event appears in payload continuity audit | Only runs when audit artifacts are present |
| Gate #12 | Witness file is complete for every broadcast event | Field contract not locked |

All gates pass immediately after \`rivergen gen\` — the generated code is structurally complete.

**Gate #12 (Witness) is the correctness progress signal.** It passes after gen but Layer 3
(the projection proof) shows as a stub with a \`⚠\` notice until you fill \`lifecycle()\`
in \`<domain>.witness.ts\`. Layer 3 is what proves fields actually survive the projection —
fill it before marking the domain production-ready.

Run \`rivergen verify\` before marking any domain task complete. All active gates must pass.

---

## Spec rules (version 2)

\`\`\`json
{
  "version": 2,
  "domain": { "key": "my-domain", "displayName": "MyDomain" },
  "entity": { "key": "myEntity", "eventPrefix": "myEntity" },
  "events": ["myEntity.created", "myEntity.updated", "myEntity.deleted"],
  "room": {
    "template": "project:\${projectId}",
    "visibilityField": "visibility"
  }
}
\`\`\`

- \`domain.key\`: kebab-case
- \`entity.key\`: camelCase
- \`eventPrefix\` must match the prefix of every event in \`events[]\`
- \`events[]\`: dot notation only (\`entity.action\`) — colons are rejected
- \`room.visibilityField\`: required for private entities — omitting it broadcasts private data to public rooms

---

## One River completion checklist — verify before calling work done

- Creating an entity replaces the optimistic ghost without a refresh
- The just-created item renders its full inline data (avatars, labels, timestamps) from the WS payload
- The just-created item is clickable immediately if the UI depends on a slug or ID
- Private entity creation reaches the creator before the client joins the new room
- Membership changes that affect room scope join/leave rooms in the live session
- \`rivergen verify\` reports \`✓ ALL GATES PASSED\` with no errors

If any of these fail, fix the realtime path. Do not mark the feature complete.
`;
}
