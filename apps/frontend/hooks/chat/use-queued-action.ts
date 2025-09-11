import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueuedActionUI } from "@repo/types";

export function useQueuedAction(taskId: string, variantId: string) {
  const queryClient = useQueryClient();
  return useQuery<QueuedActionUI | null>({
    queryKey: ["queued-action", taskId, variantId],
    queryFn: () => {
      const cachedAction = queryClient.getQueryData([
        "queued-action",
        taskId,
        variantId,
      ]) as QueuedActionUI | null;
      return cachedAction || null;
    },
  });
}
