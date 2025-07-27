import { Message, MessageMetadata, ModelType, ModelInfos } from '@repo/types';
import { LLMService } from '../llm';
import { estimateMessagesTokens } from '../utils/token-estimator';
import { compactionCache } from './compaction-cache';

export type CompactionStrategy = 
  | 'sliding-window'
  | 'tool-result-summarization' 
  | 'conversation-summarization'
  | 'hybrid';

export interface CompactionConfig {
  strategy: CompactionStrategy;
  preserveRecentCount: number; // Number of recent messages to always preserve
  maxToolResultLength: number; // Max length for individual tool results
  summaryModel: ModelType; // Model to use for generating summaries
  enableAggressiveCompaction: boolean; // Allow more aggressive compaction when needed
}

export interface CompactionResult {
  compactedMessages: Message[];
  tokensSaved: number;
  originalCount: number;
  compactedCount: number;
  strategy: CompactionStrategy;
  preservedMessageIds: string[];
}

export class MessageCompactor {
  private llmService: LLMService;
  
  constructor() {
    this.llmService = new LLMService();
  }

  async compactMessages(
    messages: Message[],
    model: ModelType,
    config: CompactionConfig,
    taskId?: string
  ): Promise<CompactionResult> {
    const originalTokens = estimateMessagesTokens(messages, model);
    const originalCount = messages.length;
    
    // Get from cache if taskId provided
    if (taskId) {
      const lastSequence = this.getLastSequence(messages);
      const cached = compactionCache.getCompactionResult(
        taskId,
        lastSequence,
        config.strategy,
        config,
        model
      );
      
      if (cached) {
        return cached;
      }
    }
    
    let compactedMessages: Message[];
    let preservedMessageIds: string[] = [];
    
    switch (config.strategy) {
      case 'sliding-window':
        ({ compactedMessages, preservedMessageIds } = this.applySlidingWindow(messages, config));
        break;
        
      case 'tool-result-summarization':
        ({ compactedMessages, preservedMessageIds } = await this.applyToolResultSummarization(messages, config, model));
        break;
        
      case 'conversation-summarization':
        ({ compactedMessages, preservedMessageIds } = await this.applyConversationSummarization(messages, config, model));
        break;
        
      case 'hybrid':
        ({ compactedMessages, preservedMessageIds } = await this.applyHybridStrategy(messages, config, model));
        break;
        
      default:
        ({ compactedMessages, preservedMessageIds } = this.applySlidingWindow(messages, config));
    }
    
    const compactedTokens = estimateMessagesTokens(compactedMessages, model);
    
    const result: CompactionResult = {
      compactedMessages,
      tokensSaved: originalTokens - compactedTokens,
      originalCount,
      compactedCount: compactedMessages.length,
      strategy: config.strategy,
      preservedMessageIds
    };
    
    // Cache the result if taskId provided
    if (taskId) {
      const lastSequence = this.getLastSequence(messages);
      compactionCache.setCompactionResult(
        taskId,
        lastSequence,
        config.strategy,
        config,
        model,
        result
      );
    }
    
    return result;
  }

  /**
   * Sliding window strategy: Keep recent messages and first few messages
   */
  private applySlidingWindow(
    messages: Message[], 
    config: CompactionConfig
  ): { compactedMessages: Message[]; preservedMessageIds: string[] } {
    if (messages.length <= config.preserveRecentCount + 2) {
      return { 
        compactedMessages: [...messages], 
        preservedMessageIds: messages.map(m => m.id) 
      };
    }
        
    if (!messages[0]) {
      throw new Error("At least one message is required");
    }
    
    // Always preserve first user message and recent messages
    const firstMessage = messages[0];
    const recentMessages = messages.slice(-config.preserveRecentCount);
    const preservedMessageIds = [firstMessage.id, ...recentMessages.map(m => m.id)];
    
    // If first message is already in recent messages, don't duplicate
    const compactedMessages = recentMessages.some(m => m.id === firstMessage.id)
      ? [...recentMessages]
      : [firstMessage, ...recentMessages];
      
    return { compactedMessages, preservedMessageIds };
  }

  /**
   * Tool result summarization: Compress verbose tool outputs while preserving key info
   */
  private async applyToolResultSummarization(
    messages: Message[], 
    config: CompactionConfig,
    model: ModelType
  ): Promise<{ compactedMessages: Message[]; preservedMessageIds: string[] }> {
    const compactedMessages: Message[] = [];
    const preservedMessageIds: string[] = [];
    
    for (const message of messages) {
      if (this.shouldCompressToolResult(message, config)) {
        const compressedMessage = await this.compressToolResult(message, config.summaryModel);
        compactedMessages.push(compressedMessage);
      } else {
        compactedMessages.push(message);
        preservedMessageIds.push(message.id);
      }
    }
    
    return { compactedMessages, preservedMessageIds };
  }

