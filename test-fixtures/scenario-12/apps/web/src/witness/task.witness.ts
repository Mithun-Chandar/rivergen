export const taskWitness = {
  domain: "task",
  events: ["task.created"],
  requiredFields: {
    "task.created": ["taskId", "title"],
  },
  testPayloads: {
    "task.created": { taskId: "test-task-001", title: "Test Task" },
  },
  async lifecycle(_queryClient: unknown) {
    return [
      {
        // Projection writes "creatorId" but the UI reads "authorId" — field shape law violation
        name: "task.created preserves title in cache",
        ok: false,
        detail:
          "expected 'Test Task' in cache but got undefined — check applyTaskCreated spreads payload.title into the cached entity",
      },
    ];
  },
  signals: {},
};
