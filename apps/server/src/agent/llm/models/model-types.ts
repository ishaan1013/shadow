import { ModelType, AvailableModels } from "@repo/types";

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
      models.push(AvailableModels.CLAUDE_SONNET_4, AvailableModels.CLAUDE_OPUS_4);
    }

    if (userApiKeys.openai) {
      models.push(AvailableModels.GPT_4O, AvailableModels.O3, AvailableModels.GPT_4_1);
    }

    return models;
  }
}
