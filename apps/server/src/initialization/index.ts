import { InitStatus, prisma } from "@repo/db";
import {
  getStepsForMode,
  InitializationProgress,
  AvailableModels,
} from "@repo/types";
import { emitStreamChunk } from "../socket";
import { createWorkspaceManager, getAgentMode } from "../execution";
import type { WorkspaceManager as AbstractWorkspaceManager } from "../execution";
import {
  setInitStatus,
  setTaskFailed,
  clearTaskProgress,
} from "../utils/task-status";
import { runDeepWiki } from "../indexing/deepwiki/core";

// Helper for async delays
const delay = (ms: number) =>
  new Promise((resolve) => global.setTimeout(resolve, ms));

// Step definitions with human-readable names
const STEP_DEFINITIONS: Record<
  InitStatus,
  { name: string; description: string }
> = {
  INACTIVE: {
    name: "Not Started",
    description: "Initialization has not started",
  },
  PREPARE_WORKSPACE: {
    name: "Preparing Workspace",
    description: "Create local workspace directory and clone repository",
  },
  CREATE_VM: {
    name: "Creating VM",
    description: "Create remote VM for task execution",
  },
  WAIT_VM_READY: {
    name: "Starting VM",
    description: "Wait for VM boot and sidecar service to become ready",
  },
  VERIFY_VM_WORKSPACE: {
    name: "Verifying Workspace",
    description: "Verify workspace is ready and contains repository",
  },
  INDEX_REPOSITORY: {
    name: "Indexing Repository",
    description: "Index repository files for semantic search",
  },

  // Deep wiki generation step (both modes, optional)
  GENERATE_DEEP_WIKI: {
    name: "Generating Deep Wiki",
    description: "Generate comprehensive codebase documentation",
  },
  ACTIVE: {
    name: "Ready",
    description: "Task is ready for execution",
  },
};

export class TaskInitializationEngine {
  private abstractWorkspaceManager: AbstractWorkspaceManager;

  constructor() {
    this.abstractWorkspaceManager = createWorkspaceManager(); // Abstraction layer for all modes
  }

