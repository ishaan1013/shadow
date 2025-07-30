import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import {
  AIStreamChunk,
  Message,
  ModelType,
  StreamChunk,
  getModelProvider,
  toCoreMessage,
  ParallelToolCall,
} from "@repo/types";
import { CoreMessage, LanguageModel, generateText, streamText } from "ai";
import { DEFAULT_MODEL } from "./chat";
import config from "./config";
import { createTools } from "./tools";
import { ParallelToolExecutor } from "./parallel-tool-executor";

const MAX_STEPS = 50;

export class LLMService {
  private parallelExecutor = new ParallelToolExecutor();

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

      const streamConfig = {
        model: modelInstance,
        system: systemPrompt,
        messages: coreMessages,
        maxTokens: 4096,
        temperature: 0.7,
        maxSteps: MAX_STEPS,
        ...(enableTools && tools && { tools }),
        ...(abortSignal && { abortSignal }),
      };

      const result = streamText(streamConfig);

      // Track pending tool calls for parallel execution
      const pendingToolCalls: ParallelToolCall[] = [];
      let isProcessingParallelBatch = false;

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
            const toolCall: ParallelToolCall = {
              id: chunk.toolCallId,
              name: chunk.toolName,
              args: chunk.args,
            };

            pendingToolCalls.push(toolCall);

            // For now, just emit the individual tool call
            // The parallel execution will be handled in the step-finish phase
            yield {
              type: "tool-call",
              toolCall: {
                id: chunk.toolCallId,
                name: chunk.toolName,
                args: chunk.args,
              },
            };
            break;
          }

          case "tool-result": {
            // Tool results come from the AI SDK's internal execution
            // If we're not using parallel execution, pass them through
            if (!isProcessingParallelBatch) {
              yield {
                type: "tool-result",
                toolResult: {
                  id: chunk.toolCallId,
                  result: chunk.result as any,
                },
              };
            }
            break;
          }

          // Handle step-finish or other step completion events
          // Note: The AI SDK may use different chunk types for step completion
          default: {
            // Check for any step completion logic
            if ((chunk as any).type === "step-finish" || 
                (chunk as any).type === "step-start" ||
                pendingToolCalls.length > 0) {
              
              // At step completion, check if we should execute tools in parallel
              if (pendingToolCalls.length > 1 && taskId && workspacePath) {
                const canExecuteInParallel = this.parallelExecutor.canExecuteInParallel(pendingToolCalls);
                
                if (canExecuteInParallel) {
                  isProcessingParallelBatch = true;
                  console.log(`[LLM_SERVICE] Executing ${pendingToolCalls.length} tools in parallel`);

                                  // Execute tools in parallel and emit progress updates
                // We need to collect the progress chunks and yield them after the execution
                const progressChunks: StreamChunk[] = [];
                
                await this.parallelExecutor.executeInParallel(
                  taskId,
                  workspacePath,
                  pendingToolCalls,
                  (progressChunk) => {
                    // Convert parallel execution chunks to StreamChunk format
                    let streamChunk: StreamChunk;
                    switch (progressChunk.type) {
                      case "parallel-tool-batch-start":
                        streamChunk = {
                          type: "parallel-tool-batch-start",
                          parallelToolBatch: {
                            batchId: progressChunk.batchId,
                            toolCallIds: progressChunk.toolCallIds,
                          },
                        };
                        break;

                      case "parallel-tool-progress":
                        streamChunk = {
                          type: "parallel-tool-progress",
                          parallelToolProgress: {
                            batchId: progressChunk.batchId,
                            toolCallId: progressChunk.toolCallId,
                            status: progressChunk.status,
                            result: progressChunk.result,
                            error: progressChunk.error,
                            executionTimeMs: progressChunk.executionTimeMs,
                          },
                        };
                        break;

                      case "parallel-tool-batch-complete":
                        streamChunk = {
                          type: "parallel-tool-batch-complete",
                          parallelToolBatch: {
                            batchId: progressChunk.batchId,
                            results: progressChunk.results,
                            totalExecutionTimeMs: progressChunk.totalExecutionTimeMs,
                          },
                        };
                        break;

                      default:
                        return; // Skip unknown chunk types
                    }
                    progressChunks.push(streamChunk);
                  }
                );

                // Yield all collected progress chunks
                for (const progressChunk of progressChunks) {
                  yield progressChunk;
                }

                  isProcessingParallelBatch = false;
                } else {
                  console.log(`[LLM_SERVICE] Tools cannot be executed in parallel, using sequential execution`);
                }
              }

              // Clear pending tool calls for next step
              pendingToolCalls.length = 0;
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
      models.push("claude-sonnet-4-20250514", "claude-opus-4-20250514");
    }

    if (config.openaiApiKey) {
      models.push("gpt-4o", "o3", "o4-mini-high");
    }

    return models;
  }

  // Get parallel execution statistics
  getParallelExecutionStats() {
    return this.parallelExecutor.getActiveExecutions();
  }
}
