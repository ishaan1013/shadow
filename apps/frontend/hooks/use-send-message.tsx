import type { Message, ModelType } from "@repo/types";
import {
  useMutation,
  useQueryClient,
  isCancelledError,
} from "@tanstack/react-query";

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
      try {
        await queryClient.cancelQueries({
          queryKey: ["task-messages", taskId],
        });
      } catch (error) {
        if (!isCancelledError(error)) {
          // Log unexpected errors but don't block optimistic update
          console.error("Failed to cancel queries for task-messages", error);
        }
      }

      const previousMessages = queryClient.getQueryData<Message[]>([
        "task-messages",
        taskId,
      ]);

      const optimisticMessage: Message = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: message.trim(),
        llmModel: model,
        createdAt: new Date().toISOString(),
        metadata: { isStreaming: false },
        pullRequestSnapshot: undefined,
      };

      queryClient.setQueryData<Message[]>(["task-messages", taskId], (old) => {
        const currentMessages = old || [];
        return [...currentMessages, optimisticMessage];
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
  });
}
