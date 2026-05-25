import { eventFactory } from "../../lib/event-factory/event-factory.service";

export async function createTask(data: { title: string; projectId: string }) {
  const task = { id: "task-1", title: data.title, projectId: data.projectId };

  await eventFactory.publish({
    type: "task.created",
    payload: { taskId: task.id, title: data.title, projectId: data.projectId },
  });

  // BUG: direct socket.emit bypasses EventFactory
  socket.emit("task.created", { taskId: task.id });

  return task;
}
