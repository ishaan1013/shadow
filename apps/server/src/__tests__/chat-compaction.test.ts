import { ChatService } from '../chat';
import { MessageCompactor } from '../services/message-compactor';
import { prisma } from '@repo/db';
import { Message } from '@repo/types';

// Mock dependencies
jest.mock('@repo/db');
jest.mock('../services/message-compactor');
jest.mock('../llm');
jest.mock('../utils/token-estimator');

describe('ChatService Compaction Integration', () => {
  let chatService: ChatService;
  let mockPrisma: jest.Mocked<typeof prisma>;
  let mockCompactor: jest.Mocked<MessageCompactor>;

  beforeEach(() => {
    jest.clearAllMocks();
    chatService = new ChatService();
    mockPrisma = prisma as jest.Mocked<typeof prisma>;
    mockCompactor = new MessageCompactor() as jest.Mocked<MessageCompactor>;
    
    // Mock the private compactor instance
    (chatService as any).messageCompactor = mockCompactor;
  });

  describe('getChatHistory with compaction', () => {
    const mockDbMessages = [
      {
        id: '1',
        content: 'Hello',
        role: 'USER',
        sequence: 1,
        createdAt: new Date(),
        llmModel: null,
        metadata: null
      },
      {
        id: '2', 
        content: 'Hi there!',
        role: 'ASSISTANT',
        sequence: 2,
        createdAt: new Date(),
        llmModel: 'gpt-4o',
        metadata: null
      }
    ];

    beforeEach(() => {
      mockPrisma.chatMessage.findMany.mockResolvedValue(mockDbMessages);
    });

    it('should return original messages when compaction is disabled', async () => {
      const messages = await chatService.getChatHistory('task-1', { compact: false });
      
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe('Hello');
      expect(messages[1].content).toBe('Hi there!');
      expect(mockCompactor.compactMessages).not.toHaveBeenCalled();
    });

    it('should skip compaction when context is within limits', async () => {
      // Mock token estimator to return false for wouldExceedContextLimit
      const { wouldExceedContextLimit } = require('../utils/token-estimator');
      wouldExceedContextLimit.mockReturnValue(false);

      const messages = await chatService.getChatHistory('task-1', { compact: true });
      
      expect(messages).toHaveLength(2);
      expect(mockCompactor.compactMessages).not.toHaveBeenCalled();
    });

    it('should apply compaction when context exceeds limits', async () => {
      // Mock token estimator to return true for wouldExceedContextLimit
      const { wouldExceedContextLimit } = require('../utils/token-estimator');
      wouldExceedContextLimit.mockReturnValue(true);

      // Mock compaction result
      const compactedMessages: Message[] = [
        {
          id: '1',
          role: 'user',
          content: 'Hello',
          createdAt: new Date().toISOString()
        }
      ];

      mockCompactor.compactMessages.mockResolvedValue({
        compactedMessages,
        tokensSaved: 100,
        originalCount: 2,
        compactedCount: 1,
        strategy: 'hybrid',
        preservedMessageIds: ['1']
      });

      const messages = await chatService.getChatHistory('task-1', { 
        compact: true, 
        model: 'gpt-4o' 
      });
      
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Hello');
      expect(mockCompactor.compactMessages).toHaveBeenCalledWith(
        expect.any(Array),
        'gpt-4o',
        expect.objectContaining({
          strategy: expect.any(String),
          preserveRecentCount: expect.any(Number)
        })
      );
    });

    it('should handle compaction failures gracefully', async () => {
      // Mock token estimator to return true for wouldExceedContextLimit
      const { wouldExceedContextLimit } = require('../utils/token-estimator');
      wouldExceedContextLimit.mockReturnValue(true);

      // Mock compaction to fail
      mockCompactor.compactMessages
        .mockRejectedValueOnce(new Error('Compaction failed'))
        .mockResolvedValueOnce({
          compactedMessages: [{ 
            id: '2', 
            role: 'assistant', 
            content: 'Hi there!', 
            createdAt: new Date().toISOString() 
          }],
          tokensSaved: 50,
          originalCount: 2,
          compactedCount: 1,
          strategy: 'sliding-window',
          preservedMessageIds: ['2']
        });

      const messages = await chatService.getChatHistory('task-1', { compact: true });
      
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Hi there!');
      expect(mockCompactor.compactMessages).toHaveBeenCalledTimes(2); // Original + fallback
    });

    it('should use last resort when all compaction fails', async () => {
      // Mock token estimator to return true for wouldExceedContextLimit
      const { wouldExceedContextLimit } = require('../utils/token-estimator');
      wouldExceedContextLimit.mockReturnValue(true);

      // Mock both compaction attempts to fail
      mockCompactor.compactMessages
        .mockRejectedValueOnce(new Error('Primary compaction failed'))
        .mockRejectedValueOnce(new Error('Fallback compaction failed'));

      const messages = await chatService.getChatHistory('task-1', { compact: true });
      
      // Should return recent messages (last resort)
      expect(messages).toHaveLength(2); // Both messages are recent
      expect(mockCompactor.compactMessages).toHaveBeenCalledTimes(2);
    });
  });

  describe('processUserMessage with auto-compaction', () => {
    beforeEach(() => {
      // Mock required methods
      mockPrisma.chatMessage.create.mockResolvedValue({
        id: 'new-msg',
        content: 'test',
        role: 'USER',
        sequence: 1,
        createdAt: new Date(),
        llmModel: null,
        metadata: null,
        taskId: 'task-1',
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        finishReason: null
      });

      mockPrisma.chatMessage.findFirst.mockResolvedValue({
        sequence: 0
      });

      // Mock LLM service
      const mockLLMService = {
        createMessageStream: async function* () {
          yield {
            type: 'content',
            content: 'Test response'
          };
          yield {
            type: 'usage',
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
          };
        }
      };
      (chatService as any).llmService = mockLLMService;
    });

    it('should automatically apply compaction when processing messages', async () => {
      // Setup mocks for compaction flow
      const { wouldExceedContextLimit } = require('../utils/token-estimator');
      wouldExceedContextLimit.mockReturnValue(true);

      mockPrisma.chatMessage.findMany.mockResolvedValue([]);
      
      mockCompactor.compactMessages.mockResolvedValue({
        compactedMessages: [],
        tokensSaved: 100,
        originalCount: 0,
        compactedCount: 0,
        strategy: 'hybrid',
        preservedMessageIds: []
      });

      // This should trigger auto-compaction
      await chatService.processUserMessage({
        taskId: 'task-1',
        userMessage: 'Test message',
        llmModel: 'gpt-4o'
      });

      expect(mockCompactor.compactMessages).toHaveBeenCalled();
    });
  });
});