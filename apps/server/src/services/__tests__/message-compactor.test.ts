import { Message } from '@repo/types';
import { MessageCompactor } from '../message-compactor';

describe('MessageCompactor', () => {
  let compactor: MessageCompactor;

  beforeEach(() => {
    compactor = new MessageCompactor();
  });

  describe('getDefaultConfig', () => {
    it('should return sensible default configuration', () => {
      const config = MessageCompactor.getDefaultConfig();
      
      expect(config.strategy).toBe('hybrid');
      expect(config.preserveRecentCount).toBe(10);
      expect(config.maxToolResultLength).toBe(2000);
      expect(config.summaryModel).toBe('gpt-4o');
      expect(config.enableAggressiveCompaction).toBe(false);
    });
  });

  describe('compactMessages', () => {
    const createMockMessage = (
      id: string, 
      role: 'user' | 'assistant' | 'tool',
      content: string,
      metadata?: any
    ): Message => ({
      id,
      role,
      content,
      createdAt: new Date().toISOString(),
      metadata
    });

    it('should apply sliding window strategy correctly', async () => {
      const messages: Message[] = [
        createMockMessage('1', 'user', 'First message'),
        createMockMessage('2', 'assistant', 'First response'),
        createMockMessage('3', 'user', 'Second message'),
        createMockMessage('4', 'assistant', 'Second response'),
        createMockMessage('5', 'user', 'Third message'),
        createMockMessage('6', 'assistant', 'Third response'),
        createMockMessage('7', 'user', 'Fourth message'),
        createMockMessage('8', 'assistant', 'Fourth response'),
      ];

      const config = {
        ...MessageCompactor.getDefaultConfig(),
        strategy: 'sliding-window' as const,
        preserveRecentCount: 3
      };

      const result = await compactor.compactMessages(messages, 'gpt-4o', config);
      
      expect(result.compactedMessages).toHaveLength(4); // First message + 3 recent
      expect(result.compactedMessages[0].id).toBe('1'); // First message preserved
      expect(result.compactedMessages[1].id).toBe('6'); // Recent messages
      expect(result.compactedMessages[2].id).toBe('7');
      expect(result.compactedMessages[3].id).toBe('8');
      expect(result.strategy).toBe('sliding-window');
      expect(result.originalCount).toBe(8);
      expect(result.compactedCount).toBe(4);
    });

    it('should handle short conversations without compaction', async () => {
      const messages: Message[] = [
        createMockMessage('1', 'user', 'Short conversation'),
        createMockMessage('2', 'assistant', 'Short response'),
      ];

      const config = {
        ...MessageCompactor.getDefaultConfig(),
        strategy: 'sliding-window' as const,
        preserveRecentCount: 10
      };

      const result = await compactor.compactMessages(messages, 'gpt-4o', config);
      
      expect(result.compactedMessages).toHaveLength(2);
      expect(result.compactedMessages).toEqual(messages);
      expect(result.tokensSaved).toBeGreaterThanOrEqual(0);
    });

    it('should identify messages that need tool result compression', async () => {
      const longToolResult = 'x'.repeat(3000); // Exceeds default maxToolResultLength
      const messages: Message[] = [
        createMockMessage('1', 'user', 'Run a tool'),
        createMockMessage('2', 'tool', longToolResult, {
          tool: {
            name: 'test-tool',
            args: {},
            status: 'COMPLETED',
            result: longToolResult
          }
        }),
      ];

      const config = {
        ...MessageCompactor.getDefaultConfig(),
        strategy: 'tool-result-summarization' as const,
        maxToolResultLength: 2000
      };

      // Mock the LLM service to avoid actual API calls in tests
      const mockSummarize = jest.spyOn(compactor['llmService'], 'generateWithTools')
        .mockResolvedValue({
          text: 'Summarized tool result',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: 'stop',
          toolCalls: [],
          toolResults: []
        });

      const result = await compactor.compactMessages(messages, 'gpt-4o', config);
      
      expect(result.compactedMessages).toHaveLength(2);
      expect(result.compactedMessages[1].content).toBe('Summarized tool result');
      expect(result.compactedMessages[1].metadata?.isCompacted).toBe(true);
      expect(result.compactedMessages[1].metadata?.compactionStrategy).toBe('tool-result-summarization');
      expect(mockSummarize).toHaveBeenCalled();
      
      mockSummarize.mockRestore();
    });
  });

  describe('private methods accessibility', () => {
    it('should have correct method signatures', () => {
      // Test that the compactor has the expected methods
      expect(typeof compactor.compactMessages).toBe('function');
      expect(typeof MessageCompactor.getDefaultConfig).toBe('function');
      
      // Test static method
      const config = MessageCompactor.getDefaultConfig();
      expect(config).toBeDefined();
      expect(typeof config).toBe('object');
    });
  });
});