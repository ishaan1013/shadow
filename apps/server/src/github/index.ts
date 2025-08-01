import { Octokit } from "@octokit/rest";
import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import config from "../config";
import { execAsync } from "../utils/exec";
import { githubTokenManager } from "../utils/github-token-manager";

export interface CloneResult {
  success: boolean;
  workspacePath: string;
  commitSha?: string;
  error?: string;
  clonedAt: Date;
}

export interface RepoInfo {
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
  size: number; // KB
}

export class GitHubService {
  constructor() {
    // No longer initialize Octokit in constructor - create per-operation
  }

  /**
   * Create Octokit instance with the provided token
   */
  private createOctokit(accessToken: string): Octokit {
    return new Octokit({
      auth: accessToken,
    });
  }

  /**
   * Execute a GitHub API operation with retry logic for token refresh
   */
  private async executeWithRetry<T>(
    userId: string,
    operation: (accessToken: string) => Promise<T>
  ): Promise<T> {
    const accessToken = await githubTokenManager.getValidAccessToken(userId);

    if (!accessToken) {
      throw new Error("No valid GitHub access token available");
    }

    try {
      return await operation(accessToken);
    } catch (error) {
      // Check if it's an authentication error
      if (
        error instanceof Error &&
        "status" in error &&
        (error.status === 401 || error.status === 403)
      ) {
        console.log(
          `[GITHUB_SERVICE] Authentication error, attempting token refresh for user ${userId}`
        );

        // Try to refresh the token
        const refreshResult =
          await githubTokenManager.refreshUserTokens(userId);

        if (refreshResult.success && refreshResult.accessToken) {
          console.log(
            `[GITHUB_SERVICE] Token refreshed successfully, retrying operation`
          );
          return await operation(refreshResult.accessToken);
        } else {
          throw new Error(
            `Authentication failed and token refresh failed: ${refreshResult.error}`
          );
        }
      }

      // Re-throw non-auth errors
      throw error;
    }
  }

