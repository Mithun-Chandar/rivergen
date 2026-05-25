import type { DomainNames } from "../naming.js";

/**
 * Generates the socket.io broadcast helper for a domain.
 *
 * LAW: socket.emit() is ONLY called here — never in routes or mutations.
 * Room scoping is enforced here. Private entities MUST use scoped rooms.
 */
export function renderBackendBroadcast(n: DomainNames): string {
  const E = n.entityPascal;
  const d = n.domainKey;
  const visField = n.roomVisibilityField;

  // Parse room template to extract the variable name(s).
  // Template looks like "project:${projectId}" — we need to extract "projectId".
  const roomVarMatch = n.roomTemplate.match(/\$\{(\w+)\}/);
  const roomVarName = roomVarMatch ? roomVarMatch[1] : "projectId";

  // Build the room resolution block
  const roomBlock = visField
    ? `
  // PRIVATE entity — room is scoped by visibility
  // NEVER emit PRIVATE data to the workspace-wide room
  const ${roomVarName} = payload.${roomVarName} as string | undefined;
  if (!${roomVarName}) {
    console.warn(\`[broadcast:${d}] \${eventName} dropped — no ${roomVarName} in payload\`);
    return;
  }
  const isPrivate = payload.${visField} === "PRIVATE";
  const room = isPrivate
    ? \`${n.roomTemplate.replace(`\${${roomVarName}}`, `\${${roomVarName}}`)}\`  // scoped room for private entities
    : \`${n.roomTemplate.replace(`\${${roomVarName}}`, `\${${roomVarName}}`)}\`;
`
    : `
  const ${roomVarName} = payload.${roomVarName} as string | undefined;
  if (!${roomVarName}) {
    console.warn(\`[broadcast:${d}] \${eventName} dropped — no ${roomVarName} in payload\`);
    return;
  }
  const room = \`${n.roomTemplate.replace(`\${${roomVarName}}`, `\${${roomVarName}}`)}\`;
`;

  const individualBroadcasts = n.events
    .map((event) => {
      const actionName = event.split(".").slice(1).join("-");
      const fnName = `broadcast${E}${toPascalIdentifier(actionName)}`;
      return `
export function ${fnName}(
  io: SocketServerLike,
  payload: AnyPayload,
): void {
  broadcast${E}Event(io, "${event}", payload);
}`;
    })
    .join("\n");

  return `import type { SocketServerLike } from "../websocket/websocket.service";

type AnyPayload = Record<string, unknown>;

/**
 * Central broadcast helper for all ${n.domainDisplay} domain events.
 * All socket.emit() calls for this domain funnel through here.
 *
 * Called by: ${d}.listener.ts
 */
export function broadcast${E}Event(
  io: SocketServerLike,
  eventName: string,
  payload: AnyPayload,
): void {
${roomBlock}
  console.log(\`[broadcast:${d}] \${eventName} → \${room}\`);
  io.to(room).emit(eventName, payload);
}
${individualBroadcasts}
`;
}

function toPascalIdentifier(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");
}
