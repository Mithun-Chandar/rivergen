import type { Server } from "socket.io";

export function broadcastTaskEvent(
  io: Server,
  eventName: string,
  payload: Record<string, unknown>,
): void {
  const projectId = payload.projectId as string;
  if (!projectId) return;
  io.to(`project:${projectId}`).emit("task.created", payload);
}