  /**
   * Get repository information from GitHub API
   */
  async getRepoInfo(repoFullName: string, userId: string): Promise<RepoInfo> {
    return this.executeWithRetry(userId, async (accessToken) => {
      const [owner, repo] = repoFullName.split("/");
      const octokit = this.createOctokit(accessToken);

      if (!owner || !repo) {
        throw new Error(`Invalid repository full name: ${repoFullName}`);
      }

      try {
        const { data } = await octokit.repos.get({
          owner,
          repo,
        });

        return {
          owner,
          repo,
          fullName: data.full_name,
          defaultBranch: data.default_branch,
          isPrivate: data.private,
          size: data.size, // GitHub returns size in KB
        };
      } catch (error) {
        if (
          error instanceof Error &&
          "status" in error &&
          error.status === 404
        ) {
          throw new Error(
            `Repository not found or not accessible: ${owner}/${repo}`
          );
        }
        throw new Error(
          `Failed to fetch repository info: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    });
  }

  /**
   * Validate that a branch exists in the repository
   */
  async validateBranch(
    repoFullName: string,
    branch: string,
    userId: string
  ): Promise<boolean> {
    return this.executeWithRetry(userId, async (accessToken) => {
      const [owner, repo] = repoFullName.split("/");
      const octokit = this.createOctokit(accessToken);

      if (!owner || !repo) {
        throw new Error(`Invalid repository full name: ${repoFullName}`);
      }

      try {
        await octokit.repos.getBranch({
          owner,
          repo,
          branch,
        });
        return true;
      } catch (error) {
        if (
          error instanceof Error &&
          "status" in error &&
          error.status === 404
        ) {
          return false;
        }
        // For other errors, assume branch might exist (could be auth issue)
        return true;
      }
    });
  }

  /**
   * Clone a GitHub repository to the specified workspace directory
   */
  async cloneRepository(
    repoFullName: string,
    branch: string,
    workspacePath: string,
    userId: string
  ): Promise<CloneResult> {
    const clonedAt = new Date();

    try {
      // Validate inputs
      const [owner, repo] = repoFullName.split("/");

      if (!owner || !repo) {
        throw new Error(`Invalid repository full name: ${repoFullName}`);
      }

      // Check if branch exists (if we have API access)
      const branchExists = await this.validateBranch(
        repoFullName,
        branch,
        userId
      );
      if (!branchExists) {
        return {
          success: false,
          workspacePath,
          error: `Branch '${branch}' not found in repository ${owner}/${repo}`,
          clonedAt,
        };
      }

      // Get repo info to check size limits
      let repoInfo: RepoInfo | null = null;
      try {
        repoInfo = await this.getRepoInfo(repoFullName, userId);

        // Check size limit (convert KB to MB)
        const sizeInMB = repoInfo.size / 1024;
        if (sizeInMB > config.maxRepoSizeMB) {
          return {
            success: false,
            workspacePath,
            error: `Repository size (${sizeInMB.toFixed(1)}MB) exceeds limit of ${config.maxRepoSizeMB}MB`,
            clonedAt,
          };
        }
      } catch (error) {
        // Continue without repo info if API call fails
        console.warn(`Could not fetch repo info for ${repoFullName}:`, error);
      }

      console.log("[GITHUB] Repo info", repoInfo);

      // Get a valid access token for cloning
      const accessToken = await githubTokenManager.getValidAccessToken(userId);
      if (!accessToken) {
        return {
          success: false,
          workspacePath,
          error: "No valid GitHub access token available",
          clonedAt,
        };
      }

      // Prepare clone command
      const cloneUrl = `https://${accessToken}@github.com/${owner}/${repo}.git`;

      // Use shallow clone for performance, targeting specific branch
      const cloneCommand = [
        "git",
        "clone",
        "--depth",
        "1",
        "--branch",
        branch,
        "--single-branch",
        cloneUrl,
        workspacePath,
      ].join(" ");

      console.log(
        `[GITHUB] Cloning ${owner}/${repo}:${branch} to ${workspacePath}`
      );

      // Execute clone with timeout
      const { stdout: _, stderr: __ } = await execAsync(cloneCommand, {
        timeout: 300000, // 5 minute timeout
      });

      // Get the actual commit SHA that was cloned
      const commitCommand = `cd "${workspacePath}" && git rev-parse HEAD`;
      const { stdout: commitSha } = await execAsync(commitCommand);

      console.log(
        `[GITHUB] Successfully cloned ${owner}/${repo}:${branch} (${commitSha.trim()})`
      );

      return {
        success: true,
        workspacePath,
        commitSha: commitSha.trim(),
        clonedAt,
      };
    } catch (error) {
      console.error(
        `[GITHUB] Clone failed for ${repoFullName}:${branch}`,
        error
      );

      let errorMessage = "Unknown clone error";
      if (error instanceof Error) {
        errorMessage = error.message;

        // Provide more user-friendly error messages
        if (errorMessage.includes("Repository not found")) {
          errorMessage = `Repository not found or not accessible: ${repoFullName}`;
        } else if (errorMessage.includes("timeout")) {
          errorMessage =
            "Clone operation timed out. Repository might be too large.";
        } else if (errorMessage.includes("authentication")) {
          errorMessage = "Authentication failed. Check repository permissions.";
        } else if (
          errorMessage.includes("not found") &&
          errorMessage.includes(branch)
        ) {
          errorMessage = `Branch '${branch}' not found in repository`;
        }
      }

      return {
        success: false,
        workspacePath,
        error: errorMessage,
        clonedAt,
      };
    }
  }

  /**
   * List pull requests for a repository with optional head branch filter
   */
  async listPullRequests(
    repoFullName: string,
    head?: string,
    userId?: string
  ): Promise<RestEndpointMethodTypes["pulls"]["list"]["response"]["data"]> {
    if (!userId) {
      throw new Error("User ID is required for PR operations");
    }

    return this.executeWithRetry(userId, async (accessToken) => {
      const [owner, repo] = repoFullName.split("/");
      const octokit = this.createOctokit(accessToken);

      if (!owner || !repo) {
        throw new Error(`Invalid repository full name: ${repoFullName}`);
      }

      try {
        const params: RestEndpointMethodTypes["pulls"]["list"]["parameters"] = {
          owner,
          repo,
          state: "open",
        };

        // Filter by head branch if provided
        if (head) {
          params.head = `${owner}:${head}`;
        }

        const { data } = await octokit.pulls.list(params);
        return data;
      } catch (error) {
        if (
          error instanceof Error &&
          "status" in error &&
          error.status === 404
        ) {
          throw new Error(
            `Repository not found or not accessible: ${owner}/${repo}`
          );
        }
        throw new Error(
          `Failed to list pull requests: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    });
  }

  /**
   * Create a pull request
   */
  async createPullRequest(
    repoFullName: string,
    options: {
      title: string;
      body: string;
      head: string;
      base: string;
      draft: boolean;
    },
    userId: string
  ): Promise<{
    url: string;
    number: number;
    additions: number;
    deletions: number;
    changed_files: number;
  }> {
    return this.executeWithRetry(userId, async (accessToken) => {
      const [owner, repo] = repoFullName.split("/");
      const octokit = this.createOctokit(accessToken);

      if (!owner || !repo) {
        throw new Error(`Invalid repository full name: ${repoFullName}`);
      }

      try {
        const { data } = await octokit.pulls.create({
          owner,
          repo,
          title: options.title,
          body: options.body,
          head: options.head,
          base: options.base,
          draft: options.draft,
        });

        return {
          url: data.html_url,
          number: data.number,
          additions: data.additions || 0,
          deletions: data.deletions || 0,
          changed_files: data.changed_files || 0,
        };
      } catch (error) {
        if (
          error instanceof Error &&
          "status" in error &&
          error.status === 404
        ) {
          throw new Error(
            `Repository not found or not accessible: ${owner}/${repo}`
          );
        } else if (
          error instanceof Error &&
          "status" in error &&
          error.status === 422
        ) {
          // Unprocessable Entity - often means branch doesn't exist or PR already exists
          throw new Error(
            `Cannot create pull request: ${error.message || "Branch may not exist or PR already exists"}`
          );
        }
        throw new Error(
          `Failed to create pull request: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    });
  }

  /**
   * Get pull request data including diff statistics
   */
  async getPullRequest(
    repoFullName: string,
    prNumber: number,
    userId: string
  ): Promise<{
    additions: number;
    deletions: number;
    changed_files: number;
  }> {
    return this.executeWithRetry(userId, async (accessToken) => {
      const [owner, repo] = repoFullName.split("/");
      const octokit = this.createOctokit(accessToken);

      if (!owner || !repo) {
        throw new Error(`Invalid repository full name: ${repoFullName}`);
      }

      try {
        const { data } = await octokit.pulls.get({
          owner,
          repo,
          pull_number: prNumber,
        });

        return {
          additions: data.additions || 0,
          deletions: data.deletions || 0,
          changed_files: data.changed_files || 0,
        };
      } catch (error) {
        if (
          error instanceof Error &&
          "status" in error &&
          error.status === 404
        ) {
          throw new Error(
            `Pull request #${prNumber} not found in ${owner}/${repo}`
          );
        }
        throw new Error(
          `Failed to get pull request: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    });
  }

  /**
   * Update an existing pull request
   */
  async updatePullRequest(
    repoFullName: string,
    prNumber: number,
    options: { title?: string; body?: string },
    userId: string
  ): Promise<void> {
    return this.executeWithRetry(userId, async (accessToken) => {
      const [owner, repo] = repoFullName.split("/");
      const octokit = this.createOctokit(accessToken);

      if (!owner || !repo) {
        throw new Error(`Invalid repository full name: ${repoFullName}`);
      }

      try {
        await octokit.pulls.update({
          owner,
          repo,
          pull_number: prNumber,
          title: options.title,
          body: options.body,
        });

        console.log(
          `[GITHUB_SERVICE] Successfully updated PR #${prNumber} in ${owner}/${repo}`
        );
      } catch (error) {
        if (
          error instanceof Error &&
          "status" in error &&
          error.status === 404
        ) {
          throw new Error(
            `Pull request #${prNumber} not found in ${owner}/${repo}`
          );
        } else if (
          error instanceof Error &&
          "status" in error &&
          error.status === 422
        ) {
          throw new Error(
            `Cannot update pull request: ${error.message || "Invalid request"}`
          );
        }
        throw new Error(
          `Failed to update pull request: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    });
  }
}
