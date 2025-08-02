import { prisma } from "@repo/db";
import {
  ModelType,
  Message,
  CompressionLevel,
  ContextUsageStats,
} from "@repo/types";
import { TokenCounterService } from "./token-counter";
import { MessageCompressor } from "./message-compressor";
import { compressionSettings, getCompressionSettings } from "../config/compression-settings";
import { ChatMessage } from "@repo/db";

export class ContextManager {
  private tokenCounter: TokenCounterService;
  private messageCompressor: MessageCompressor;

  constructor() {
    this.tokenCounter = new TokenCounterService();
    this.messageCompressor = new MessageCompressor();
  }

  // Build optimal context for a task, compressing as needed
  // Main fn for compressing context
  async buildOptimalContext(
    taskId: string,
    model: ModelType
  ): Promise<{ messages: Message[], compressionStats: { compressedTokens: number, uncompressedTokens: number, compressionSavings: number } }> {
    console.log(`[CONTEXT] Building optimal context for task ${taskId} with model ${model}`);
    // Get all messages for the task
    const dbMessages: ChatMessage[] = await prisma.chatMessage.findMany({
      where: { taskId },
      orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
    });

    if (dbMessages.length === 0) {
      return { 
        messages: [], 
        compressionStats: { 
          compressedTokens: 0, 
          uncompressedTokens: 0, 
          compressionSavings: 0 
        } 
      };
    }

    // Get compression settings for model
    const settings = getCompressionSettings(model);
    const targetTokens = Math.floor(
      settings.tokenLimit * settings.compressionThreshold
    ); // Calculate target tokens

    // Convert to our internal format and calculate initial token count
    const messages = this.convertDbMessages(dbMessages, model);
    const uncompressedTokens = this.tokenCounter.countTotalTokens(
      messages.map((m) => ({ content: m.content })),
      model
    );
    const totalTokens = uncompressedTokens;

    console.log(
      `[CONTEXT] Initial context: ${messages.length} messages, ${totalTokens} tokens`
    );
    console.log(
      `[CONTEXT] Target: ${targetTokens} tokens (${settings.compressionThreshold * 100}% of ${settings.tokenLimit})`
    );

    // If under threshold, don'ts compress
    if (totalTokens <= targetTokens) {
      console.log(`[CONTEXT] Initial context is under threshold, returning ${messages.length} messages`);
      return { 
        messages, 
        compressionStats: { 
          compressedTokens: totalTokens, 
          uncompressedTokens, 
          compressionSavings: 0 
        } 
      };
    }

    // Apply sliding window - keep recent messages uncompressed
    const slidingWindowSize = settings.slidingWindowSize;
    const recentMessages = messages.slice(-slidingWindowSize);
    const olderMessages = messages.slice(0, -slidingWindowSize);

    console.log(
      `[CONTEXT] Keeping ${recentMessages.length} recent messages uncompressed`
    );
    console.log(`[CONTEXT] Compressing ${olderMessages.length} older messages`);

    // Compress older messages iteratively
    const compressedOlderMessages = await this.compressMessagesIteratively(
      olderMessages,
      model,
      targetTokens,
      recentMessages
    );

    // Combine compressed older messages with recent uncompressed messages
    const finalMessages = [...compressedOlderMessages, ...recentMessages];

    const finalTokens = this.tokenCounter.countTotalTokens(
      finalMessages.map((m) => ({ content: m.content })),
      model
    );

    const compressionSavings = uncompressedTokens - finalTokens;

    console.log(
      `[CONTEXT] Final context: ${finalMessages.length} messages, ${finalTokens} tokens`
    );
    console.log(
      `[CONTEXT] Compression savings: ${compressionSavings} tokens (${((compressionSavings / uncompressedTokens) * 100).toFixed(1)}% reduction)`
    );

    return { 
      messages: finalMessages, 
      compressionStats: { 
        compressedTokens: finalTokens, 
        uncompressedTokens, 
        compressionSavings 
      } 
    };
  }

