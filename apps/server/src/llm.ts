import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import {
  Message,
  ModelType,
  StreamChunk,
  AIStreamChunk,
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

      // Convert our messages to AI SDK CoreMessage format
      const coreMessages: CoreMessage[] = messages.map(toCoreMessage);

      console.log("coreMessages", coreMessages);

      // Create tools with task context if taskId is provided
      const tools = taskId ? createTools(taskId, workspacePath) : undefined;

      const streamConfig: any = {
        model: modelInstance,
        system: systemPrompt,
        messages: coreMessages,
        maxTokens: 4096,
        temperature: 0.7,
        maxSteps: MAX_STEPS,
        ...(enableTools && tools && { tools }),
      };
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
              yield {
                type: "usage",
                usage: {
                  promptTokens: chunk.usage.promptTokens,
                  completionTokens: chunk.usage.completionTokens,
                  totalTokens: chunk.usage.totalTokens,
                },
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
      const coreMessages: CoreMessage[] = messages.map(toCoreMessage);

      // Create tools with task context if taskId is provided
      const tools = taskId ? createTools(taskId, workspacePath) : undefined;

      const config = {
        model: modelInstance,
        system: systemPrompt,
        messages: coreMessages,
        maxTokens: 4096,
        temperature: 0.7,
        maxSteps: MAX_STEPS,
        ...(enableTools && tools && { tools }),
      };

      const result = await generateText(config);

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
      models.push("claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022");
    }

    if (config.openaiApiKey) {
      models.push("gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o3", "o4-mini-high");
    }

    return models;
  }
}
