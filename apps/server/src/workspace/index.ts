import * as fs from "fs/promises";
import * as path from "path";
import config from "../config";
import { CloneResult, GitHubService } from "../github";
import { execAsync } from "../utils/exec";

export interface WorkspaceSetupResult {
  success: boolean;
  workspacePath: string;
  cloneResult?: CloneResult;
  error?: string;
}

export class WorkspaceManager {
  private githubService: GitHubService;

  constructor() {
    this.githubService = new GitHubService();
  }

  /**
   * Get the workspace directory path for a specific task
   */
  private getTaskWorkspaceDir(taskId: string): string {
    return path.join(config.workspaceDir, "tasks", taskId);
  }

  /**
   * Ensure a workspace directory exists and is properly set up
   */
  private async ensureWorkspaceExists(workspacePath: string): Promise<void> {
    try {
      // Check if directory already exists
      const stat = await fs.stat(workspacePath);
      if (stat.isDirectory()) {
        // Directory exists, clean it out
        await this.cleanDirectory(workspacePath);
      }
    } catch (error) {
      // Directory doesn't exist, create it
      await fs.mkdir(workspacePath, { recursive: true });
    }
  }

  /**
   * Clean a directory of all contents
   */
  private async cleanDirectory(dirPath: string): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath);
      await Promise.all(
        entries.map(async (entry) => {
          const fullPath = path.join(dirPath, entry);
          const stat = await fs.stat(fullPath);

          if (stat.isDirectory()) {
            await fs.rm(fullPath, { recursive: true, force: true });
          } else {
            await fs.unlink(fullPath);
          }
        })
      );
    } catch (error) {
      console.warn(`Warning: Could not clean directory ${dirPath}:`, error);
    }
  }

  /**
   * Prepare a workspace for a task by cloning the specified repository
   */
  async prepareTaskWorkspace(
    taskId: string,
    repoUrl: string,
    branch: string,
    githubToken: string
  ): Promise<WorkspaceSetupResult> {
    const workspacePath = this.getTaskWorkspaceDir(taskId);

    try {
      console.log(
        `[WORKSPACE] Preparing workspace for task ${taskId} at ${workspacePath}`
      );

      // Ensure workspace directory exists and is clean
      await this.ensureWorkspaceExists(workspacePath);

      // Clone the repository with user's GitHub token
      const cloneResult = await this.githubService.cloneRepository(
        repoUrl,
        branch,
        workspacePath,
        githubToken
      );

      if (!cloneResult.success) {
        return {
          success: false,
          workspacePath,
          cloneResult,
          error: cloneResult.error,
        };
      }

      // Verify the clone was successful by checking for .git directory
      try {
        const gitDir = path.join(workspacePath, ".git");
        await fs.access(gitDir);
      } catch (error) {
        return {
          success: false,
          workspacePath,
          cloneResult,
          error: "Clone completed but .git directory not found",
        };
      }

      console.log(
        `[WORKSPACE] Successfully prepared workspace for task ${taskId}`
      );

      return {
        success: true,
        workspacePath,
        cloneResult,
      };
    } catch (error) {
      console.error(
        `[WORKSPACE] Failed to prepare workspace for task ${taskId}:`,
        error
      );

      return {
        success: false,
        workspacePath,
        error:
          error instanceof Error ? error.message : "Unknown workspace error",
      };
    }
  }

  /**
   * Clean up a task's workspace directory
   */
  async cleanupTaskWorkspace(taskId: string): Promise<void> {
    const workspacePath = this.getTaskWorkspaceDir(taskId);

    try {
      console.log(`[WORKSPACE] Cleaning up workspace for task ${taskId}`);

      // Check if workspace exists
      try {
        await fs.access(workspacePath);
      } catch (error) {
        // Workspace doesn't exist, nothing to clean
        console.log(
          `[WORKSPACE] Workspace ${workspacePath} doesn't exist, nothing to clean`
        );
        return;
      }

      // Remove the entire workspace directory
      await fs.rm(workspacePath, { recursive: true, force: true });

      console.log(
        `[WORKSPACE] Successfully cleaned up workspace for task ${taskId}`
      );
    } catch (error) {
      console.error(
        `[WORKSPACE] Failed to cleanup workspace for task ${taskId}:`,
        error
      );
      // Don't throw error for cleanup failures, just log them
    }
  }

  /**
   * Get the workspace path for a task (without creating it)
   */
  getWorkspacePath(taskId: string): string {
    return this.getTaskWorkspaceDir(taskId);
  }

  /**
   * Check if a workspace exists for a task
   */
  async workspaceExists(taskId: string): Promise<boolean> {
    const workspacePath = this.getTaskWorkspaceDir(taskId);

    try {
      const stat = await fs.stat(workspacePath);
      return stat.isDirectory();
    } catch (error) {
      return false;
    }
  }

  /**
   * Get workspace size in bytes
   */
  async getWorkspaceSize(taskId: string): Promise<number> {
    const workspacePath = this.getTaskWorkspaceDir(taskId);

    try {
      const { stdout } = await execAsync(`du -sb "${workspacePath}"`);
      const sizeMatch = stdout.match(/^(\d+)/);
      return sizeMatch && sizeMatch[1] ? parseInt(sizeMatch[1], 10) : 0;
    } catch (error) {
      console.warn(`Could not get workspace size for ${taskId}:`, error);
      return 0;
    }
  }
}