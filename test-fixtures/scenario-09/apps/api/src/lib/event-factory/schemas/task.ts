import { z } from "zod";

// Schema only has taskId and projectId — "title" is absent
export const taskSchemas = {
  "task.created": z
    .object({
      taskId: z.string(),
      projectId: z.string(),
    })
    .strict(),
};
