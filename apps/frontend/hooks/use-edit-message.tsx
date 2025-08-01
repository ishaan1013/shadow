import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSocket } from "./socket/use-socket";
import { ModelType, Message } from "@repo/types";

interface EditMessageParams {
  taskId: string;
  messageId: string;
  newContent: string;
  newModel: ModelType;
}

export function useEditMessage() {
  const queryClient = useQueryClient();
  const { socket } = useSocket();

  return useMutation({
    mutationFn: async ({ taskId, messageId, newContent, newModel }: EditMessageParams) => {
      // Emit socket event to trigger server-side processing
      socket?.emit("edit-user-message", {
        taskId,
        messageId,
        message: newContent,
        llmModel: newModel,
      });

      return { taskId, messageId, newContent, newModel };
    },
    onMutate: async ({ taskId, messageId, newContent, newModel }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["task-messages", taskId] });

      // Snapshot the previous value
      const previousMessages = queryClient.getQueryData<Message[]>([
        "task-messages",
        taskId,
      ]);

      // Optimistically update the edited message
      queryClient.setQueryData<Message[]>(["task-messages", taskId], (old) => {
        if (!old) return [];
        
        return old.map((msg) => {
          if (msg.id === messageId) {
            return {
              ...msg,
              content: newContent,
              llmModel: newModel,
              metadata: {
                ...msg.metadata,
                // Don't show as streaming yet
              },
            };
          }
          return msg;
        });
      });

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
    onSuccess: (data) => {
      // Clear the edit message ID to exit edit mode
      queryClient.setQueryData(["edit-message-id", data.taskId], null);
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