  // Compress messages iteratively until under target token count
  private async compressMessagesIteratively(
    messages: Message[], // All but the recent messages
    model: ModelType,
    targetTokens: number,
    recentMessages: Message[] // Recent messages (uncompressed)
  ): Promise<Message[]> {
    if (messages.length === 0) {
      return messages;
    }

    const compressionLevels: CompressionLevel[] = ["LIGHT", "HEAVY"];
    let currentMessages = [...messages];

    for (const level of compressionLevels) {
      // Count tokens for recent messages
      const recentTokens = this.tokenCounter.countTotalTokens(
        recentMessages.map((m) => ({
          content: m.content,
        })),
        model
      );

      // Count tokens for current messages
      const currentTokens = this.tokenCounter.countTotalTokens(
        currentMessages.map((m) => ({
          content: m.content,
        })),
        model
      );

      // Count total tokens
      const totalTokens = currentTokens + recentTokens;

      console.log(
        `[CONTEXT] Evaluating ${level} compression: current=${currentTokens}, recent=${recentTokens}, total=${totalTokens}, target=${targetTokens}`
      );

      // If we're under target, we're done
      if (totalTokens <= targetTokens) {
        console.log(`[CONTEXT] Target reached with ${level} compression, stopping compression`);
        break;
      }

      // Compress messages to this level
      console.log(`[CONTEXT] Applying ${level} compression to ${currentMessages.length} older messages`);
      currentMessages = await this.compressMessagesToLevel(
        currentMessages,
        level,
        model
      );
      
      const newTokens = this.tokenCounter.countTotalTokens(
        currentMessages.map((m) => ({ content: m.content })),
        model
      );
      console.log(`[CONTEXT] After ${level} compression: ${currentTokens} -> ${newTokens} tokens (${((currentTokens - newTokens) / currentTokens * 100).toFixed(1)}% reduction)`);
    }

    // If still over target after all compression levels, remove oldest messages
    let finalMessages = currentMessages;
    let messagesRemoved = 0;
    
    while (finalMessages.length > 0) {
      const recentTokens = this.tokenCounter.countTotalTokens(
        recentMessages.map((m) => ({
          content: m.content,
        })),
        model
      );

      const currentTokens = this.tokenCounter.countTotalTokens(
        finalMessages.map((m) => ({
          content: m.content,
        })),
        model
      );

      const totalTokens = currentTokens + recentTokens;

      if (totalTokens <= targetTokens) {
        console.log(`[CONTEXT] Target reached after removing ${messagesRemoved} oldest messages`);
        break;
      }

      // Remove oldest message
      finalMessages = finalMessages.slice(1);
      messagesRemoved++;
      console.log(
        `[CONTEXT] Removed oldest message ${messagesRemoved}, ${finalMessages.length} messages remaining, ${totalTokens} -> ${totalTokens - this.tokenCounter.countTotalTokens([{content: currentMessages[messagesRemoved - 1]?.content || ""}], model)} tokens`
      );
    }

    return finalMessages;
  }

  /**
   * Compress all messages to a specific level
   */
  private async compressMessagesToLevel(
    messages: Message[],
    level: CompressionLevel,
    model: ModelType
  ): Promise<Message[]> {
    console.log(`[CONTEXT] Compressing ${messages.length} messages to ${level} level`);
    const compressedMessages: Message[] = [];
    let successfulCompressions = 0;
    let failedCompressions = 0;

    for (const message of messages) {
      try {
        if (message.role === "user" || message.role === "assistant") {
          // Compress the message
          const compressed =
            await this.messageCompressor.ensureCompressionLevel(
              message.id,
              level,
              model
            );

          compressedMessages.push({
            ...message,
            content: compressed.content,
            metadata: compressed.metadata,
          });
          successfulCompressions++;
        } else {
          // Keep system/tool messages as-is for now
          compressedMessages.push(message);
        }
      } catch (error) {
        console.warn(
          `[CONTEXT] Failed to compress message ${message.id} to ${level}:`,
          error
        );
        // Keep original message if compression fails
        compressedMessages.push(message);
        failedCompressions++;
      }
    }

    console.log(`[CONTEXT] Compression to ${level} complete: ${successfulCompressions} successful, ${failedCompressions} failed`);
    return compressedMessages;
  }

