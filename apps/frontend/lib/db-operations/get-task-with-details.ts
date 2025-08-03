import type { Task, Todo } from "@repo/db";
import { db } from "@repo/db";

export interface FileChange {
  filePath: string;
  operation: "CREATE" | "UPDATE" | "DELETE" | "RENAME";
  additions: number;
  deletions: number;
  createdAt: string;
}

export interface DiffStats {
  additions: number;
  deletions: number;
  totalFiles: number;
}

export interface TaskWithDetails {
  task: Task | null;
  todos: Todo[];
  fileChanges: FileChange[];
  diffStats: DiffStats;
}

async function fetchFileChanges(
  taskId: string
): Promise<{ fileChanges: FileChange[]; diffStats: DiffStats }> {
  try {
    const response = await fetch(
      `http://localhost:4000/api/tasks/${taskId}/file-changes`
    );
    if (!response.ok) {
      console.warn(
        `Failed to fetch file changes for task ${taskId}: ${response.status}`
      );
      return {
        fileChanges: [],
        diffStats: { additions: 0, deletions: 0, totalFiles: 0 },
      };
    }
    const data = await response.json();

    return {
      fileChanges: data.fileChanges,
      diffStats: data.diffStats,
    };
  } catch (error) {
    console.error(`Error fetching file changes for task ${taskId}:`, error);
    return {
      fileChanges: [],
      diffStats: { additions: 0, deletions: 0, totalFiles: 0 },
    };
  }
}

export async function getTaskWithDetails(
  taskId: string
): Promise<TaskWithDetails> {
  try {
    // Fetch all data in parallel for better performance
    const [task, todos, { fileChanges, diffStats }] = await Promise.all([
      db.task.findUnique({
        where: { id: taskId },
      }),
      db.todo.findMany({
        where: { taskId },
        orderBy: { sequence: "asc" },
      }),
      fetchFileChanges(taskId),
    ]);

    return {
      task,
      todos,
      fileChanges,
      diffStats,
    };
  } catch (error) {
    console.error(`Failed to fetch task details for ${taskId}:`, error);
    // Return empty data structure on error
    return {
      task: null,
      todos: [],
      fileChanges: [],
      diffStats: { additions: 0, deletions: 0, totalFiles: 0 },
    };
  }
}
