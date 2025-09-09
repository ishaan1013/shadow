import { GitService } from "../execution/interfaces/git-service";
import { LLMService } from "../agent/llm";
import { PRService } from "../github/pull-requests";
import type { PRMetadata, CreatePROptions } from "../github/types";
import { TaskModelContext } from "./task-model-context";
import { emitToTask } from "../socket";

export class PRManager {
  private prService: PRService;

  constructor(
    private gitService: GitService,
    private llmService: LLMService
  ) {
    this.prService = new PRService();
  }

  /**
   * Create or update PR and save snapshot
   */
  async createPRIfNeeded(
    options: CreatePROptions,
    context: TaskModelContext
  ): Promise<void> {
    try {
      console.log(`[PR_MANAGER] Processing PR for task ${options.taskId}`);

      // Check if there are any uncommitted changes
      const hasChanges = await this.gitService.hasChanges();
      if (hasChanges) {
        console.log(
          `[PR_MANAGER] Uncommitted changes found, skipping PR creation`
        );
        return;
      }

      // Get git metadata
      const commitSha = await this.gitService.getCurrentCommitSha();

      // Check if PR already exists (variant-aware)
      const existingPRNumber = await this.prService.getExistingPRNumber(
        options.variantId
      );

      if (!existingPRNumber) {
        // Create new PR path
        await this.createNewPR(options, commitSha, context);
      } else {
        // Update existing PR path
        await this.updateExistingPR(
          options,
          existingPRNumber,
          commitSha,
          context
        );
      }

      console.log(
        `[PR_MANAGER] Successfully ${existingPRNumber ? "updated" : "created"} PR for task ${options.taskId}`
      );

      // Emit success event with PR data
      await this.emitCompletionEvent(options, existingPRNumber ?? undefined);
    } catch (error) {
      console.error(
        `[PR_MANAGER] Failed to create/update PR for task ${options.taskId}:`,
        error
      );

      // Emit failure event
      emitToTask(options.taskId, "auto-pr-status", {
        taskId: options.taskId,
        messageId: options.messageId,
        status: "failed" as const,
        error:
          error instanceof Error
            ? error.message
            : "Failed to create pull request",
      });

      // Don't throw - PR creation is non-blocking
    }
  }

  /**
   * Create a new PR and save snapshot
   */
  private async createNewPR(
    options: CreatePROptions,
    commitSha: string,
    context: TaskModelContext
  ): Promise<void> {
    // Generate PR metadata with AI using mini model for cost optimization
    const metadata = await this.generatePRMetadata(options, context);

    // Use PR service to create the PR
    const result = await this.prService.createPR(options, metadata, commitSha);

    if (!result.success) {
      throw new Error(`Failed to create PR: ${result.error}`);
    }
  }

  /**
   * Update existing PR and save snapshot
   */
  private async updateExistingPR(
    options: CreatePROptions,
    prNumber: number,
    commitSha: string,
    context: TaskModelContext
  ): Promise<void> {
    // Get current PR description from most recent snapshot
    const latestSnapshot = await this.prService.getLatestSnapshot(
      options.taskId
    );

    if (!latestSnapshot) {
      console.warn(
        `[PR_MANAGER] No previous snapshot found for task ${options.taskId}, creating new description`
      );
    }

    // Generate updated description using AI with mini model
    const newDescription = await this.generateUpdatedDescription(
      latestSnapshot?.description || "",
      await this.gitService.getDiffAgainstBase(options.baseBranch),
      options.taskTitle,
      context
    );

    // Use PR service to update the PR
    const result = await this.prService.updatePR(
      options,
      prNumber,
      newDescription,
      commitSha
    );

    if (!result.success) {
      throw new Error(`Failed to update PR: ${result.error}`);
    }
  }

