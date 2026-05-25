import type { Server } from "socket.io";

export function broadcastTaskEvent(
  io: Server,
  eventName: string,
  payload: Record<string, unknown>,
): void {
  // BUG: broadcasts to ALL connected sockets, no room scope
  io.emit(eventName, payload);
}
