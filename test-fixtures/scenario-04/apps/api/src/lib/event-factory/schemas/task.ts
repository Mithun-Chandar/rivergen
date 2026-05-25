import { z } from "zod";

// BUG: missing .strict() — unknown fields will not be stripped at publish time
export const taskSchemas = {
  "task.created": z.object({
    taskId: z.string(),
    title: z.string(),
    projectId: z.string(),
  }),
};
