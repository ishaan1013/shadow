import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  AIStreamChunk,
  Message,
  ModelType,
  StreamChunk,
  ToolResultTypes,
  ValidationErrorResult,
  ToolName,
  ToolResultSchemas,
  getModelProvider,
  toCoreMessage,
  createValidator,
} from "@repo/types";
import { CoreMessage, LanguageModel, generateText, streamText } from "ai";
import { createTools } from "./tools";

const MAX_STEPS = 50;

export class LLMService {
  /**
   * Validates a tool result and creates a graceful error result if validation fails
   */
  private validateToolResult(
    toolName: ToolName,
    result: unknown
  ): {
    isValid: boolean;
    validatedResult: ToolResultTypes["result"] | ValidationErrorResult;
    shouldEmitError: boolean;
    errorDetails?: {
      error: string;
      suggestedFix: string;
      originalResult: unknown;
    };
  } {
    try {
      // toolName is guaranteed to be valid, validate the result directly
      const schema = ToolResultSchemas[toolName];
      const validation = createValidator(schema)(result);

      if (validation.success) {
        return {
          isValid: true,
          validatedResult: validation.data!,
          shouldEmitError: false,
        };
      }

      // Generate helpful error message for the LLM
      const errorMessage = `Tool call validation failed for ${toolName}: ${validation.error}`;
      const suggestedFix = this.generateToolValidationSuggestion(
        toolName,
        validation.error || ""
      );

      const errorResult: ValidationErrorResult = {
        success: false,
        error: errorMessage,
        suggestedFix,
        originalResult: result,
        validationDetails: {
          expectedType: "Valid tool result schema",
          receivedType: typeof result,
          fieldPath: validation.error || "",
        },
      };

      return {
        isValid: false,
        validatedResult: errorResult,
        shouldEmitError: true,
        errorDetails: {
          error: errorMessage,
          suggestedFix,
          originalResult: result,
        },
      };
    } catch (error) {
      // Fallback for unexpected validation errors
      const fallbackMessage = `Unexpected validation error for tool ${toolName}: ${error instanceof Error ? error.message : "Unknown error"}`;

      return {
        isValid: false,
        validatedResult: {
          success: false,
          error: fallbackMessage,
          suggestedFix:
            "Please retry the tool call with valid parameters according to the tool schema.",
          originalResult: result,
        } as ValidationErrorResult,
        shouldEmitError: true,
        errorDetails: {
          error: fallbackMessage,
          suggestedFix:
            "Please retry the tool call with valid parameters according to the tool schema.",
          originalResult: result,
        },
      };
    }
  }

  /**
   * Generates helpful suggestions for tool validation errors
   */
  private generateToolValidationSuggestion(
    toolName: string,
    validationError: string
  ): string {
    const lowerError = validationError.toLowerCase();

    // Handle unknown tool errors
    if (lowerError.includes("unknown tool")) {
      const availableTools = Object.keys(ToolResultSchemas).join(", ");
      return `The tool "${toolName}" does not exist. Please use one of the available tools: ${availableTools}`;
    }

    // Handle common validation patterns
    if (lowerError.includes("required")) {
      return `The ${toolName} tool is missing required parameters. Please check the tool schema and provide all required fields.`;
    }

    if (lowerError.includes("invalid_type")) {
      return `The ${toolName} tool received incorrect parameter types. Please ensure all parameters match the expected types in the tool schema.`;
    }

    if (lowerError.includes("boolean") && lowerError.includes("undefined")) {
      return `The ${toolName} tool requires a boolean parameter that was not provided. Please set the missing boolean field to either true or false.`;
    }

    // Tool-specific suggestions
    switch (toolName) {
      case "read_file":
        return "For read_file, ensure 'should_read_entire_file' is provided as a boolean, and if false, provide both start_line_one_indexed and end_line_one_indexed_inclusive as numbers.";
      case "todo_write":
        return "For todo_write, ensure 'merge' is a boolean and 'todos' is an array with valid todo objects containing id, content, and status fields.";
      case "run_terminal_cmd":
        return "For run_terminal_cmd, ensure 'is_background' is provided as a boolean and 'command' is a non-empty string.";
      default:
        return `Please check the ${toolName} tool schema and ensure all required parameters are provided with correct types.`;
    }
  }

