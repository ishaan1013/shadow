import { prisma } from "@repo/db";
import {
  AssistantMessagePart,
  Message,
  MessageMetadata,
  ModelType,
  TextPart,
  ToolCallPart,
  ToolResultPart,
} from "@repo/types";
import { randomUUID } from "crypto";
import { type ChatMessage } from "../../../packages/db/src/client";
import { LLMService } from "./llm";
import { systemPrompt } from "./prompt/system";
import {
  emitStreamChunk,
  endStream,
  handleStreamError,
  startStream,
} from "./socket";

export const DEFAULT_MODEL: ModelType = "gpt-4o";

export class ChatService {
  private llmService: LLMService;
  private activeStreams: Map<string, AbortController> = new Map();
  private stopRequested: Set<string> = new Set();

  constructor() {
    this.llmService = new LLMService();
  }

  private async getNextSequence(taskId: string): Promise<number> {
    const lastMessage = await prisma.chatMessage.findFirst({
      where: { taskId },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });
    return (lastMessage?.sequence || 0) + 1;
  }

  async saveUserMessage(
    taskId: string,
    content: string,
    metadata?: MessageMetadata
  ): Promise<ChatMessage> {
    const sequence = await this.getNextSequence(taskId);
    return await prisma.chatMessage.create({
      data: {
        taskId,
        content,
        role: "USER",
        sequence,
        metadata: (metadata as any) || undefined,
      },
    });
  }

  async saveAssistantMessage(
    taskId: string,
    content: string,
    llmModel: string,
    sequence: number,
    metadata?: MessageMetadata
  ): Promise<ChatMessage> {
    // Extract usage info for denormalized storage
    const usage = metadata?.usage;

    return await prisma.chatMessage.create({
      data: {
        taskId,
        content,
        role: "ASSISTANT",
        llmModel,
        sequence,
        metadata: (metadata as any) || undefined,
        // Denormalized usage fields for easier querying
        promptTokens: usage?.promptTokens,
        completionTokens: usage?.completionTokens,
        totalTokens: usage?.totalTokens,
        finishReason: metadata?.finishReason,
      },
    });
  }

  async saveToolMessage(
    taskId: string,
    toolName: string,
    toolArgs: Record<string, any>,
    toolResult: string,
    sequence: number,
    metadata?: MessageMetadata
  ): Promise<ChatMessage> {
    return await prisma.chatMessage.create({
      data: {
        taskId,
        content: toolResult,
        role: "TOOL",
        sequence,
        metadata: {
          ...(metadata as any),
          tool: {
            name: toolName,
            args: toolArgs,
            status: "COMPLETED",
            result: toolResult,
          },
        } as any,
      },
    });
  }

  async getChatHistory(taskId: string): Promise<Message[]> {
    const dbMessages = await prisma.chatMessage.findMany({
      where: { taskId },
      orderBy: [
        { sequence: "asc" }, // Primary ordering by sequence
        { createdAt: "asc" }, // Fallback ordering by timestamp
      ],
    });

    return dbMessages.map((msg) => ({
      id: msg.id,
      role: msg.role.toLowerCase() as Message["role"],
      content: msg.content,
      llmModel: msg.llmModel || undefined,
      createdAt: msg.createdAt.toISOString(),
      metadata: msg.metadata as MessageMetadata | undefined,
    }));
  }

