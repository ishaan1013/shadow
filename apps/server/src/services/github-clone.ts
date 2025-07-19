import { Octokit } from "@octokit/rest";
import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import config from "../config";

const execAsync = promisify(exec);

export interface CloneOptions {
  repoUrl: string;
  branch: string;
  taskId: string;
  accessToken: string;
}

export interface CloneProgress {
  status: "cloning" | "completed" | "error";
  message: string;
  progress?: number;
}

export class GitHubCloneService {
  private octokit: Octokit;

  constructor(accessToken: string) {
    this.octokit = new Octokit({
      auth: accessToken,
    });
  }

  /**
   * Get the task-specific workspace directory
   */
  private getTaskWorkspaceDir(taskId: string): string {
    return path.join(config.workspaceDir, `task-${taskId}`);
  }

  /**
   * Parse GitHub repo URL or owner/repo format
   */
  private parseRepoIdentifier(repoUrl: string): {
    owner: string;
    repo: string;
  } {
    // Handle both "owner/repo" format and full GitHub URLs
    if (repoUrl.includes("github.com")) {
      const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!match) {
        throw new Error(`Invalid GitHub URL format: ${repoUrl}`);
      }
      return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
    } else if (repoUrl.includes("/")) {
      const [owner, repo] = repoUrl.split("/");
      if (!owner || !repo) {
        throw new Error(
          `Invalid repo format. Expected 'owner/repo': ${repoUrl}`
        );
      }
      return { owner, repo };
    } else {
      throw new Error(`Invalid repo format: ${repoUrl}`);
    }
  }

  /**
   * Verify repository exists and user has access
   */
  async verifyRepoAccess(repoUrl: string): Promise<boolean> {
    try {
      const { owner, repo } = this.parseRepoIdentifier(repoUrl);
      await this.octokit.rest.repos.get({ owner, repo });
      return true;
    } catch (error) {
      console.error("Error verifying repo access:", error);
      return false;
    }
  }

  /**
   * Verify branch exists in repository
   */
  async verifyBranchExists(repoUrl: string, branch: string): Promise<boolean> {
    try {
      const { owner, repo } = this.parseRepoIdentifier(repoUrl);
      await this.octokit.rest.repos.getBranch({ owner, repo, branch });
      return true;
    } catch (error) {
      console.error("Error verifying branch:", error);
      return false;
    }
  }

  /**
   * Clone repository to task-specific workspace
   */
  async cloneRepository(
    options: CloneOptions,
    onProgress?: (progress: CloneProgress) => void
  ): Promise<string> {
    const { repoUrl, branch, taskId, accessToken } = options;
    const taskWorkspaceDir = this.getTaskWorkspaceDir(taskId);

    try {
      // Parse repo identifier
      const { owner, repo } = this.parseRepoIdentifier(repoUrl);

      onProgress?.({
        status: "cloning",
        message: "Verifying repository access...",
        progress: 10,
      });

      // Verify repository and branch exist
      const [repoExists, branchExists] = await Promise.all([
        this.verifyRepoAccess(repoUrl),
        this.verifyBranchExists(repoUrl, branch),
      ]);

      if (!repoExists) {
        throw new Error(`Repository not found or access denied: ${repoUrl}`);
      }

      if (!branchExists) {
        throw new Error(
          `Branch '${branch}' not found in repository: ${repoUrl}`
        );
      }

      onProgress?.({
        status: "cloning",
        message: "Creating workspace directory...",
        progress: 20,
      });

      // Ensure task workspace directory exists
      await fs.mkdir(taskWorkspaceDir, { recursive: true });

      // Check if directory already contains a clone
      const repoDir = path.join(taskWorkspaceDir, repo);
      try {
        await fs.access(repoDir);
        // Directory exists, remove it to start fresh
        await fs.rm(repoDir, { recursive: true, force: true });
      } catch {
        // Directory doesn't exist, which is fine
      }

      onProgress?.({
        status: "cloning",
        message: `Cloning ${owner}/${repo} (${branch})...`,
        progress: 30,
      });

      // Clone the repository with authentication
      const cloneUrl = `https://${accessToken}@github.com/${owner}/${repo}.git`;

      // Check if git is available
      try {
        await execAsync("git --version", { timeout: 5000 });
      } catch (error) {
        throw new Error("Git is not installed or not available in PATH");
      }

      // Use git clone with specific branch
      const cloneCommand = `git clone --branch ${branch} --single-branch --depth 1 "${cloneUrl}" "${repo}"`;

      console.log(
        `[CLONE] Executing: git clone --branch ${branch} --single-branch --depth 1 <repo> ${repo}`
      );

      const { stdout, stderr } = await execAsync(cloneCommand, {
        cwd: taskWorkspaceDir,
        timeout: 60000, // 60 second timeout
      });

      if (stderr && !stderr.includes("Cloning into")) {
        console.warn("Git clone stderr:", stderr);
      }

      onProgress?.({
        status: "cloning",
        message: "Verifying clone...",
        progress: 80,
      });

      // Verify the clone was successful
      const clonedRepoPath = path.join(taskWorkspaceDir, repo);
      await fs.access(clonedRepoPath);

      // Remove .git directory to avoid nested git issues
      const gitDir = path.join(clonedRepoPath, ".git");
      try {
        await fs.rm(gitDir, { recursive: true, force: true });
      } catch (error) {
        console.warn("Failed to remove .git directory:", error);
      }

      onProgress?.({
        status: "completed",
        message: `Successfully cloned ${owner}/${repo} (${branch})`,
        progress: 100,
      });

      console.log(
        `[CLONE] Successfully cloned ${owner}/${repo} to ${clonedRepoPath}`
      );
      return clonedRepoPath;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      onProgress?.({
        status: "error",
        message: `Failed to clone repository: ${errorMessage}`,
      });

      console.error("[CLONE] Error:", error);
      throw new Error(`Failed to clone repository: ${errorMessage}`);
    }
  }

  /**
   * Get the cloned repository path for a task
   */
  getClonedRepoPath(taskId: string, repoUrl: string): string {
    const { repo } = this.parseRepoIdentifier(repoUrl);
    return path.join(this.getTaskWorkspaceDir(taskId), repo);
  }

  /**
   * Check if repository is already cloned for a task
   */
  async isRepositoryCloned(taskId: string, repoUrl: string): Promise<boolean> {
    try {
      const repoPath = this.getClonedRepoPath(taskId, repoUrl);
      await fs.access(repoPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up task workspace directory
   */
  async cleanupTaskWorkspace(taskId: string): Promise<void> {
    try {
      const taskWorkspaceDir = this.getTaskWorkspaceDir(taskId);
      await fs.rm(taskWorkspaceDir, { recursive: true, force: true });
      console.log(`[CLEANUP] Removed task workspace: ${taskWorkspaceDir}`);
    } catch (error) {
      console.error(`[CLEANUP] Failed to remove task workspace:`, error);
    }
  }
}
