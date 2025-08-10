import { db, Task } from "@repo/db";

export async function deleteTask(
  taskId: string
): Promise<{ success: boolean; task?: Task; error?: string }> {
  try {
    const deletedTask = await db.task.delete({
      where: { id: taskId },
    });

    return { success: true, task: deletedTask };
  } catch (error) {
    console.error(`Failed to delete task ${taskId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}