  private getModel(
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

  async *createMessageStream(
    systemPrompt: string,
    messages: Message[],
    model: ModelType,
    userApiKeys: { openai?: string; anthropic?: string },
    enableTools: boolean = true,
    taskId?: string,
    workspacePath?: string,
    abortSignal?: AbortSignal
  ): AsyncGenerator<StreamChunk> {
    try {
      const modelInstance = this.getModel(model, userApiKeys);

      console.log("modelInstance", modelInstance);

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

      const toolCallMap = new Map<string, ToolName>(); // toolCallId -> validated toolName

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

          case "tool-call": {
            if (chunk.toolName in ToolResultSchemas) {
              toolCallMap.set(chunk.toolCallId, chunk.toolName as ToolName);

              yield {
                type: "tool-call",
                toolCall: {
                  id: chunk.toolCallId,
                  name: chunk.toolName,
                  args: chunk.args,
                },
              };
            } else {
              // Invalid tool
              const availableTools = Object.keys(ToolResultSchemas).join(", ");
              const errorMessage = `Unknown tool: ${chunk.toolName}. Available tools are: ${availableTools}`;
              const suggestedFix = `Please use one of the available tools: ${availableTools}`;

              console.warn(`[LLM] Invalid tool call: ${chunk.toolName}`);

              // Emit validation error chunk
              yield {
                type: "tool-validation-error",
                toolValidationError: {
                  id: chunk.toolCallId,
                  toolName: chunk.toolName,
                  error: errorMessage,
                  suggestedFix,
                  originalResult: undefined,
                },
              };

              // Also emit the tool-call so the conversation continues
              yield {
                type: "tool-call",
                toolCall: {
                  id: chunk.toolCallId,
                  name: chunk.toolName,
                  args: chunk.args,
                },
              };
            }
            break;
          }

          case "tool-result": {
            const toolName = toolCallMap.get(chunk.toolCallId);

            if (!toolName) {
              console.warn(
                `[LLM] Skipping result for invalid tool call ID: ${chunk.toolCallId}`
              );
              break;
            }

            const validation = this.validateToolResult(toolName, chunk.result);

            if (validation.isValid) {
              yield {
                type: "tool-result",
                toolResult: {
                  id: chunk.toolCallId,
                  result: validation.validatedResult,
                  isValid: true,
                },
              };
            } else {
              // Invalid result - emit both a validation error and a tool-result with error
              console.warn(
                `[LLM] Tool validation failed for ${toolName}:`,
                validation.errorDetails?.error
              );

              // Emit validation error chunk for debugging/monitoring
              yield {
                type: "tool-validation-error",
                toolValidationError: {
                  id: chunk.toolCallId,
                  toolName,
                  error: validation.errorDetails!.error,
                  suggestedFix: validation.errorDetails!.suggestedFix,
                  originalResult: validation.errorDetails!.originalResult,
                },
              };

              // Emit tool-result with validation error as the result
              // This ensures the LLM receives feedback about the validation failure
              yield {
                type: "tool-result",
                toolResult: {
                  id: chunk.toolCallId,
                  result: validation.validatedResult,
                  isValid: false,
                },
              };
            }
            break;
          }

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

  // Helper method to get available models based on user API keys
  getAvailableModels(userApiKeys: {
    openai?: string;
    anthropic?: string;
  }): ModelType[] {
    const models: ModelType[] = [];

    if (userApiKeys.anthropic) {
      models.push("claude-sonnet-4-20250514", "claude-opus-4-20250514");
    }

    if (userApiKeys.openai) {
      models.push("gpt-4o", "o3", "o4-mini-high");
    }

    return models;
  }

  /**
   * Generate PR metadata using LLM based on task context and git changes
   */
  async generatePRMetadata(
    options: {
      taskTitle: string;
      gitDiff: string;
      commitMessages: string[];
      wasTaskCompleted: boolean;
    },
    userApiKeys: { openai?: string; anthropic?: string }
  ): Promise<{
    title: string;
    description: string;
    isDraft: boolean;
  }> {
    try {
      const prompt = this.buildPRGenerationPrompt(options);

      const prModel = userApiKeys.openai
        ? "gpt-4o-mini"
        : // TODO: Add Claude 3.5 Haiku
          "claude-sonnet-4-20250514";

      const { text } = await generateText({
        model: this.getModel(prModel, userApiKeys),
        temperature: 0.3,
        maxTokens: 1000,
        prompt,
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
