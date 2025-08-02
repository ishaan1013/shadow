import { GitHubIssue } from "@repo/types";
import { Branch, GitHubStatus, GroupedRepos } from "./types";

/*
Client-side API functions (for use in hooks)
*/

export async function fetchGitHubStatus(): Promise<GitHubStatus> {
  const response = await fetch("/api/github/status");
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

export async function fetchGitHubRepositories(): Promise<GroupedRepos> {
  const response = await fetch("/api/github/repositories");
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

export async function fetchGitHubBranches(
  repoFullName: string
): Promise<Branch[]> {
  const response = await fetch(`/api/github/branches?repo=${repoFullName}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
}

export async function fetchGitHubIssues(
  repoFullName: string
): Promise<GitHubIssue[]> {
  const response = await fetch(`/api/github/issues?repo=${repoFullName}`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return await response.json();
}
