// Direct exports of GitHub services
export { GitHubApiClient } from "./github-api";
export { RepositoryService } from "./repositories";
export { PRService } from "./pull-requests";
export { getGitHubAccount, getGitHubAccessToken } from "./auth/account-service";
export { githubTokenManager } from "./auth/token-manager";
export { generateIssuePrompt } from "./issues";

// Export types
export type * from "./types";