  /**
   * Conversation summarization: Create concise summaries of conversation segments
   */
  private async applyConversationSummarization(
    messages: Message[], 
    config: CompactionConfig,
    model: ModelType
  ): Promise<{ compactedMessages: Message[]; preservedMessageIds: string[] }> {
    if (messages.length <= config.preserveRecentCount + 2) {
      return { 
        compactedMessages: [...messages], 
        preservedMessageIds: messages.map(m => m.id) 
      };
    }
    
    // Preserve recent messages
    const recentMessages = messages.slice(-config.preserveRecentCount);
    const messagesToSummarize = messages.slice(0, -config.preserveRecentCount);
    
    // Create summary of older conversation
    const summary = await this.createConversationSummary(messagesToSummarize, config.summaryModel);
    
    const summaryMessage: Message = {
      id: `summary-${Date.now()}`,
      role: 'system',
      content: summary,
      createdAt: new Date().toISOString(),
      metadata: {
        isCompacted: true,
        compactionStrategy: 'conversation-summarization',
        originalMessageCount: messagesToSummarize.length
      } as MessageMetadata & { isCompacted: boolean; compactionStrategy: string; originalMessageCount: number }
    };
    
    return {
      compactedMessages: [summaryMessage, ...recentMessages],
      preservedMessageIds: recentMessages.map(m => m.id)
    };
  }

  /**
   * Hybrid strategy: Combines multiple approaches based on message types and sizes
   */
  private async applyHybridStrategy(
    messages: Message[], 
    config: CompactionConfig,
    model: ModelType
  ): Promise<{ compactedMessages: Message[]; preservedMessageIds: string[] }> {
    // Step 1: Apply tool result summarization to all messages
    const { compactedMessages: toolCompacted } = await this.applyToolResultSummarization(messages, config, model);
    
    // Step 2: If still too many messages, apply conversation summarization
    if (toolCompacted.length > config.preserveRecentCount + 5) {
      return await this.applyConversationSummarization(toolCompacted, config, model);
    }
    
    // Step 3: If still too many, fall back to sliding window
    if (toolCompacted.length > config.preserveRecentCount + 10) {
      return this.applySlidingWindow(toolCompacted, config);
    }
    
    return {
      compactedMessages: toolCompacted,
      preservedMessageIds: toolCompacted.map(m => m.id)
    };
  }

  /**
   * Determines if a tool result should be compressed
   */
  private shouldCompressToolResult(message: Message, config: CompactionConfig): boolean {
    // Only compress tool messages or assistant messages with large tool results
    if (message.role !== 'tool' && message.role !== 'assistant') {
      return false;
    }
    
    // Check if message content is too long
    if (message.content.length > config.maxToolResultLength) {
      return true;
    }
    
    // Check if metadata contains large tool results
    if (message.metadata?.tool?.result) {
      const resultStr = typeof message.metadata.tool.result === 'string' 
        ? message.metadata.tool.result 
        : JSON.stringify(message.metadata.tool.result);
      return resultStr.length > config.maxToolResultLength;
    }
    
    // Check if parts contain large tool results
    if (message.metadata?.parts) {
      for (const part of message.metadata.parts) {
        if (part.type === 'tool-result') {
          const resultStr = typeof part.result === 'string' 
            ? part.result 
            : JSON.stringify(part.result);
          if (resultStr.length > config.maxToolResultLength) {
            return true;
          }
        }
      }
    }
    
    return false;
  }

