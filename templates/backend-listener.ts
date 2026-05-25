import type { DomainNames } from "../naming.js";

/**
 * Generates the EventBus listener for a domain.
 *
 * LAW: Every event published by EventFactory MUST have a listener here.
 * The listener receives the event from the EventBus and forwards it to
 * the broadcaster which performs the socket.io emit.
 *
 * STUB — each handler is wired; no business logic lives here.
 */
export function renderBackendListener(n: DomainNames): string {
  const E = n.entityPascal;
  const d = n.domainKey;

  const handlerBlocks = n.events
    .map((event) => {
      return `
  eventBus.subscribe("${event}", (envelope) => {
    broadcast${E}Event(io, "${event}", envelope.payload as AnyPayload);
  });`;
    })
    .join("\n");

  return `import type { SocketServerLike } from "../../websocket/websocket.service";
import { eventBus } from "../event-bus.service";
import { broadcast${E}Event } from "../../${d}/${d}.broadcast";

type AnyPayload = Record<string, unknown>;

/**
 * Registers all ${n.domainDisplay} domain event listeners on the EventBus.
 * Must be called once during server startup.
 *
 * Covered events:
${n.events.map((e) => ` *   - ${e}`).join("\n")}
 */
export function register${E}Listeners(io: SocketServerLike): void {
  // LAW: every event from EventFactory must flow through here → broadcaster
${handlerBlocks}
}
`;
}
