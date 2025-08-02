import { Endpoints } from "@octokit/types";

// Type definitions for GitHub API responses
export type ListUserReposResponse = Endpoints["GET /user/repos"]["response"];
export type UserRepository = ListUserReposResponse["data"][0];

export type FilteredRepository = {
  id: number;
  name: string;
  full_name: string;
  owner: {
    id?: number;
    login: string;
    type: string;
  };
  pushed_at: string | null;
};

export type GroupedRepos = {
  groups: {
    name: string;
    type: "user" | "organization";
    repositories: FilteredRepository[];
  }[];
};

export type Branch = {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected?: boolean;
};

export type GitHubStatus = {
  isConnected: boolean;
  isAppInstalled: boolean;
  installationId?: string;
  installationUrl?: string;
  message: string;
};

// GitHubIssue type moved to @repo/types to eliminate duplication
