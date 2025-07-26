import type { TaskWithDetails } from "@/lib/db-operations/get-task-with-details";
import { useQuery } from "@tanstack/react-query";

export function useTask(taskId: string) {
  // Main task data query (includes fileChanges now)
  const taskQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: async (): Promise<TaskWithDetails> => {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (!res.ok) throw new Error("Failed to fetch task");
      return await res.json();
    },
    enabled: !!taskId,
  });

  return {
    task: taskQuery.data?.task || null,
    todos: taskQuery.data?.todos || [],
    fileChanges: taskQuery.data?.fileChanges || [],
    diffStats: taskQuery.data?.diffStats || {
      additions: 0,
      deletions: 0,
      totalFiles: 0,
    },
    isLoading: taskQuery.isLoading,
    error: taskQuery.error,
  };
}
