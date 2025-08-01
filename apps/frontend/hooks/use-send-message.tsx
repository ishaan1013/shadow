import type { Message, ModelType } from "@repo/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TaskMessages } from "@/lib/db-operations/get-task-messages";

export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      taskId,
      message,
      model,
    }: {
      taskId: string;
      message: string;
      model: ModelType;
    }) => {
      // This will be handled via socket, not direct API call
      // The actual sending happens through socket.emit in the component
      return { taskId, message, model };
    },
    onMutate: async ({ taskId, message, model }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["task-messages", taskId] });

      // Snapshot the previous value
      const previousMessages = queryClient.getQueryData<TaskMessages>([
        "task-messages",
        taskId,
      ]);

      // Optimistically update with new message
      const optimisticMessage: Message = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: message.trim(),
        llmModel: model,
        createdAt: new Date().toISOString(),
        metadata: { isStreaming: false },
        pullRequestSnapshot: undefined,
      };

      queryClient.setQueryData<TaskMessages>(
        ["task-messages", taskId],
        (old) => {
          const currentMessages = old?.messages || [];
          const updatedMessages = [...currentMessages, optimisticMessage];

          return {
            messages: updatedMessages,
            mostRecentMessageModel: model,
          };
        }
      );

      // Return a context object with the snapshotted value
      return { previousMessages };
    },
    onError: (_err, variables, context) => {
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