  /**
   * Initialize a task with the specified steps
   */
  async initializeTask(
    taskId: string,
    steps: InitStatus[] = ["PREPARE_WORKSPACE"],
    userId: string,
    userApiKeys: { openai?: string; anthropic?: string }
  ): Promise<void> {
    console.log(
      `[TASK_INIT] Starting initialization for task ${taskId} with steps: ${steps.join(", ")}`
    );

    try {
      // Clear any previous progress and start fresh
      await clearTaskProgress(taskId);

      // Emit start event
      this.emitProgress(taskId, {
        type: "init-start",
        taskId,
        message: "Starting task initialization...",
        totalSteps: steps.length,
      });

      // Execute each step in sequence
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (!step) continue; // Skip undefined steps
        const stepNumber = i + 1;

        try {
          // Set step as in progress
          await setInitStatus(taskId, step);

          // Emit step start
          this.emitProgress(taskId, {
            type: "step-start",
            taskId,
            currentStep: step,
            stepName: STEP_DEFINITIONS[step].name,
            message: `${STEP_DEFINITIONS[step].name}...`,
            stepNumber,
            totalSteps: steps.length,
          });

          console.log(
            `[TASK_INIT] ${taskId}: Starting step ${stepNumber}/${steps.length}: ${step}`
          );

          // Execute the step
          await this.executeStep(taskId, step, userId, userApiKeys);

          // Mark step as completed
          await setInitStatus(taskId, step);

          console.log(
            `[TASK_INIT] ${taskId}: Completed step ${stepNumber}/${steps.length}: ${step}`
          );
        } catch (error) {
          console.error(
            `[TASK_INIT] ${taskId}: Failed at step ${stepNumber}/${steps.length}: ${step}:`,
            error
          );

          // Mark as failed with error details
          await setTaskFailed(
            taskId,
            step,
            error instanceof Error ? error.message : "Unknown error"
          );

          // Emit error
          this.emitProgress(taskId, {
            type: "init-error",
            taskId,
            currentStep: step,
            stepName: STEP_DEFINITIONS[step].name,
            message: `Failed during ${STEP_DEFINITIONS[step].name}`,
            error: error instanceof Error ? error.message : "Unknown error",
            stepNumber,
            totalSteps: steps.length,
          });

          throw error;
        }
      }

      // All steps completed successfully - set to ACTIVE
      await setInitStatus(taskId, "ACTIVE");

      console.log(
        `[TASK_INIT] ${taskId}: Initialization completed successfully`
      );

      // Emit completion
      this.emitProgress(taskId, {
        type: "init-complete",
        taskId,
        message: "Task initialization completed successfully",
        totalSteps: steps.length,
      });
    } catch (error) {
      console.error(`[TASK_INIT] ${taskId}: Initialization failed:`, error);
      throw error;
    }
  }

  /**
   * Execute a specific initialization step
   */
  private async executeStep(
    taskId: string,
    step: InitStatus,
    userId: string,
    userApiKeys: { openai?: string; anthropic?: string }
  ): Promise<void> {
    switch (step) {
      // Local mode step
      case "PREPARE_WORKSPACE":
        await this.executePrepareWorkspace(taskId, userId);
        break;

      // Remote mode steps
      case "CREATE_VM":
        await this.executeCreateVM(taskId, userId);
        break;

      case "WAIT_VM_READY":
        await this.executeWaitVMReady(taskId);
        break;

      case "VERIFY_VM_WORKSPACE":
        await this.executeVerifyVMWorkspace(taskId, userId);
        break;

      // Repository indexing step (both modes)
      case "INDEX_REPOSITORY":
        // Indexing is handled during deep wiki generation
        break;

      // Deep wiki generation step (both modes, optional)
      case "GENERATE_DEEP_WIKI":
        await this.executeGenerateDeepWiki(taskId, userApiKeys);
        break;

      case "INACTIVE":
      case "ACTIVE":
        // These are state markers, not executable steps
        break;

      default:
        throw new Error(`Unknown initialization step: ${step}`);
    }
  }

  /**
   * Prepare workspace step - local mode only
   * Creates local workspace directory and clones repository
   */
  private async executePrepareWorkspace(
    taskId: string,
    userId: string
  ): Promise<void> {
    const agentMode = getAgentMode();
    if (agentMode !== "local") {
      throw new Error(
        `PREPARE_WORKSPACE step should only be used in local mode, but agent mode is: ${agentMode}`
      );
    }

    console.log(`[TASK_INIT] ${taskId}: Preparing local workspace`);

    // Get task info
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        repoFullName: true,
        repoUrl: true,
        baseBranch: true,
        shadowBranch: true,
      },
    });

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Use workspace manager to prepare local workspace and clone repo
    const workspaceResult =
      await this.abstractWorkspaceManager.prepareWorkspace({
        id: taskId,
        repoFullName: task.repoFullName,
        repoUrl: task.repoUrl,
        baseBranch: task.baseBranch || "main",
        shadowBranch: task.shadowBranch || `shadow/task-${taskId}`,
        userId,
      });

    if (!workspaceResult.success) {
      throw new Error(
        workspaceResult.error || "Failed to prepare local workspace"
      );
    }

    // Update task with workspace path
    await prisma.task.update({
      where: { id: taskId },
      data: { workspacePath: workspaceResult.workspacePath },
    });
  }

  /**
   * Create VM step - remote mode only
   * Creates remote VM pod (VM startup script handles repository cloning)
   */
  private async executeCreateVM(taskId: string, userId: string): Promise<void> {
    const agentMode = getAgentMode();
    if (agentMode !== "remote") {
      throw new Error(
        `CREATE_VM step should only be used in remote mode, but agent mode is: ${agentMode}`
      );
    }

    console.log(`[TASK_INIT] ${taskId}: Creating remote VM for execution`);

    try {
      // Get task info
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: {
          repoFullName: true,
          repoUrl: true,
          baseBranch: true,
          shadowBranch: true,
        },
      });

      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      const workspaceInfo =
        await this.abstractWorkspaceManager.prepareWorkspace({
          id: taskId,
          repoFullName: task.repoFullName,
          repoUrl: task.repoUrl,
          baseBranch: task.baseBranch || "main",
          shadowBranch: task.shadowBranch || `shadow/task-${taskId}`,
          userId,
        });

      if (!workspaceInfo.success) {
        throw new Error(`Failed to create VM: ${workspaceInfo.error}`);
      }

      // Create or update TaskSession with VM information
      if (workspaceInfo.podName && workspaceInfo.podNamespace) {
        await prisma.taskSession.create({
          data: {
            taskId,
            podName: workspaceInfo.podName,
            podNamespace: workspaceInfo.podNamespace,
            isActive: true,
          },
        });
      }

      // Update task with workspace path
      await prisma.task.update({
        where: { id: taskId },
        data: {
          workspacePath: workspaceInfo.workspacePath,
        },
      });

      console.log(
        `[TASK_INIT] ${taskId}: Successfully created VM ${workspaceInfo.podName}`
      );
    } catch (error) {
      console.error(`[TASK_INIT] ${taskId}: Failed to create VM:`, error);
      throw error;
    }
  }

  /**
   * Wait for VM ready step - Wait for VM boot and sidecar API to become healthy
   */
  private async executeWaitVMReady(taskId: string): Promise<void> {
    console.log(
      `[TASK_INIT] ${taskId}: Waiting for sidecar service and repository clone to complete`
    );

    try {
      // Use the workspace manager's getExecutor() method for consistent connectivity
      // This ensures initialization uses the same approach as regular execution
      const executor = await this.abstractWorkspaceManager.getExecutor(taskId);

      // Wait for both sidecar to be healthy AND repository to be cloned
      const maxRetries = 5; // 5 * 2s = 10s timeout (faster for testing)
      const retryDelay = 2000; // 2 seconds between retries

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Test sidecar connectivity AND verify workspace has content
          const listing = await executor.listDirectory(".");

          // Check that both sidecar is responding AND workspace has content
          if (
            listing.success &&
            listing.contents &&
            listing.contents.length > 0
          ) {
            console.log(
              `[TASK_INIT] ${taskId}: Sidecar ready and repository cloned (attempt ${attempt})`
            );
            return;
          } else {
            throw new Error("Sidecar responding but workspace appears empty");
          }
        } catch (error) {
          if (attempt === maxRetries) {
            throw new Error(
              `Sidecar/clone failed to become ready after ${maxRetries} attempts: ${error}`
            );
          }
          console.log(
            `[TASK_INIT] ${taskId}: Sidecar or clone not ready yet (attempt ${attempt}/${maxRetries}), retrying...`
          );
          await delay(retryDelay);
        }
      }
    } catch (error) {
      console.error(
        `[TASK_INIT] ${taskId}: Failed waiting for sidecar and clone:`,
        error
      );
      throw error;
    }
  }

  /**
   * Verify VM workspace step - Verify workspace is ready and contains repository
   */
  private async executeVerifyVMWorkspace(
    taskId: string,
    _userId: string
  ): Promise<void> {
    console.log(
      `[TASK_INIT] ${taskId}: Verifying workspace is ready and contains repository`
    );

    try {
      // Get task info
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { repoUrl: true, baseBranch: true },
      });

      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      // Use the workspace manager's getExecutor() method for consistent connectivity
      // This ensures initialization uses the same approach as regular execution
      const executor = await this.abstractWorkspaceManager.getExecutor(taskId);

      // Final verification that workspace is fully ready with repository content
      console.log(
        `[TASK_INIT] ${taskId}: Performing final workspace verification`
      );

      // Verify the workspace is ready by checking contents
      const listing = await executor.listDirectory(".");
      if (
        !listing.success ||
        !listing.contents ||
        listing.contents.length === 0
      ) {
        throw new Error(
          "Workspace verification failed - workspace appears empty"
        );
      }

      console.log(
        `[TASK_INIT] ${taskId}: Successfully verified workspace is ready with repository content`
      );
    } catch (error) {
      console.error(
        `[TASK_INIT] ${taskId}: Failed to verify workspace:`,
        error
      );
      throw error;
    }
  }

  /**
   * Generate deep wiki step - Generate comprehensive codebase documentation
   */
  private async executeGenerateDeepWiki(
    taskId: string,
    userApiKeys: { openai?: string; anthropic?: string }
  ): Promise<void> {
    console.log(`[TASK_INIT] ${taskId}: Starting deep wiki generation`);

    try {
      // Get task info
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: {
          repoFullName: true,
          repoUrl: true,
          userId: true,
          workspacePath: true,
        },
      });

      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      // Check if deep wiki already exists for this repository
      const existingUnderstanding =
        await prisma.codebaseUnderstanding.findUnique({
          where: { repoFullName: task.repoFullName },
          select: { id: true },
        });

      if (existingUnderstanding) {
        // Link task to existing understanding
        console.log(
          `[TASK_INIT] ${taskId}: Linking to existing deep wiki for ${task.repoFullName} (ID: ${existingUnderstanding.id})`
        );

        await prisma.task.update({
          where: { id: taskId },
          data: { codebaseUnderstandingId: existingUnderstanding.id },
        });

        console.log(
          `[TASK_INIT] ${taskId}: Successfully linked to existing codebase understanding`
        );
        return;
      }

      if (!task.workspacePath) {
        throw new Error(`Workspace path not found for task: ${taskId}`);
      }

      // Generate deep wiki documentation
      console.log(
        `[TASK_INIT] ${taskId}: Generating new deep wiki for ${task.repoFullName}`
      );

      const result = await runDeepWiki(
        task.workspacePath,
        taskId,
        task.repoFullName,
        task.repoUrl,
        task.userId,
        userApiKeys,
        {
          // migrate to better abstraction for userApiKeys
          concurrency: 12,
          model: AvailableModels.GPT_4O,
          modelMini: AvailableModels.GPT_4O_MINI,
        }
      );

      console.log(
        `[TASK_INIT] ${taskId}: Successfully generated deep wiki - ${result.stats.filesProcessed} files, ${result.stats.directoriesProcessed} directories processed`
      );
    } catch (error) {
      console.error(
        `[TASK_INIT] ${taskId}: Failed to generate deep wiki:`,
        error
      );
      throw error;
    }
  }

  /**
   * Emit progress events via WebSocket
   */
  private emitProgress(taskId: string, progress: InitializationProgress): void {
    emitStreamChunk(
      {
        type: "init-progress",
        initProgress: progress,
      },
      taskId
    );
  }

  /**
   * Get default initialization steps based on agent mode and user settings
   */
  async getDefaultStepsForTask(userId: string): Promise<InitStatus[]> {
    const agentMode = getAgentMode();

    // Fetch user settings to determine if deep wiki generation should be enabled
    let enableDeepWiki = true; // Default to true
    try {
      const userSettings = await prisma.userSettings.findUnique({
        where: { userId },
        select: { enableDeepWiki: true },
      });
      enableDeepWiki = userSettings?.enableDeepWiki ?? true;
    } catch (error) {
      console.warn(
        `[TASK_INIT] Failed to fetch user settings for ${userId}, using default enableDeepWiki=true:`,
        error
      );
    }

    return getStepsForMode(agentMode, { enableDeepWiki });
  }
}
