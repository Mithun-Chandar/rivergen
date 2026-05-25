import { useMutation } from "@tanstack/react-query";
import { taskKeys } from "../lib/query-keys/task";

export function useCreateTask() {
  return useMutation({
    mutationFn: async (data: { title: string }) => {
      const resp = await fetch("/api/tasks", {
        method: "POST",
        body: JSON.stringify(data),
      });
      return resp.json();
    },
    // BUG: onMutate missing — no optimistic ghost, no rollback possible
    onError: () => {},
  });
}
