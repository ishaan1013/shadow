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
import type {
  LanguageModelV1FunctionToolCall,
  LanguageModelV1ProviderMetadata,
} from "@ai-sdk/provider";
import { createTools } from "../../tools";
import { ModelProvider } from "../models/model-provider";
import { ChunkHandlers } from "./chunk-handlers";

const MAX_STEPS = 100;

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
    preCreatedTools?: ToolSet
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
      const isOpenAIModel = modelProvider === "openai";
      // Treat any model id starting with "gpt-5" as part of the GPT-5 family (includes mini variants)
      const isGpt5Family = (model as unknown as string)?.startsWith("gpt-5");

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

      const DEFAULT_GPT5_MAX_COMPLETION_TOKENS = 4096;

      const reasoningProviderOptions: LanguageModelV1ProviderMetadata = {
        anthropic: {
          thinking: {
            type: "enabled",
            budgetTokens: 12000,
          },
        },
        ...(isOpenAIModel && isGpt5Family
          ? {
              openai: {
                // AI SDK providerOptions style; SDK maps to OpenAI REST
                reasoningEffort: "high" as const,
              },
            }
          : {}),
      };

      const streamConfig = {
        model: modelInstance,
        ...(isAnthropicModel ? {} : { system: systemPrompt }),
        messages: finalMessages,
        // For GPT-5 family, temperature must be 1
        temperature: isOpenAIModel && isGpt5Family ? 1 : 0.7,
        // Map to OpenAI max_completion_tokens for reasoning models
        ...(isOpenAIModel && isGpt5Family
          ? { maxOutputTokens: DEFAULT_GPT5_MAX_COMPLETION_TOKENS }
          : {}),
        maxSteps: MAX_STEPS,
        providerOptions: reasoningProviderOptions,
        ...(isAnthropicModel && {
          headers: {
            "anthropic-beta": "interleaved-thinking-2025-05-14",
          },
        }),
        ...(enableTools && tools && { tools, toolCallStreaming: true }),
        ...(abortSignal && { abortSignal }),
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
              // Log error details for debugging
              console.log(
                `[REPAIR_DEBUG] Tool call repair triggered for ${toolCall.toolName}:`,
                {
                  errorType: error.constructor.name,
                  errorMessage: error.message,
                  isInvalidArgs: error instanceof InvalidToolArgumentsError,
                  isNoSuchTool: error instanceof NoSuchToolError,
                  originalArgs: toolCall.args,
                  toolCallId: toolCall.toolCallId,
                }
              );

              // Only handle parameter validation errors, let other errors fail normally
              if (error.constructor.name !== "InvalidToolArgumentsError") {
                console.log(
                  `[REPAIR_DEBUG] Skipping repair - error type: ${error.constructor.name}, instanceof check: ${error instanceof InvalidToolArgumentsError}`
                );
                return null;
              }

              try {
                console.log(
                  `[REPAIR_DEBUG] Attempting repair for ${toolCall.toolName} with error: ${error.message}`
                );

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

                console.log(`[REPAIR_DEBUG] Repair result:`, {
                  toolCallsCount: repairResult.toolCalls?.length || 0,
                  toolCallNames:
                    repairResult.toolCalls?.map((tc) => tc.toolName) || [],
                  targetToolName: toolCall.toolName,
                });

                // Extract the first tool call that matches our tool name
                const repairedToolCall = repairResult.toolCalls?.find(
                  (tc) => tc.toolName === toolCall.toolName
                );

                if (repairedToolCall) {
                  console.log(
                    `[REPAIR_DEBUG] Successfully repaired ${toolCall.toolName}:`,
                    {
                      originalArgs: toolCall.args,
                      repairedArgs: JSON.stringify(repairedToolCall.args),
                    }
                  );

                  return {
                    toolCallType: "function" as const,
                    toolCallId: toolCall.toolCallId, // Keep original ID
                    toolName: repairedToolCall.toolName,
                    args: JSON.stringify(repairedToolCall.args),
                  };
                }

                console.log(
                  `[REPAIR_DEBUG] No matching tool call found in repair response for ${toolCall.toolName}`
                );
                return null;
              } catch (repairError) {
                console.log(`[REPAIR_DEBUG] Repair attempt failed:`, {
                  error:
                    repairError instanceof Error
                      ? repairError.message
                      : String(repairError),
                  toolName: toolCall.toolName,
                });
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
        anthropicLength: userApiKeys.anthropic?.length || 0,
      });

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
      // Stream creation with error handling
      let result;
      try {
        result = streamText(streamConfig);

        // Handle environment difference: production returns Promise, local returns direct result
        const isPromise = result instanceof Promise;

        if (isPromise) {
          result = await result;
        }
      } catch (error) {
        console.error("[LLM_STREAM_ERROR] streamText threw error:", error);
        throw error;
      }

      const toolCallMap = new Map<string, ToolName>(); // toolCallId -> validated toolName

      // Check if fullStream is accessible (don't rely on truthiness since it could be a getter)
      if (!result.fullStream || !(Symbol.asyncIterator in result.fullStream)) {
        console.error(
          `[LLM_STREAM_ERROR] fullStream is not accessible for task ${taskId}`
        );

        // Try textStream as fallback if fullStream isn't available
        if (result.textStream && Symbol.asyncIterator in result.textStream) {
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
      // For GPT-5 interleaved thinking: show reasoning immediately on step-start
      const isOpenAIModelForReasoning = isOpenAIModel && isGpt5Family;
      let gpt5ReasoningActive = false;
      let chunkCounter = 0;

      console.log(`[GPT5_DEBUG] Stream starting - isGPT5: ${isOpenAIModelForReasoning}, model: ${model}`);

      for await (const chunk of result.fullStream as AsyncIterable<AIStreamChunk>) {
        chunkCounter++;
        console.log(`[GPT5_DEBUG] #${chunkCounter} Received chunk: ${chunk.type}, reasoningActive: ${gpt5ReasoningActive}`);
        
        if (chunk.type === "step-start" && isOpenAIModelForReasoning) {
          // Close previous reasoning if still active
          if (gpt5ReasoningActive) {
            console.log(`[GPT5_DEBUG] #${chunkCounter} CLOSING previous reasoning (was active)`);
            yield { type: "reasoning-signature", reasoningSignature: "gpt5" };
          }
          console.log(`[GPT5_DEBUG] #${chunkCounter} STARTING new reasoning session`);
          yield { type: "reasoning", reasoning: "" };
          gpt5ReasoningActive = true;
          continue;
        }
        
        if (chunk.type === "step-finish" && isOpenAIModelForReasoning) {
          console.log(`[GPT5_DEBUG] #${chunkCounter} SKIPPING step-finish (reasoning: ${gpt5ReasoningActive})`);
          continue; // Skip step-finish, we handle reasoning close on content
        }

        // Close reasoning ONLY for actual text output, NOT for tool calls (tools are part of reasoning)
        if (gpt5ReasoningActive && isOpenAIModelForReasoning && chunk.type === "text-delta") {
          console.log(`[GPT5_DEBUG] #${chunkCounter} CLOSING reasoning BEFORE text-delta`);
          yield { type: "reasoning-signature", reasoningSignature: "gpt5" };
          gpt5ReasoningActive = false;
        }
        
        // DEBUG: Log reasoning state during tool execution
        if (gpt5ReasoningActive && isOpenAIModelForReasoning && 
            (chunk.type.startsWith("tool-call") || chunk.type === "tool-result")) {
          console.log(`[GPT5_DEBUG] #${chunkCounter} KEEPING reasoning ACTIVE during ${chunk.type}`);
        }

        console.log(`[GPT5_DEBUG] #${chunkCounter} Processing chunk in switch: ${chunk.type}`);
        
        switch (chunk.type) {
          case "text-delta": {
            const streamChunk = this.chunkHandlers.handleTextDelta(chunk);
            if (streamChunk) {
              console.log(`[GPT5_DEBUG] #${chunkCounter} YIELDING text-delta:`, streamChunk.type);
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
              console.log(`[GPT5_DEBUG] #${chunkCounter} YIELDING tool-call:`, streamChunk.type, 'toolCall' in streamChunk ? streamChunk.toolCall?.name : 'N/A');
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
              console.log(`[GPT5_DEBUG] #${chunkCounter} YIELDING tool-call-start:`, streamChunk.type, 'toolCallStart' in streamChunk ? streamChunk.toolCallStart?.name : 'N/A');
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

          case "reasoning": {
            const streamChunk = this.chunkHandlers.handleReasoning(chunk);
            if (streamChunk) {
              console.log(`[GPT5_DEBUG] #${chunkCounter} YIELDING reasoning:`, streamChunk.type);
              yield streamChunk;
            }
            break;
          }

          case "reasoning-signature": {
            const streamChunk =
              this.chunkHandlers.handleReasoningSignature(chunk);
            if (streamChunk) {
              console.log(`[GPT5_DEBUG] #${chunkCounter} YIELDING reasoning-signature:`, streamChunk.type);
              yield streamChunk;
            }
            break;
          }

          case "redacted-reasoning": {
            const streamChunk =
              this.chunkHandlers.handleRedactedReasoning(chunk);
            if (streamChunk) {
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
