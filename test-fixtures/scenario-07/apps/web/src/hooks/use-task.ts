import { useMutation, useQueryClient } from "@tanstack/react-query";
import { taskKeys } from "../lib/query-keys/task";

export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { title: string }) => {
      const resp = await fetch("/api/tasks", {
        method: "POST",
        body: JSON.stringify(data),
      });
      return resp.json();
    },
    onMutate: async (data) => {
      const prev = queryClient.getQueryData(taskKeys.all());
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(taskKeys.all(), context.prev);
    },
    onSuccess: (data) => {
      // BUG: cache write in onSuccess races with the WS projection
      queryClient.invalidateQueries({ queryKey: taskKeys.all() });
    },
  });
}
