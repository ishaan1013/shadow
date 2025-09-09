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
  private services = new Map<string, BackgroundService[]>(); // taskId -> services

  async startServices(
    taskId: string,
    userSettings: { enableShadowWiki?: boolean; enableIndexing?: boolean },
    context: TaskModelContext
  ): Promise<void> {
    const services: BackgroundService[] = [];

    if (userSettings.enableShadowWiki) {
      const shadowWikiPromise = this.startShadowWiki(taskId, context);

      const service = {
        name: "shadowWiki" as const,
        promise: shadowWikiPromise,
        started: true,
        completed: false,
        failed: false,
        blocking: true, // Shadow Wiki blocks initialization
        error: undefined as string | undefined,
      };

      // Wrap the promise to update completion status when it resolves
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

      services.push(service);
    }

    if (userSettings.enableIndexing) {
      const indexingPromise = this.startIndexing(taskId);

      const service = {
        name: "indexing" as const,
        promise: indexingPromise,
        started: true,
        completed: false,
        failed: false,
        blocking: false, // Indexing runs in background, doesn't block initialization
        error: undefined as string | undefined,
      };

      // Wrap the promise to update completion status when it resolves
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

      services.push(service);
    }

    this.services.set(taskId, services);
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

      const workspacePath = task.variants[0]?.workspacePath;
      if (!workspacePath) {
        throw new Error(`Workspace path not found for task: ${taskId}`);
      }

      // If a summary already exists for this repo, link it and skip generation
      const existingForRepo = await prisma.codebaseUnderstanding.findUnique({
        where: { repoFullName: task.repoFullName },
        select: { id: true },
      });

      if (existingForRepo) {
        if (!task.codebaseUnderstandingId) {
          await prisma.task.update({
            where: { id: taskId },
            data: { codebaseUnderstandingId: existingForRepo.id },
          });
        }
        console.log(
          `[SHADOW-WIKI] Skipping generation for ${task.repoFullName} (summary already exists)`
        );
        return;
      }

      console.log(
        `[SHADOW-WIKI] Task details - Repo: ${task.repoFullName}, Workspace: ${workspacePath}`
      );
      console.log(
        `[SHADOW-WIKI] Using model: ${context.getMainModel()} for analysis`
      );

      // Generate Shadow Wiki documentation
      // Note: runShadowWiki handles duplicate detection and task linking internally

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
    const services = this.services.get(taskId) || [];
    const blockingServices = services.filter((s) => s.blocking);

    if (blockingServices.length === 0) {
      return true;
    }

    // Only check blocking services for completion
    return blockingServices.every(
      (service) => service.completed || service.failed
    );
  }
}
