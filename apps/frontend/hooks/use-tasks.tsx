import { Task } from "@repo/db";
import { useQuery } from "@tanstack/react-query";

export function useTasks(initialData: Task[]) {
  return useQuery({
    queryKey: ["tasks"],
    queryFn: async (): Promise<Task[]> => {
      const res = await fetch("/api/tasks");
      if (!res.ok) throw new Error("Failed to fetch tasks");
      const data = await res.json();
      return data.tasks || [];
    },
    initialData,
  });
}
