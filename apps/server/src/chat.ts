import { prisma } from "@repo/db";
import { Message, MessageMetadata, ModelType } from "@repo/types";
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
  }: {
    taskId: string;
    userMessage: string;
    llmModel?: ModelType;
    enableTools?: boolean;
    skipUserMessageSave?: boolean;
  }) {
    // Save user message to database (unless skipped)
    if (!skipUserMessageSave) {
      await this.saveUserMessage(taskId, userMessage);
    }

    // Get chat history for context
    const history = await this.getChatHistory(taskId);

    // Prepare messages for LLM (exclude the user message we just saved to avoid duplication)
    const messages: Message[] = history
      .slice(0, -1) // Remove the last message (the one we just saved)
      .filter(
        (msg) =>
          msg.role === "user" || msg.role === "assistant" || msg.role === "tool"
      )
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

    // Track streaming state for immediate database persistence
    let assistantSequence: number | null = null;
    let assistantMessageId: string | null = null;
    let fullAssistantResponse = "";
    let usageMetadata: MessageMetadata["usage"];
    let finishReason: MessageMetadata["finishReason"];

    // Map to track tool call sequences as they're created
    const toolCallSequences = new Map<string, number>();

    try {
      for await (const chunk of this.llmService.createMessageStream(
        systemPrompt,
        messages,
        llmModel,
        enableTools
      )) {
        // Emit the chunk directly to clients
        emitStreamChunk(chunk);

        // Save messages to database as they stream to preserve order
        if (chunk.type === "content" && chunk.content) {
          fullAssistantResponse += chunk.content;

          // Create assistant message on first content chunk
          if (assistantSequence === null) {
            assistantSequence = await this.getNextSequence(taskId);
            const assistantMsg = await this.saveAssistantMessage(
              taskId,
              chunk.content,
              llmModel,
              assistantSequence,
              { isStreaming: true }
            );
            assistantMessageId = assistantMsg.id;
          } else {
            // Update existing assistant message with accumulated content
            if (assistantMessageId) {
              await prisma.chatMessage.update({
                where: { id: assistantMessageId },
                data: { content: fullAssistantResponse },
              });
            }
          }
        }

        // Save tool calls immediately when they start
        if (chunk.type === "tool-call" && chunk.toolCall) {
          const toolSequence = await this.getNextSequence(taskId);
          toolCallSequences.set(chunk.toolCall.id, toolSequence);

          // Save tool message with placeholder content (will be updated with result)
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
            // Include provider-specific tokens if available
            cacheCreationInputTokens: chunk.usage.cacheCreationInputTokens,
            cacheReadInputTokens: chunk.usage.cacheReadInputTokens,
          };
        }

        // Track finish reason
        if (
          chunk.type === "complete" &&
          chunk.finishReason &&
          chunk.finishReason !== "error"
        ) {
          finishReason = chunk.finishReason;
        }
      }

      // Update final assistant message with complete metadata
      if (assistantMessageId && usageMetadata) {
        const finalMetadata: MessageMetadata = {
          usage: usageMetadata,
          finishReason,
          isStreaming: false,
        };

        await prisma.chatMessage.update({
          where: { id: assistantMessageId },
          data: {
            content: fullAssistantResponse,
            metadata: finalMetadata as any,
            promptTokens: usageMetadata.promptTokens,
            completionTokens: usageMetadata.completionTokens,
            totalTokens: usageMetadata.totalTokens,
            finishReason: finishReason,
          },
        });
      }

      console.log(`[CHAT] Completed processing for task ${taskId}`);
      console.log(
        `[CHAT] Response length: ${fullAssistantResponse.length} chars`
      );
      console.log(`[CHAT] Tool calls executed: ${toolCallSequences.size}`);

      endStream();
    } catch (error) {
      console.error("Error processing user message:", error);

      // Emit error chunk
      emitStreamChunk({
        type: "error",
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
        finishReason: "error",
      });

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
    llmModel: ModelType = DEFAULT_MODEL
  ) {
    console.log(`[CODING_TASK] Starting coding task for ${taskId}`);
    console.log(`[CODING_TASK] Task: ${userMessage.substring(0, 100)}...`);

    return this.processUserMessage({
      taskId,
      userMessage,
      llmModel,
      enableTools: true,
    });
  }
}
