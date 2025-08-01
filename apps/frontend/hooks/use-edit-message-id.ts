import { useQuery, useQueryClient } from "@tanstack/react-query";

// Simple query state to track message ID of the message being edited (max 1 at a time)
export function useEditMessageId(taskId: string) {
  const queryClient = useQueryClient();
  return useQuery<string | null>({
    queryKey: ["edit-message-id", taskId],
    queryFn: () => {
      const { editMessageId } = queryClient.getQueryData([
        "edit-message-id",
        taskId,
      ]) as { editMessageId: string | null };

      return editMessageId || null;
    },
  });
}
