import { generateText, streamText, type CoreMessage, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LLMConfig, ProviderType, StreamChunk } from "@repo/types";

export interface LLMProvider {
  generateText(messages: CoreMessage[], config?: Partial<LLMConfig>): Promise<any>;
  streamText(messages: CoreMessage[], config?: Partial<LLMConfig>): AsyncGenerator<StreamChunk>;
  getModel(): LanguageModel;
}

export class UnifiedLLMProvider implements LLMProvider {
  private model: LanguageModel;
  private modelName: string;
  private provider: ProviderType;

  constructor(config: LLMConfig) {
    this.modelName = config.model;
    this.provider = this.detectProvider(config.model);
    this.model = this.createModel(config);
  }

  private detectProvider(modelName: string): ProviderType {
    if (modelName.startsWith("claude")) {
      return "anthropic";
    } else if (modelName.startsWith("gpt") || modelName.startsWith("o1")) {
      return "openai";
    } else if (modelName.startsWith("gemini")) {
      return "google";
    } else if (modelName.includes("llama") || modelName.includes("mixtral")) {
      return "groq";
    } else {
      return "anthropic"; // Default fallback
    }
  }

  private createModel(config: LLMConfig): LanguageModel {
    switch (this.provider) {
      case "anthropic":
        return anthropic(this.modelName, {
          apiKey: config.apiKey,
          baseURL: config.baseURL,
        });
      case "openai":
        return openai(this.modelName, {
          apiKey: config.apiKey,
          baseURL: config.baseURL,
        });
      default:
        throw new Error(`Unsupported provider: ${this.provider}`);
    }
  }

  async generateText(messages: CoreMessage[], config: Partial<LLMConfig> = {}) {
    const result = await generateText({
      model: this.model,
      messages,
      maxTokens: config.maxTokens || 4096,
      temperature: config.temperature || 0.7,
      topP: config.topP,
      frequencyPenalty: config.frequencyPenalty,
      presencePenalty: config.presencePenalty,
      tools: config.tools,
      toolChoice: config.toolChoice,
      maxSteps: config.maxSteps || 1,
    });

    return result;
  }

  async *streamText(messages: CoreMessage[], config: Partial<LLMConfig> = {}): AsyncGenerator<StreamChunk> {
    const result = await streamText({
      model: this.model,
      messages,
      maxTokens: config.maxTokens || 4096,
      temperature: config.temperature || 0.7,
      topP: config.topP,
      frequencyPenalty: config.frequencyPenalty,
      presencePenalty: config.presencePenalty,
      tools: config.tools,
      toolChoice: config.toolChoice,
      maxSteps: config.maxSteps || 1,
    });

    // Stream text deltas
    for await (const textPart of result.textStream) {
      yield {
        type: "text-delta",
        textDelta: textPart,
        // Legacy compatibility
        content: textPart,
      };
    }

    // Process tool interactions
    for await (const step of result.steps) {
      if (step.stepType === "tool-call") {
        for (const toolCall of step.toolCalls) {
          yield {
            type: "tool-call",
            toolCall: {
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              args: toolCall.args,
            },
          };
        }
      }

      if (step.stepType === "tool-result") {
        for (const toolResult of step.toolResults) {
          yield {
            type: "tool-result",
            toolResult: {
              toolCallId: toolResult.toolCallId,
              result: toolResult.result,
            },
          };
        }
      }

      yield {
        type: "step-finish",
        stepType: step.stepType,
      };
    }

    // Final result
    const finalResult = await result.response;
    
    yield {
      type: "finish",
      finishReason: finalResult.finishReason,
      usage: {
        promptTokens: finalResult.usage.promptTokens,
        completionTokens: finalResult.usage.completionTokens,
        totalTokens: finalResult.usage.totalTokens,
      },
    };
  }

  getModel(): LanguageModel {
    return this.model;
  }

  getModelName(): string {
    return this.modelName;
  }

  getProvider(): ProviderType {
    return this.provider;
  }
}

// Factory function for creating providers
export function createLLMProvider(config: LLMConfig): UnifiedLLMProvider {
  return new UnifiedLLMProvider(config);
}

// Legacy API compatibility
export interface APIHandler {
  createMessage(systemPrompt: string, messages: CoreMessage[]): AsyncGenerator<StreamChunk>;
  getModel(): { name: string; provider: ProviderType };
}

export class LegacyAPIHandler implements APIHandler {
  private provider: UnifiedLLMProvider;

  constructor(config: LLMConfig) {
    this.provider = new UnifiedLLMProvider(config);
  }

  async *createMessage(systemPrompt: string, messages: CoreMessage[]): AsyncGenerator<StreamChunk> {
    const allMessages: CoreMessage[] = systemPrompt 
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : messages;

    yield* this.provider.streamText(allMessages);
  }

  getModel(): { name: string; provider: ProviderType } {
    return {
      name: this.provider.getModelName(),
      provider: this.provider.getProvider(),
    };
  }
}