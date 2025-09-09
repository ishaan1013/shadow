import { prisma } from "@repo/db";
import { createWorkspaceManager, getAgentMode } from "../execution";
import { MemoryCleanupService } from "./memory-cleanup";

export class TaskCleanupService {
  private interval: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL_MS = 60 * 1000; // Every minute

  /**
   * Start the background cleanup service
   * Only runs in remote mode
   */
  start(): void {
    const agentMode = getAgentMode();

    // Only run cleanup in remote mode
    if (agentMode !== "remote") {
      return;
    }

    this.processStartupCleanup();

    this.interval = setInterval(async () => {
      await this.processCleanupQueue();
    }, this.CLEANUP_INTERVAL_MS);
  }

  /**
   * Process any cleanup tasks that were scheduled but missed due to server shutdown
   */
  private async processStartupCleanup(): Promise<void> {
    try {
      console.log(
        "[TASK_CLEANUP] Checking for missed cleanup tasks on startup"
      );
      await this.processCleanupQueue();
    } catch (error) {
      console.error("[TASK_CLEANUP] Error during startup cleanup:", error);
    }
  }

  /**
   * Stop the background cleanup service
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log("[TASK_CLEANUP] Stopped background cleanup service");
    }
  }

  /**
   * Process tasks scheduled for cleanup
   */
  private async processCleanupQueue(): Promise<void> {
    try {
      const tasksToCleanup = await prisma.task.findMany({
        where: {
          scheduledCleanupAt: {
            lte: new Date(),
          },
          NOT: {
            scheduledCleanupAt: null,
          },
        },
        select: {
          id: true,
          scheduledCleanupAt: true,
        },
      });

      if (tasksToCleanup.length === 0) {
        return;
      }

      console.log(
        `[TASK_CLEANUP] Processing ${tasksToCleanup.length} tasks for cleanup`
      );

      for (const task of tasksToCleanup) {
        await this.cleanupTask(task.id);
      }
    } catch (error) {
      console.error("[TASK_CLEANUP] Error processing cleanup queue:", error);
    }
  }

  /**
   * Clean up a specific task (multi-variant aware)
   * Cleans up all variants in the task that aren't already inactive
   */
  private async cleanupTask(taskId: string): Promise<void> {
    try {
      console.log(`[TASK_CLEANUP] Cleaning up task ${taskId}`);

      // Get all variants for this task that need cleanup
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
          variants: {
            select: {
              id: true,
              initStatus: true,
            },
          },
        },
      });

      if (!task) {
        console.warn(`[TASK_CLEANUP] Task ${taskId} not found`);
        return;
      }

      // Filter variants that need cleanup (not already inactive)
      const variantsToCleanup = task.variants.filter(
        (variant) => variant.initStatus !== "INACTIVE"
      );

      if (variantsToCleanup.length === 0) {
        console.log(
          `[TASK_CLEANUP] All variants for task ${taskId} already inactive`
        );
        await this.clearCleanupSchedule(taskId);
        return;
      }

      console.log(
        `[TASK_CLEANUP] Cleaning up ${variantsToCleanup.length} variants for task ${taskId}`
      );

      // Get workspace manager for cleanup operations
      const workspaceManager = createWorkspaceManager();

      // Clean up server memory structures first
      MemoryCleanupService.cleanupTaskMemory(taskId);

      // Cleanup workspace/VM resources for the task
      try {
        await workspaceManager.cleanupWorkspace(taskId);
      } catch (workspaceError) {
        console.warn(
          `[TASK_CLEANUP] Failed to cleanup workspace for task ${taskId}:`,
          workspaceError
        );
        // Continue with database cleanup
      }

      // Update TaskSessions to mark as inactive (using variantId)
      await prisma.taskSession.updateMany({
        where: {
          variantId: {
            in: variantsToCleanup.map((v) => v.id),
          },
          isActive: true,
        },
        data: {
          isActive: false,
          endedAt: new Date(),
        },
      });

      // Set initStatus to INACTIVE for all variants and clear cleanup schedule
      // Keep original task status (COMPLETED/STOPPED) so user can resume later
      await prisma.variant.updateMany({
        where: {
          id: {
            in: variantsToCleanup.map((v) => v.id),
          },
        },
        data: {
          initStatus: "INACTIVE",
        },
      });

      await this.clearCleanupSchedule(taskId);

      console.log(
        `[TASK_CLEANUP] Successfully cleaned up ${variantsToCleanup.length} variants for task ${taskId}`
      );
    } catch (error) {
      console.error(`[TASK_CLEANUP] Failed to cleanup task ${taskId}:`, error);

      // Clear the cleanup schedule even if cleanup failed to prevent infinite retries
      await this.clearCleanupSchedule(taskId);
    }
  }

  /**
   * Clear the cleanup schedule for a task
   */
  private async clearCleanupSchedule(taskId: string): Promise<void> {
    try {
      await prisma.task.update({
        where: { id: taskId },
        data: {
          scheduledCleanupAt: null,
        },
      });
    } catch (updateError) {
      console.error(
        `[TASK_CLEANUP] Failed to clear cleanup schedule for task ${taskId}:`,
        updateError
      );
    }
  }
}

// Singleton instance
export const taskCleanupService = new TaskCleanupService();
