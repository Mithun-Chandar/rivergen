// BUG: static import at module scope — causes Layer 3 subprocess to fail on import
import { applyTaskProjection } from "../lib/projections/task-projections";

export const taskWitness = {
  domain: "task",
  events: ["task.created"],
  requiredFields: {
    "task.created": ["taskId"],
  },
  testPayloads: {
    "task.created": { taskId: "test-task-001" },
  },
  async lifecycle(queryClient: unknown) {
    applyTaskProjection({ taskId: "test-task-001" }, queryClient);
    return [{ name: "taskId preserved", ok: true }];
  },
  signals: {},
};
