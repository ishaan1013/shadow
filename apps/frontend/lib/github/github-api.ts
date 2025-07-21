"use server";

import { getGitHubAccount } from "@/lib/db-operations/get-github-account";
import { clearGitHubInstallation } from "@/lib/db-operations/update-github-account";
import {
  createInstallationOctokit,
  getGitHubAppInstallationUrl,
} from "@/lib/github/github-app";
import { formatTimeAgo } from "@/lib/utils";
import {
  Branch,
  FilteredRepository,
  GitHubStatus,
  GroupedRepos,
  UserRepository,
} from "./types";

function filterRepositoryData(repo: UserRepository): FilteredRepository {
  return {
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    owner: {
      id: repo.owner?.id,
      login: repo.owner?.login || "",
      type: repo.owner?.type || "User",
    },
    pushed_at: repo.pushed_at,
  };
}

function groupReposByOrg(
  repositories: FilteredRepository[],
  accountId: string
): GroupedRepos {
  const userGroups: { [name: string]: FilteredRepository[] } = {};
  const orgGroups: { [name: string]: FilteredRepository[] } = {};

  // Separate user repos from org repos
  repositories.forEach((repo) => {
    if (repo.owner.id === parseInt(accountId)) {
      const userName = repo.owner.login;
      if (!userGroups[userName]) {
        userGroups[userName] = [];
      }
      userGroups[userName].push(repo);
    } else {
      const orgName = repo.owner.login;
      if (!orgGroups[orgName]) {
        orgGroups[orgName] = [];
      }
      orgGroups[orgName].push(repo);
    }
  });

  // Build ordered groups array: sort groups by most recent activity within each group
  const groups: GroupedRepos["groups"] = [];

  // Explicitly sort repositories within each owner bucket by pushed_at (newest first)
  Object.values(userGroups).forEach((repos) =>
    repos.sort(
      (a, b) =>
        new Date(b.pushed_at || 0).getTime() - new Date(a.pushed_at || 0).getTime()
    )
  );
  Object.values(orgGroups).forEach((repos) =>
    repos.sort(
      (a, b) =>
        new Date(b.pushed_at || 0).getTime() - new Date(a.pushed_at || 0).getTime()
    )
  );

  // Add user groups first
  Object.keys(userGroups).forEach((name) => {
    const repositories = userGroups[name];
    if (repositories) {
      groups.push({
        name,
        type: "user" as const,
        repositories,
      });
    }
  });

  // Add org groups alphabetically
  Object.keys(orgGroups)
    .sort()
    .forEach((name) => {
      const repositories = orgGroups[name];
      if (repositories) {
        groups.push({
          name,
          type: "organization" as const,
          repositories,
        });
      }
    });

  return { groups };
}

async function handleStaleInstallation(
  error: any,
  userId: string
): Promise<boolean> {
  // Check if this is a 404 error indicating the installation no longer exists
  if (error?.status === 404 || error?.message?.includes("Not Found")) {
    console.log("Detected stale GitHub installation, clearing from database");
    try {
      await clearGitHubInstallation(userId);
      return true; // Installation was cleared
    } catch (clearError) {
      console.error("Error clearing stale installation:", clearError);
    }
  }
  return false; // Not a stale installation or failed to clear
}

