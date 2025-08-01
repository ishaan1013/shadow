import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useTaskTitle(taskId: string) {
  return useQuery({
    queryKey: ["task-title", taskId],
    queryFn: async () => {
      const res = await fetch(`/api/tasks/${taskId}/title`);
      if (!res.ok) throw new Error("Failed to fetch title");
      const data = await res.json();
      return data.title as string;
    },
    throwOnError: true,
    enabled: !!taskId,
  });
}

export function useUpdateTaskTitle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      taskId,
      title,
    }: {
      taskId: string;
      title: string;
    }) => {
      const response = await fetch(`/api/tasks/${taskId}/title`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update task title");
      }

      return response.json();
    },
    onSettled: (data, error, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    },
  });
}
