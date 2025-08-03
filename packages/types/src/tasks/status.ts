import type { InitStatus, TaskStatus } from "@repo/db";

/**
 * Task with initialization fields for status helpers
 */
export interface TaskWithInitFields {
  initStatus?: InitStatus;
  initializationError?: string | null;
  status?: TaskStatus;
}

/**
 * Check if task initialization has not started yet
 */
export function isInitializationNotStarted(task: TaskWithInitFields): boolean {
  return task.initStatus === 'INACTIVE' && !task.initializationError;
}

/**
 * Check if task initialization is currently in progress
 */
export function isInitializationInProgress(task: TaskWithInitFields): boolean {
  return task.initStatus !== 'INACTIVE' && task.initStatus !== 'ACTIVE' && !task.initializationError && task.status === 'INITIALIZING';
}

/**
 * Check if task initialization has completed successfully
 */
export function isInitializationCompleted(task: TaskWithInitFields): boolean {
  return task.initStatus === 'ACTIVE' && !task.initializationError;
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
  stepsList: InitStatus[]
): { completed: number; total: number; currentStep?: string } {
  const total = stepsList.length;

  if (!task.initStatus || task.initStatus === 'INACTIVE') {
    return { completed: 0, total };
  }

  if (task.initStatus === 'ACTIVE') {
    return { completed: total, total, currentStep: 'ACTIVE' };
  }

  const completedIndex = stepsList.indexOf(task.initStatus);
  const completed = completedIndex >= 0 ? completedIndex + 1 : 0;

  return {
    completed,
    total,
    currentStep: task.initStatus,
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