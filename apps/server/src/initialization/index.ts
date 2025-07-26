import { InitializationStatus, InitStepType, prisma } from "@repo/db";
import {
  InitializationProgress,
} from "@repo/types";
import { emitStreamChunk } from "../socket";
import { createWorkspaceManager, createToolExecutor, getAgentMode } from "../execution";
import type { WorkspaceManager as AbstractWorkspaceManager } from "../execution";

// Helper for async delays
const delay = (ms: number) =>
  new Promise((resolve) => global.setTimeout(resolve, ms));

// Step definitions with human-readable names
const STEP_DEFINITIONS: Record<
  InitStepType,
  { name: string; description: string }
> = {
  CLONE_REPOSITORY: {
    name: "Cloning Repository",
    description: "Clone the specified GitHub repository",
  },
  PROVISION_MICROVM: {
    name: "Provisioning Environment",
    description: "Set up isolated microVM environment",
  },
  SETUP_ENVIRONMENT: {
    name: "Setting up Environment",
    description: "Configure development environment",
  },
  INSTALL_DEPENDENCIES: {
    name: "Installing Dependencies",
    description: "Install project dependencies",
  },
  CONFIGURE_TOOLS: {
    name: "Configuring Tools",
    description: "Set up development tools and configurations",
  },
  VALIDATE_SETUP: {
    name: "Validating Setup",
    description: "Verify environment is ready for development",
  },
  // Remote mode specific steps
  CREATE_POD: {
    name: "Creating Pod",
    description: "Create Kubernetes pod for task execution",
  },
  WAIT_SIDECAR_READY: {
    name: "Waiting for Sidecar",
    description: "Wait for sidecar service to become ready",
  },
  VERIFY_WORKSPACE: {
    name: "Verifying Workspace",
    description: "Verify workspace is ready and contains repository",
  },
  CLEANUP_POD: {
    name: "Cleaning up Pod",
    description: "Destroy Kubernetes pod and cleanup resources",
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
    steps: InitStepType[] = ["CLONE_REPOSITORY"],
    userId: string
  ): Promise<void> {
    console.log(
      `[TASK_INIT] Starting initialization for task ${taskId} with steps: ${steps.join(", ")}`
    );

    try {
      // Set overall status to in progress
      await this.updateTaskInit(taskId, "IN_PROGRESS", null);

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
          // Update current step
          await this.updateTaskInit(taskId, "IN_PROGRESS", step);

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
          await this.executeStep(taskId, step, userId);

          console.log(
            `[TASK_INIT] ${taskId}: Completed step ${stepNumber}/${steps.length}: ${step}`
          );
        } catch (error) {
          console.error(
            `[TASK_INIT] ${taskId}: Failed at step ${stepNumber}/${steps.length}: ${step}:`,
            error
          );

          // Mark as failed
          await this.updateTaskInit(taskId, "FAILED", step);

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

      // All steps completed successfully
      await this.updateTaskInit(taskId, "COMPLETED", null);

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
    step: InitStepType,
    userId: string
  ): Promise<void> {
    switch (step) {
      case "CLONE_REPOSITORY":
        await this.executeCloneRepository(taskId, userId);
        break;

      case "PROVISION_MICROVM":
        await this.executeProvisionMicroVM(taskId);
        break;

      case "SETUP_ENVIRONMENT":
        await this.executeSetupEnvironment(taskId);
        break;

      case "INSTALL_DEPENDENCIES":
        await this.executeInstallDependencies(taskId);
        break;

      case "CONFIGURE_TOOLS":
        await this.executeConfigureTools(taskId);
        break;

      case "VALIDATE_SETUP":
        await this.executeValidateSetup(taskId);
        break;

      // Remote mode specific steps
      case "CREATE_POD":
        await this.executeCreatePod(taskId, userId);
        break;

      case "WAIT_SIDECAR_READY":
        await this.executeWaitSidecarReady(taskId);
        break;

      case "VERIFY_WORKSPACE":
        await this.executeVerifyWorkspace(taskId, userId);
        break;

      case "CLEANUP_POD":
        await this.executeCleanupPod(taskId);
        break;

      default:
        throw new Error(`Unknown initialization step: ${step}`);
    }
  }

  /**
   * Clone repository step
   */
  private async executeCloneRepository(
    taskId: string,
    userId: string
  ): Promise<void> {
    // Get task info
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { repoUrl: true, baseBranch: true, shadowBranch: true },
    });

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const workspaceResult = await this.abstractWorkspaceManager.prepareWorkspace({
      id: taskId,
      repoUrl: task.repoUrl,
      baseBranch: task.baseBranch || 'main',
      shadowBranch: task.shadowBranch || `shadow/task-${taskId}`,
      userId,
    });

    if (!workspaceResult.success) {
      throw new Error(workspaceResult.error || "Failed to clone repository");
    }

    // Update task with workspace info
    await prisma.task.update({
      where: { id: taskId },
      data: {
        workspacePath: workspaceResult.workspacePath,
      },
    });
  }

  /**
   * Provision microVM step (placeholder for future implementation)
   */
  private async executeProvisionMicroVM(taskId: string): Promise<void> {
    // Placeholder - would provision microVM in the future
    console.log(
      `[TASK_INIT] ${taskId}: MicroVM provisioning not yet implemented`
    );

    // Simulate some work
    await delay(1000);
  }

  /**
   * Setup environment step (placeholder)
   */
  private async executeSetupEnvironment(taskId: string): Promise<void> {
    // Placeholder - would set up development environment
    console.log(`[TASK_INIT] ${taskId}: Environment setup not yet implemented`);

    // Simulate some work
    await delay(500);
  }

  /**
   * Install dependencies step (placeholder)
   */
  private async executeInstallDependencies(taskId: string): Promise<void> {
    // Placeholder - would install npm/pip/etc dependencies
    console.log(
      `[TASK_INIT] ${taskId}: Dependency installation not yet implemented`
    );

    // Simulate some work
    await delay(1500);
  }

  /**
   * Configure tools step (placeholder)
   */
  private async executeConfigureTools(taskId: string): Promise<void> {
    // Placeholder - would configure linters, formatters, etc
    console.log(
      `[TASK_INIT] ${taskId}: Tool configuration not yet implemented`
    );

    // Simulate some work
    await delay(500);
  }

  /**
   * Validate setup step (placeholder)
   */
  private async executeValidateSetup(taskId: string): Promise<void> {
    // Placeholder - would validate that everything is working
    console.log(`[TASK_INIT] ${taskId}: Setup validation not yet implemented`);

    // Simulate some work
    await delay(300);
  }

  /**
   * Create pod step - Create Kubernetes pod for remote execution
   */
  private async executeCreatePod(taskId: string, userId: string): Promise<void> {
    console.log(`[TASK_INIT] ${taskId}: Creating Kubernetes pod for remote execution`);

    try {
      // Get task info
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { repoUrl: true, baseBranch: true, shadowBranch: true },
      });

      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      // Use abstract workspace manager to prepare workspace (creates pod in remote mode)
      const workspaceInfo = await this.abstractWorkspaceManager.prepareWorkspace({
        id: taskId,
        repoUrl: task.repoUrl,
        baseBranch: task.baseBranch || 'main',
        shadowBranch: task.shadowBranch || `shadow/task-${taskId}`,
        userId,
      });

      if (!workspaceInfo.success) {
        throw new Error(`Failed to create pod: ${workspaceInfo.error}`);
      }

      // Create or update TaskSession with pod information
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

      // Update task with workspace path (CRITICAL FIX)
      await prisma.task.update({
        where: { id: taskId },
        data: {
          workspacePath: workspaceInfo.workspacePath,
        },
      });

      console.log(`[TASK_INIT] ${taskId}: Successfully created pod ${workspaceInfo.podName}`);
    } catch (error) {
      console.error(`[TASK_INIT] ${taskId}: Failed to create pod:`, error);
      throw error;
    }
  }

  /**
   * Wait for sidecar ready step - Wait for sidecar API to become healthy and repository to be cloned
   */
  private async executeWaitSidecarReady(taskId: string): Promise<void> {
    console.log(`[TASK_INIT] ${taskId}: Waiting for sidecar service and repository clone to complete`);

    try {
      // Get the tool executor for this task (will contain sidecar endpoint info)
      const executor = createToolExecutor(taskId);

      // Wait for both sidecar to be healthy AND repository to be cloned
      const maxRetries = 30; // 30 * 2s = 60s timeout
      const retryDelay = 2000; // 2 seconds between retries

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Test sidecar connectivity AND verify workspace has content
          const listing = await executor.listDirectory(".");

          // Check that both sidecar is responding AND workspace has content
          if (listing.success && listing.contents && listing.contents.length > 0) {
            console.log(`[TASK_INIT] ${taskId}: Sidecar ready and repository cloned (attempt ${attempt})`);
            return;
          } else {
            throw new Error("Sidecar responding but workspace appears empty");
          }
        } catch (error) {
          if (attempt === maxRetries) {
            throw new Error(`Sidecar/clone failed to become ready after ${maxRetries} attempts: ${error}`);
          }
          console.log(`[TASK_INIT] ${taskId}: Sidecar or clone not ready yet (attempt ${attempt}/${maxRetries}), retrying...`);
          await delay(retryDelay);
        }
      }
    } catch (error) {
      console.error(`[TASK_INIT] ${taskId}: Failed waiting for sidecar and clone:`, error);
      throw error;
    }
  }

  /**
   * Verify workspace step - Verify workspace is ready and contains repository
   */
  private async executeVerifyWorkspace(taskId: string, _userId: string): Promise<void> {
    console.log(`[TASK_INIT] ${taskId}: Verifying workspace is ready and contains repository`);

    try {
      // Get task info
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { repoUrl: true, baseBranch: true },
      });

      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      // Get the tool executor for remote operations
      const executor = createToolExecutor(taskId);

      // Final verification that workspace is fully ready with repository content
      console.log(`[TASK_INIT] ${taskId}: Performing final workspace verification`);

      // Verify the workspace is ready by checking contents
      const listing = await executor.listDirectory(".");
      if (!listing.success || !listing.contents || listing.contents.length === 0) {
        throw new Error("Workspace verification failed - workspace appears empty");
      }

      console.log(`[TASK_INIT] ${taskId}: Successfully verified workspace is ready with repository content`);
    } catch (error) {
      console.error(`[TASK_INIT] ${taskId}: Failed to verify workspace:`, error);
      throw error;
    }
  }

  /**
   * Cleanup pod step - Destroy Kubernetes pod and cleanup resources
   */
  private async executeCleanupPod(taskId: string): Promise<void> {
    console.log(`[TASK_INIT] ${taskId}: Cleaning up Kubernetes pod`);

    try {
      // Cleanup through abstract workspace manager
      await this.abstractWorkspaceManager.cleanupWorkspace(taskId);

      // Update TaskSession to mark as inactive
      await prisma.taskSession.updateMany({
        where: { taskId, isActive: true },
        data: {
          isActive: false,
          endedAt: new Date(),
        },
      });

      console.log(`[TASK_INIT] ${taskId}: Successfully cleaned up pod`);
    } catch (error) {
      console.error(`[TASK_INIT] ${taskId}: Failed to cleanup pod:`, error);
      // Don't throw error for cleanup failures, just log them
      // We don't want cleanup failures to break the overall flow
    }
  }

  /**
   * Update task initialization status in database
   */
  private async updateTaskInit(
    taskId: string,
    status: InitializationStatus,
    step: InitStepType | null
  ): Promise<void> {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        initializationStatus: status,
        currentInitStep: step,
      },
    });
  }

  /**
   * Emit progress events via WebSocket
   */
  private emitProgress(_taskId: string, progress: InitializationProgress): void {
    emitStreamChunk({
      type: "init-progress",
      initProgress: progress,
    });
  }

  /**
   * Get default initialization steps based on agent mode and task type
   */
  getDefaultStepsForTask(
    taskType: "simple" | "microvm" | "full" = "simple"
  ): InitStepType[] {
    const agentMode = getAgentMode();

    if (agentMode === "remote") {
      // Remote mode uses pod-based execution
      switch (taskType) {
        case "simple":
          return ["CREATE_POD", "WAIT_SIDECAR_READY", "VERIFY_WORKSPACE"];

        case "microvm":
          return [
            "CREATE_POD",
            "WAIT_SIDECAR_READY",
            "VERIFY_WORKSPACE",
            "SETUP_ENVIRONMENT"
          ];

        case "full":
          return [
            "CREATE_POD",
            "WAIT_SIDECAR_READY",
            "VERIFY_WORKSPACE",
            "SETUP_ENVIRONMENT",
            "INSTALL_DEPENDENCIES",
            "CONFIGURE_TOOLS",
            "VALIDATE_SETUP",
          ];

        default:
          return ["CREATE_POD", "WAIT_SIDECAR_READY", "VERIFY_WORKSPACE"];
      }
    } else {
      // Local/mock mode uses traditional local execution
      switch (taskType) {
        case "simple":
          return ["CLONE_REPOSITORY"];

        case "microvm":
          return ["CLONE_REPOSITORY", "PROVISION_MICROVM", "SETUP_ENVIRONMENT"];

        case "full":
          return [
            "CLONE_REPOSITORY",
            "PROVISION_MICROVM",
            "SETUP_ENVIRONMENT",
            "INSTALL_DEPENDENCIES",
            "CONFIGURE_TOOLS",
            "VALIDATE_SETUP",
          ];

        default:
          return ["CLONE_REPOSITORY"];
      }
    }
  }

  /**
   * Get cleanup steps for task completion
   */
  getCleanupSteps(): InitStepType[] {
    const agentMode = getAgentMode();

    if (agentMode === "remote") {
      return ["CLEANUP_POD"];
    } else {
      return []; // Local mode cleanup is handled automatically
    }
  }
}
