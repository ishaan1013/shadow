import { prisma } from "@repo/db";
import { URLSearchParams } from "url";
import config from "../config";

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

export class GitHubTokenManager {
  /**
   * Check if a token is expiring soon (within 5 minutes)
   */
  private isTokenExpiringSoon(expiresAt: Date | null): boolean {
    if (!expiresAt) return false;

    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
    return expiresAt <= fiveMinutesFromNow;
  }

  /**
   * Refresh GitHub access token using refresh token
   */
  private async refreshTokenWithGitHub(
    clientId: string,
    clientSecret: string,
    refreshToken: string
  ): Promise<GitHubTokenResponse> {
    const response = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `GitHub token refresh failed: ${response.status} ${errorText}`
      );
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(
        `GitHub token refresh error: ${data.error_description || data.error}`
      );
    }

    return data;
  }

  /**
   * Update account tokens in database
   */
  private async updateAccountTokens(
    accountId: string,
    tokenResponse: GitHubTokenResponse
  ): Promise<void> {
    const now = new Date();

    // expires_in is in seconds, so we need to convert to milliseconds
    const expiresAt = new Date(now.getTime() + tokenResponse.expires_in * 1000);
    const refreshTokenExpiresAt = new Date(
      now.getTime() + tokenResponse.refresh_token_expires_in * 1000
    );

    await prisma.account.update({
      where: { id: accountId },
      data: {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        accessTokenExpiresAt: expiresAt,
        refreshTokenExpiresAt: refreshTokenExpiresAt,
        updatedAt: now,
      },
    });
  }

  /**
   * Refresh tokens for a user's GitHub account
   */
  async refreshUserTokens(userId: string): Promise<TokenRefreshResult> {
    try {
      // Get user's GitHub account
      const account = await prisma.account.findFirst({
        where: {
          userId,
          providerId: "github",
        },
      });

      if (!account) {
        return {
          success: false,
          error: "No GitHub account found for user",
        };
      }

      if (!account.refreshToken) {
        return {
          success: false,
          error: "No refresh token available",
        };
      }

      // Check if refresh token is expired
      if (
        account.refreshTokenExpiresAt &&
        account.refreshTokenExpiresAt <= new Date()
      ) {
        return {
          success: false,
          error: "Refresh token expired",
        };
      }

      // Get GitHub OAuth app credentials from environment
      const clientId = config.githubClientId;
      const clientSecret = config.githubClientSecret;

      if (!clientId || !clientSecret) {
        return {
          success: false,
          error: "GitHub OAuth credentials not configured",
        };
      }

      // Refresh the token
      const tokenResponse = await this.refreshTokenWithGitHub(
        clientId,
        clientSecret,
        account.refreshToken
      );

      // Update database with new tokens
      await this.updateAccountTokens(account.id, tokenResponse);

      console.log(
        `[TOKEN_MANAGER] Successfully refreshed tokens for user ${userId}`
      );

      return {
        success: true,
        accessToken: tokenResponse.access_token,
      };
    } catch (error) {
      console.error(
        `[TOKEN_MANAGER] Failed to refresh tokens for user ${userId}:`,
        error
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown refresh error",
      };
    }
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  async getValidAccessToken(userId: string): Promise<string | null> {
    try {
      // Get user's GitHub account
      const account = await prisma.account.findFirst({
        where: {
          userId,
          providerId: "github",
        },
      });

      if (!account || !account.accessToken) {
        console.log(`[TOKEN_MANAGER] No access token found for user ${userId}`);
        return null;
      }

      // Check if token is expiring soon
      if (this.isTokenExpiringSoon(account.accessTokenExpiresAt)) {
        console.log(
          `[TOKEN_MANAGER] Token expiring soon for user ${userId}, attempting refresh`
        );

        const refreshResult = await this.refreshUserTokens(userId);

        if (refreshResult.success && refreshResult.accessToken) {
          return refreshResult.accessToken;
        } else {
          console.log(
            `[TOKEN_MANAGER] Token refresh failed for user ${userId}: ${refreshResult.error}`
          );
          return null;
        }
      }

      // Token is still valid
      return account.accessToken;
    } catch (error) {
      console.error(
        `[TOKEN_MANAGER] Error getting valid token for user ${userId}:`,
        error
      );
      return null;
    }
  }
}

// Export singleton instance
export const githubTokenManager = new GitHubTokenManager();