  /**
   * Generate PR metadata using LLM based on git changes and task context
   */
  private async generatePRMetadata(
    options: CreatePROptions,
    context: TaskModelContext
  ): Promise<PRMetadata> {
    try {
      const diff = await this.gitService.getDiffAgainstBase(options.baseBranch);
      const commitMessages = await this.gitService.getRecentCommitMessages(
        options.baseBranch
      );

      // Use mini model for PR generation (cost optimization)
      // TODO: Update LLMService to support model selection parameter
      const metadata = await this.llmService.generatePRMetadata(
        {
          taskTitle: options.taskTitle,
          gitDiff: diff,
          commitMessages,
          wasTaskCompleted: options.wasTaskCompleted,
        },
        context.getApiKeys() // Pass full API keys for compatibility
      );

      // Append shadow URL to the description
      const shadowUrl = `https://shadowrealm.ai/tasks/${options.taskId}`;
      metadata.description = `${metadata.description}\n\n---\n\n[Open in Shadow](${shadowUrl})`;

      return metadata;
    } catch (error) {
      console.warn(
        `[PR_MANAGER] Failed to generate PR metadata for task ${options.taskId}:`,
        error
      );

      return {
        title: options.taskTitle,
        description: "Pull request description generation failed.",
        isDraft: true,
      };
    }
  }

  /**
   * Generate updated PR description by merging old description with new changes
   */
  private async generateUpdatedDescription(
    oldDescription: string,
    newDiff: string,
    taskTitle: string,
    context: TaskModelContext
  ): Promise<string> {
    if (!oldDescription) {
      // If no old description, generate fresh one
      return newDiff
        ? `## Changes\n\nUpdated implementation for: **${taskTitle}**\n\n## Recent Updates\n\nSee commit for details.`
        : "Pull request description generation failed.";
    }

    try {
      // Use mini model for PR description updates
      // TODO: Update LLMService to support model selection parameter
      const result = await this.llmService.generatePRMetadata(
        {
          taskTitle,
          gitDiff: newDiff,
          commitMessages: [],
          wasTaskCompleted: true,
        },
        context.getApiKeys()
      );

      return result.description;
    } catch (error) {
      console.warn(
        `[PR_MANAGER] Failed to generate updated description:`,
        error
      );

      // Fallback: append to existing description
      return `${oldDescription}\n\n## Recent Updates\n\n- Additional changes made\n- See latest commit for details`;
    }
  }

  /**
   * Emit completion event with PR snapshot data
   */
  private async emitCompletionEvent(
    options: CreatePROptions,
    prNumber?: number
  ): Promise<void> {
    try {
      // Get the latest snapshot to send to frontend
      const latestSnapshot = await this.prService.getLatestSnapshot(
        options.taskId
      );

      if (!latestSnapshot) {
        console.warn(
          `[PR_MANAGER] No snapshot found for completed PR on task ${options.taskId}`
        );
        return;
      }

      // Get the PR number from variant in database (updated during PR creation)
      const db = await import("@repo/db");
      let taskPRNumber: number | null = null;
      let repoUrl: string | undefined = undefined;

      if (options.variantId) {
        // Multi-variant mode: get PR from specific variant
        const variant = await db.prisma.variant.findUnique({
          where: { id: options.variantId },
          select: {
            pullRequestNumber: true,
            task: {
              select: { repoUrl: true },
            },
          },
        });
        taskPRNumber = variant?.pullRequestNumber || null;
        repoUrl = variant?.task.repoUrl;
      } else {
        // Legacy fallback: get from first variant
        const task = await db.prisma.task.findUnique({
          where: { id: options.taskId },
          select: {
            repoUrl: true,
            variants: {
              select: { pullRequestNumber: true },
              take: 1,
            },
          },
        });
        taskPRNumber = task?.variants[0]?.pullRequestNumber || null;
        repoUrl = task?.repoUrl;
      }

      const finalPRNumber = prNumber || taskPRNumber;
      if (!finalPRNumber) {
        console.warn(
          `[PR_MANAGER] No PR number available for task ${options.taskId}`
        );
        return;
      }

      // Construct PR URL
      const finalRepoUrl =
        repoUrl || `https://github.com/${options.repoFullName}`;
      const prUrl = `${finalRepoUrl}/pull/${finalPRNumber}`;

      emitToTask(options.taskId, "auto-pr-status", {
        taskId: options.taskId,
        messageId: options.messageId,
        status: "completed" as const,
        snapshot: {
          title: latestSnapshot.title,
          description: latestSnapshot.description,
          filesChanged: latestSnapshot.filesChanged,
          linesAdded: latestSnapshot.linesAdded,
          linesRemoved: latestSnapshot.linesRemoved,
          commitSha: latestSnapshot.commitSha,
          status: latestSnapshot.status,
        },
        prNumber: finalPRNumber,
        prUrl,
      });
    } catch (error) {
      console.error(
        `[PR_MANAGER] Failed to emit completion event for task ${options.taskId}:`,
        error
      );
    }
  }
}
