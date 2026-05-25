// Minimal valid state-cache — no events dispatched
export const domainDispatchers: Record<
  string,
  (p: unknown, qc: unknown) => void
> = {};

export function applyRealtimeEventToCache(
  eventName: string,
  payload: unknown,
  queryClient: unknown,
): void {
  const handler = domainDispatchers[eventName];
  if (handler) handler(payload, queryClient);
}
