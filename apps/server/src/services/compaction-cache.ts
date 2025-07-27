import { Message, ModelType } from '@repo/types';
import { CompactionResult, CompactionConfig } from './message-compactor';

interface CacheEntry {
  compactedMessages: Message[];
  lastSequence: number;
  strategy: string;
  config: CompactionConfig;
  timestamp: number;
  tokensSaved: number;
  originalCount: number;
  compactedCount: number;
}

interface ToolSummaryCacheEntry {
  originalContent: string;
  summarizedContent: string;
  toolName: string;
  timestamp: number;
}

interface ConversationSummaryCacheEntry {
  messageIds: string[];
  summary: string;
  timestamp: number;
}

export class CompactionCache {
  private compactionCache = new Map<string, CacheEntry>();
  private toolSummaryCache = new Map<string, ToolSummaryCacheEntry>();
  private conversationSummaryCache = new Map<string, ConversationSummaryCacheEntry>();
  
  // Cache TTL in milliseconds
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 minutes
  private readonly TOOL_SUMMARY_TTL = 24 * 60 * 60 * 1000; // 24 hours (tool summaries are more stable)
  private readonly CONVERSATION_SUMMARY_TTL = 60 * 60 * 1000; // 1 hour

  /**
   * Get cached compaction result if valid
   */
  getCompactionResult(
    taskId: string,
    lastSequence: number,
    strategy: string,
    config: CompactionConfig,
    model: ModelType
  ): CompactionResult | null {
    const cacheKey = this.getCompactionCacheKey(taskId, strategy, model);
    const cached = this.compactionCache.get(cacheKey);
    
    if (!cached) {
      return null;
    }
    
    // Check if cache is stale
    if (this.isCacheStale(cached.timestamp, this.CACHE_TTL)) {
      this.compactionCache.delete(cacheKey);
      return null;
    }
    
    // Check if new messages were added
    if (cached.lastSequence < lastSequence) {
      this.compactionCache.delete(cacheKey);
      return null;
    }
    
    // Check if config changed significantly
    if (!this.isConfigCompatible(cached.config, config)) {
      this.compactionCache.delete(cacheKey);
      return null;
    }
    
    console.log(`[CACHE] Hit: Compaction cache for task ${taskId}`);
    
    return {
      compactedMessages: cached.compactedMessages,
      tokensSaved: cached.tokensSaved,
      originalCount: cached.originalCount,
      compactedCount: cached.compactedCount,
      strategy: cached.strategy as any,
      preservedMessageIds: cached.compactedMessages.map(m => m.id)
    };
  }
  
  /**
   * Cache compaction result
   */
  setCompactionResult(
    taskId: string,
    lastSequence: number,
    strategy: string,
    config: CompactionConfig,
    model: ModelType,
    result: CompactionResult
  ): void {
    const cacheKey = this.getCompactionCacheKey(taskId, strategy, model);
    
    this.compactionCache.set(cacheKey, {
      compactedMessages: result.compactedMessages,
      lastSequence,
      strategy,
      config: { ...config }, // Deep copy config
      timestamp: Date.now(),
      tokensSaved: result.tokensSaved,
      originalCount: result.originalCount,
      compactedCount: result.compactedCount
    });
    
    console.log(`[CACHE] Set: Compaction cache for task ${taskId}, saved ${result.tokensSaved} tokens`);
  }
  
  /**
   * Get cached tool summary
   */
  getToolSummary(content: string, toolName: string): string | null {
    const cacheKey = this.getToolSummaryCacheKey(content, toolName);
    const cached = this.toolSummaryCache.get(cacheKey);
    
    if (!cached) {
      return null;
    }
    
    if (this.isCacheStale(cached.timestamp, this.TOOL_SUMMARY_TTL)) {
      this.toolSummaryCache.delete(cacheKey);
      return null;
    }
    
    console.log(`[CACHE] Hit: Tool summary cache for ${toolName}`);
    return cached.summarizedContent;
  }
  
  /**
   * Cache tool summary
   */
  setToolSummary(content: string, toolName: string, summary: string): void {
    const cacheKey = this.getToolSummaryCacheKey(content, toolName);
    
    this.toolSummaryCache.set(cacheKey, {
      originalContent: content,
      summarizedContent: summary,
      toolName,
      timestamp: Date.now()
    });
    
    console.log(`[CACHE] Set: Tool summary cache for ${toolName}, ${content.length} → ${summary.length} chars`);
  }
  
