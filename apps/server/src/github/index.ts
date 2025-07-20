import { Octokit } from "@octokit/rest";
import { execAsync } from "../utils/exec";
import config from "../config";
import { z } from "zod";
import { prisma } from "@repo/db";

const RepoUrlSchema = z.string().regex(
  /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/,
  "Invalid GitHub repository URL format"
);

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

/**
 * Get GitHub access token for a user from their account
 */
export async function getGitHubTokenForUser(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: {
      userId,
      providerId: "github",
    },
  });

  return account?.accessToken || null;
}

export class GitHubService {
  /**
   * Parse GitHub repository URL to extract owner and repo name
   */
  private parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
    const result = RepoUrlSchema.safeParse(repoUrl);
    if (!result.success) {
      throw new Error(`Invalid repository URL: ${repoUrl}`);
    }

    const urlParts = repoUrl.replace("https://github.com/", "").split("/");
    if (urlParts.length !== 2) {
      throw new Error(`Invalid repository URL format: ${repoUrl}`);
    }

    const [owner, repo] = urlParts;
    if (!owner || !repo) {
      throw new Error(`Invalid repository URL format: ${repoUrl}`);
    }

    return { owner, repo };
  }

  /**
   * Create an Octokit instance with the provided token
   */
  private createOctokit(githubToken: string): Octokit {
    return new Octokit({
      auth: githubToken,
    });
  }

  /**
   * Get repository information from GitHub API
   */
  async getRepoInfo(repoUrl: string, githubToken: string): Promise<RepoInfo> {
    const { owner, repo } = this.parseRepoUrl(repoUrl);
    const octokit = this.createOctokit(githubToken);

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
      if (error instanceof Error && 'status' in error && error.status === 404) {
        throw new Error(`Repository not found or not accessible: ${owner}/${repo}`);
      }
      throw new Error(`Failed to fetch repository info: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate that a branch exists in the repository
   */
  async validateBranch(repoUrl: string, branch: string, githubToken: string): Promise<boolean> {
    const { owner, repo } = this.parseRepoUrl(repoUrl);
    const octokit = this.createOctokit(githubToken);

    try {
      await octokit.repos.getBranch({
        owner,
        repo,
        branch,
      });
      return true;
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 404) {
        return false;
      }
      // For other errors, assume branch might exist (could be auth issue)
      return true;
    }
  }

  /**
   * Clone a GitHub repository to the specified workspace directory
   */
  async cloneRepository(
    repoUrl: string,
    branch: string,
    workspacePath: string,
    githubToken: string
  ): Promise<CloneResult> {
    const clonedAt = new Date();

    try {
      // Validate inputs
      const { owner, repo } = this.parseRepoUrl(repoUrl);
      
      // Check if branch exists (if we have token)
      if (githubToken) {
        const branchExists = await this.validateBranch(repoUrl, branch, githubToken);
        if (!branchExists) {
          return {
            success: false,
            workspacePath,
            error: `Branch '${branch}' not found in repository ${owner}/${repo}`,
            clonedAt,
          };
        }
      }

      // Get repo info to check size limits (if we have token)
      let repoInfo: RepoInfo | null = null;
      if (githubToken) {
        try {
          repoInfo = await this.getRepoInfo(repoUrl, githubToken);
          
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
          console.warn(`Could not fetch repo info for ${repoUrl}:`, error);
        }
      }

      // Prepare clone command
      const cloneUrl = githubToken 
        ? `https://${githubToken}@github.com/${owner}/${repo}.git`
        : repoUrl;

      // Use shallow clone for performance, targeting specific branch
      const cloneCommand = [
        'git', 'clone',
        '--depth', '1',
        '--branch', branch,
        '--single-branch',
        cloneUrl,
        workspacePath
      ].join(' ');

      console.log(`[GITHUB] Cloning ${owner}/${repo}:${branch} to ${workspacePath}`);

      // Execute clone with timeout
      const { stdout: _stdout, stderr: _stderr } = await execAsync(cloneCommand, {
        timeout: 300000, // 5 minute timeout
      });

      // Get the actual commit SHA that was cloned
      const commitCommand = `cd "${workspacePath}" && git rev-parse HEAD`;
      const { stdout: commitSha } = await execAsync(commitCommand);

      console.log(`[GITHUB] Successfully cloned ${owner}/${repo}:${branch} (${commitSha.trim()})`);

      return {
        success: true,
        workspacePath,
        commitSha: commitSha.trim(),
        clonedAt,
      };

    } catch (error) {
      console.error(`[GITHUB] Clone failed for ${repoUrl}:${branch}`, error);
      
      let errorMessage = 'Unknown clone error';
      if (error instanceof Error) {
        errorMessage = error.message;
        
        // Provide more user-friendly error messages
        if (errorMessage.includes('Repository not found')) {
          errorMessage = `Repository not found or not accessible: ${repoUrl}`;
        } else if (errorMessage.includes('timeout')) {
          errorMessage = 'Clone operation timed out. Repository might be too large.';
        } else if (errorMessage.includes('authentication')) {
          errorMessage = 'Authentication failed. Check repository permissions.';
        } else if (errorMessage.includes('not found') && errorMessage.includes(branch)) {
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