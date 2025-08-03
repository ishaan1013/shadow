import { ModelType } from "@repo/types";

export class ModelTypes {
  /**
   * Get available models based on user API keys
   */
  getAvailableModels(userApiKeys: {
    openai?: string;
    anthropic?: string;
  }): ModelType[] {
    const models: ModelType[] = [];

    if (userApiKeys.anthropic) {
      models.push("claude-sonnet-4-20250514", "claude-opus-4-20250514");
    }

    if (userApiKeys.openai) {
      models.push("gpt-4o", "o3", "gpt-4.1-2025-04-14");
    }

    return models;
  }
}
