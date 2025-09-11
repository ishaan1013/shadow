import { useMutation, useQueryClient } from "@tanstack/react-query";

interface CreatePRResponse {
  success: boolean;
  prNumber?: number;
  prUrl?: string;
  messageId?: string;
  error?: string;
}

export function useCreatePR() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, variantId }: { taskId: string; variantId: string }): Promise<CreatePRResponse> => {
      const response = await fetch(`/api/tasks/${taskId}/pull-request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ variantId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to create pull request");
      }

      return await response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["task", variables.taskId] });
      queryClient.invalidateQueries({ queryKey: ["task-messages", variables.taskId, variables.variantId] });
    },
  });
}
