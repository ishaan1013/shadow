import { prisma } from "@repo/db";
import { TaskModelContext } from "../services/task-model-context";
import { runShadowWiki } from "../indexing/shadowwiki/core";
import { startBackgroundIndexing } from "./background-indexing";

interface BackgroundService {
  name: "shadowWiki" | "indexing";
  promise: Promise<void>;
  started: boolean;
  completed: boolean;
  failed: boolean;
  blocking: boolean; // Whether this service blocks initialization completion
  error?: string;
}

/**
 * BackgroundServiceManager extends the existing background indexing infrastructure
 * to handle both Shadow Wiki and indexing as parallel background services
 */
export class BackgroundServiceManager {
  // taskId -> serviceName -> service state
  private services = new Map<string, Map<string, BackgroundService>>();

  async startServices(
    taskId: string,
    userSettings: { enableShadowWiki?: boolean; enableIndexing?: boolean },
    context: TaskModelContext
  ): Promise<void> {
    // Initialize map for task if missing
    if (!this.services.has(taskId)) {
      this.services.set(taskId, new Map());
    }
    const serviceMap = this.services.get(taskId)!;

    if (userSettings.enableShadowWiki && !serviceMap.has("shadowWiki")) {
      const shadowWikiPromise = this.startShadowWiki(taskId, context);
      const service: BackgroundService = {
        name: "shadowWiki",
        promise: shadowWikiPromise,
        started: true,
        completed: false,
        failed: false,
        blocking: true,
        error: undefined,
      };
      service.promise = service.promise
        .then(() => {
          service.completed = true;
        })
        .catch((error) => {
          service.failed = true;
          service.error =
            error instanceof Error ? error.message : "Unknown error";
          console.error(
            `❌ [BACKGROUND_SERVICES] Service "shadowWiki" marked as failed for task ${taskId}:`,
            error
          );
        });
      serviceMap.set("shadowWiki", service);
    }

    if (userSettings.enableIndexing && !serviceMap.has("indexing")) {
      const indexingPromise = this.startIndexing(taskId);
      const service: BackgroundService = {
        name: "indexing",
        promise: indexingPromise,
        started: true,
        completed: false,
        failed: false,
        blocking: false,
        error: undefined,
      };
      service.promise = service.promise
        .then(() => {
          service.completed = true;
        })
        .catch((error) => {
          service.failed = true;
          service.error =
            error instanceof Error ? error.message : "Unknown error";
          console.error(
            `❌ [BACKGROUND_SERVICES] Service "indexing" marked as failed for task ${taskId}:`,
            error
          );
        });
      serviceMap.set("indexing", service);
    }
  }

  /**
   * Start Shadow Wiki generation in background
   */
  private async startShadowWiki(
    taskId: string,
    context: TaskModelContext
  ): Promise<void> {
    console.log(
      `[SHADOW-WIKI] Starting Shadow Wiki generation for task ${taskId}`
    );

    try {
      // Get task info
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: {
          repoFullName: true,
          repoUrl: true,
          userId: true,
          codebaseUnderstandingId: true,
          variants: {
            select: {
              workspacePath: true,
            },
            take: 1,
          },
        },
      });

      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      // Workspace path is not required for repo-based Shadow Wiki

      // If a summary already exists and is fresh (< 24h), link and skip. Otherwise regenerate.
      const existingForRepo = await prisma.codebaseUnderstanding.findUnique({
        where: { repoFullName: task.repoFullName },
        select: { id: true, updatedAt: true },
      });
      const isStale = existingForRepo
        ? Date.now() - new Date(existingForRepo.updatedAt).getTime() >
          24 * 60 * 60 * 1000
        : true;
      if (existingForRepo && !isStale) {
        if (!task.codebaseUnderstandingId) {
          await prisma.task.update({
            where: { id: taskId },
            data: { codebaseUnderstandingId: existingForRepo.id },
          });
        }
        console.log(
          `[SHADOW-WIKI] Using existing fresh summary for ${task.repoFullName}`
        );
        return;
      }

      console.log(`[SHADOW-WIKI] Task details - Repo: ${task.repoFullName}`);
      console.log(
        `[SHADOW-WIKI] Using model: ${context.getMainModel()} for analysis`
      );

      // Generate (or regenerate stale) Shadow Wiki documentation
      await runShadowWiki(
        taskId,
        task.repoFullName,
        task.repoUrl,
        task.userId,
        context,
        {
          concurrency: 12,
          model: context.getMainModel(),
          recursionLimit: 1,
        }
      );

      console.log(
        `✅ [SHADOW-WIKI] Shadow Wiki generation completed successfully for task ${taskId}`
      );
    } catch (error) {
      console.error(
        `❌ [SHADOW-WIKI] Shadow Wiki generation failed for task ${taskId}:`,
        error
      );
      // Don't throw - we want to mark as failed but continue
      throw error;
    }
  }

  private async startIndexing(taskId: string): Promise<void> {
    try {
      // Get task info
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { repoFullName: true },
      });

      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      // Use existing background indexing system
      await startBackgroundIndexing(task.repoFullName, taskId, {
        clearNamespace: true,
        force: false,
      });
    } catch (error) {
      console.error(
        `[BACKGROUND_SERVICES] Failed to start background indexing:`,
        error
      );
      // Don't throw - we want to mark as failed but continue
      throw error;
    }
  }

  areAllServicesComplete(taskId: string): boolean {
    const serviceMap = this.services.get(taskId);
    const services = serviceMap
      ? Array.from(serviceMap.values())
      : ([] as BackgroundService[]);
    const blockingServices = services.filter(
      (s: BackgroundService) => s.blocking
    );

    if (blockingServices.length === 0) {
      return true;
    }

    // Only check blocking services for completion
    const inMemoryDone = blockingServices.every(
      (service: BackgroundService) => service.completed || service.failed
    );

    // Fallback to DB readiness if in-memory services map was lost (e.g., restart)
    return inMemoryDone;
  }
}
