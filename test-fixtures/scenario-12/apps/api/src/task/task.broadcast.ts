import type { Server } from "socket.io";

export function broadcastTaskCreated(
  io: Server,
  payload: Record<string, unknown>,
): void {
  const projectId = payload.projectId as string;
  if (!projectId) return;
  io.to(`project:${projectId}`).emit("task.created", {
    taskId: payload.taskId,
    title: payload.title,
  });
}
