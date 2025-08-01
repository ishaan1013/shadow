import { prisma } from "@repo/db";
import { createWorkspaceManager, getAgentMode } from "../execution";

export class TaskCleanupService {
  private interval: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL_MS = 60 * 1000; // Every minute

  /**
   * Start the background cleanup service
   * Only runs in firecracker mode
   */
  start(): void {
    const agentMode = getAgentMode();
    
    // Only run cleanup in firecracker mode
    if (agentMode !== "firecracker") {
      console.log("[TASK_CLEANUP] Cleanup service disabled in local mode");
      return;
    }

    console.log("[TASK_CLEANUP] Starting background cleanup service");
    
    this.interval = setInterval(async () => {
      await this.processCleanupQueue();
    }, this.CLEANUP_INTERVAL_MS);
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
            lte: new Date()
          },
          NOT: {
            scheduledCleanupAt: null
          }
        },
        select: {
          id: true,
          scheduledCleanupAt: true
        }
      });

      if (tasksToCleanup.length === 0) {
        return;
      }

      console.log(`[TASK_CLEANUP] Processing ${tasksToCleanup.length} tasks for cleanup`);

      for (const task of tasksToCleanup) {
        await this.cleanupTask(task.id);
      }
    } catch (error) {
      console.error("[TASK_CLEANUP] Error processing cleanup queue:", error);
    }
  }

  /**
   * Clean up a specific task
   */
  private async cleanupTask(taskId: string): Promise<void> {
    try {
      console.log(`[TASK_CLEANUP] Cleaning up task ${taskId}`);

      // Get workspace manager for cleanup operations
      const workspaceManager = createWorkspaceManager();

      // Cleanup workspace/VM resources
      await workspaceManager.cleanupWorkspace(taskId);

      // Update TaskSession to mark as inactive
      await prisma.taskSession.updateMany({
        where: { 
          taskId, 
          isActive: true 
        },
        data: {
          isActive: false,
          endedAt: new Date(),
        },
      });

      // Update task status to ARCHIVED and clear cleanup schedule
      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: "ARCHIVED",
          initStatus: "INACTIVE",
          scheduledCleanupAt: null,
        },
      });

      console.log(`[TASK_CLEANUP] Successfully cleaned up task ${taskId}`);
    } catch (error) {
      console.error(`[TASK_CLEANUP] Failed to cleanup task ${taskId}:`, error);
      
      // Clear the cleanup schedule even if cleanup failed to prevent infinite retries
      // The task will remain in COMPLETED state but won't be retried
      await prisma.task.update({
        where: { id: taskId },
        data: {
          scheduledCleanupAt: null,
        },
      }).catch((updateError) => {
        console.error(`[TASK_CLEANUP] Failed to clear cleanup schedule for task ${taskId}:`, updateError);
      });
    }
  }
}

// Singleton instance
export const taskCleanupService = new TaskCleanupService();