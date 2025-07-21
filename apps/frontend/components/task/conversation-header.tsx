import type { Task } from "@/lib/db-operations/get-task";

export function ConversationHeader({
  task,
  added,
  removed,
}: {
  task: Task;
  added: number;
  removed: number;
}) {
  return (
    <div className="text-xs text-muted-foreground border rounded-md p-2 mb-4 w-full">
      <div className="font-semibold">
        {task.repoUrl} ({task.branch})
      </div>
      <div>Started: {new Date(task.createdAt).toLocaleString()}</div>
      <div>
        Changes: +{added} -{removed}
      </div>
    </div>
  );
}