  /**
   * Convert database messages to our internal format
   */
  private convertDbMessages(dbMessages: ChatMessage[], model: ModelType): Message[] {
    return dbMessages
      .filter((msg) => msg.role === "USER" || msg.role === "ASSISTANT" || msg.role === "TOOL") // Include tool messages
      .map((msg) => {
        let content = msg.content;
        let role = msg.role.toLowerCase() as Message["role"];
        
        // For tool messages, move tool information from metadata into content
        if (msg.role === "TOOL" && msg.metadata) {
          const metadata = msg.metadata as Record<string, unknown>;
          if (metadata.tool && typeof metadata.tool === 'object') {
            const toolInfo = metadata.tool as Record<string, unknown>;
            content = `Tool: ${toolInfo.name}\nArgs: ${JSON.stringify(toolInfo.args, null, 2)}\nResult: ${toolInfo.result || msg.content}`;
            role = "assistant"; // Convert tool messages to assistant messages for LLM context
          }
        }
        
        // For assistant messages with tool calls in metadata, include that in content
        if (msg.role === "ASSISTANT" && msg.metadata) {
          const metadata = msg.metadata as Record<string, unknown>;
          if (metadata.parts && Array.isArray(metadata.parts)) {
            const parts = metadata.parts;
            const textParts = parts.filter((part: Record<string, unknown>) => part.type === "text").map((part: Record<string, unknown>) => part.text);
            const toolCalls = parts.filter((part: Record<string, unknown>) => part.type === "tool-call");
            const toolResults = parts.filter((part: Record<string, unknown>) => part.type === "tool-result");
            
            let enrichedContent = textParts.join("");
            
            // Add tool calls to content
            for (const toolCall of toolCalls) {
              const toolCallTyped = toolCall as Record<string, unknown>;
              enrichedContent += `\n\n[Tool Call: ${toolCallTyped.toolName}]\nArgs: ${JSON.stringify(toolCallTyped.args, null, 2)}`;
            }
            
            // Add tool results to content
            for (const toolResult of toolResults) {
              const toolResultTyped = toolResult as Record<string, unknown>;
              enrichedContent += `\n\n[Tool Result: ${toolResultTyped.toolName}]\n${typeof toolResultTyped.result === 'string' ? toolResultTyped.result : JSON.stringify(toolResultTyped.result, null, 2)}`;
            }
            
            if (enrichedContent.trim()) {
              content = enrichedContent;
            }
          }
        }

        return {
          id: msg.id,
          role: role,
          content: content,
          llmModel: msg.llmModel || model,
          createdAt: msg.createdAt.toISOString(),
          metadata: undefined, // Clear metadata as important info is now in content
        };
      });
  }


  // Update compression settings for a model
  updateCompressionSettings(
    model: ModelType,
    settings: Partial<(typeof compressionSettings)[ModelType]>
  ) {
    const existingSettings = getCompressionSettings(model);
    compressionSettings[model] = {
      ...existingSettings,
      ...settings,
    };
  }

  // Get context usage statistics for a task
  async getContextUsageStats(
    taskId: string,
    model: ModelType
  ): Promise<ContextUsageStats> {
    // Get all messages for the task
    const dbMessages: ChatMessage[] = await prisma.chatMessage.findMany({
      where: { taskId },
      orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
    });

    if (dbMessages.length === 0) {
      const settings = getCompressionSettings(model);
      return {
        taskId,
        model,
        totalMessages: 0,
        totalTokens: 0,
        tokenLimit: settings.tokenLimit,
        compressionThreshold: Math.floor(
          settings.tokenLimit * settings.compressionThreshold
        ),
        usagePercentage: 0,
        compressionActive: false,
        compressedMessages: 0,
        compressionBreakdown: {
          none: 0,
          light: 0,
          heavy: 0,
        },
      };
    }

    const settings = getCompressionSettings(model);
    const messages = this.convertDbMessages(dbMessages, model);

    // Calculate total tokens
    const totalTokens = this.tokenCounter.countTotalTokens(
      messages.map((m) => ({ content: m.content })),
      model
    );

    // Calculate compression breakdown
    const compressionBreakdown = {
      none: 0,
      light: 0,
      heavy: 0,
    };

    let compressedMessages = 0;

    for (const dbMsg of dbMessages) {
      const level =
        (dbMsg.activeCompressionLevel as CompressionLevel) || "NONE";

      if (level !== "NONE") {
        compressedMessages++;
      }

      switch (level) {
        case "LIGHT":
          compressionBreakdown.light++;
          break;
        case "HEAVY":
          compressionBreakdown.heavy++;
          break;
        default:
          compressionBreakdown.none++;
          break;
      }
    }

    const compressionThreshold = Math.floor(
      settings.tokenLimit * settings.compressionThreshold
    );
    const usagePercentage = Math.round(
      (totalTokens / settings.tokenLimit) * 100
    );
    const compressionActive = totalTokens > compressionThreshold;

    return {
      taskId,
      model,
      totalMessages: messages.length,
      totalTokens,
      tokenLimit: settings.tokenLimit,
      compressionThreshold,
      usagePercentage,
      compressionActive,
      compressedMessages,
      compressionBreakdown,
    };
  }
}
