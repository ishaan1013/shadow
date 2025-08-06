import { db, Task } from "@repo/db";

export async function archiveTask(
  taskId: string
): Promise<{ success: boolean; task?: Task; error?: string }> {
  try {
    const updatedTask = await db.task.update({
      where: { id: taskId },
      data: { status: "ARCHIVED" },
    });

    return { success: true, task: updatedTask };
  } catch (error) {
    console.error(`Failed to archive task ${taskId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}