import { ApiKeyProvider } from "@repo/types";

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  latencyMs: number;
}

export class ApiKeyValidator {
  /**
   * Validate an API key for the specified provider
   */
  async validateApiKey(
    provider: ApiKeyProvider,
    apiKey: string
  ): Promise<ValidationResult> {
    console.log(`Validating ${provider} API key...`);
    const startTime = Date.now();

    try {
      switch (provider) {
        case "openai":
          return await this.validateOpenAI(apiKey, startTime);
        case "anthropic":
          return await this.validateAnthropic(apiKey, startTime);
        case "openrouter":
          return await this.validateOpenRouter(apiKey, startTime);
        default:
          throw new Error(`Unsupported provider: ${provider}`);
      }
    } catch (error: any) {
      console.error(`${provider} validation error:`, error?.message);
      return {
        isValid: false,
        error: error?.message || "Unknown validation error",
        latencyMs: Date.now() - startTime,
      };
    }
  }

  private async validateOpenAI(
    apiKey: string,
    startTime: number
  ): Promise<ValidationResult> {
    try {
      // Make a simple API call to validate the key
      const response = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": "Shadow-Agent/1.0",
        },
        signal: AbortSignal.timeout(5000),
      });

      const latencyMs = Date.now() - startTime;

      if (response.status === 200) {
        return { isValid: true, latencyMs };
      } else if (response.status === 401) {
        return {
          isValid: false,
          error: "Invalid OpenAI API key",
          latencyMs,
        };
      } else if (response.status === 429) {
        return {
          isValid: false,
          error: "OpenAI API rate limit exceeded",
          latencyMs,
        };
      } else {
        return {
          isValid: false,
          error: `OpenAI API returned status ${response.status}`,
          latencyMs,
        };
      }
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;

      // Handle specific error types
      if (
        error?.message?.includes("401") ||
        error?.message?.includes("Unauthorized")
      ) {
        return {
          isValid: false,
          error: "Invalid OpenAI API key",
          latencyMs,
        };
      } else if (
        error?.message?.includes("429") ||
        error?.message?.includes("rate limit")
      ) {
        return {
          isValid: false,
          error: "OpenAI API rate limit exceeded",
          latencyMs,
        };
      } else {
        return {
          isValid: false,
          error: `OpenAI validation failed: ${error?.message || "Unknown error"}`,
          latencyMs,
        };
      }
    }
  }

  private async validateAnthropic(
    apiKey: string,
    startTime: number
  ): Promise<ValidationResult> {
    try {
      // Make a simple API call to validate the key
      const response = await fetch("https://api.anthropic.com/v1/models", {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "User-Agent": "Shadow-Agent/1.0",
        },
        signal: AbortSignal.timeout(5000),
      });

      const latencyMs = Date.now() - startTime;

      if (response.status === 200) {
        return { isValid: true, latencyMs };
      } else if (response.status === 401) {
        return {
          isValid: false,
          error: "Invalid Anthropic API key",
          latencyMs,
        };
      } else if (response.status === 429) {
        return {
          isValid: false,
          error: "Anthropic API rate limit exceeded",
          latencyMs,
        };
      } else {
        return {
          isValid: false,
          error: `Anthropic API returned status ${response.status}`,
          latencyMs,
        };
      }
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;

      // Handle specific error types
      if (
        error?.message?.includes("401") ||
        error?.message?.includes("Unauthorized")
      ) {
        return {
          isValid: false,
          error: "Invalid Anthropic API key",
          latencyMs,
        };
      } else if (
        error?.message?.includes("429") ||
        error?.message?.includes("rate limit")
      ) {
        return {
          isValid: false,
          error: "Anthropic API rate limit exceeded",
          latencyMs,
        };
      } else {
        return {
          isValid: false,
          error: `Anthropic validation failed: ${error?.message || "Unknown error"}`,
          latencyMs,
        };
      }
    }
  }

  private async validateOpenRouter(
    apiKey: string,
    startTime: number
  ): Promise<ValidationResult> {
    try {
      // Make a simple API call to validate the key
      const response = await fetch("https://openrouter.ai/api/v1/key", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://shadow-agent.com",
          "X-Title": "Shadow Agent Validation",
        },
        signal: AbortSignal.timeout(5000),
      });

      const latencyMs = Date.now() - startTime;

      if (response.status === 200) {
        return { isValid: true, latencyMs };
      } else if (response.status === 401) {
        return {
          isValid: false,
          error: "Invalid OpenRouter API key",
          latencyMs,
        };
      } else if (response.status === 400) {
        return {
          isValid: false,
          error: "Missing required headers for OpenRouter",
          latencyMs,
        };
      } else {
        return {
          isValid: false,
          error: `OpenRouter API returned status ${response.status}`,
          latencyMs,
        };
      }
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;

      // Handle specific error types
      if (
        error?.message?.includes("401") ||
        error?.message?.includes("Unauthorized")
      ) {
        return {
          isValid: false,
          error: "Invalid OpenRouter API key",
          latencyMs,
        };
      } else if (
        error?.message?.includes("429") ||
        error?.message?.includes("rate limit")
      ) {
        return {
          isValid: false,
          error: "OpenRouter API rate limit exceeded",
          latencyMs,
        };
      } else {
        return {
          isValid: false,
          error: `OpenRouter validation failed: ${error?.message || "Unknown error"}`,
          latencyMs,
        };
      }
    }
  }

  /**
   * Validate multiple API keys concurrently
   */
  async validateMultiple(
    keys: Partial<Record<ApiKeyProvider, string>>
  ): Promise<Record<string, ValidationResult>> {
    const validationPromises = Object.entries(keys)
      .filter(([_, key]) => key && key.length > 0)
      .map(async ([provider, key]) => {
        const result = await this.validateApiKey(
          provider as ApiKeyProvider,
          key!
        );
        return [provider, result] as const;
      });

    const results = await Promise.all(validationPromises);
    return Object.fromEntries(results);
  }
}