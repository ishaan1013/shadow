import {
  useMutation,
  useQueryClient,
  isCancelledError,
} from "@tanstack/react-query";
import { useSocket } from "./socket/use-socket";
import { Message, ModelType } from "@repo/types";
import { StreamingStatus, type StreamingStatusSetter } from "@/lib/constants";

interface EditMessageParams {
  taskId: string;
  messageId: string;
  newContent: string;
  newModel: ModelType;
}

export function useEditMessage(setStreamingStatus?: StreamingStatusSetter) {
  const queryClient = useQueryClient();
  const { socket } = useSocket();

  return useMutation({
    mutationFn: async ({
      taskId,
      messageId,
      newContent,
      newModel,
    }: EditMessageParams) => {
      setStreamingStatus?.(StreamingStatus.PENDING);

      socket?.emit("edit-user-message", {
        taskId,
        messageId,
        message: newContent,
        llmModel: newModel,
      });

      return { taskId, messageId, newContent, newModel };
    },
    onMutate: async ({ taskId, messageId, newContent, newModel }) => {
      try {
        await queryClient.cancelQueries({
          queryKey: ["task-messages", taskId],
        });
      } catch (error) {
        if (!isCancelledError(error)) {
          console.error("Failed to cancel queries for task-messages", error);
        }
      }

      const previousMessages = queryClient.getQueryData<Message[]>([
        "task-messages",
        taskId,
      ]);

      queryClient.setQueryData<Message[]>(["task-messages", taskId], (old) => {
        if (!old) return [];

        const messageIndex = old.findIndex((msg) => msg.id === messageId);
        if (messageIndex === -1 || !old[messageIndex]) return old;

        const updatedMessages = old.slice(0, messageIndex + 1);

        updatedMessages[messageIndex] = {
          ...old[messageIndex],
          content: newContent,
          llmModel: newModel,
          pullRequestSnapshot: old[messageIndex]?.pullRequestSnapshot,
          metadata: {
            ...old[messageIndex]?.metadata,
          },
        };

        return updatedMessages;
      });

      return { previousMessages };
    },
    onError: (_err, variables, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(
          ["task-messages", variables.taskId],
          context.previousMessages
        );
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["edit-message-id", data.taskId], null);
    },
  });
}
