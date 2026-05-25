export const taskWitness = {
  domain: "task",
  events: ["task.created"],
  requiredFields: {
    // "title" is required but the broadcast above strips it
    "task.created": ["taskId", "title"],
  },
  testPayloads: {
    "task.created": {
      taskId: "test-task-001",
      title: "Test Task",
    },
  },
  async lifecycle(_queryClient: unknown) {
    return [];
  },
  signals: {},
};