export async function getGitHubStatus(
  userId: string | undefined
): Promise<GitHubStatus> {
  try {
    if (!userId) {
      return {
        isConnected: false,
        isAppInstalled: false,
        installationUrl: undefined,
        message: "User not authenticated",
      };
    }

    // Check if GitHub App is configured
    if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_APP_SLUG) {
      return {
        isConnected: false,
        isAppInstalled: false,
        installationUrl: undefined,
        message: "GitHub App not configured",
      };
    }

    const account = await getGitHubAccount(userId);

    if (!account) {
      return {
        isConnected: false,
        isAppInstalled: false,
        installationUrl: getGitHubAppInstallationUrl(),
        message: "GitHub account not connected",
      };
    }

    const isAppInstalled = !!(
      account.githubAppConnected && account.githubInstallationId
    );

    // If we think the app is installed, let's verify it by trying to create an Octokit instance
    if (isAppInstalled && account.githubInstallationId) {
      try {
        await createInstallationOctokit(account.githubInstallationId);
      } catch (error) {
        // If we get a 404, the installation is stale - clear it
        const wasCleared = await handleStaleInstallation(error, userId);
        if (wasCleared) {
          return {
            isConnected: true,
            isAppInstalled: false,
            installationUrl: getGitHubAppInstallationUrl(),
            message: "GitHub App installation was removed - please reinstall",
          };
        }
        // If it's some other error, treat as not installed
        console.error("Error verifying GitHub installation:", error);
        return {
          isConnected: true,
          isAppInstalled: false,
          installationUrl: getGitHubAppInstallationUrl(),
          message: "Error verifying GitHub App installation",
        };
      }
    }

    return {
      isConnected: true,
      isAppInstalled,
      installationId: account.githubInstallationId || undefined,
      installationUrl: !isAppInstalled
        ? getGitHubAppInstallationUrl()
        : undefined,
      message: isAppInstalled
        ? "GitHub App is installed and connected"
        : "GitHub App needs to be installed for full repository access",
    };
  } catch (error) {
    console.error("Error getting GitHub status:", error);
    return {
      isConnected: false,
      isAppInstalled: false,
      installationUrl: undefined,
      message: "Error checking GitHub status",
    };
  }
}

export async function getGitHubRepositories(
  userId: string | undefined
): Promise<GroupedRepos> {
  if (!userId) {
    return { groups: [] };
  }

  try {
    const account = await getGitHubAccount(userId);

    if (!account) {
      return { groups: [] };
    }

    if (!account.githubAppConnected || !account.githubInstallationId) {
      // Return empty state instead of throwing
      return { groups: [] };
    }

    const octokit = await createInstallationOctokit(
      account.githubInstallationId
    );

    // Fetch repositories from GitHub API sorted by most recently pushed
    const allRepositories: UserRepository[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({
        per_page: perPage,
        page,
        sort: "pushed",
      });

      allRepositories.push(...data.repositories);

      if (data.repositories.length < perPage) {
        break;
      }
      page++;
    }

    const sortedRepositories = allRepositories.sort((a, b) => {
      if (!a.pushed_at || !b.pushed_at) return 0;
      return new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime();
    });

    const filteredRepos = sortedRepositories.map((repo) =>
      filterRepositoryData(repo)
    );
    const groupedRepos = groupReposByOrg(filteredRepos, account.accountId);

    return groupedRepos;
  } catch (error) {
    console.error("Error getting GitHub repositories:", error);

    await handleStaleInstallation(error, userId);

    return { groups: [] };
  }
}

export async function getGitHubBranches(
  repoFullName: string,
  userId: string
): Promise<Branch[]> {
  try {
    // Parse owner and repo name from full_name (e.g., "owner/repo")
    const [owner, repoName] = repoFullName.split("/");
    if (!owner || !repoName) {
      throw new Error("Invalid repository format. Expected 'owner/repo'");
    }

    // Get the GitHub account and create authenticated Octokit instance
    const account = await getGitHubAccount(userId);

    if (!account) {
      // Return empty state instead of throwing
      return [];
    }

    if (!account.githubAppConnected || !account.githubInstallationId) {
      // Return empty state instead of throwing
      return [];
    }

    const octokit = await createInstallationOctokit(
      account.githubInstallationId
    );

    // Fetch branches from GitHub API
    const { data: branches } = await octokit.rest.repos.listBranches({
      owner,
      repo: repoName,
      per_page: 100,
    });

    // Convert to our simplified Branch interface and sort
    const simplifiedBranches: Branch[] = branches.map((branch) => ({
      name: branch.name,
      commit: {
        sha: branch.commit.sha,
        url: branch.commit.url,
      },
      protected: branch.protected,
    }));

    // Sort branches: main/master first, then by name
    return simplifiedBranches.sort((a: Branch, b: Branch) => {
      const isMainA = a.name === "main" || a.name === "master";
      const isMainB = b.name === "main" || b.name === "master";

      if (isMainA && !isMainB) return -1;
      if (!isMainA && isMainB) return 1;

      return a.name.localeCompare(b.name);
    });
  } catch (error) {
    console.error("Error getting GitHub branches:", error);

    // Check if this is a stale installation and clear it
    if (userId) {
      await handleStaleInstallation(error, userId);
    }

    // Return empty state instead of throwing
    return [];
  }
}
