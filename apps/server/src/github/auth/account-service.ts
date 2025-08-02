import { prisma } from "@repo/db";
import { githubTokenManager } from "./token-manager";

export async function getGitHubAccount(userId: string) {
  const account = await prisma.account.findFirst({
    where: {
      userId,
      providerId: "github",
    },
  });

  return account;
}

/**
 * Get a valid GitHub access token for a user, refreshing if necessary
 * @param userId - The user ID
 * @returns A valid access token or null if authentication is needed
 */
export async function getGitHubAccessToken(
  userId: string
): Promise<string | null> {
  return await githubTokenManager.getValidAccessToken(userId);
}
