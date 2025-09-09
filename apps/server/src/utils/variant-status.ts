import { prisma, VariantStatus, InitStatus } from "@repo/db";
import { emitVariantStatusUpdate, emitStreamChunk } from "../socket";

/**
 * Updates a variant's status in the database and emits a real-time update
 * @param variantId - The variant ID to update
 * @param status - The new status for the variant
 * @param context - Optional context for logging (e.g., "CHAT", "SOCKET", "INIT")
 */
export async function updateVariantStatus(
  variantId: string,
  status: VariantStatus,
  context?: string,
  errorMessage?: string
): Promise<void> {
  try {
    const variant = await prisma.variant.update({
      where: { id: variantId },
      data: {
        status,
        errorMessage:
          status === "FAILED" ? errorMessage || "Unknown error" : null,
      },
      include: {
        task: true,
      },
    });

    // Log the status change
    const logPrefix = context ? `[${context}]` : "[VARIANT]";
    const errorSuffix = errorMessage ? ` (error: ${errorMessage})` : "";
    console.log(
      `${logPrefix} Variant ${variantId} (task ${variant.taskId}) status updated to ${status}${errorSuffix}`
    );

    // Emit real-time update to all connected clients for this task
    emitVariantStatusUpdate(variant.taskId, {
      taskId: variant.taskId,
      variantId,
      status,
      errorMessage: errorMessage || undefined,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      `Failed to update variant ${variantId} status to ${status}:`,
      error
    );
    throw error;
  }
}

/**
 * Set variant initialization status
 */
export async function setVariantInitStatus(
  variantId: string,
  status: InitStatus
): Promise<void> {
  const variant = await prisma.variant.update({
    where: { id: variantId },
    data: {
      initStatus: status,
      initializationError: null, // Clear any previous errors
    },
    include: {
      task: true,
    },
  });

  // Emit progress update
  emitStreamChunk(
    {
      type: "init-progress",
      initProgress: {
        type: "step-progress",
        taskId: variant.taskId,
        variantId,
        currentStep: status,
      },
    },
    variantId,
    variant.taskId
  );
}

/**
 * Set variant as completed with final step
 */
export async function setVariantCompleted(
  variantId: string,
  status: InitStatus
): Promise<void> {
  const variant = await prisma.variant.update({
    where: { id: variantId },
    data: {
      initStatus: status,
      initializationError: null,
      status: "RUNNING", // Variant is now ready to run
    },
    include: {
      task: true,
    },
  });

  emitStreamChunk(
    {
      type: "init-progress",
      initProgress: {
        type: "init-complete",
        taskId: variant.taskId,
        variantId,
      },
    },
    variantId,
    variant.taskId
  );
}

/**
 * Set variant as failed with error message
 */
export async function setVariantFailed(
  variantId: string,
  step: InitStatus,
  error: string
): Promise<void> {
  const variant = await prisma.variant.update({
    where: { id: variantId },
    data: {
      initStatus: step, // Keep the step where failure occurred
      initializationError: error,
      status: "FAILED",
    },
    include: {
      task: true,
    },
  });

  emitStreamChunk(
    {
      type: "init-progress",
      initProgress: {
        type: "init-error",
        taskId: variant.taskId,
        variantId,
        currentStep: step,
        error,
      },
    },
    variantId,
    variant.taskId
  );
}

/**
 * Clear variant progress (reset to not started state)
 */
export async function clearVariantProgress(variantId: string): Promise<void> {
  await prisma.variant.update({
    where: { id: variantId },
    data: {
      initStatus: "INACTIVE",
      initializationError: null,
    },
  });
}

/**
 * Updates a variant's updatedAt timestamp to reflect recent activity
 * @param variantId - The variant ID to update
 * @param context - Optional context for logging (e.g., "MESSAGE", "CHAT", "TOOL")
 */
export async function updateVariantActivity(
  variantId: string,
  context?: string
): Promise<void> {
  try {
    await prisma.variant.update({
      where: { id: variantId },
      data: {
        updatedAt: new Date(),
      },
    });

    const logPrefix = context ? `[${context}]` : "[ACTIVITY]";
    console.log(`${logPrefix} Variant ${variantId} activity timestamp updated`);
  } catch (error) {
    console.error(`Failed to update variant ${variantId} activity timestamp:`, error);
  }
}

/**
 * Schedule variant for cleanup (remote mode only)
 */
export async function scheduleVariantCleanup(
  variantId: string,
  delayMinutes: number
): Promise<void> {
  const scheduledAt = new Date(Date.now() + delayMinutes * 60 * 1000);

  try {
    await prisma.variant.update({
      where: { id: variantId },
      data: {
        scheduledCleanupAt: scheduledAt,
      },
    });

    console.log(
      `[VARIANT_CLEANUP] Variant ${variantId} scheduled for cleanup at ${scheduledAt.toISOString()}`
    );
  } catch (error) {
    console.error(`Failed to schedule cleanup for variant ${variantId}:`, error);
  }
}

/**
 * Cancel scheduled cleanup for a variant
 */
export async function cancelVariantCleanup(variantId: string): Promise<void> {
  await prisma.variant.update({
    where: { id: variantId },
    data: {
      scheduledCleanupAt: null,
    },
  });

  console.log(`[VARIANT_CLEANUP] Cancelled cleanup for variant ${variantId}`);
}

/**
 * Mark variant as having been initialized for the first time
 */
export async function setVariantInitialized(variantId: string): Promise<void> {
  await prisma.variant.update({
    where: { id: variantId },
    data: {
      hasBeenInitialized: true,
    },
  });

  console.log(`[VARIANT_STATUS] Variant ${variantId} marked as initialized`);
}