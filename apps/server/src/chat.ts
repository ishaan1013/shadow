import { Message, MessageMetadata, ModelType } from "@repo/types";
import { randomUUID } from "crypto";
import { prisma } from "../../../packages/db/src/client";
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

  async saveUserMessage(
    taskId: string,
    content: string,
    metadata?: MessageMetadata
  ) {
    return await prisma.chatMessage.create({
      data: {
        taskId,
        content,
        role: "USER",
        metadata: (metadata as any) || undefined,
      },
    });
  }

  async saveAssistantMessage(
    taskId: string,
    content: string,
    llmModel: string,
    metadata?: MessageMetadata
  ) {
    // Extract usage info for denormalized storage
    const usage = metadata?.usage;

    return await prisma.chatMessage.create({
      data: {
        taskId,
        content,
        role: "ASSISTANT",
        llmModel,
        metadata: (metadata as any) || undefined,
        // Denormalized usage fields for easier querying
        promptTokens: usage?.promptTokens,
        completionTokens: usage?.completionTokens,
        totalTokens: usage?.totalTokens,
        finishReason: metadata?.finishReason as string,
      },
    });
  }

  async getChatHistory(taskId: string): Promise<Message[]> {
    const dbMessages = await prisma.chatMessage.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" },
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

  async processUserMessage(
    taskId: string,
    userMessage: string,
    llmModel: ModelType = DEFAULT_MODEL,
    enableTools: boolean = true
  ) {
    // Save user message to database
    await this.saveUserMessage(taskId, userMessage);

    // Get chat history for context
    const history = await this.getChatHistory(taskId);

    // Prepare messages for LLM (exclude the user message we just saved to avoid duplication)
    const messages: Message[] = history
      .slice(0, -1) // Remove the last message (the one we just saved)
      .filter((msg) => msg.role === "user" || msg.role === "assistant" || msg.role === "tool")
      .concat([
        {
          id: randomUUID(),
          role: "user",
          content: userMessage,
          createdAt: new Date().toISOString(),
        },
      ]);

    console.log(`Processing message with ${messages.length} messages in context, tools: ${enableTools ? 'enabled' : 'disabled'}`);

    // Start streaming
    startStream();

    let fullAssistantResponse = "";
    let usageMetadata: MessageMetadata["usage"];
    let finishReason: MessageMetadata["finishReason"];

    try {
      for await (const chunk of this.llmService.createMessageStream(
        systemPrompt,
        messages,
        llmModel,
        enableTools
      )) {
        // Emit the chunk directly to clients
        emitStreamChunk(chunk);

        // Accumulate content for database storage
        if (chunk.type === "content" && chunk.content) {
          fullAssistantResponse += chunk.content;
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

      // Save assistant response to database with metadata
      await this.saveAssistantMessage(taskId, fullAssistantResponse, llmModel, {
        usage: usageMetadata,
        finishReason,
      });

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

  // Get available tools from LLM service
  getAvailableTools(): string[] {
    return this.llmService.getAvailableTools();
  }
}
