import type { FileChange, Task, Todo } from "@repo/db";
import { db } from "@repo/db";

export interface TaskWithDetails {
  task: Task | null;
  todos: Todo[];
  fileChanges: FileChange[];
}

export async function getTaskWithDetails(
  taskId: string
): Promise<TaskWithDetails> {
  try {
    // Fetch all data in parallel for better performance
    const [task, todos, fileChanges] = await Promise.all([
      db.task.findUnique({
        where: { id: taskId },
      }),
      db.todo.findMany({
        where: { taskId },
        orderBy: { sequence: "asc" },
      }),
      db.fileChange.findMany({
        where: { taskId },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return {
      task,
      todos,
      fileChanges,
    };
  } catch (error) {
    console.error(`Failed to fetch task details for ${taskId}:`, error);
    // Return empty data structure on error
    return {
      task: null,
      todos: [],
      fileChanges: [],
    };
  }
}
