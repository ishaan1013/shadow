import {
  AIStreamChunk,
  Message,
  ModelType,
  StreamChunk,
  ToolName,
  getModelProvider,
  toCoreMessage,
  ApiKeys,
} from "@repo/types";
import {
  CoreMessage,
  streamText,
  generateText,
  NoSuchToolError,
  InvalidToolArgumentsError,
  ToolSet,
} from "ai";
import type { LanguageModelV1FunctionToolCall } from "@ai-sdk/provider";
import { createTools } from "../../tools";
import { ModelProvider } from "../models/model-provider";
import { ChunkHandlers } from "./chunk-handlers";

const MAX_STEPS = 300;

export class StreamProcessor {
  private modelProvider = new ModelProvider();
  private chunkHandlers = new ChunkHandlers();

  async *createMessageStream(
    systemPrompt: string,
    messages: Message[],
    model: ModelType,
    userApiKeys: ApiKeys,
    enableTools: boolean = true,
    taskId: string,
    workspacePath?: string,
    abortSignal?: AbortSignal,
    preCreatedTools?: ToolSet,
    thinkingConfig?: {
      enabled: boolean;
      budgetTokens?: number;
    }
  ): AsyncGenerator<StreamChunk> {
    try {
      const modelInstance = this.modelProvider.getModel(model, userApiKeys);

      // Convert our messages to AI SDK CoreMessage format
      const coreMessages: CoreMessage[] = messages.map(toCoreMessage);

      // Use pre-created tools if provided, otherwise create tools with task context if taskId is provided
      const tools =
        preCreatedTools || (await createTools(taskId, workspacePath));

      const modelProvider = getModelProvider(model);
      const isAnthropicModel = modelProvider === "anthropic";

      let finalMessages: CoreMessage[];
      if (isAnthropicModel) {
        const systemMessages = coreMessages.filter(
          (msg) => msg.role === "system"
        );
        const nonSystemMessages = coreMessages.filter(
          (msg) => msg.role !== "system"
        );

        finalMessages = [
          {
            role: "system",
            content: systemPrompt,
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral" } },
            },
          } as CoreMessage,
          ...systemMessages,
          ...nonSystemMessages,
        ];
      } else {
        finalMessages = coreMessages;
      }

      // Check if model supports thinking
      const supportsThinking = (() => {
        try {
          const {
            supportsThinking: supportsThinkingFn,
          } = require("@repo/types");
          return supportsThinkingFn(model);
        } catch {
          return false;
        }
      })();

      // Determine if thinking should be enabled
      const thinkingEnabled = thinkingConfig?.enabled ?? true; // Default to enabled for supported models
      const shouldEnableThinking =
        supportsThinking && isAnthropicModel && thinkingEnabled;

      // Prepare headers for thinking support
      const headers: Record<string, string> = {};
      if (shouldEnableThinking) {
        headers["anthropic-beta"] = "interleaved-thinking-2025-05-14";
      }

      const streamConfig = {
        model: modelInstance,
        ...(isAnthropicModel ? {} : { system: systemPrompt }),
        messages: finalMessages,
        maxTokens: 4096,
        temperature: 0.7,
        maxSteps: MAX_STEPS,
        ...(enableTools && tools && { tools, toolCallStreaming: true }),
        ...(abortSignal && { abortSignal }),
        ...(Object.keys(headers).length > 0 && { headers }),
        ...(shouldEnableThinking && {
          providerOptions: {
            anthropic: {
              thinking: {
                type: "enabled" as const,
                budgetTokens: thinkingConfig?.budgetTokens ?? 10000, // Default thinking budget
              },
            },
          },
        }),
        ...(enableTools &&
          tools && {
            experimental_repairToolCall: async ({
              system,
              messages,
              toolCall,
              tools,
              error,
            }: {
              system: string | undefined;
              messages: CoreMessage[];
              toolCall: LanguageModelV1FunctionToolCall;
              tools: ToolSet;
              error: NoSuchToolError | InvalidToolArgumentsError;
            }): Promise<LanguageModelV1FunctionToolCall | null> => {
              // Only handle parameter validation errors, let other errors fail normally
              if (error.constructor.name !== "InvalidToolArgumentsError") {
                return null;
              }

              try {
                // Re-ask the model with error context
                const repairResult = await generateText({
                  model: modelInstance,
                  system: system || systemPrompt,
                  messages: [
                    ...messages,
                    {
                      role: "assistant" as const,
                      content: `I attempted to call the tool ${toolCall.toolName} with arguments: ${toolCall.args}`,
                    },
                    {
                      role: "user" as const,
                      content: `Error: ${error.message}\n\nPlease retry this tool call with the correct parameters.`,
                    },
                  ],
                  tools,
                });

                // Extract the first tool call that matches our tool name
                const repairedToolCall = repairResult.toolCalls?.find(
                  (tc) => tc.toolName === toolCall.toolName
                );

                if (repairedToolCall) {
                  return {
                    toolCallType: "function" as const,
                    toolCallId: toolCall.toolCallId, // Keep original ID
                    toolName: repairedToolCall.toolName,
                    args: JSON.stringify(repairedToolCall.args),
                  };
                }

                console.log(
                  `[REPAIR] No matching tool call found in repair response`
                );
                return null;
              } catch (_repairError) {
                return null;
              }
            },
          }),
      };

      // Log cache control usage for debugging
      if (isAnthropicModel) {
        console.log(
          `[LLM] Using Anthropic model ${model} with prompt caching enabled`
        );
      }

      // Pre-stream validation logs
      console.log("[DEBUG_STREAM] Model instance type:", typeof modelInstance);
      console.log(
        "[DEBUG_STREAM] Model instance keys:",
        Object.keys(modelInstance || {})
      );

      // Log API keys validation
      console.log("[DEBUG_STREAM] API keys present:", {
        anthropic: !!userApiKeys.anthropic,
        openai: !!userApiKeys.openai,
        openrouter: !!userApiKeys.openrouter,
        anthropicLength: userApiKeys.anthropic?.length || 0,
        openaiLength: userApiKeys.openai?.length || 0,
        openrouterLength: userApiKeys.openrouter?.length || 0,
      });

      // Log model provider info
      console.log("[DEBUG_STREAM] Model provider:", modelProvider);
      console.log("[DEBUG_STREAM] Model ID:", model);

      // Log streamConfig validation
      console.log(
        "[DEBUG_STREAM] StreamConfig keys:",
        Object.keys(streamConfig)
      );
      console.log(
        "[DEBUG_STREAM] StreamConfig model:",
        streamConfig.model?.constructor?.name
      );
      console.log(
        "[DEBUG_STREAM] StreamConfig messages length:",
        streamConfig.messages?.length
      );
      console.log(
        "[DEBUG_STREAM] StreamConfig has tools:",
        !!streamConfig.tools
      );

      if (process.env.NODE_ENV === "production") {
        // Test basic LLM connectivity with simple generateText call
        console.log("[DEBUG_STREAM] Testing basic LLM connectivity...");
        try {
          const testResult = await generateText({
            model: modelInstance,
            messages: [{ role: "user", content: "Hello" }],
            maxTokens: 10,
          });
          console.log("[DEBUG_STREAM] LLM connectivity test SUCCESS:", {
            textLength: testResult.text?.length || 0,
            usage: testResult.usage,
          });
        } catch (testError) {
          console.error(
            "[DEBUG_STREAM] LLM connectivity test FAILED:",
            testError
          );
          console.error("[DEBUG_STREAM] Test error details:", {
            name: testError instanceof Error ? testError.name : "Unknown",
            message:
              testError instanceof Error
                ? testError.message
                : String(testError),
          });
        }
      }

      // Stream creation with error handling
      let result;
      try {
        console.log("[DEBUG_STREAM] Calling streamText with config...");
        result = streamText(streamConfig);

        // Handle environment difference: production returns Promise, local returns direct result
        const isPromise = result instanceof Promise;
        console.log("[DEBUG_STREAM] streamText returned Promise:", isPromise);

        if (isPromise) {
          console.log("[DEBUG_STREAM] Awaiting Promise result...");
          result = await result;
          console.log("[DEBUG_STREAM] Promise resolved successfully");
        } else {
          console.log(
            "[DEBUG_STREAM] Direct result returned (local environment)"
          );
        }
      } catch (error) {
        console.error("[DEBUG_STREAM] streamText threw error:", error);
        console.error("[DEBUG_STREAM] Error details:", {
          name: error instanceof Error ? error.name : "Unknown",
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : "No stack trace",
        });
        throw error;
      }

      // Result object analysis - use proper property detection instead of Object.keys()
      console.log("[DEBUG_STREAM] Result object analysis:");
      console.log("[DEBUG_STREAM] Result type:", typeof result);
      console.log("[DEBUG_STREAM] Result is null/undefined:", result == null);
      console.log(
        "[DEBUG_STREAM] Result constructor:",
        result?.constructor?.name
      );
      console.log(
        "[DEBUG_STREAM] Result is Promise:",
        result instanceof Promise
      );

      // Object.keys() doesn't show non-enumerable properties - check directly
      console.log("[DEBUG_STREAM] fullStream exists:", !!result.fullStream);
      console.log("[DEBUG_STREAM] fullStream type:", typeof result.fullStream);
      console.log("[DEBUG_STREAM] textStream exists:", !!result.textStream);
      console.log("[DEBUG_STREAM] textStream type:", typeof result.textStream);

      // Check if streams are iterable
      console.log(
        "[DEBUG_STREAM] fullStream iterable:",
        result.fullStream && Symbol.asyncIterator in result.fullStream
      );

      // Show all properties including non-enumerable ones
      const descriptors = Object.getOwnPropertyDescriptors(result || {});
      console.log(
        "[DEBUG_STREAM] All property names:",
        Object.keys(descriptors)
      );

      // Additional debugging for production issue
      console.log(
        "[DEBUG_STREAM] Result JSON (first 200 chars):",
        JSON.stringify(result).substring(0, 200)
      );
      console.log(
        "[DEBUG_STREAM] Result prototype:",
        Object.getPrototypeOf(result)?.constructor?.name
      );
      console.log(
        "[DEBUG_STREAM] Result own properties:",
        Object.getOwnPropertyNames(result)
      );
      console.log(
        "[DEBUG_STREAM] Result symbols:",
        Object.getOwnPropertySymbols(result).map((s) => s.toString())
      );

      // Note: StreamTextResult doesn't have an error property
      // Errors are handled through the stream itself or thrown during creation

      const toolCallMap = new Map<string, ToolName>(); // toolCallId -> validated toolName

      // Check if fullStream is accessible (don't rely on truthiness since it could be a getter)
      if (!result.fullStream || !(Symbol.asyncIterator in result.fullStream)) {
        console.error(
          `[LLM_STREAM_ERROR] fullStream is not accessible for task ${taskId}`
        );
        console.log(
          "[DEBUG_STREAM] Attempting to use textStream as fallback..."
        );

        // Try textStream as fallback if fullStream isn't available
        if (result.textStream && Symbol.asyncIterator in result.textStream) {
          console.log("[DEBUG_STREAM] Using textStream fallback");
          for await (const textPart of result.textStream) {
            yield {
              type: "content",
              content: textPart,
            };
          }
          return;
        }

        console.error(
          "[LLM_STREAM_ERROR] Neither fullStream nor textStream are available"
        );
        yield {
          type: "error",
          error:
            "Stream initialization failed - no accessible stream properties",
          finishReason: "error",
        };
        return;
      }

      // Use fullStream to get real-time tool calls and results
      console.log(
        "[DEBUG_STREAM] Starting to iterate over fullStream for model:",
        model
      );
      let chunkCount = 0;
      for await (const chunk of result.fullStream as AsyncIterable<AIStreamChunk>) {
        chunkCount++;
        console.log(
          `[DEBUG_STREAM] Received chunk ${chunkCount}, type: ${chunk.type} for model: ${model}`
        );

        switch (chunk.type) {
          case "text-delta": {
            const streamChunk = this.chunkHandlers.handleTextDelta(chunk);
            if (streamChunk) {
              yield streamChunk;
            }
            break;
          }

          case "thinking-delta": {
            const streamChunk = this.chunkHandlers.handleThinkingDelta(chunk);
            if (streamChunk) {
              yield streamChunk;
            }
            break;
          }

          case "thinking": {
            const streamChunk = this.chunkHandlers.handleThinking(chunk);
            if (streamChunk) {
              yield streamChunk;
            }
            break;
          }

          case "tool-call": {
            const streamChunks = this.chunkHandlers.handleToolCall(
              chunk,
              toolCallMap
            );
            for (const streamChunk of streamChunks) {
              yield streamChunk;
            }
            break;
          }

          case "tool-call-streaming-start": {
            const streamChunks =
              this.chunkHandlers.handleToolCallStreamingStart(
                chunk,
                toolCallMap
              );
            for (const streamChunk of streamChunks) {
              yield streamChunk;
            }
            break;
          }

          case "tool-call-delta": {
            const streamChunks = this.chunkHandlers.handleToolCallDelta(chunk);
            for (const streamChunk of streamChunks) {
              yield streamChunk;
            }
            break;
          }

          case "tool-result": {
            const streamChunk = this.chunkHandlers.handleToolResult(
              chunk,
              toolCallMap
            );
            if (streamChunk) {
              yield streamChunk;
            }
            break;
          }

          case "finish": {
            const streamChunks = this.chunkHandlers.handleFinish(chunk, model);
            for (const streamChunk of streamChunks) {
              yield streamChunk;
            }
            break;
          }

          case "error": {
            const streamChunk = this.chunkHandlers.handleError(chunk);
            yield streamChunk;
            break;
          }
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
}
