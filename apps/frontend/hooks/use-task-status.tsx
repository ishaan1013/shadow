import { TaskStatusData } from "@/lib/db-operations/get-task-status";
import { useQuery } from "@tanstack/react-query";

export function useTaskStatus(taskId: string) {
  return useQuery({
    queryKey: ["task-status", taskId],
    queryFn: async () => {
      const res = await fetch(`/api/tasks/${taskId}/status`);
      if (!res.ok) throw new Error("Failed to fetch status");
      const data = await res.json();
      return data as TaskStatusData;
    },
    throwOnError: true,
    enabled: !!taskId,
  });
}
