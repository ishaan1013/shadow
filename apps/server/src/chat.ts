import type { CoreMessage, Message, MessageMetadata, StreamChunk } from "@repo/types";
import { prisma } from "../../../packages/db/src/client";
import { LLMService } from "./llm";
import {
  emitStreamChunk,
  endStream,
  handleStreamError,
  startStream,
} from "./socket";

export class ChatService {
  private llmService: LLMService;

  constructor() {
    this.llmService = new LLMService();
  }

  async saveUserMessage(taskId: string, content: string): Promise<void> {
    await prisma.chatMessage.create({
      data: {
        taskId,
        role: "USER",
        content,
      },
    });
  }

  async saveAssistantMessage(
    taskId: string,
    content: string,
    llmModel: string,
    metadata?: MessageMetadata
  ): Promise<void> {
    await prisma.chatMessage.create({
      data: {
        taskId,
        role: "ASSISTANT",
        content,
        llmModel,
        finishReason: metadata?.finishReason?.toUpperCase() as any,
        toolInvocations: metadata?.usage ? undefined : null, // Tool invocations stored separately
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });
  }

  async getChatHistory(taskId: string): Promise<Message[]> {
    const messages = await prisma.chatMessage.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" },
    });

    return messages.map((msg) => ({
      id: msg.id,
      role: msg.role.toLowerCase() as any,
      content: msg.content,
      llmModel: msg.llmModel || undefined,
      createdAt: msg.createdAt.toISOString(),
      metadata: msg.metadata ? JSON.parse(msg.metadata as string) : undefined,
      toolInvocations: msg.toolInvocations ? JSON.parse(msg.toolInvocations as string) : undefined,
    }));
  }

  private convertToLegacyStreamChunk(aiSdkChunk: StreamChunk): any {
    // Convert AI SDK format to legacy format for backward compatibility
    if (aiSdkChunk.type === "text-delta") {
      return {
        type: "content",
        content: aiSdkChunk.textDelta || aiSdkChunk.content,
      };
    }

    if (aiSdkChunk.type === "finish" && aiSdkChunk.usage) {
      return {
        type: "usage",
        usage: {
          inputTokens: aiSdkChunk.usage.promptTokens,
          outputTokens: aiSdkChunk.usage.completionTokens,
          // Map to legacy format
          cacheWriteTokens: undefined,
          cacheReadTokens: undefined,
        },
      };
    }

    if (aiSdkChunk.type === "error") {
      return {
        type: "error",
        error: aiSdkChunk.error,
      };
    }

    // Return as-is for tool calls and other types
    return aiSdkChunk;
  }

  async processUserMessage(
    taskId: string,
    userMessage: string,
    llmModel: string = "claude-3-5-sonnet-20241022"
  ) {
    // Save user message to database
    await this.saveUserMessage(taskId, userMessage);

    // Get chat history for context
    const history = await this.getChatHistory(taskId);

    // Convert to CoreMessage format for AI SDK
    const messages: CoreMessage[] = history
      .slice(0, -1) // Remove the last message (the one we just saved to avoid duplication)
      .filter((msg) => msg.role === "user" || msg.role === "assistant")
      .map((msg) => ({
        role: msg.role,
        content: msg.content,
        // Include tool invocations if present
        ...(msg.toolInvocations && { toolInvocations: msg.toolInvocations }),
      }))
      .concat([{ role: "user", content: userMessage }]);

    const systemPrompt = `You are a helpful coding assistant. You help users with their programming tasks by providing clear, accurate, and helpful responses.`;

    // Start streaming
    startStream();

    let fullAssistantResponse = "";
    let usageMetadata: MessageMetadata["usage"];
    let finishReason: MessageMetadata["finishReason"];
    let toolInvocations: any[] = [];

    try {
      for await (const chunk of this.llmService.createMessageStream(
        systemPrompt,
        messages,
        { model: llmModel }
      )) {
        // Convert to legacy format for frontend compatibility
        const legacyChunk = this.convertToLegacyStreamChunk(chunk);
        emitStreamChunk(legacyChunk);

        // Accumulate data for database storage
        if (chunk.type === "text-delta" && chunk.textDelta) {
          fullAssistantResponse += chunk.textDelta;
        }

        if (chunk.type === "tool-call" && chunk.toolCall) {
          toolInvocations.push(chunk.toolCall);
        }

        if (chunk.type === "finish") {
          usageMetadata = chunk.usage;
          finishReason = chunk.finishReason;
        }
      }

      // Save assistant response to database with metadata
      const metadata: MessageMetadata = {
        usage: usageMetadata,
        finishReason,
        ...(toolInvocations.length > 0 && { toolInvocations }),
      };

      await this.saveAssistantMessage(
        taskId,
        fullAssistantResponse,
        llmModel,
        metadata
      );

      endStream();
    } catch (error) {
      console.error("Error processing user message:", error);

      // Emit error chunk
      emitStreamChunk({
        type: "error",
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      });

      handleStreamError(error);
      throw error;
    }
  }

  // Enhanced method with AI SDK features
  async processUserMessageWithTools(
    taskId: string,
    userMessage: string,
    llmConfig: {
      model?: string;
      tools?: Record<string, any>;
      maxSteps?: number;
    } = {}
  ) {
    const { model = "claude-3-5-sonnet-20241022", tools, maxSteps = 3 } = llmConfig;

    // Save user message to database
    await this.saveUserMessage(taskId, userMessage);

    // Get chat history for context
    const history = await this.getChatHistory(taskId);
    const messages: CoreMessage[] = history
      .slice(0, -1)
      .filter((msg) => msg.role === "user" || msg.role === "assistant")
      .map((msg) => ({
        role: msg.role,
        content: msg.content,
        ...(msg.toolInvocations && { toolInvocations: msg.toolInvocations }),
      }))
      .concat([{ role: "user", content: userMessage }]);

    const systemPrompt = `You are a helpful coding assistant with access to tools. Use tools when appropriate to help users with their programming tasks.`;

    startStream();

    let fullAssistantResponse = "";
    let usageMetadata: MessageMetadata["usage"];
    let finishReason: MessageMetadata["finishReason"];
    let toolInvocations: any[] = [];

    try {
      for await (const chunk of this.llmService.createMessageStream(
        systemPrompt,
        messages,
        { model, tools, maxSteps }
      )) {
        const legacyChunk = this.convertToLegacyStreamChunk(chunk);
        emitStreamChunk(legacyChunk);

        if (chunk.type === "text-delta" && chunk.textDelta) {
          fullAssistantResponse += chunk.textDelta;
        }

        if (chunk.type === "tool-call" && chunk.toolCall) {
          toolInvocations.push(chunk.toolCall);
          
          // Save tool call to database
          await prisma.toolCall.create({
            data: {
              taskId,
              toolCallId: chunk.toolCall.toolCallId,
              toolName: chunk.toolCall.toolName,
              args: chunk.toolCall.args,
              status: "RUNNING",
            },
          });
        }

        if (chunk.type === "tool-result" && chunk.toolResult) {
          // Update tool call with result
          await prisma.toolCall.updateMany({
            where: {
              taskId,
              toolCallId: chunk.toolResult.toolCallId,
            },
            data: {
              result: chunk.toolResult.result,
              status: "SUCCESS",
              completedAt: new Date(),
            },
          });
        }

        if (chunk.type === "finish") {
          usageMetadata = chunk.usage;
          finishReason = chunk.finishReason;
        }
      }

      const metadata: MessageMetadata = {
        usage: usageMetadata,
        finishReason,
        ...(toolInvocations.length > 0 && { toolInvocations }),
      };

      await this.saveAssistantMessage(
        taskId,
        fullAssistantResponse,
        model,
        metadata
      );

      endStream();
    } catch (error) {
      console.error("Error processing user message with tools:", error);

      emitStreamChunk({
        type: "error",
        error: error instanceof Error ? error.message : "Unknown error occurred",
      });

      handleStreamError(error);
      throw error;
    }
  }
}
