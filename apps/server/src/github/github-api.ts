import { Octokit } from "@octokit/rest";
import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import type { GitHubIssue } from "@repo/types";
import { githubTokenManager } from "./auth/token-manager";
import type { RepoInfo } from "./types";

export class GitHubApiClient {
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
          `[GITHUB_API_CLIENT] Authentication error, attempting token refresh for user ${userId}`
        );

        // Try to refresh the token
        const refreshResult =
          await githubTokenManager.refreshUserTokens(userId);

        if (refreshResult.success && refreshResult.accessToken) {
          console.log(
            `[GITHUB_API_CLIENT] Token refreshed successfully, retrying operation`
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
          `[GITHUB_API_CLIENT] Successfully updated PR #${prNumber} in ${owner}/${repo}`
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

  /**
   * Get a single issue by number
   */
  async getIssue(
    repoFullName: string,
    issueNumber: number,
    userId: string
  ): Promise<GitHubIssue | null> {
    return this.executeWithRetry(userId, async (accessToken) => {
      const [owner, repo] = repoFullName.split("/");
      const octokit = this.createOctokit(accessToken);

      if (!owner || !repo) {
        throw new Error(`Invalid repository full name: ${repoFullName}`);
      }

      try {
        const { data } = await octokit.rest.issues.get({
          owner,
          repo,
          issue_number: issueNumber,
        });

        // Transform to our GitHubIssue interface
        return {
          id: data.id.toString(),
          title: data.title,
          body: data.body || null,
          state: data.state as "open" | "closed",
          user: data.user
            ? {
                login: data.user.login,
                avatar_url: data.user.avatar_url,
              }
            : null,
          labels:
            data.labels?.map((label) => ({
              id: typeof label === "string" ? 0 : label.id || 0,
              name: typeof label === "string" ? label : label.name || "",
              color: typeof label === "string" ? "" : label.color || "",
            })) || [],
          assignees:
            data.assignees?.map((assignee) => ({
              login: assignee.login,
              avatar_url: assignee.avatar_url,
            })) || [],
          created_at: data.created_at,
          updated_at: data.updated_at,
          html_url: data.html_url,
        };
      } catch (error) {
        if (
          error instanceof Error &&
          "status" in error &&
          error.status === 404
        ) {
          // Issue not found - return null instead of throwing
          return null;
        }
        throw new Error(
          `Failed to get issue: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    });
  }
}
