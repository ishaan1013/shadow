import config from "../config";
import { execAsync } from "../utils/exec";
import { githubTokenManager } from "./auth/token-manager";
import { GitHubApiClient } from "./github-api";
import type { CloneResult } from "./types";

export class RepositoryService {
  private apiClient: GitHubApiClient;

  constructor() {
    this.apiClient = new GitHubApiClient();
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
      const branchExists = await this.apiClient.validateBranch(
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
      let repoInfo = null;
      try {
        repoInfo = await this.apiClient.getRepoInfo(repoFullName, userId);

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

      console.log("[REPOSITORY_SERVICE] Repo info", repoInfo);

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
        `[REPOSITORY_SERVICE] Cloning ${owner}/${repo}:${branch} to ${workspacePath}`
      );

      // Execute clone with timeout
      const { stdout: _, stderr: __ } = await execAsync(cloneCommand, {
        timeout: 300000, // 5 minute timeout
      });

      // Get the actual commit SHA that was cloned
      const commitCommand = `cd "${workspacePath}" && git rev-parse HEAD`;
      const { stdout: commitSha } = await execAsync(commitCommand);

      console.log(
        `[REPOSITORY_SERVICE] Successfully cloned ${owner}/${repo}:${branch} (${commitSha.trim()})`
      );

      return {
        success: true,
        workspacePath,
        commitSha: commitSha.trim(),
        clonedAt,
      };
    } catch (error) {
      console.error(
        `[REPOSITORY_SERVICE] Clone failed for ${repoFullName}:${branch}`,
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
}
