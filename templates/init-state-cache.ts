/**
 * Template: init-state-cache
 *
 * Produces: apps/web/src/lib/cache/state-cache.ts
 *
 * Written once by rivergen init. Never modified by rivergen gen.
 * The dispatcher is a lookup table, not a switch statement.
 * Domain dispatch maps live in domain-dispatchers/<domain>.ts slices.
 * This file stays the same size regardless of how many domains are added.
 */
export function renderStateCache(): string {
  return `import { QueryClient } from "@tanstack/react-query";
import { domainDispatchers } from "./domain-dispatchers/_index";

type AnyPayload = Record<string, unknown> | null | undefined;

/**
 * Routes a realtime event from WebSocketProvider into the correct domain
 * projection. Domain dispatch maps are in domain-dispatchers/<domain>.ts.
 * This file never needs to be edited — adding a domain adds a slice file
 * and regenerates the barrel.
 */
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
`;
}
