export const taskWitness = {
  domain: "task",
  events: ["task.created"],
  requiredFields: {
    // BUG: "title" is required here but absent from the schema above
    // EventFactory .strict() strips unknown fields — "title" never reaches the bus
    "task.created": ["taskId", "projectId", "title"],
  },
  testPayloads: {
    "task.created": {
      taskId: "test-task-001",
      projectId: "test-project-001",
      title: "Test Task",
    },
  },
  async lifecycle(_queryClient: unknown) {
    return [];
  },
  signals: {},
};
