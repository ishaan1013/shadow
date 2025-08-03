import { prisma, TaskStatus, InitStatus } from "@repo/db";
import { emitTaskStatusUpdate } from "../socket";
import { getAgentMode } from "../execution";

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
 * Set task initialization status
 */
export async function setInitStatus(
  taskId: string,
  status: InitStatus
): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: {
      initStatus: status,
      initializationError: null, // Clear any previous errors
    },
  });
}

/**
 * Set task as completed with final step
 */
export async function setTaskCompleted(
  taskId: string,
  status: InitStatus
): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: {
      initStatus: status,
      initializationError: null,
    },
  });
}

/**
 * Set task as failed with error message
 */
export async function setTaskFailed(
  taskId: string,
  step: InitStatus,
  error: string
): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: {
      initStatus: step, // Keep the step where failure occurred
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
      initStatus: "INACTIVE",
      initializationError: null,
    },
  });
}

/**
 * Updates a task's updatedAt timestamp to reflect recent activity
 * @param taskId - The task ID to update
 * @param context - Optional context for logging (e.g., "MESSAGE", "CHAT", "TOOL")
 */
export async function updateTaskActivity(
  taskId: string,
  context?: string
): Promise<void> {
  try {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        updatedAt: new Date(),
      },
    });

    const logPrefix = context ? `[${context}]` : "[ACTIVITY]";
    console.log(`${logPrefix} Task ${taskId} activity timestamp updated`);
  } catch (error) {
    console.error(`Failed to update task ${taskId} activity timestamp:`, error);
  }
}

/**
 * Schedule task for cleanup (remote mode only)
 */
export async function scheduleTaskCleanup(
  taskId: string,
  delayMinutes: number
): Promise<void> {
  const agentMode = getAgentMode();

  // Only schedule cleanup for remote mode
  if (agentMode !== "remote") {
    return;
  }

  const scheduledAt = new Date(Date.now() + delayMinutes * 60 * 1000);

  // Get current task to preserve its status
  const currentTask = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true },
  });

  if (!currentTask) {
    throw new Error(`Task ${taskId} not found`);
  }

  // Only schedule cleanup for COMPLETED or STOPPED tasks
  if (currentTask.status !== "COMPLETED" && currentTask.status !== "STOPPED") {
    return;
  }

  await prisma.task.update({
    where: { id: taskId },
    data: {
      scheduledCleanupAt: scheduledAt,
    },
  });

  console.log(
    `[TASK_CLEANUP] Task ${taskId} scheduled for cleanup at ${scheduledAt.toISOString()}`
  );
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
