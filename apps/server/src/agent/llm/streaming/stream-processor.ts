import {
  AIStreamChunk,
  Message,
  ModelType,
  StreamChunk,
  ToolName,
  getModelProvider,
  toCoreMessage,
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

const MAX_STEPS = 50;

export class StreamProcessor {
  private modelProvider = new ModelProvider();
  private chunkHandlers = new ChunkHandlers();

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
      const modelInstance = this.modelProvider.getModel(model, userApiKeys);

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

      const result = streamText(streamConfig);

      const toolCallMap = new Map<string, ToolName>(); // toolCallId -> validated toolName

      // Use fullStream to get real-time tool calls and results
      for await (const chunk of result.fullStream as AsyncIterable<AIStreamChunk>) {
        switch (chunk.type) {
          case "text-delta": {
            const streamChunk = this.chunkHandlers.handleTextDelta(chunk);
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
