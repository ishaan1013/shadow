import { prisma, TaskStatus } from "@repo/db";
import { emitTaskStatusUpdate } from "../socket";

/**
 * Updates a task's status in the database and emits a real-time update
 * @param taskId - The task ID to update
 * @param status - The new status for the task
 * @param context - Optional context for logging (e.g., "CHAT", "SOCKET", "INIT")
 */
export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  context?: string
): Promise<void> {
  try {
    // Update task status in database
    await prisma.task.update({
      where: { id: taskId },
      data: { status },
    });

    // Log the status change
    const logPrefix = context ? `[${context}]` : "[TASK]";
    console.log(`${logPrefix} Task ${taskId} status updated to ${status}`);

    // Emit real-time update to all connected clients
    emitTaskStatusUpdate(taskId, status);
  } catch (error) {
    console.error(
      `Failed to update task ${taskId} status to ${status}:`,
      error
    );
    throw error;
  }
}