  async processUserMessage({
    taskId,
    userMessage,
    llmModel = DEFAULT_MODEL,
    enableTools = true,
    skipUserMessageSave = false,
    workspacePath,
  }: {
    taskId: string;
    userMessage: string;
    llmModel?: ModelType;
    enableTools?: boolean;
    skipUserMessageSave?: boolean;
    workspacePath?: string;
  }) {
    // Save user message to database (unless skipped)
    if (!skipUserMessageSave) {
      await this.saveUserMessage(taskId, userMessage);
    }

    // Get chat history for context
    const history = await this.getChatHistory(taskId);

    // Prepare messages for LLM (exclude the user message we just saved to avoid duplication)
    // Filter out tool messages since they're embedded in assistant messages as parts
    const messages: Message[] = history
      .slice(0, -1) // Remove the last message (the one we just saved)
      .filter((msg) => msg.role === "user" || msg.role === "assistant")
      .concat([
        {
          id: randomUUID(),
          role: "user",
          content: userMessage,
          createdAt: new Date().toISOString(),
        },
      ]);

    console.log(
      `[CHAT] Processing message for task ${taskId} with ${messages.length} context messages`
    );
    console.log(
      `[CHAT] Using model: ${llmModel}, Tools enabled: ${enableTools}`
    );

    // Start streaming
    startStream();

    // Create AbortController for this stream
    const abortController = new AbortController();
    this.activeStreams.set(taskId, abortController);

    // Track structured assistant message parts in chronological order
    let assistantSequence: number | null = null;
    let assistantMessageId: string | null = null;
    const assistantParts: AssistantMessagePart[] = [];
    let usageMetadata: MessageMetadata["usage"];
    let finishReason: MessageMetadata["finishReason"];

    // Map to track tool call sequences as they're created
    const toolCallSequences = new Map<string, number>();

    try {
      for await (const chunk of this.llmService.createMessageStream(
        systemPrompt,
        messages,
        llmModel,
        enableTools,
        taskId, // Pass taskId to enable todo tool context
        workspacePath, // Pass workspace path for tool operations
        abortController.signal
      )) {
        // If a stop was requested, break out of the loop immediately
        if (this.stopRequested.has(taskId)) {
          console.log(`[CHAT] Stop requested during stream for task ${taskId}`);
          break;
        }

        // Emit the chunk directly to clients
        emitStreamChunk(chunk);

        // Handle text content chunks
        if (chunk.type === "content" && chunk.content) {
          // Add text part to assistant message
          const textPart: TextPart = {
            type: "text",
            text: chunk.content,
          };
          assistantParts.push(textPart);

          // Create assistant message on first content chunk
          if (assistantSequence === null) {
            assistantSequence = await this.getNextSequence(taskId);
            const assistantMsg = await this.saveAssistantMessage(
              taskId,
              chunk.content, // Still store some content for backward compatibility
              llmModel,
              assistantSequence,
              {
                isStreaming: true,
                parts: assistantParts,
              }
            );
            assistantMessageId = assistantMsg.id;
          } else {
            // Update existing assistant message with current parts
            if (assistantMessageId) {
              const fullContent = assistantParts
                .filter((part) => part.type === "text")
                .map((part) => (part as TextPart).text)
                .join("");

              await prisma.chatMessage.update({
                where: { id: assistantMessageId },
                data: {
                  content: fullContent,
                  metadata: {
                    isStreaming: true,
                    parts: assistantParts,
                  } as any,
                },
              });
            }
          }
        }

        // Handle tool calls
        if (chunk.type === "tool-call" && chunk.toolCall) {
          // Add tool call part to assistant message
          const toolCallPart: ToolCallPart = {
            type: "tool-call",
            toolCallId: chunk.toolCall.id,
            toolName: chunk.toolCall.name,
            args: chunk.toolCall.args,
          };
          assistantParts.push(toolCallPart);

          // Update assistant message with tool call part
          if (assistantMessageId) {
            const fullContent = assistantParts
              .filter((part) => part.type === "text")
              .map((part) => (part as TextPart).text)
              .join("");

            await prisma.chatMessage.update({
              where: { id: assistantMessageId },
              data: {
                content: fullContent,
                metadata: {
                  isStreaming: true,
                  parts: assistantParts,
                } as any,
              },
            });
          }

          // ALSO save separate tool message for backward compatibility and separate tool results
          const toolSequence = await this.getNextSequence(taskId);
          toolCallSequences.set(chunk.toolCall.id, toolSequence);

          await this.saveToolMessage(
            taskId,
            chunk.toolCall.name,
            chunk.toolCall.args,
            "Running...", // Placeholder content
            toolSequence,
            {
              tool: {
                name: chunk.toolCall.name,
                args: chunk.toolCall.args,
                status: "RUNNING",
                result: undefined,
              },
              isStreaming: true,
            }
          );

          console.log(
            `[TOOL_CALL] ${chunk.toolCall.name}:`,
            chunk.toolCall.args
          );
        }

        // Update tool results when they complete
        if (chunk.type === "tool-result" && chunk.toolResult) {
          // Add tool result part to assistant message
          const toolResultPart: ToolResultPart = {
            type: "tool-result",
            toolCallId: chunk.toolResult.id,
            toolName: "", // We'll need to find the tool name from the corresponding call
            result: chunk.toolResult.result,
          };

          // Find the corresponding tool call to get the tool name
          const correspondingCall = assistantParts.find(
            (part) =>
              part.type === "tool-call" &&
              part.toolCallId === chunk.toolResult!.id
          );
          if (correspondingCall && correspondingCall.type === "tool-call") {
            toolResultPart.toolName = correspondingCall.toolName;
          }

          assistantParts.push(toolResultPart);

          // Update assistant message with tool result part
          if (assistantMessageId) {
            const fullContent = assistantParts
              .filter((part) => part.type === "text")
              .map((part) => (part as TextPart).text)
              .join("");

            await prisma.chatMessage.update({
              where: { id: assistantMessageId },
              data: {
                content: fullContent,
                metadata: {
                  isStreaming: true,
                  parts: assistantParts,
                } as any,
              },
            });
          }

          const toolSequence = toolCallSequences.get(chunk.toolResult.id);
          if (toolSequence !== undefined) {
            // Find and update the tool message with the result
            const toolMessage = await prisma.chatMessage.findFirst({
              where: {
                taskId,
                sequence: toolSequence,
                role: "TOOL",
              },
            });

            if (toolMessage) {
              await prisma.chatMessage.update({
                where: { id: toolMessage.id },
                data: {
                  content: chunk.toolResult.result,
                  metadata: {
                    ...(toolMessage.metadata as any),
                    tool: {
                      ...(toolMessage.metadata as any)?.tool,
                      status: "COMPLETED",
                      result: chunk.toolResult.result,
                    },
                    isStreaming: false,
                  },
                },
              });
            }
          }

          console.log(
            `[TOOL_RESULT] ${chunk.toolResult.id}:`,
            chunk.toolResult.result
          );
        }

        // Track usage information
        if (chunk.type === "usage" && chunk.usage) {
          usageMetadata = {
            promptTokens: chunk.usage.promptTokens,
            completionTokens: chunk.usage.completionTokens,
            totalTokens: chunk.usage.totalTokens,
          };
        }

        // Track finish reason
        if (
          chunk.type === "complete" &&
          chunk.finishReason &&
          chunk.finishReason !== "error"
        ) {
          // Map finish reason to our type system
          finishReason =
            chunk.finishReason === "content-filter"
              ? "content_filter"
              : chunk.finishReason === "function_call"
                ? "tool_calls"
                : chunk.finishReason;
        }
      }

      // Check if stream was stopped early
      const wasStoppedEarly = this.stopRequested.has(taskId);

      // Update final assistant message with complete metadata
      if (assistantMessageId && usageMetadata) {
        const fullContent = assistantParts
          .filter((part) => part.type === "text")
          .map((part) => (part as TextPart).text)
          .join("");

        const finalMetadata: MessageMetadata = {
          usage: usageMetadata,
          finishReason,
          isStreaming: false,
          parts: assistantParts,
        };

        await prisma.chatMessage.update({
          where: { id: assistantMessageId },
          data: {
            content: fullContent,
            metadata: finalMetadata as any,
            promptTokens: usageMetadata.promptTokens,
            completionTokens: usageMetadata.completionTokens,
            totalTokens: usageMetadata.totalTokens,
            finishReason: finishReason,
          },
        });
      }

      console.log(`[CHAT] Completed processing for task ${taskId}`);
      console.log(`[CHAT] Assistant parts: ${assistantParts.length}`);
      console.log(`[CHAT] Tool calls executed: ${toolCallSequences.size}`);

      // Update task status based on how stream ended
      if (wasStoppedEarly) {
        await prisma.task.update({
          where: { id: taskId },
          data: { status: "STOPPED" },
        });
        console.log(
          `[CHAT] Task ${taskId} status updated to STOPPED (early termination)`
        );
      } else {
        await prisma.task.update({
          where: { id: taskId },
          data: { status: "COMPLETED" },
        });
        console.log(`[CHAT] Task ${taskId} status updated to COMPLETED`);
      }

      // Clean up stream tracking
      this.activeStreams.delete(taskId);
      this.stopRequested.delete(taskId);
      endStream();
    } catch (error) {
      console.error("Error processing user message:", error);

      // Update task status to failed when stream processing fails
      await prisma.task.update({
        where: { id: taskId },
        data: { status: "FAILED" },
      });
      console.log(
        `[CHAT] Task ${taskId} status updated to FAILED due to error`
      );

      // Emit error chunk
      emitStreamChunk({
        type: "error",
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
        finishReason: "error",
      });

      // Clean up stream tracking on error
      this.activeStreams.delete(taskId);
      this.stopRequested.delete(taskId);
      handleStreamError(error);
      throw error;
    }
  }

