import { Task } from "@repo/db";
import { useQuery } from "@tanstack/react-query";

export function useTask(taskId: string, initialData?: Task) {
  return useQuery({
    queryKey: ["task", taskId],
    queryFn: async () => {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (!res.ok) throw new Error("Failed to fetch task");
      return res.json() as Promise<Task>;
    },
    initialData,
  });
}
