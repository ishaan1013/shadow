import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { ModelType, getModelProvider } from "@repo/types";
import { LanguageModel } from "ai";

export class ModelProvider {
  /**
   * Creates and returns a language model instance based on the model type and user API keys
   */
  getModel(
    modelId: ModelType,
    userApiKeys: { openai?: string; anthropic?: string }
  ): LanguageModel {
    const provider = getModelProvider(modelId);

    switch (provider) {
      case "anthropic": {
        if (!userApiKeys.anthropic) {
          throw new Error(
            "Anthropic API key not provided. Please configure your API key in settings."
          );
        }

        console.log(
          "Creating Anthropic client with API key",
          userApiKeys.anthropic
        );

        const anthropicClient = createAnthropic({
          apiKey: userApiKeys.anthropic,
        });
        return anthropicClient(modelId);
      }

      case "openai": {
        if (!userApiKeys.openai) {
          throw new Error(
            "OpenAI API key not provided. Please configure your API key in settings."
          );
        }

        console.log("Creating OpenAI client with API key", userApiKeys.openai);

        const openaiClient = createOpenAI({ apiKey: userApiKeys.openai });
        return openaiClient(modelId);
      }

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }
}