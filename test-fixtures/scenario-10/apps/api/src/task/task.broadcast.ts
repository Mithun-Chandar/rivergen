import type { Server } from "socket.io";

export function broadcastTaskEvent(
  io: Server,
  payload: Record<string, unknown>,
): void {
  const projectId = payload.projectId as string;
  if (!projectId) return;

  // BUG: "title" is intentionally dropped — only taskId forwarded
  io.to(`project:${projectId}`).emit("task.created", {
    taskId: payload.taskId,
  });
}
