/**
 * Template: init-event-bus
 *
 * Produces: apps/api/src/lib/event-bus.service.ts
 *
 * Written once by rivergen init. Never modified by rivergen gen.
 * The WorkspaceEvent proxy is removed — event strings are the canonical
 * identifiers. Listeners use the dot-notation string directly.
 */
export function renderEventBus(): string {
  return `import { EventEmitter } from "node:events";

import type { EventEnvelope } from "./event-factory/schemas/_index";

export type EventEnvelopeRecord = EventEnvelope;

class EventBusService extends EventEmitter {
  private publishedEnvelopes: EventEnvelopeRecord[] = [];

  async publishEnvelope(envelope: EventEnvelopeRecord): Promise<void> {
    this.publishedEnvelopes.push(envelope);
    this.emit(envelope.type, envelope);
    this.emit("*", envelope);
  }

  subscribe(
    event: string | "*",
    handler: (envelope: EventEnvelopeRecord) => void | Promise<void>,
  ): void {
    this.on(event, (payload: EventEnvelopeRecord) => {
      void handler(payload);
    });
  }

  unsubscribe(
    event: string | "*",
    handler: (envelope: EventEnvelopeRecord) => void | Promise<void>,
  ): void {
    this.off(event, handler as never);
  }

  getPublishedEnvelopes(): EventEnvelopeRecord[] {
    return [...this.publishedEnvelopes];
  }

  clear(): void {
    this.publishedEnvelopes = [];
    this.removeAllListeners();
  }
}

export const eventBus = new EventBusService();
`;
}