  /**
   * Get cached conversation summary
   */
  getConversationSummary(messageIds: string[]): string | null {
    const cacheKey = this.getConversationSummaryCacheKey(messageIds);
    const cached = this.conversationSummaryCache.get(cacheKey);
    
    if (!cached) {
      return null;
    }
    
    if (this.isCacheStale(cached.timestamp, this.CONVERSATION_SUMMARY_TTL)) {
      this.conversationSummaryCache.delete(cacheKey);
      return null;
    }
    
    // Check if message IDs match exactly
    if (!this.arraysEqual(cached.messageIds, messageIds)) {
      return null;
    }
    
    console.log(`[CACHE] Hit: Conversation summary cache for ${messageIds.length} messages`);
    return cached.summary;
  }
  
  /**
   * Cache conversation summary
   */
  setConversationSummary(messageIds: string[], summary: string): void {
    const cacheKey = this.getConversationSummaryCacheKey(messageIds);
    
    this.conversationSummaryCache.set(cacheKey, {
      messageIds: [...messageIds], // Copy array
      summary,
      timestamp: Date.now()
    });
    
    console.log(`[CACHE] Set: Conversation summary cache for ${messageIds.length} messages`);
  }
  
  /**
   * Invalidate all cache entries for a task
   */
  invalidateTask(taskId: string): void {
    // Remove compaction cache entries
    for (const [key, _] of this.compactionCache) {
      if (key.startsWith(`${taskId}-`)) {
        this.compactionCache.delete(key);
      }
    }
    
    console.log(`[CACHE] Invalidated: All cache entries for task ${taskId}`);
  }
  
  /**
   * Clean up stale cache entries
   */
  cleanup(): void {
    const now = Date.now();
    let cleanedCount = 0;
    
    // Clean compaction cache
    for (const [key, entry] of this.compactionCache) {
      if (this.isCacheStale(entry.timestamp, this.CACHE_TTL)) {
        this.compactionCache.delete(key);
        cleanedCount++;
      }
    }
    
    // Clean tool summary cache
    for (const [key, entry] of this.toolSummaryCache) {
      if (this.isCacheStale(entry.timestamp, this.TOOL_SUMMARY_TTL)) {
        this.toolSummaryCache.delete(key);
        cleanedCount++;
      }
    }
    
    // Clean conversation summary cache
    for (const [key, entry] of this.conversationSummaryCache) {
      if (this.isCacheStale(entry.timestamp, this.CONVERSATION_SUMMARY_TTL)) {
        this.conversationSummaryCache.delete(key);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`[CACHE] Cleanup: Removed ${cleanedCount} stale cache entries`);
    }
  }
  
  /**
   * Get cache statistics
   */
  getStats(): {
    compactionEntries: number;
    toolSummaryEntries: number;
    conversationSummaryEntries: number;
    totalMemoryUsage: string;
  } {
    return {
      compactionEntries: this.compactionCache.size,
      toolSummaryEntries: this.toolSummaryCache.size,
      conversationSummaryEntries: this.conversationSummaryCache.size,
      totalMemoryUsage: `~${Math.round((this.compactionCache.size * 10 + this.toolSummaryCache.size * 2 + this.conversationSummaryCache.size * 1))}KB`
    };
  }
  
  // Private helper methods
  
  private getCompactionCacheKey(taskId: string, strategy: string, model: ModelType): string {
    return `${taskId}-${strategy}-${model}`;
  }
  
  private getToolSummaryCacheKey(content: string, toolName: string): string {
    // Use content hash for consistent caching of identical tool results
    const contentHash = this.simpleHash(content);
    return `${toolName}-${contentHash}`;
  }
  
  private getConversationSummaryCacheKey(messageIds: string[]): string {
    // Create deterministic key from message IDs
    return messageIds.join('-');
  }
  
  private isCacheStale(timestamp: number, ttl: number): boolean {
    return (Date.now() - timestamp) > ttl;
  }
  
  private isConfigCompatible(cached: CompactionConfig, current: CompactionConfig): boolean {
    // Check if significant config changes that would affect results
    return (
      cached.strategy === current.strategy &&
      cached.preserveRecentCount === current.preserveRecentCount &&
      cached.maxToolResultLength === current.maxToolResultLength &&
      cached.summaryModel === current.summaryModel
    );
  }
  
  private arraysEqual<T>(a: T[], b: T[]): boolean {
    return a.length === b.length && a.every((val, i) => val === b[i]);
  }
  
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }
}

// Global cache instance
export const compactionCache = new CompactionCache();

// Cleanup job - run every 30 minutes
setInterval(() => {
  compactionCache.cleanup();
}, 30 * 60 * 1000);