  // Get available models from LLM service
  getAvailableModels(): ModelType[] {
    return this.llmService.getAvailableModels();
  }

  // Method to process coding tasks with specific configuration
  async processCodingTask(
    taskId: string,
    userMessage: string,
    llmModel: ModelType = DEFAULT_MODEL,
    workspacePath?: string
  ) {
    console.log(`[CODING_TASK] Starting coding task for ${taskId}`);
    console.log(`[CODING_TASK] Task: ${userMessage.substring(0, 100)}...`);

    // Update task status to running when processing a coding task
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "RUNNING" },
    });
    console.log(`[CODING_TASK] Task ${taskId} status updated to RUNNING`);

    return this.processUserMessage({
      taskId,
      userMessage,
      llmModel,
      enableTools: true,
      workspacePath,
    });
  }

  async stopStream(taskId: string): Promise<void> {
    // Mark stop requested so generator exits early
    this.stopRequested.add(taskId);

    console.log(`[CHAT] Stopping stream for task ${taskId}`);

    const abortController = this.activeStreams.get(taskId);
    if (abortController) {
      abortController.abort();
      this.activeStreams.delete(taskId);
      console.log(`[CHAT] Stream stopped for task ${taskId}`);
    }

    // Update task status to stopped when manually stopped by user
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "STOPPED" },
    });
    console.log(`[CHAT] Task ${taskId} status updated to STOPPED`);
  }
}
