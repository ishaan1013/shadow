import { prisma } from "@repo/db";
import {
  ModelType,
  Message,
  CompressionLevel,
  ModelCompressionSettings,
  ContextUsageStats,
} from "@repo/types";
import { TokenCounterService } from "./token-counter";
import { MessageCompressor } from "./message-compressor";

export class ContextManager {
  private tokenCounter: TokenCounterService;
  private messageCompressor: MessageCompressor;

  // CONSTANTS: Compression settings for different models
  /**
   * Sliding window is the number of recent messages to keep uncompressed
   * Compression threshold is the percentage of the token limit that can be used for compression (total tokens must be under this)
   * TODO: Should move the compression settings to its own file
   */
  private compressionSettings: ModelCompressionSettings = {
    "claude-sonnet-4-20250514": {
      tokenLimit: 200000,
      compressionThreshold: 0.05,
      slidingWindowSize: 10,
    },
    "claude-opus-4-20250514": {
      tokenLimit: 200000,
      compressionThreshold: 0.05,
      slidingWindowSize: 10,
    },
    "gpt-4o": {
      tokenLimit: 128000,
      compressionThreshold: 0.05,
      slidingWindowSize: 8,
    },
    "o3": {
      tokenLimit: 128000,
      compressionThreshold: 0.05,
      slidingWindowSize: 8,
    },
    "o4-mini-high": {
      tokenLimit: 128000,
      compressionThreshold: 0.5,
      slidingWindowSize: 8,
    },
  };

  constructor() {
    this.tokenCounter = new TokenCounterService();
    this.messageCompressor = new MessageCompressor();
  }

  // Build optimal context for a task, compressing as needed
  // Main fn for compressing context
  async buildOptimalContext(
    taskId: string,
    model: ModelType
  ): Promise<Message[]> {
    // Get all messages for the task
    const dbMessages = await prisma.chatMessage.findMany({
      where: { taskId },
      orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
    });

    if (dbMessages.length === 0) {
      return [];
    }

    // Get compression settings for model
    const settings =
      this.compressionSettings[model] ||
      this.compressionSettings["gpt-4o"];
    if (!settings) {
      throw new Error(`No compression settings found for model ${model}`); // This should never happen
    }
    const targetTokens = Math.floor(
      settings.tokenLimit * settings.compressionThreshold
    ); // Calculate target tokens

    // Convert to our internal format and calculate initial token count
    const messages = this.convertDbMessages(dbMessages, model);
    const totalTokens = this.tokenCounter.countTotalTokens(
      messages.map((m) => ({ content: m.content, metadata: m.metadata })),
      model
    );

    console.log(
      `[CONTEXT] Initial context: ${messages.length} messages, ${totalTokens} tokens`
    );
    console.log(
      `[CONTEXT] Target: ${targetTokens} tokens (${settings.compressionThreshold * 100}% of ${settings.tokenLimit})`
    );

    // If under threshold, don'ts compress
    if (totalTokens <= targetTokens) {
      return messages;
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
      finalMessages.map((m) => ({ content: m.content, metadata: m.metadata })),
      model
    );

    console.log(
      `[CONTEXT] Final context: ${finalMessages.length} messages, ${finalTokens} tokens`
    );

    return finalMessages;
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

    const compressionLevels: CompressionLevel[] = ["LIGHT", "MEDIUM", "HEAVY"];
    let currentMessages = [...messages];

    for (const level of compressionLevels) {
      // Count tokens for recent messages
      const recentTokens = this.tokenCounter.countTotalTokens(
        recentMessages.map((m) => ({
          content: m.content,
          metadata: m.metadata,
        })),
        model
      );

      // Count tokens for current messages
      const currentTokens = this.tokenCounter.countTotalTokens(
        currentMessages.map((m) => ({
          content: m.content,
          metadata: m.metadata,
        })),
        model
      );

      // Count total tokens
      const totalTokens = currentTokens + recentTokens;

      console.log(
        `[CONTEXT] ${level} compression: ${totalTokens} total tokens`
      ); // Debug log

      // If we're under target, we're done
      if (totalTokens <= targetTokens) {
        break;
      }

      // Compress messages to this level
      currentMessages = await this.compressMessagesToLevel(
        currentMessages,
        level,
        model
      );
    }

    // If still over target after all compression levels, remove oldest messages
    let finalMessages = currentMessages;
    while (finalMessages.length > 0) {
      const recentTokens = this.tokenCounter.countTotalTokens(
        recentMessages.map((m) => ({
          content: m.content,
          metadata: m.metadata,
        })),
        model
      );

      const currentTokens = this.tokenCounter.countTotalTokens(
        finalMessages.map((m) => ({
          content: m.content,
          metadata: m.metadata,
        })),
        model
      );

      const totalTokens = currentTokens + recentTokens;

      if (totalTokens <= targetTokens) {
        break;
      }

      // Remove oldest message
      finalMessages = finalMessages.slice(1);
      console.log(
        `[CONTEXT] Removed oldest message, ${finalMessages.length} messages remaining`
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
    const compressedMessages: Message[] = [];

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
        } else {
          // Keep system/tool messages as-is for now
          compressedMessages.push(message);
        }
      } catch (error) {
        console.warn(
          `[CONTEXT] Failed to compress message ${message.id}:`,
          error
        );
        // Keep original message if compression fails
        compressedMessages.push(message);
      }
    }

    return compressedMessages;
  }

  /**
   * Convert database messages to our internal format
   */
  private convertDbMessages(dbMessages: any[], model: ModelType): Message[] {
    return dbMessages
      .filter((msg) => msg.role === "USER" || msg.role === "ASSISTANT") // Only include user/assistant messages
      .map((msg) => ({
        id: msg.id,
        role: msg.role.toLowerCase() as Message["role"],
        content: msg.content,
        llmModel: msg.llmModel || model,
        createdAt: msg.createdAt.toISOString(),
        metadata: msg.metadata,
      }));
  }

  // Get compression settings for a model
  getCompressionSettings(model: ModelType) {
    const settings =
      this.compressionSettings[model] ||
      this.compressionSettings["gpt-4o"];
    if (!settings) {
      throw new Error(`No compression settings found for model ${model}`);
    }
    return settings;
  }

  // Update compression settings for a model
  updateCompressionSettings(
    model: ModelType,
    settings: Partial<(typeof this.compressionSettings)[ModelType]>
  ) {
    const existingSettings = this.getCompressionSettings(model);
    this.compressionSettings[model] = {
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
    const dbMessages = await prisma.chatMessage.findMany({
      where: { taskId },
      orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
    });

    if (dbMessages.length === 0) {
      const settings = this.getCompressionSettings(model);
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
          medium: 0,
          heavy: 0,
        },
      };
    }

    const settings = this.getCompressionSettings(model);
    const messages = this.convertDbMessages(dbMessages, model);

    // Calculate total tokens
    const totalTokens = this.tokenCounter.countTotalTokens(
      messages.map((m) => ({ content: m.content, metadata: m.metadata })),
      model
    );

    // Calculate compression breakdown
    const compressionBreakdown = {
      none: 0,
      light: 0,
      medium: 0,
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
        case "MEDIUM":
          compressionBreakdown.medium++;
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
