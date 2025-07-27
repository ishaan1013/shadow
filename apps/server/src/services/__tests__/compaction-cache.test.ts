import { CompactionCache } from '../compaction-cache';
import { MessageCompactor } from '../message-compactor';

describe('CompactionCache', () => {
  let cache: CompactionCache;

  beforeEach(() => {
    cache = new CompactionCache();
  });

  describe('Tool Summary Caching', () => {
    it('should cache and retrieve tool summaries', () => {
      const content = 'Very long tool result content that needs compression';
      const toolName = 'test-tool';
      const summary = 'Short summary';

      // First call should return null (no cache)
      expect(cache.getToolSummary(content, toolName)).toBeNull();

      // Set cache
      cache.setToolSummary(content, toolName, summary);

      // Second call should return cached value
      expect(cache.getToolSummary(content, toolName)).toBe(summary);
    });

    it('should handle cache misses for different content', () => {
      const content1 = 'First tool result';
      const content2 = 'Second tool result';
      const toolName = 'test-tool';

      cache.setToolSummary(content1, toolName, 'First summary');

      expect(cache.getToolSummary(content1, toolName)).toBe('First summary');
      expect(cache.getToolSummary(content2, toolName)).toBeNull();
    });
  });

  describe('Conversation Summary Caching', () => {
    it('should cache and retrieve conversation summaries', () => {
      const messageIds = ['msg1', 'msg2', 'msg3'];
      const summary = 'Conversation summary';

      // First call should return null
      expect(cache.getConversationSummary(messageIds)).toBeNull();

      // Set cache
      cache.setConversationSummary(messageIds, summary);

      // Second call should return cached value
      expect(cache.getConversationSummary(messageIds)).toBe(summary);
    });

    it('should miss cache for different message order', () => {
      const messageIds1 = ['msg1', 'msg2', 'msg3'];
      const messageIds2 = ['msg3', 'msg2', 'msg1'];

      cache.setConversationSummary(messageIds1, 'Summary 1');

      expect(cache.getConversationSummary(messageIds1)).toBe('Summary 1');
      expect(cache.getConversationSummary(messageIds2)).toBeNull();
    });
  });

  describe('Compaction Result Caching', () => {
    it('should cache compaction results with proper invalidation', () => {
      const taskId = 'test-task';
      const strategy = 'hybrid';
      const config = MessageCompactor.getDefaultConfig();
      const model = 'gpt-4o' as const;

      const mockResult = {
        compactedMessages: [],
        tokensSaved: 100,
        originalCount: 10,
        compactedCount: 5,
        strategy: 'hybrid' as const,
        preservedMessageIds: []
      };

      // Should return null initially
      expect(cache.getCompactionResult(taskId, 5, strategy, config, model)).toBeNull();

      // Set cache
      cache.setCompactionResult(taskId, 5, strategy, config, model, mockResult);

      // Should return cached result for same sequence
      expect(cache.getCompactionResult(taskId, 5, strategy, config, model)).toEqual(mockResult);

      // Should return null for newer sequence (cache invalidation)
      expect(cache.getCompactionResult(taskId, 6, strategy, config, model)).toBeNull();
    });
  });

  describe('Cache Management', () => {
    it('should provide accurate stats', () => {
      const stats = cache.getStats();
      expect(stats.compactionEntries).toBe(0);
      expect(stats.toolSummaryEntries).toBe(0);
      expect(stats.conversationSummaryEntries).toBe(0);

      cache.setToolSummary('content', 'tool', 'summary');
      cache.setConversationSummary(['msg1'], 'summary');

      const newStats = cache.getStats();
      expect(newStats.toolSummaryEntries).toBe(1);
      expect(newStats.conversationSummaryEntries).toBe(1);
    });

    it('should invalidate task-specific entries', () => {
      const taskId = 'test-task';
      const config = MessageCompactor.getDefaultConfig();
      const mockResult = {
        compactedMessages: [],
        tokensSaved: 100,
        originalCount: 10,
        compactedCount: 5,
        strategy: 'hybrid' as const,
        preservedMessageIds: []
      };

      cache.setCompactionResult(taskId, 5, 'hybrid', config, 'gpt-4o', mockResult);
      
      // Verify cache exists
      expect(cache.getCompactionResult(taskId, 5, 'hybrid', config, 'gpt-4o')).toEqual(mockResult);

      // Invalidate
      cache.invalidateTask(taskId);

      // Verify cache is gone
      expect(cache.getCompactionResult(taskId, 5, 'hybrid', config, 'gpt-4o')).toBeNull();
    });
  });
});