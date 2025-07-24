import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import {
  AIStreamChunk,
  Message,
  ModelType,
  StreamChunk,
  getModelProvider,
  toCoreMessage,
} from "@repo/types";
import { CoreMessage, LanguageModel, generateText, streamText } from "ai";
import { DEFAULT_MODEL } from "./chat";
import config from "./config";
import { createTools } from "./tools";

const MAX_STEPS = 20;

export class LLMService {
  private getModel(modelId: ModelType): LanguageModel {
    const provider = getModelProvider(modelId);

    switch (provider) {
      case "anthropic":
        if (!config.anthropicApiKey) {
          throw new Error("Anthropic API key not configured");
        }
        return anthropic(modelId);

      case "openai":
        if (!config.openaiApiKey) {
          throw new Error("OpenAI API key not configured");
        }
        return openai(modelId);

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  /**
   * Creates messages with prompt caching optimization.
   * For Anthropic: Uses cache control on system message for prompts >= 1024 tokens
   * For OpenAI: Automatic caching for prompts >= 1024 tokens
   */
  private createCachedMessages(
    systemPrompt: string,
    messages: CoreMessage[],
    modelId: ModelType
  ): CoreMessage[] {
    const provider = getModelProvider(modelId);
    
    // Estimate tokens (rough approximation: 4 characters per token)
    const estimatedTokens = Math.round(systemPrompt.length / 4);
    
    if (provider === "anthropic" && estimatedTokens >= 1024) {
      // For Anthropic, we need to structure system messages at the head of messages array
      // with cache control on the system prompt
      console.log(`Enabling Anthropic prompt caching for ${estimatedTokens} estimated tokens`);
      return [
        {
          role: 'system',
          content: systemPrompt,
          providerOptions: {
            anthropic: { cacheControl: { type: 'ephemeral' } },
          },
        },
        ...messages,
      ];
    }
    
    // For OpenAI or short prompts, return messages as-is
    // OpenAI handles caching automatically for prompts >= 1024 tokens
    if (provider === "openai" && estimatedTokens >= 1024) {
      console.log(`OpenAI automatic prompt caching will be available for ${estimatedTokens} estimated tokens`);
    }
    
    return messages;
  }

  async *createMessageStream(
    systemPrompt: string,
    messages: Message[],
    model: ModelType = DEFAULT_MODEL,
    enableTools: boolean = true,
    taskId?: string,
    workspacePath?: string,
    abortSignal?: AbortSignal
  ): AsyncGenerator<StreamChunk> {
    try {
      const modelInstance = this.getModel(model);
      const provider = getModelProvider(model);

      // Convert our messages to AI SDK CoreMessage format
      const coreMessages: CoreMessage[] = messages.map(toCoreMessage);

      console.log("coreMessages", coreMessages);

      // Create tools with task context if taskId is provided
      const tools = taskId ? createTools(taskId, workspacePath) : undefined;

      let streamConfig: any;
      const estimatedTokens = Math.round(systemPrompt.length / 4);

      if (provider === "anthropic" && estimatedTokens >= 1024) {
        // For Anthropic with caching, use cached messages structure
        const cachedMessages = this.createCachedMessages(systemPrompt, coreMessages, model);
        streamConfig = {
          model: modelInstance,
          messages: cachedMessages,
          maxTokens: 4096,
          temperature: 0.7,
          maxSteps: MAX_STEPS,
          ...(enableTools && tools && { tools }),
        };
      } else {
        // Standard configuration for OpenAI or short prompts
        streamConfig = {
          model: modelInstance,
          system: systemPrompt,
          messages: coreMessages,
          maxTokens: 4096,
          temperature: 0.7,
          maxSteps: MAX_STEPS,
          ...(enableTools && tools && { tools }),
        };
      }

      if (abortSignal) {
        streamConfig.signal = abortSignal;
      }

      const result = streamText(streamConfig);

      // Use fullStream to get real-time tool calls and results
      for await (const chunk of result.fullStream as AsyncIterable<AIStreamChunk>) {
        switch (chunk.type) {
          case "text-delta": {
            if (chunk.textDelta) {
              yield {
                type: "content",
                content: chunk.textDelta,
              };
            }
            break;
          }

          case "tool-call":
            yield {
              type: "tool-call",
              toolCall: {
                id: chunk.toolCallId,
                name: chunk.toolName,
                args: chunk.args,
              },
            };
            break;

          case "tool-result":
            yield {
              type: "tool-result",
              toolResult: {
                id: chunk.toolCallId,
                result: JSON.stringify(chunk.result),
              },
            };
            break;

          case "finish":
            // Emit final usage and completion
            if (chunk.usage) {
              const usage = {
                promptTokens: chunk.usage.promptTokens,
                completionTokens: chunk.usage.completionTokens,
                totalTokens: chunk.usage.totalTokens,
              };

              // Add cache-specific metadata if available
              const providerMetadata = (chunk as any).providerMetadata;
              if (provider === "anthropic" && providerMetadata?.anthropic?.cacheCreationInputTokens) {
                console.log(`Anthropic cache created: ${providerMetadata.anthropic.cacheCreationInputTokens} tokens`);
              } else if (provider === "openai" && providerMetadata?.openai?.cachedPromptTokens) {
                console.log(`OpenAI cache hit: ${providerMetadata.openai.cachedPromptTokens} tokens`);
              }

              yield {
                type: "usage",
                usage,
              };
            }

            yield {
              type: "complete",
              finishReason:
                chunk.finishReason === "stop"
                  ? "stop"
                  : chunk.finishReason === "length"
                    ? "length"
                    : chunk.finishReason === "content-filter"
                      ? "content-filter"
                      : chunk.finishReason === "tool-calls"
                        ? "tool_calls"
                        : "stop",
            };
            break;

          case "error":
            yield {
              type: "error",
              error:
                chunk.error instanceof Error
                  ? chunk.error.message
                  : "Unknown error occurred",
              finishReason: "error",
            };
            break;
        }
      }
    } catch (error) {
      console.error("LLM Service Error:", error);
      yield {
        type: "error",
        error: error instanceof Error ? error.message : "Unknown error",
        finishReason: "error",
      };
    }
  }

  // Non-streaming method for simple tool usage
  async generateWithTools(
    systemPrompt: string,
    messages: Message[],
    model: ModelType = DEFAULT_MODEL,
    enableTools: boolean = true,
    taskId?: string,
    workspacePath?: string
  ) {
    try {
      const modelInstance = this.getModel(model);
      const provider = getModelProvider(model);
      const coreMessages: CoreMessage[] = messages.map(toCoreMessage);

      // Create tools with task context if taskId is provided
      const tools = taskId ? createTools(taskId, workspacePath) : undefined;

      let config: any;
      const estimatedTokens = Math.round(systemPrompt.length / 4);

      if (provider === "anthropic" && estimatedTokens >= 1024) {
        // For Anthropic with caching, use cached messages structure
        const cachedMessages = this.createCachedMessages(systemPrompt, coreMessages, model);
        config = {
          model: modelInstance,
          messages: cachedMessages,
          maxTokens: 4096,
          temperature: 0.7,
          maxSteps: MAX_STEPS,
          ...(enableTools && tools && { tools }),
        };
      } else {
        // Standard configuration for OpenAI or short prompts
        config = {
          model: modelInstance,
          system: systemPrompt,
          messages: coreMessages,
          maxTokens: 4096,
          temperature: 0.7,
          maxSteps: MAX_STEPS,
          ...(enableTools && tools && { tools }),
        };
      }

      const result = await generateText(config);

      // Log cache usage information
      const providerMetadata = result.providerMetadata as any;
      if (provider === "anthropic" && providerMetadata?.anthropic?.cacheCreationInputTokens) {
        console.log(`Anthropic cache created: ${providerMetadata.anthropic.cacheCreationInputTokens} tokens`);
      } else if (provider === "openai" && providerMetadata?.openai?.cachedPromptTokens) {
        console.log(`OpenAI cache hit: ${providerMetadata.openai.cachedPromptTokens} tokens`);
      }

      return {
        text: result.text,
        usage: {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
        },
        finishReason: result.finishReason,
        toolCalls: result.toolCalls || [],
        toolResults: result.toolResults || [],
      };
    } catch (error) {
      console.error("LLM Service Error:", error);
      throw error;
    }
  }

  // Helper method to get available models based on configured API keys
  getAvailableModels(): ModelType[] {
    const models: ModelType[] = [];

    if (config.anthropicApiKey) {
      models.push("claude-sonnet-4-20250514", "claude-opus-4-20250514");
    }

    if (config.openaiApiKey) {
      models.push("gpt-4o", "o3", "o4-mini-high");
    }

    return models;
  }
}
