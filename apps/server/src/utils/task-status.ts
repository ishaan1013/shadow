import { prisma, TaskStatus } from "@repo/db";
import { emitTaskStatusUpdate } from "../socket";

/**
 * Updates a task's status in the database and emits a real-time update
 * @param taskId - The task ID to update
 * @param status - The new status for the task
 * @param context - Optional context for logging (e.g., "CHAT", "SOCKET", "INIT")
 * @param errorMessage - Optional error message for FAILED status
 */
export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  context?: string,
  errorMessage?: string
): Promise<void> {
  try {
    const task = await prisma.task.update({
      where: { id: taskId },
      data: { status },
    });

    // Log the status change
    const logPrefix = context ? `[${context}]` : "[TASK]";
    const errorSuffix = errorMessage ? ` (error: ${errorMessage})` : "";
    console.log(
      `${logPrefix} Task ${taskId} status updated to ${status}${errorSuffix}`
    );

    // Emit real-time update to all connected clients for this task
    emitTaskStatusUpdate(taskId, {
      taskId,
      status,
      errorMessage: errorMessage || undefined,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      `Failed to update task ${taskId} status to ${status}:`,
      error
    );
    throw error;
  }
}

/**
 * Schedule task for cleanup (remote mode only)
 */
export async function scheduleTaskCleanup(
  taskId: string,
  delayMinutes: number
): Promise<void> {
  const scheduledAt = new Date(Date.now() + delayMinutes * 60 * 1000);

  try {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        scheduledCleanupAt: scheduledAt,
      },
    });

    console.log(
      `[TASK_CLEANUP] Task ${taskId} scheduled for cleanup at ${scheduledAt.toISOString()}`
    );
  } catch (error) {
    console.error(`Failed to schedule cleanup for task ${taskId}:`, error);
  }
}

/**
 * Cancel scheduled cleanup for a task
 */
export async function cancelTaskCleanup(taskId: string): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: {
      scheduledCleanupAt: null,
    },
  });

  console.log(`[TASK_CLEANUP] Cancelled cleanup for task ${taskId}`);
}