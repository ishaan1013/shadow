import { GitHubService } from "../github";
import { GitManager } from "./git-manager";
import { LLMService } from "../ai/llm";
import { prisma } from "@repo/db";

export interface PRMetadata {
  title: string;
  description: string;
  isDraft: boolean;
}

export interface CreatePROptions {
  taskId: string;
  repoFullName: string;
  shadowBranch: string;
  baseBranch: string;
  userId: string;
  taskTitle: string;
  wasTaskCompleted: boolean;
  messageId: string;
}

export class PRManager {
  constructor(
    private githubService: GitHubService,
    private gitManager: GitManager,
    private llmService: LLMService
  ) {}

  /**
   * Create or update PR and save snapshot
   */
  async createPRIfNeeded(options: CreatePROptions): Promise<void> {
    try {
      console.log(`[PR_MANAGER] Processing PR for task ${options.taskId}`);

      // Check if there are any uncommitted changes
      const hasChanges = await this.gitManager.hasChanges();
      if (hasChanges) {
        console.log(
          `[PR_MANAGER] Uncommitted changes found, skipping PR creation`
        );
        return;
      }

      // Get task to check if PR already exists
      const task = await prisma.task.findUnique({
        where: { id: options.taskId },
      });

      if (!task) {
        console.warn(`[PR_MANAGER] Task not found: ${options.taskId}`);
        return;
      }

      // Get git metadata
      const commitSha = await this.gitManager.getCurrentCommitSha();

      const existingPRNumber = task.pullRequestNumber;

      if (!existingPRNumber) {
        // Create new PR path
        await this.createNewPR(options, commitSha);
      } else {
        // Update existing PR path
        await this.updateExistingPR(options, existingPRNumber, commitSha);
      }

      console.log(
        `[PR_MANAGER] Successfully ${existingPRNumber ? "updated" : "created"} PR for task ${options.taskId}`
      );
    } catch (error) {
      console.error(
        `[PR_MANAGER] Failed to create/update PR for task ${options.taskId}:`,
        error
      );
      // Don't throw - PR creation is non-blocking
    }
  }

  /**
   * Create a new PR and save snapshot
   */
  private async createNewPR(
    options: CreatePROptions,
    commitSha: string,
    userApiKeys?: { openai?: string; anthropic?: string }
  ): Promise<void> {
    // Generate PR metadata with AI
    const metadata = await this.generatePRMetadata(options, userApiKeys);

    // Create GitHub PR
    const result = await this.githubService.createPullRequest(
      options.repoFullName,
      {
        title: metadata.title,
        body: metadata.description,
        head: options.shadowBranch,
        base: options.baseBranch,
        draft: metadata.isDraft,
      },
      options.userId
    );

    // Update task with PR number
    await prisma.task.update({
      where: { id: options.taskId },
      data: { pullRequestNumber: result.number },
    });

    // Create snapshot record
    await prisma.pullRequestSnapshot.create({
      data: {
        messageId: options.messageId,
        status: "CREATED",
        title: metadata.title,
        description: metadata.description,
        filesChanged: result.changed_files,
        linesAdded: result.additions,
        linesRemoved: result.deletions,
        commitSha,
      },
    });

    console.log(
      `[PR_MANAGER] Created new PR #${result.number} for task ${options.taskId}`
    );
  }

  /**
   * Update existing PR and save snapshot
   */
  private async updateExistingPR(
    options: CreatePROptions,
    prNumber: number,
    commitSha: string
  ): Promise<void> {
    // Get current PR description from most recent snapshot
    const latestSnapshot = await prisma.pullRequestSnapshot.findFirst({
      where: {
        message: {
          taskId: options.taskId,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!latestSnapshot) {
      console.warn(
        `[PR_MANAGER] No previous snapshot found for task ${options.taskId}, creating new description`
      );
    }

    // Generate updated description using AI
    const newDescription = await this.generateUpdatedDescription(
      latestSnapshot?.description || "",
      await this.gitManager.getDiff(),
      options.taskTitle
    );

    // Update GitHub PR
    await this.githubService.updatePullRequest(
      options.repoFullName,
      prNumber,
      { body: newDescription },
      options.userId
    );

    // Get updated PR stats from GitHub
    const prStats = await this.githubService.getPullRequest(
      options.repoFullName,
      prNumber,
      options.userId
    );

    // Create new snapshot record
    await prisma.pullRequestSnapshot.create({
      data: {
        messageId: options.messageId,
        status: "UPDATED",
        title: latestSnapshot?.title || options.taskTitle,
        description: newDescription,
        filesChanged: prStats.changed_files,
        linesAdded: prStats.additions,
        linesRemoved: prStats.deletions,
        commitSha,
      },
    });

    console.log(
      `[PR_MANAGER] Updated PR #${prNumber} for task ${options.taskId}`
    );
  }

  /**
   * Generate PR metadata using LLM based on git changes and task context
   */
  private async generatePRMetadata(
    options: CreatePROptions,
    userApiKeys?: { openai?: string; anthropic?: string }
  ): Promise<PRMetadata> {
    try {
      const diff = await this.gitManager.getDiff();
      const commitMessages = await this.getRecentCommitMessages();

      const metadata = await this.llmService.generatePRMetadata(
        {
          taskTitle: options.taskTitle,
          gitDiff: diff,
          commitMessages,
          wasTaskCompleted: options.wasTaskCompleted,
        },
        userApiKeys || {}
      );

      return metadata;
    } catch (error) {
      console.warn(
        `[PR_MANAGER] Failed to generate PR metadata for task ${options.taskId}:`,
        error
      );

      return {
        title: options.taskTitle,
        description: "Pull request description generation failed.",
        isDraft: !options.wasTaskCompleted,
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
    userApiKeys?: { openai?: string; anthropic?: string }
  ): Promise<string> {
    if (!oldDescription) {
      // If no old description, generate fresh one
      return newDiff
        ? `## Changes\n\nUpdated implementation for: **${taskTitle}**\n\n## Recent Updates\n\nSee commit for details.`
        : "Pull request description generation failed.";
    }

    try {
      const result = await this.llmService.generatePRMetadata(
        {
          taskTitle,
          gitDiff: newDiff,
          commitMessages: [],
          wasTaskCompleted: true,
        },
        userApiKeys || {}
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
   * Get recent commit messages from the shadow branch
   */
  private async getRecentCommitMessages(): Promise<string[]> {
    try {
      const { stdout } = await this.gitManager["execGit"](
        'log --oneline -5 --pretty=format:"%s"'
      );
      return stdout.trim().split("\n").filter(Boolean);
    } catch (error) {
      console.warn(`[PR_MANAGER] Failed to get recent commit messages:`, error);
      return [];
    }
  }
}
