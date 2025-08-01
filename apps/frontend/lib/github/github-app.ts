import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

const GITHUB_APP_ID = process.env.GITHUB_APP_ID;
const GITHUB_PRIVATE_KEY = process.env.GITHUB_PRIVATE_KEY;

if (!GITHUB_APP_ID || !GITHUB_PRIVATE_KEY) {
  console.warn(
    "Missing required GitHub App environment variables - GitHub App functionality will be disabled"
  );
}

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  installationId?: string;
}

/**
 * Create an Octokit instance authenticated as a GitHub App installation
 */
export async function createInstallationOctokit(
  installationId: string
): Promise<Octokit> {
  if (!GITHUB_APP_ID || !GITHUB_PRIVATE_KEY) {
    throw new Error("GitHub App not configured");
  }

  const auth = createAppAuth({
    appId: GITHUB_APP_ID,
    privateKey: GITHUB_PRIVATE_KEY.replace(/\\n/g, "\n"), // Handle escaped newlines
    installationId,
  });

  const { token } = await auth({ type: "installation" });

  return new Octokit({
    auth: token,
  });
}

/**
 * Create an Octokit instance authenticated as the GitHub App (not installation)
 */
export function createAppOctokit(): Octokit {
  if (!GITHUB_APP_ID || !GITHUB_PRIVATE_KEY) {
    throw new Error("GitHub App not configured");
  }

  createAppAuth({
    appId: GITHUB_APP_ID,
    privateKey: GITHUB_PRIVATE_KEY.replace(/\\n/g, "\n"),
  });

  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: GITHUB_APP_ID,
      privateKey: GITHUB_PRIVATE_KEY.replace(/\\n/g, "\n"),
    },
  });
}

/**
 * Generate GitHub App installation URL
 */
export function getGitHubAppInstallationUrl() {
  const appSlug = process.env.GITHUB_APP_SLUG;
  if (!appSlug) {
    throw new Error("GITHUB_APP_SLUG environment variable is required");
  }

  return `https://github.com/apps/${appSlug}/installations/new`;
}
