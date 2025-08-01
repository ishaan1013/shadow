import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import {
  AIStreamChunk,
  Message,
  ModelType,
  StreamChunk,
  ToolResultTypes,
  getModelProvider,
  toCoreMessage,
} from "@repo/types";
import { CoreMessage, LanguageModel, generateText, streamText } from "ai";
import config from "./config";
import { createTools } from "./tools";

const MAX_STEPS = 50;

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
    model: ModelType,
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

      // For Anthropic models, add system prompt as first message with cache control
      // For other providers, use the system parameter
      const isAnthropicModel = getModelProvider(model) === "anthropic";
      const finalMessages: CoreMessage[] = isAnthropicModel
        ? [
            {
              role: "system",
              content: systemPrompt,
              providerOptions: {
                anthropic: { cacheControl: { type: "ephemeral" } },
              },
            } as CoreMessage,
            ...coreMessages,
          ]
        : coreMessages;

      const streamConfig = {
        model: modelInstance,
        ...(isAnthropicModel ? {} : { system: systemPrompt }),
        messages: finalMessages,
        maxTokens: 4096,
        temperature: 0.7,
        maxSteps: MAX_STEPS,
        ...(enableTools && tools && { tools }),
        ...(abortSignal && { abortSignal }),
      };

      // Log cache control usage for debugging
      if (isAnthropicModel) {
        console.log(
          `[LLM] Using Anthropic model ${model} with prompt caching enabled`
        );
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
                result: chunk.result as ToolResultTypes["result"],
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
                  // Include cache metadata for Anthropic models if available
                  // Note: Cache metadata will be available in future AI SDK versions
                  // For now, we'll log when cache control is enabled for debugging
                  ...(getModelProvider(model) === "anthropic" && {
                    cacheCreationInputTokens: undefined, // Will be populated by future SDK versions
                    cacheReadInputTokens: undefined, // Will be populated by future SDK versions
                  }),
                },
              };
            }

            yield {
              type: "complete",
              finishReason: chunk.finishReason,
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

  /**
   * Generate PR metadata using LLM based on task context and git changes
   */
  async generatePRMetadata(options: {
    taskTitle: string;
    gitDiff: string;
    commitMessages: string[];
    wasTaskCompleted: boolean;
  }): Promise<{
    title: string;
    description: string;
    isDraft: boolean;
  }> {
    try {
      const prompt = this.buildPRGenerationPrompt(options);

      const prModel = "gpt-4o-mini";
      const isPrModelAnthropic = getModelProvider(prModel) === "anthropic";

      const { text } = await generateText({
        model: this.getModel(prModel),
        temperature: 0.3,
        maxTokens: 1000,
        ...(isPrModelAnthropic
          ? {
              messages: [
                {
                  role: "system",
                  content: prompt,
                  providerOptions: {
                    anthropic: { cacheControl: { type: "ephemeral" } },
                  },
                } as CoreMessage,
              ],
            }
          : { prompt }),
      });

      const result = this.parsePRMetadata(text);

      console.log(`[LLM] Generated PR metadata:`, {
        title: result.title,
        isDraft: result.isDraft,
        descriptionLength: result.description.length,
      });

      return result;
    } catch (error) {
      console.error(`[LLM] Failed to generate PR metadata:`, error);
      throw error;
    }
  }

  /**
   * Build the prompt for PR metadata generation
   */
  private buildPRGenerationPrompt(options: {
    taskTitle: string;
    gitDiff: string;
    commitMessages: string[];
    wasTaskCompleted: boolean;
  }): string {
    const sections = [
      "Generate a pull request title and description based on the following information:",
      "",
      `**Task Title:** ${options.taskTitle}`,
      `**Task Status:** ${options.wasTaskCompleted ? "Completed successfully" : "Partially completed or stopped early"}`,
      "",
    ];

    if (options.commitMessages.length > 0) {
      sections.push(
        "**Recent Commits:**",
        ...options.commitMessages.map((msg) => `- ${msg}`),
        ""
      );
    }

    if (options.gitDiff.trim()) {
      sections.push(
        "**Git Diff:**",
        "```diff",
        options.gitDiff.slice(0, 3000), // Limit diff size for token efficiency
        "```",
        ""
      );
    }

    sections.push(
      "Please respond with JSON in this exact format:",
      "```json",
      "{",
      '  "title": "Concise PR title (max 50 chars)",',
      '  "description": "• Bullet point description\\n• What was changed\\n• Key files modified",',
      `  "isDraft": ${!options.wasTaskCompleted}`,
      "}",
      "```",
      "",
      "Guidelines:",
      "- Title should be concise and action-oriented (e.g., 'Add user authentication', 'Fix API error handling')",
      "- Description should use bullet points and be informative but concise",
      "- Set isDraft to true only if the task was not fully completed",
      "- Focus on what was implemented, not implementation details"
    );

    return sections.join("\n");
  }

  /**
   * Parse the LLM response to extract PR metadata
   */
  private parsePRMetadata(response: string): {
    title: string;
    description: string;
    isDraft: boolean;
  } {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      if (!jsonMatch || !jsonMatch[1]) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[1]);

      if (!parsed.title || !parsed.description) {
        throw new Error("Missing required fields in response");
      }

      return {
        title: String(parsed.title).slice(0, 50), // Enforce length limit
        description: String(parsed.description),
        isDraft: Boolean(parsed.isDraft),
      };
    } catch (error) {
      console.warn(`[LLM] Failed to parse PR metadata response:`, error);

      const lines = response
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const title =
        lines[0]?.replace(/^#+\s*/, "").slice(0, 50) ||
        "Update code via Shadow agent";
      const description = "Pull request description generation failed.";

      return {
        title,
        description,
        isDraft: true, // Default to draft
      };
    }
  }
}
