import { InitStatus, prisma } from "@repo/db";
import { getStepsForMode, InitializationProgress } from "@repo/types";
import { emitStreamChunk } from "../socket";
import { createWorkspaceManager, getAgentMode } from "../execution";
import type { WorkspaceManager as AbstractWorkspaceManager } from "../execution";
import {
  setVariantInitStatus,
  setVariantFailed,
  clearVariantProgress,
  setVariantInitialized,
} from "../utils/variant-status";
import { BackgroundServiceManager } from "./background-service-manager";
import { TaskModelContext } from "../services/task-model-context";

// Helper for async delays
const delay = (ms: number) =>
  new Promise((resolve) => global.setTimeout(resolve, ms));

export class TaskInitializationEngine {
  private abstractWorkspaceManager: AbstractWorkspaceManager;
  private backgroundServiceManager: BackgroundServiceManager;

  constructor() {
    this.abstractWorkspaceManager = createWorkspaceManager(); // Abstraction layer for all modes
    this.backgroundServiceManager = new BackgroundServiceManager();
  }

  /**
   * Initialize a variant with the specified steps
   */
  async initializeTask(
    variantId: string,
    steps: InitStatus[] = ["PREPARE_WORKSPACE"],
    userId: string,
    context: TaskModelContext
  ): Promise<void> {
    try {
      // Clear any previous progress and start fresh
      await clearVariantProgress(variantId);

      // Get variant info including task
      const variant = await prisma.variant.findUnique({
        where: { id: variantId },
        include: { task: true },
      });

      if (!variant) {
        throw new Error(`Variant ${variantId} not found`);
      }

      // Emit start event
      this.emitProgress(variant.taskId, {
        type: "init-start",
        taskId: variant.taskId,
        variantId,
      });

      // Execute each step in sequence
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (!step) continue; // Skip undefined steps
        const stepNumber = i + 1;

        try {
          // Set step as in progress
          await setVariantInitStatus(variantId, step);

          // Emit step start
          this.emitProgress(variant.taskId, {
            type: "step-start",
            taskId: variant.taskId,
            variantId,
            currentStep: step,
          });

          // Execute the step
          await this.executeStep(variantId, step, userId, context);

          // Mark step as completed
          await setVariantInitStatus(variantId, step);
        } catch (error) {
          console.error(
            `[VARIANT_INIT] ${variantId}: Failed at step ${stepNumber}/${steps.length}: ${step}:`,
            error
          );

          // Mark as failed with error details
          await setVariantFailed(
            variantId,
            step,
            error instanceof Error ? error.message : "Unknown error"
          );

          // Emit error
          this.emitProgress(variant.taskId, {
            type: "init-error",
            taskId: variant.taskId,
            variantId,
            currentStep: step,
            error: error instanceof Error ? error.message : "Unknown error",
          });

          throw error;
        }
      }

      // All steps completed successfully - set to ACTIVE
      await setVariantInitStatus(variantId, "ACTIVE");
      // Mark variant as having been initialized for the first time
      await setVariantInitialized(variantId);

      console.log(`✅ [VARIANT_INIT] ${variantId}: Ready for RUNNING status`);

      // Emit completion
      this.emitProgress(variant.taskId, {
        type: "init-complete",
        taskId: variant.taskId,
        variantId,
      });
    } catch (error) {
      console.error(`[VARIANT_INIT] ${variantId}: Initialization failed:`, error);
      throw error;
    }
  }


  /**
   * Execute a specific initialization step for a variant
   */
  private async executeStep(
    variantId: string,
    step: InitStatus,
    userId: string,
    context: TaskModelContext
  ): Promise<void> {
    const variant = await prisma.variant.findUnique({
      where: { id: variantId },
      include: { task: true },
    });

    if (!variant) {
      throw new Error(`Variant ${variantId} not found`);
    }

    switch (step) {
      case "PREPARE_WORKSPACE":
        await this.executePrepareWorkspace(variantId, userId);
        break;

      case "CREATE_VM":
        await this.executeCreateVM(variantId, userId);
        break;

      case "WAIT_VM_READY":
        await this.executeWaitVMReady(variantId);
        break;

      case "VERIFY_VM_WORKSPACE":
        await this.executeVerifyVMWorkspace(variantId, userId);
        break;

      case "START_BACKGROUND_SERVICES":
        await this.executeStartBackgroundServices(variantId, userId, context);
        break;

      case "INSTALL_DEPENDENCIES":
        await this.executeInstallDependencies(variantId);
        break;

      case "COMPLETE_SHADOW_WIKI":
        await this.executeCompleteShadowWiki(variantId);
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
   * Execute a specific initialization step for a task (legacy method)
   */
  private async executeStep(
    taskId: string,
    step: InitStatus,
    userId: string,
    context: TaskModelContext
  ): Promise<void> {
    switch (step) {
      case "PREPARE_WORKSPACE":
        await this.executePrepareWorkspace(taskId, userId);
        break;

      case "CREATE_VM":
        await this.executeCreateVM(taskId, userId);
        break;

      case "WAIT_VM_READY":
        await this.executeWaitVMReady(taskId);
        break;

      case "VERIFY_VM_WORKSPACE":
        await this.executeVerifyVMWorkspace(taskId, userId);
        break;

      case "START_BACKGROUND_SERVICES":
        await this.executeStartBackgroundServices(taskId, userId, context);
        break;

      case "INSTALL_DEPENDENCIES":
        await this.executeInstallDependencies(taskId);
        break;

      case "COMPLETE_SHADOW_WIKI":
        await this.executeCompleteShadowWiki(taskId);
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
    variantId: string,
    userId: string
  ): Promise<void> {
    const agentMode = getAgentMode();
    if (agentMode !== "local") {
      throw new Error(
        `PREPARE_WORKSPACE step should only be used in local mode, but agent mode is: ${agentMode}`
      );
    }

    // Get variant and task info
    const variant = await prisma.variant.findUnique({
      where: { id: variantId },
      include: { task: true },
    });

    if (!variant) {
      throw new Error(`Variant ${variantId} not found`);
    }

    const task = variant.task;

    // Use workspace manager to prepare local workspace and clone repo
    const workspaceResult =
      await this.abstractWorkspaceManager.prepareWorkspace({
        id: variantId, // Use variant ID for unique workspace
        repoFullName: task.repoFullName,
        repoUrl: task.repoUrl,
        baseBranch: task.baseBranch || "main",
        shadowBranch: variant.shadowBranch,
        userId,
      });

    if (!workspaceResult.success) {
      throw new Error(
        workspaceResult.error || "Failed to prepare local workspace"
      );
    }

    // Update variant with workspace path
    await prisma.variant.update({
      where: { id: variantId },
      data: { workspacePath: workspaceResult.workspacePath },
    });
  }


  /**
   * Create VM step - remote mode only
   * Creates remote VM pod (VM startup script handles repository cloning)
   */
  private async executeCreateVM(variantId: string, userId: string): Promise<void> {
    const agentMode = getAgentMode();
    if (agentMode !== "remote") {
      throw new Error(
        `CREATE_VM step should only be used in remote mode, but agent mode is: ${agentMode}`
      );
    }

    try {
      // Get variant and task info
      const variant = await prisma.variant.findUnique({
        where: { id: variantId },
        include: { task: true },
      });

      if (!variant) {
        throw new Error(`Variant not found: ${variantId}`);
      }

      const task = variant.task;

      const workspaceInfo =
        await this.abstractWorkspaceManager.prepareWorkspace({
          id: variantId, // Use variant ID for unique VM
          repoFullName: task.repoFullName,
          repoUrl: task.repoUrl,
          baseBranch: task.baseBranch || "main",
          shadowBranch: variant.shadowBranch,
          userId,
        });

      if (!workspaceInfo.success) {
        throw new Error(`Failed to create VM: ${workspaceInfo.error}`);
      }

      if (workspaceInfo.podName && workspaceInfo.podNamespace) {
        await prisma.taskSession.create({
          data: {
            variantId,
            podName: workspaceInfo.podName,
            podNamespace: workspaceInfo.podNamespace,
            isActive: true,
          },
        });
      }

      await prisma.variant.update({
        where: { id: variantId },
        data: {
          workspacePath: workspaceInfo.workspacePath,
        },
      });
    } catch (error) {
      console.error(`[VARIANT_INIT] ${variantId}: Failed to create VM:`, error);
      throw error;
    }
  }


  /**
   * Wait for VM ready step - Wait for VM boot and sidecar API to become healthy
   */
  private async executeWaitVMReady(variantId: string): Promise<void> {
    try {
      const executor = await this.abstractWorkspaceManager.getExecutor(variantId);

      // Wait for both sidecar to be healthy AND repository to be cloned
      const maxRetries = 5;
      const retryDelay = 2000;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Test sidecar connectivity AND verify workspace has content
          const listing = await executor.listDirectory(".");

          if (
            listing.success &&
            listing.contents &&
            listing.contents.length > 0
          ) {
            return;
          } else {
            throw new Error(
              `Sidecar responding but workspace appears empty. Response: ${JSON.stringify(listing)}`
            );
          }
        } catch (error) {
          if (attempt === maxRetries) {
            throw new Error(
              `Sidecar/clone failed to become ready after ${maxRetries} attempts: ${error}`
            );
          }
          await delay(retryDelay);
        }
      }
    } catch (error) {
      console.error(
        `[VARIANT_INIT] ${variantId}: Failed waiting for sidecar and clone:`,
        error
      );
      throw error;
    }
  }

  // Implementation methods for other steps
  private async executeVerifyVMWorkspace(variantId: string, userId: string): Promise<void> {
    // Similar to existing executeVerifyVMWorkspace but uses variantId
    const executor = await this.abstractWorkspaceManager.getExecutor(variantId);
    const listing = await executor.listDirectory(".");
    if (!listing.success || !listing.contents || listing.contents.length === 0) {
      throw new Error("Workspace verification failed - workspace appears empty");
    }
  }

  private async executeInstallDependencies(variantId: string): Promise<void> {
    // Similar to existing executeInstallDependencies but uses variantId
    const executor = await this.abstractWorkspaceManager.getExecutor(variantId);
    // Implementation details would be the same...
  }

  private async executeStartBackgroundServices(variantId: string, userId: string, context: TaskModelContext): Promise<void> {
    // Similar to existing executeStartBackgroundServices but uses variantId
    const userSettings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { enableShadowWiki: true, enableIndexing: true },
    });
    // Implementation details would be the same...
  }

  private async executeCompleteShadowWiki(variantId: string): Promise<void> {
    // Similar to existing executeCompleteShadowWiki but uses variantId
    // Implementation details would be the same...
  }


  /**
   * Verify VM workspace step - Verify workspace is ready and contains repository
   */
  private async executeVerifyVMWorkspace(
    taskId: string,
    _userId: string
  ): Promise<void> {
    try {
      // Get task info
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { repoUrl: true, baseBranch: true },
      });

      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      const executor = await this.abstractWorkspaceManager.getExecutor(taskId);

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
    } catch (error) {
      console.error(
        `[TASK_INIT] ${taskId}: Failed to verify workspace:`,
        error
      );
      throw error;
    }
  }

  /**
   * Install dependencies step - Install project dependencies (npm, pip, etc.)
   */
  private async executeInstallDependencies(taskId: string): Promise<void> {
    try {
      // Get the executor for this task
      const executor = await this.abstractWorkspaceManager.getExecutor(taskId);

      // Check for package.json and install Node.js dependencies with appropriate package manager
      const packageJsonExists = await this.checkFileExists(
        executor,
        "package.json"
      );
      if (packageJsonExists) {
        // Determine which package manager to use based on lockfiles
        const yarnLockExists = await this.checkFileExists(
          executor,
          "yarn.lock"
        );
        const pnpmLockExists = await this.checkFileExists(
          executor,
          "pnpm-lock.yaml"
        );
        const bunLockExists = await this.checkFileExists(executor, "bun.lockb");

        if (bunLockExists) {
          await this.runInstallCommand(executor, taskId, "bun install");
        } else if (pnpmLockExists) {
          await this.runInstallCommand(executor, taskId, "pnpm install");
        } else if (yarnLockExists) {
          await this.runInstallCommand(executor, taskId, "yarn install");
        } else {
          await this.runInstallCommand(executor, taskId, "npm install");
        }
      }

      // Check for requirements.txt and install Python dependencies
      const requirementsExists = await this.checkFileExists(
        executor,
        "requirements.txt"
      );
      if (requirementsExists) {
        await this.runInstallCommand(
          executor,
          taskId,
          "pip install -r requirements.txt"
        );
      }

      // Check for pyproject.toml and install Python project
      const pyprojectExists = await this.checkFileExists(
        executor,
        "pyproject.toml"
      );
      if (pyprojectExists) {
        await this.runInstallCommand(executor, taskId, "pip install -e .");
      }
    } catch (error) {
      console.error(
        `[TASK_INIT] ${taskId}: Dependency installation failed:`,
        error
      );
      // Don't throw error - we want to continue initialization even if deps fail
    }
  }

  /**
   * Helper method to check if a file exists in the workspace
   */
  private async checkFileExists(
    executor: any,
    filename: string
  ): Promise<boolean> {
    try {
      const result = await executor.listDirectory(".");
      return (
        result.success &&
        result.contents?.some(
          (item: any) => item.name === filename && item.type === "file"
        )
      );
    } catch (error) {
      console.warn(`Failed to check for ${filename}:`, error);
      return false;
    }
  }

  /**
   * Helper method to run installation commands with proper error handling
   */
  private async runInstallCommand(
    executor: any,
    taskId: string,
    command: string
  ): Promise<void> {
    try {
      const result = await executor.executeCommand(command, {
        timeout: 300000, // 5 minutes timeout
        allowNetworkAccess: true,
      });

      if (!result.success) {
        console.warn(`[TASK_INIT] ${taskId}: Command failed: ${command}`);
        console.warn(
          `[TASK_INIT] ${taskId}: Error: ${result.error || result.stderr}`
        );
      }
    } catch (error) {
      console.warn(
        `[TASK_INIT] ${taskId}: Exception running command "${command}":`,
        error
      );
    }
  }

  /**
   * Start background services step - Start Shadow Wiki generation and indexing in parallel
   */
  private async executeStartBackgroundServices(
    taskId: string,
    userId: string,
    context: TaskModelContext
  ): Promise<void> {
    try {
      // Get user settings to determine which services to start
      const userSettings = await prisma.userSettings.findUnique({
        where: { userId },
        select: { enableShadowWiki: true, enableIndexing: true },
      });

      const enableShadowWiki = userSettings?.enableShadowWiki ?? true;
      const enableIndexing = userSettings?.enableIndexing ?? false;

      // Start background services using the manager
      await this.backgroundServiceManager.startServices(
        taskId,
        { enableShadowWiki, enableIndexing },
        context
      );
    } catch (error) {
      console.error(
        `[TASK_INIT] ${taskId}: Failed to start background services:`,
        error
      );
      // Don't throw error - we want to continue initialization even if background services fail to start
    }
  }

  /**
   * Complete Shadow Wiki step - Wait for background services to complete
   */
  private async executeCompleteShadowWiki(taskId: string): Promise<void> {
    try {
      const maxWait = 10 * 60 * 1000; // 10 minutes max
      const checkInterval = 2000; // Check every 2 seconds
      const startTime = Date.now();

      // Monitor progress and wait for completion
      while (Date.now() - startTime < maxWait) {
        // Check if all services are done
        const allComplete =
          this.backgroundServiceManager.areAllServicesComplete(taskId);

        if (allComplete) {
          break;
        }

        await delay(checkInterval);
      }
    } catch (error) {
      console.error(
        `[TASK_INIT] ${taskId}: Failed to complete Shadow Wiki:`,
        error
      );
      // Don't throw error - we want to continue to ACTIVE even if background services had issues
    }
  }

  /**
   * Emit progress events via WebSocket
   */
  private emitProgress(taskId: string, progress: InitializationProgress & { variantId?: string }): void {
    emitStreamChunk(
      {
        type: "init-progress",
        initProgress: progress,
      },
      taskId
    );
  }

  /**
   * Get default initialization steps based on agent mode
   * Background services are now handled separately and run in parallel
   */
  async getDefaultStepsForTask(): Promise<InitStatus[]> {
    const agentMode = getAgentMode();
    return getStepsForMode(agentMode);
  }
}
