import { prisma } from "@repo/db";
import { GitHubApiClient } from "./github-api";
import type { PRMetadata, CreatePROptions, PROperationResult } from "./types";

export class PRService {
  private apiClient: GitHubApiClient;

  constructor() {
    this.apiClient = new GitHubApiClient();
  }

  /**
   * Create a new PR and save snapshot
   */
  async createPR(
    options: CreatePROptions,
    metadata: PRMetadata,
    commitSha: string
  ): Promise<PROperationResult> {
    try {
      // Create GitHub PR (always as draft)
      const result = await this.apiClient.createPullRequest(
        options.repoFullName,
        {
          title: metadata.title,
          body: metadata.description,
          head: options.shadowBranch,
          base: options.baseBranch,
          draft: true,
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
        `[PR_SERVICE] Created new PR #${result.number} for task ${options.taskId}`
      );

      return {
        success: true,
        prNumber: result.number,
      };
    } catch (error) {
      console.error(
        `[PR_SERVICE] Failed to create PR for task ${options.taskId}:`,
        error
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Update existing PR and save snapshot
   */
  async updatePR(
    options: CreatePROptions,
    prNumber: number,
    newDescription: string,
    commitSha: string
  ): Promise<PROperationResult> {
    try {
      // Update GitHub PR
      await this.apiClient.updatePullRequest(
        options.repoFullName,
        prNumber,
        { body: newDescription },
        options.userId
      );

      // Get updated PR stats from GitHub
      const prStats = await this.apiClient.getPullRequest(
        options.repoFullName,
        prNumber,
        options.userId
      );

      // Get title from most recent snapshot
      const latestSnapshot = await prisma.pullRequestSnapshot.findFirst({
        where: {
          message: {
            taskId: options.taskId,
          },
        },
        orderBy: { createdAt: "desc" },
      });

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
        `[PR_SERVICE] Updated PR #${prNumber} for task ${options.taskId}`
      );

      return {
        success: true,
        prNumber,
      };
    } catch (error) {
      console.error(
        `[PR_SERVICE] Failed to update PR for task ${options.taskId}:`,
        error
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Check if a task already has a PR
   */
  async getExistingPRNumber(taskId: string): Promise<number | null> {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    return task?.pullRequestNumber || null;
  }

  /**
   * Get the most recent PR snapshot for a task
   */
  async getLatestSnapshot(taskId: string) {
    return await prisma.pullRequestSnapshot.findFirst({
      where: {
        message: {
          taskId,
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