  /**
   * Compresses a tool result while preserving important information
   */
  private async compressToolResult(message: Message, summaryModel: ModelType): Promise<Message> {
    const toolName = message.metadata?.tool?.name || 'unknown';
    
    // Check cache first
    const cachedSummary = compactionCache.getToolSummary(message.content, toolName);
    if (cachedSummary) {
      return {
        ...message,
        content: cachedSummary,
        metadata: {
          ...message.metadata,
          isCompacted: true,
          compactionStrategy: 'tool-result-summarization',
          originalLength: message.content.length
        } as MessageMetadata & { isCompacted: boolean; compactionStrategy: string; originalLength: number }
      };
    }

    const systemPrompt = `You are compressing verbose tool outputs while preserving essential information.

TASK: Summarize this tool result, keeping:
1. Key outcomes and results
2. Important errors or warnings  
3. Critical data or findings
4. Action items or next steps

Remove:
- Verbose logs and debug output
- Repetitive information
- Unnecessary details
- Long file paths (keep just filenames)

Tool: ${toolName}
Original output length: ${message.content.length} characters

Provide a concise summary (max 500 chars) that captures the essential information:`;

    try {
      const summary = await this.llmService.generateWithTools(
        systemPrompt,
        [{ id: 'compress', role: 'user', content: message.content, createdAt: new Date().toISOString() }],
        summaryModel,
        false // No tools needed for summarization
      );

      const summaryText = summary.text.slice(0, 500); // Enforce length limit
      
      // Cache the summary
      compactionCache.setToolSummary(message.content, toolName, summaryText);

      const compressedMessage: Message = {
        ...message,
        content: summaryText,
        metadata: {
          ...message.metadata,
          isCompacted: true,
          compactionStrategy: 'tool-result-summarization',
          originalLength: message.content.length
        } as MessageMetadata & { isCompacted: boolean; compactionStrategy: string; originalLength: number }
      };

      return compressedMessage;
    } catch (error) {
      console.warn('Failed to compress tool result, using truncation:', error);
      
      // Fallback: simple truncation with ellipsis
      const truncated = message.content.slice(0, 300) + '... [truncated]';
      return {
        ...message,
        content: truncated,
        metadata: {
          ...message.metadata,
          isCompacted: true,
          compactionStrategy: 'truncation',
          originalLength: message.content.length
        } as MessageMetadata & { isCompacted: boolean; compactionStrategy: string; originalLength: number }
      };
    }
  }

  /**
   * Creates a summary of a conversation segment
   */
  private async createConversationSummary(messages: Message[], summaryModel: ModelType): Promise<string> {
    const messageIds = messages.map(m => m.id);
    
    // Check cache first
    const cachedSummary = compactionCache.getConversationSummary(messageIds);
    if (cachedSummary) {
      return cachedSummary;
    }

    const conversationText = messages
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    const systemPrompt = `You are summarizing a conversation segment to preserve context while reducing token usage.

TASK: Create a concise summary that captures:
1. Main topics discussed
2. Key decisions made
3. Important technical details
4. Problems solved or encountered
5. Current state/progress

Keep the summary under 800 characters while preserving essential context for continuing the conversation.

Conversation to summarize (${messages.length} messages):`;

    try {
      const summary = await this.llmService.generateWithTools(
        systemPrompt,
        [{ id: 'summarize', role: 'user', content: conversationText, createdAt: new Date().toISOString() }],
        summaryModel,
        false // No tools needed for summarization
      );

      const summaryText = `[CONVERSATION SUMMARY] ${summary.text.slice(0, 800)}`;
      
      // Cache the summary
      compactionCache.setConversationSummary(messageIds, summaryText);

      return summaryText;
    } catch (error) {
      console.warn('Failed to create conversation summary:', error);
      
      // Fallback: basic summary
      const topicHints = messages
        .filter(m => m.role === 'user')
        .map(m => m.content.slice(0, 50))
        .join(', ');
        
      return `[CONVERSATION SUMMARY] Previous discussion covered: ${topicHints} (${messages.length} messages)`;
    }
  }

  /**
   * Get default compaction configuration
   */
  /**
   * Get the last sequence number from messages (for cache invalidation)
   */
  private getLastSequence(messages: Message[]): number {
    // If messages have sequence metadata, use it
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.metadata && 'sequence' in lastMessage.metadata) {
      return lastMessage.metadata.sequence as number;
    }
    
    // Fallback: use message count as proxy for sequence
    return messages.length;
  }

  /**
   * Get context statistics for a given set of messages
   */
  getContextStatistics(
    messages: Message[],
    model: ModelType,
    systemPrompt: string = ''
  ): {
    currentTokens: number;
    maxTokens: number;
    percentage: number;
    messageCount: number;
    needsCompaction: boolean;
    modelName: string;
  } {
    const currentTokens = estimateMessagesTokens(messages, model, systemPrompt);
    
    // Get max tokens from model info
    const modelInfo = ModelInfos[model];
    const maxTokens = modelInfo?.maxTokens || 128000; // Default fallback
    const percentage = Math.min((currentTokens / maxTokens) * 100, 100);
    const needsCompaction = percentage > 80; // Threshold for compaction warning
    
    return {
      currentTokens,
      maxTokens,
      percentage,
      messageCount: messages.length,
      needsCompaction,
      modelName: modelInfo?.name || model
    };
  }

  static getDefaultConfig(): CompactionConfig {
    return {
      strategy: 'hybrid',
      preserveRecentCount: 10,
      maxToolResultLength: 2000,
      summaryModel: 'gpt-4o', // Use faster model for summarization
      enableAggressiveCompaction: false
    };
  }
}