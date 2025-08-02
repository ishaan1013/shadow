// Repository and cloning types
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

// Authentication and token types
export interface TokenRefreshResult {
  success: boolean;
  accessToken?: string;
  error?: string;
}

export interface GitHubTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in: number;
  scope: string;
  token_type: string;
}

// Pull Request types
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

export interface PROperationResult {
  success: boolean;
  prNumber?: number;
  error?: string;
}