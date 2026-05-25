import { z } from "zod";

export const taskSchemas = {
  "task.created": z.object({ taskId: z.string(), title: z.string() }).strict(),
};
