import type { InitStatus, VariantStatus, Variant as PrismaVariant } from "@repo/db";
import type { ModelType } from "../llm/models";

/**
 * Variant interface extending Prisma model with computed fields
 */
export interface Variant extends Omit<PrismaVariant, 'modelType'> {
  modelType: ModelType;
}

/**
 * Entity with initialization fields for status helpers (now variant-based)
 */
export interface WithInitFields {
  initStatus?: InitStatus;
  initializationError?: string | null;
  status?: VariantStatus;
}

// Keep backward compatibility alias
export type VariantWithInitFields = WithInitFields;

/**
 * Check if initialization has not started yet
 */
export function isInitializationNotStarted(entity: WithInitFields): boolean {
  return entity.initStatus === 'INACTIVE' && !entity.initializationError;
}

/**
 * Check if initialization is currently in progress
 */
export function isInitializationInProgress(entity: WithInitFields): boolean {
  return entity.initStatus !== 'INACTIVE' && entity.initStatus !== 'ACTIVE' && !entity.initializationError && entity.status === 'INITIALIZING';
}

/**
 * Check if initialization has completed successfully
 */
export function isInitializationCompleted(entity: WithInitFields): boolean {
  return entity.initStatus === 'ACTIVE' && !entity.initializationError;
}

/**
 * Check if initialization has failed
 */
export function isInitializationFailed(entity: WithInitFields): boolean {
  return !!entity.initializationError;
}

// Backward compatibility aliases
export const isVariantInitializationNotStarted = isInitializationNotStarted;
export const isVariantInitializationInProgress = isInitializationInProgress;
export const isVariantInitializationCompleted = isInitializationCompleted;
export const isVariantInitializationFailed = isInitializationFailed;

/**
 * Calculate initialization progress based on completed steps
 */
export function getInitializationProgress(
  entity: WithInitFields,
  stepsList: InitStatus[]
): { completed: number; total: number; currentStep?: string } {
  const total = stepsList.length;

  if (!entity.initStatus || entity.initStatus === 'INACTIVE') {
    return { completed: 0, total };
  }

  if (entity.initStatus === 'ACTIVE') {
    return { completed: total, total, currentStep: 'ACTIVE' };
  }

  const completedIndex = stepsList.indexOf(entity.initStatus);
  const completed = completedIndex >= 0 ? completedIndex + 1 : 0;

  return {
    completed,
    total,
    currentStep: entity.initStatus,
  };
}

// Backward compatibility alias
export const getVariantInitializationProgress = getInitializationProgress;

/**
 * Get human-readable status text for display
 */
export function getStatusText(entity: WithInitFields): string {
  if (isInitializationFailed(entity)) {
    return `Failed: ${entity.initializationError}`;
  }

  if (isInitializationInProgress(entity)) {
    return "Initializing";
  }

  if (isInitializationNotStarted(entity)) {
    return "Not started";
  }

  // Default to entity status
  return entity.status?.toLowerCase().replace("_", " ") || "Unknown";
}

// Backward compatibility alias
export const getVariantStatusText = getStatusText;