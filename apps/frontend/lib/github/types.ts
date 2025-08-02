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

export type GitHubIssue = {
  id: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  user: {
    login: string;
    avatar_url: string;
  } | null;
  labels: {
    id: number;
    name: string;
    color: string;
  }[];
  assignees: {
    login: string;
    avatar_url: string;
  }[];
  created_at: string;
  updated_at: string;
  html_url: string;
};
