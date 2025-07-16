import { generateText, streamText, type CoreMessage, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { StreamChunk, LLMConfig, ProviderType } from "@repo/types";
import config from "./config";

export class LLMService {
  private getModel(modelName: string, provider?: ProviderType): LanguageModel {
    // Auto-detect provider from model name if not specified
    const detectedProvider = provider || this.detectProvider(modelName);
    
    switch (detectedProvider) {
      case "anthropic":
        return anthropic(modelName, {
          apiKey: config.anthropicApiKey,
        });
      case "openai":
        return openai(modelName, {
          apiKey: config.openaiApiKey,
        });
      default:
        throw new Error(`Unsupported provider: ${detectedProvider}`);
    }
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
      // Default to anthropic for backward compatibility
      return "anthropic";
    }
  }

  async generateText(
    messages: CoreMessage[],
    config: Partial<LLMConfig> = {}
  ) {
    const model = this.getModel(config.model || "claude-3-5-sonnet-20241022");
    
    const result = await generateText({
      model,
      messages,
      maxTokens: config.maxTokens || 4096,
      temperature: config.temperature || 0.7,
      tools: config.tools,
      toolChoice: config.toolChoice,
      maxSteps: config.maxSteps || 1,
    });

    return result;
  }

  async *createMessageStream(
    systemPrompt: string,
    messages: CoreMessage[],
    llmConfig: Partial<LLMConfig> = {}
  ): AsyncGenerator<StreamChunk> {
    const model = this.getModel(llmConfig.model || "claude-3-5-sonnet-20241022");
    
    // Add system message if provided
    const allMessages: CoreMessage[] = systemPrompt 
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : messages;

    const result = await streamText({
      model,
      messages: allMessages,
      maxTokens: llmConfig.maxTokens || 4096,
      temperature: llmConfig.temperature || 0.7,
      tools: llmConfig.tools,
      toolChoice: llmConfig.toolChoice,
      maxSteps: llmConfig.maxSteps || 1,
    });

    // Stream text deltas
    for await (const textPart of result.textStream) {
      yield {
        type: "text-delta",
        textDelta: textPart,
        // Legacy format for backward compatibility
        content: textPart,
      };
    }

    // Process tool calls if any
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
    }

    // Get final usage and finish reason
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

  // Legacy method for backward compatibility
  async *createMessageStreamLegacy(
    systemPrompt: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    model: string = "claude-3-5-sonnet-20241022"
  ): AsyncGenerator<StreamChunk> {
    const coreMessages: CoreMessage[] = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    yield* this.createMessageStream(systemPrompt, coreMessages, { model });
  }
}
