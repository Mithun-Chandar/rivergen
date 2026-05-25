import { eventFactory } from "../../lib/event-factory/event-factory.service";
import { eventBus } from "../../lib/event-bus.service";

export async function createTask(data: { title: string }) {
  const task = { id: "task-1", title: data.title };

  await eventFactory.publish({
    type: "task.created",
    payload: { taskId: task.id, title: data.title },
  });

  // BUG: bypasses EventFactory schema validation
  eventBus.publish("task.created", { taskId: task.id });

  return task;
}
