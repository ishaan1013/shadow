import { prisma } from "@repo/db";
import {
  InitStepType,
  InitializationProgress,
  InitializationStatus,
} from "@repo/types";
import { emitStreamChunk } from "../socket";
import { WorkspaceManager } from "../workspace";

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
};

export class TaskInitializationEngine {
  private workspaceManager: WorkspaceManager;

  constructor() {
    this.workspaceManager = new WorkspaceManager();
  }

  /**
   * Initialize a task with the specified steps
   */
  async initializeTask(
    taskId: string,
    steps: InitStepType[] = ["CLONE_REPOSITORY"],
    githubToken?: string
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
          await this.executeStep(taskId, step, githubToken);

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
    githubToken?: string
  ): Promise<void> {
    switch (step) {
      case "CLONE_REPOSITORY":
        await this.executeCloneRepository(taskId, githubToken);
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

      default:
        throw new Error(`Unknown initialization step: ${step}`);
    }
  }

  /**
   * Clone repository step
   */
  private async executeCloneRepository(taskId: string, githubToken?: string): Promise<void> {
    // Get task info
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { repoUrl: true, branch: true },
    });

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (!githubToken) {
      throw new Error(`GitHub token required for repository cloning`);
    }

    // Use existing workspace manager to clone
    const workspaceResult = await this.workspaceManager.prepareTaskWorkspace(
      taskId,
      task.repoUrl,
      task.branch,
      githubToken
    );

    if (!workspaceResult.success) {
      throw new Error(workspaceResult.error || "Failed to clone repository");
    }

    // Update task with workspace info
    await prisma.task.update({
      where: { id: taskId },
      data: {
        workspacePath: workspaceResult.workspacePath,
        commitSha: workspaceResult.cloneResult?.commitSha,
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
  private emitProgress(taskId: string, progress: InitializationProgress): void {
    emitStreamChunk({
      type: "init-progress",
      initProgress: progress,
    });
  }

  /**
   * Get default initialization steps for a task type
   */
  getDefaultStepsForTask(
    taskType: "simple" | "microvm" | "full" = "simple"
  ): InitStepType[] {
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