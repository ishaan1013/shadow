import type { InitStepType, TaskStatus } from "@repo/db";

/**
 * Task with initialization fields for status helpers
 */
export interface TaskWithInitFields {
  lastCompletedStep?: InitStepType | null;
  initializationError?: string | null;
  status?: TaskStatus;
}

/**
 * Check if task initialization has not started yet
 */
export function isInitializationNotStarted(task: TaskWithInitFields): boolean {
  return !task.lastCompletedStep && !task.initializationError;
}

/**
 * Check if task initialization is currently in progress
 */
export function isInitializationInProgress(task: TaskWithInitFields): boolean {
  return !!task.lastCompletedStep && !task.initializationError && task.status === 'INITIALIZING';
}

/**
 * Check if task initialization has completed successfully
 */
export function isInitializationCompleted(task: TaskWithInitFields): boolean {
  return !!task.lastCompletedStep && !task.initializationError && task.status !== 'INITIALIZING';
}

/**
 * Check if task initialization has failed
 */
export function isInitializationFailed(task: TaskWithInitFields): boolean {
  return !!task.initializationError;
}

/**
 * Calculate initialization progress based on completed steps
 */
export function getInitializationProgress(
  task: TaskWithInitFields,
  stepsList: InitStepType[]
): { completed: number; total: number; currentStep?: string } {
  const total = stepsList.length;

  if (!task.lastCompletedStep) {
    return { completed: 0, total };
  }

  const completedIndex = stepsList.indexOf(task.lastCompletedStep);
  const completed = completedIndex >= 0 ? completedIndex + 1 : 0;

  return {
    completed,
    total,
    currentStep: task.lastCompletedStep,
  };
}


/**
 * Get human-readable status text for display
 */
export function getStatusText(task: TaskWithInitFields): string {
  if (isInitializationFailed(task)) {
    return `Failed: ${task.initializationError}`;
  }

  if (isInitializationInProgress(task)) {
    return "Initializing";
  }

  if (isInitializationNotStarted(task)) {
    return "Not started";
  }

  // Default to task status
  return task.status?.toLowerCase().replace("_", " ") || "Unknown";
} 