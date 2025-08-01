import { prisma, TaskStatus } from "@repo/db";
import type { InitStepType } from "@repo/db";
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

/**
 * Set task as in progress with current step
 */
export async function setTaskInProgress(taskId: string, step: InitStepType): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: {
      lastCompletedStep: step,
      initializationError: null, // Clear any previous errors
    },
  });
}

/**
 * Set task as completed with final step
 */
export async function setTaskCompleted(taskId: string, lastStep: InitStepType): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: {
      lastCompletedStep: lastStep,
      initializationError: null,
    },
  });
}

/**
 * Set task as failed with error message
 */
export async function setTaskFailed(taskId: string, step: InitStepType, error: string): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: {
      lastCompletedStep: step, // Keep the step where failure occurred
      initializationError: error,
    },
  });
}

/**
 * Clear task progress (reset to not started state)
 */
export async function clearTaskProgress(taskId: string): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: {
      lastCompletedStep: null,
      initializationError: null,
    },
  });
}
