import { useQuery, useQueryClient } from "@tanstack/react-query";

export function useQueuedMessage(taskId: string) {
  const queryClient = useQueryClient();
  return useQuery<string | null>({
    queryKey: ["queued-message", taskId],
    queryFn: () => {
      const { queuedMessage } = queryClient.getQueryData([
        "queued-message",
        taskId,
      ]) as { queuedMessage: string | null };
      return queuedMessage || null;
    },
  });
}
