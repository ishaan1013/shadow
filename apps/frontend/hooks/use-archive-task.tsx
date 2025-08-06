import { useMutation, useQueryClient } from "@tanstack/react-query";

export function useArchiveTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId }: { taskId: string }) => {
      const response = await fetch(`/api/tasks/${taskId}/archive`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to archive task");
      }

      return response.json();
    },
    onSettled: (data, error, { taskId }) => {
      // Invalidate tasks list to refresh the UI
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      // Also invalidate the specific task if needed
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    },
  });
}