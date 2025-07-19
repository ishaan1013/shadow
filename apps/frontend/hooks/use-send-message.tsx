import { queryClient } from "@/lib/query-client";
import type { Message } from "@repo/types";
import { useMutation } from "@tanstack/react-query";

interface SendMessageParams {
  taskId: string;
  message: string;
  model: string;
}

export function useSendMessage() {
  return useMutation({
    mutationFn: async ({ taskId, message, model }: SendMessageParams) => {
      // This will be handled via socket, not direct API call
      // The actual sending happens through socket.emit in the component
      return { taskId, message, model };
    },
    onMutate: async ({ taskId, message }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["task-messages", taskId] });

      // Snapshot the previous value
      const previousMessages = queryClient.getQueryData<Message[]>([
        "task-messages",
        taskId,
      ]);

      // Optimistically update with new message
      const optimisticMessage: Message = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: message.trim(),
        createdAt: new Date().toISOString(),
        metadata: { isStreaming: false },
      };

      queryClient.setQueryData<Message[]>(["task-messages", taskId], (old) => [
        ...(old || []),
        optimisticMessage,
      ]);

      // Return a context object with the snapshotted value
      return { previousMessages };
    },
    onError: (err, variables, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      if (context?.previousMessages) {
        queryClient.setQueryData(
          ["task-messages", variables.taskId],
          context.previousMessages
        );
      }
    },
    onSettled: (data) => {
      // Always refetch after error or success to ensure we have the latest data
      if (data?.taskId) {
        queryClient.invalidateQueries({
          queryKey: ["task-messages", data.taskId],
        });
      }
    },
  });
}
