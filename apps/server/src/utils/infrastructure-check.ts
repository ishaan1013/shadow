import { prisma } from "@repo/db";
import { createToolExecutor, getAgentMode } from "../execution";
import { TaskInitializationEngine } from "../initialization";
import { TaskModelContext } from "../services/task-model-context";
import { getStepsForMode } from "@repo/types";

/**
 * Ensures task infrastructure exists and is healthy
 * If infrastructure is missing or unhealthy, triggers re-initialization
 */
export async function ensureTaskInfrastructureExists(
  taskId: string,
  userId: string,
  context: TaskModelContext
): Promise<void> {
  console.log(`[INFRA_CHECK] Checking infrastructure for task ${taskId}`);

  // Local mode has persistent workspaces - no infrastructure validation needed
  if (getAgentMode() === "local") {
    console.log(
      `[INFRA_CHECK] ${taskId}: Local mode - skipping infrastructure check`
    );
    return;
  }

  try {
    // First get the task's variants to check their sessions
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        variants: {
          select: { id: true },
        },
      },
    });

    if (!task || task.variants.length === 0) {
      console.warn(`[INFRA_CHECK] Task ${taskId} or its variants not found`);
      return;
    }

    // Step 1: Check if we have an active TaskSession for any variant
    const activeSession = await prisma.taskSession.findFirst({
      where: {
        variantId: { in: task.variants.map((v) => v.id) },
        isActive: true,
      },
      select: {
        id: true,
        podName: true,
        podNamespace: true,
        createdAt: true,
        variantId: true,
      },
    });

    if (!activeSession) {
      console.log(
        `[INFRA_CHECK] ${taskId}: No active session found, re-initialization required`
      );
      await triggerReinitialization(taskId, userId, context);
      return;
    }

    // Step 2: Check if the pod is actually healthy by trying to create a tool executor
    try {
      const toolExecutor = await createToolExecutor(taskId);

      const healthCheck = await toolExecutor.listDirectory(".");

      if (!healthCheck.success) {
        console.log(
          `[INFRA_CHECK] ${taskId}: Pod unhealthy (health check failed), re-initialization required`
        );
        await triggerReinitialization(taskId, userId, context);
        return;
      }

      console.log(
        `[INFRA_CHECK] ${taskId}: Infrastructure healthy, proceeding normally`
      );
    } catch (error) {
      console.log(
        `[INFRA_CHECK] ${taskId}: Pod inaccessible (${error instanceof Error ? error.message : "Unknown error"}), re-initialization required`
      );
      await triggerReinitialization(taskId, userId, context);
      return;
    }
  } catch (error) {
    console.error(
      `[INFRA_CHECK] ${taskId}: Infrastructure check failed:`,
      error
    );
    throw new Error(
      `Failed to ensure task infrastructure: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Triggers full re-initialization for a task
 * Uses specific steps optimized for re-initialization (includes dependencies, skips background services)
 */
async function triggerReinitialization(
  taskId: string,
  userId: string,
  context: TaskModelContext
): Promise<void> {
  console.log(`[INFRA_CHECK] ${taskId}: Starting re-initialization`);

  // Get task variants first
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      variants: {
        select: { id: true },
      },
    },
  });

  if (!task || task.variants.length === 0) {
    console.warn(
      `[INFRA_CHECK] Task ${taskId} or variants not found for re-init`
    );
    return;
  }

  // End all active sessions for this task's variants
  await prisma.taskSession.updateMany({
    where: {
      variantId: { in: task.variants.map((v) => v.id) },
      isActive: true,
    },
    data: {
      isActive: false,
      endedAt: new Date(),
    },
  });

  // Use TaskInitializationEngine with re-init optimized steps
  const initEngine = new TaskInitializationEngine();

  // Get all remote mode steps and filter out steps not critical for resumption
  const allRemoteSteps = getStepsForMode("remote");
  const stepsToSkip = ["START_BACKGROUND_SERVICES", "COMPLETE_SHADOW_WIKI"];
  const reinitSteps = allRemoteSteps.filter(
    (step) => !stepsToSkip.includes(step)
  );

  // Re-initialize all variants
  for (const variant of task.variants) {
    try {
      await initEngine.initializeTask(
        variant.id,
        [...reinitSteps],
        userId,
        context
      );
      console.log(
        `[INFRA_CHECK] Variant ${variant.id} re-initialized successfully`
      );
    } catch (error) {
      console.error(
        `[INFRA_CHECK] Failed to re-initialize variant ${variant.id}:`,
        error
      );
    }
  }

  console.log(
    `[INFRA_CHECK] ${taskId}: Re-initialization completed successfully`
  );
}
