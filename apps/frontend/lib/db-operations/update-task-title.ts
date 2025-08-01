import { db, Task } from "@repo/db";

export async function updateTaskTitle(
  taskId: string,
  title: string
): Promise<{ success: boolean; task?: Task; error?: string }> {
  try {
    const updatedTask = await db.task.update({
      where: { id: taskId },
      data: { title },
    });

    return { success: true, task: updatedTask };
  } catch (error) {
    console.error(`Failed to update task title for ${taskId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
