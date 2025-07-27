import { Message } from '@repo/types';
import { 
  estimateMessageTokens, 
  estimateMessagesTokens, 
  estimateSystemPromptTokens,
  estimateContextTokens,
  getModelContextLimit,
  wouldExceedContextLimit
} from '../token-estimator';

describe('TokenEstimator', () => {
  const createMockMessage = (content: string, role: 'user' | 'assistant' | 'tool' = 'user'): Message => ({
    id: 'test-id',
    role,
    content,
    createdAt: new Date().toISOString()
  });

  describe('estimateMessageTokens', () => {
    it('should estimate tokens for simple messages', () => {
      const message = createMockMessage('Hello world');
      const tokens = estimateMessageTokens(message, 'gpt-4o');
      
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(50); // Should be reasonable for short message
    });

    it('should estimate more tokens for longer messages', () => {
      const shortMessage = createMockMessage('Hi');
      const longMessage = createMockMessage('This is a much longer message that should have significantly more tokens than the short one');
      
      const shortTokens = estimateMessageTokens(shortMessage, 'gpt-4o');
      const longTokens = estimateMessageTokens(longMessage, 'gpt-4o');
      
      expect(longTokens).toBeGreaterThan(shortTokens);
    });

    it('should handle messages with tool metadata', () => {
      const messageWithTool = createMockMessage('Tool result', 'tool');
      messageWithTool.metadata = {
        tool: {
          name: 'test-tool',
          args: { param: 'value' },
          status: 'COMPLETED',
          result: 'This is a tool result with some content'
        }
      };
      
      const tokens = estimateMessageTokens(messageWithTool, 'gpt-4o');
      expect(tokens).toBeGreaterThan(10); // Should account for tool metadata
    });
  });

  describe('estimateMessagesTokens', () => {
    it('should sum tokens for multiple messages', () => {
      const messages = [
        createMockMessage('First message'),
        createMockMessage('Second message'),
        createMockMessage('Third message')
      ];
      
      const totalTokens = estimateMessagesTokens(messages, 'gpt-4o');
      const individualSum = messages.reduce((sum, msg) => 
        sum + estimateMessageTokens(msg, 'gpt-4o'), 0
      );
      
      expect(totalTokens).toBe(individualSum);
    });
  });

  describe('estimateSystemPromptTokens', () => {
    it('should estimate tokens for system prompt', () => {
      const systemPrompt = 'You are a helpful assistant that answers questions accurately.';
      const tokens = estimateSystemPromptTokens(systemPrompt, 'gpt-4o');
      
      expect(tokens).toBeGreaterThan(10);
      expect(tokens).toBeLessThan(50);
    });
  });

  describe('estimateContextTokens', () => {
    it('should combine system prompt and message tokens', () => {
      const systemPrompt = 'You are helpful.';
      const messages = [createMockMessage('Hello')];
      
      const contextTokens = estimateContextTokens(systemPrompt, messages, 'gpt-4o');
      const systemTokens = estimateSystemPromptTokens(systemPrompt, 'gpt-4o');
      const messageTokens = estimateMessagesTokens(messages, 'gpt-4o');
      
      expect(contextTokens).toBeGreaterThanOrEqual(systemTokens + messageTokens);
    });
  });

  describe('getModelContextLimit', () => {
    it('should return correct limits for different models', () => {
      expect(getModelContextLimit('claude-sonnet-4-20250514')).toBe(200000);
      expect(getModelContextLimit('claude-opus-4-20250514')).toBe(200000);
      expect(getModelContextLimit('gpt-4o')).toBe(128000);
      expect(getModelContextLimit('o3')).toBe(128000);
    });
  });

  describe('wouldExceedContextLimit', () => {
    it('should return false for small contexts', () => {
      const systemPrompt = 'Short prompt';
      const messages = [createMockMessage('Short message')];
      
      const wouldExceed = wouldExceedContextLimit(systemPrompt, messages, 'gpt-4o');
      expect(wouldExceed).toBe(false);
    });

    it('should respect custom threshold', () => {
      const systemPrompt = 'Short prompt';
      const messages = [createMockMessage('Short message')];
      
      // With very low threshold, should trigger compaction
      const wouldExceed = wouldExceedContextLimit(systemPrompt, messages, 'gpt-4o', 0.0001);
      expect(wouldExceed).toBe(true);
    });

    it('should handle fallback estimation on error', () => {
      // Test with unusual characters that might cause encoding issues
      const systemPrompt = '🤖 System prompt with emojis 🎉';
      const messages = [createMockMessage('Message with special chars: ñáéíóú')];
      
      // Should not throw and should return a boolean
      const result = wouldExceedContextLimit(systemPrompt, messages, 'gpt-4o');
      expect(typeof result).toBe('boolean');
    });
  });
});