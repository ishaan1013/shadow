import { Todo } from "@repo/db";
import { useQuery } from "@tanstack/react-query";

export function useTodos(taskId: string, initialData?: Todo[]) {
  return useQuery({
    queryKey: ["todos", taskId],
    queryFn: async (): Promise<Todo[]> => {
      const res = await fetch(`/api/tasks/${taskId}/todos`);
      if (!res.ok) {
        if (res.status === 404) return [];
        throw new Error("Failed to fetch todos");
      }
      return res.json() as Promise<Todo[]>;
    },
    initialData,
  });
}
