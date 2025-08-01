import { TaskMessages } from "@/lib/db-operations/get-task-messages";
import { useQuery } from "@tanstack/react-query";

export function useTaskMessages(taskId: string) {
  return useQuery({
    queryKey: ["task-messages", taskId],
    queryFn: async (): Promise<TaskMessages> => {
      const res = await fetch(`/api/tasks/${taskId}/messages`);
      if (!res.ok) throw new Error("Failed to fetch messages");
      const data = await res.json();

      return data;
    },
    throwOnError: true,
    enabled: !!taskId,
  });
}
