import { encode } from 'gpt-tokenizer';
import { Message, ModelType, getModelProvider } from '@repo/types';

/**
 * Estimates token count for a single message
 */
export function estimateMessageTokens(message: Message, model: ModelType): number {
  try {
    let tokens = encode(message.content).length;
    
    // Add tokens for role and metadata overhead
    tokens += encode(message.role).length;
    
    // Add overhead for message structure (varies by provider)
    const provider = getModelProvider(model);
    switch (provider) {
      case 'openai':
        // OpenAI format: {"role": "user", "content": "..."}
        tokens += 4; // Overhead for JSON structure
        break;
      case 'anthropic':
        // Anthropic format: Human: ... or Assistant: ...
        tokens += 3; // Overhead for role prefix
        break;
    }
    
    // Add tokens for metadata if present
    if (message.metadata) {
      if (message.metadata.parts) {
        for (const part of message.metadata.parts) {
          if (part.type === 'tool-call') {
            tokens += encode(part.toolName).length;
            tokens += encode(JSON.stringify(part.args)).length;
            tokens += 10; // Tool call overhead
          } else if (part.type === 'tool-result') {
            tokens += encode(JSON.stringify(part.result)).length;
            tokens += 8; // Tool result overhead
          }
        }
      }
      
      if (message.metadata.tool) {
        tokens += encode(message.metadata.tool.name).length;
        tokens += encode(JSON.stringify(message.metadata.tool.args)).length;
        if (message.metadata.tool.result) {
          const resultStr = typeof message.metadata.tool.result === 'string' 
            ? message.metadata.tool.result 
            : JSON.stringify(message.metadata.tool.result);
          tokens += encode(resultStr).length;
        }
        tokens += 15; // Tool metadata overhead
      }
    }
    
    return tokens;
  } catch (error) {
    console.warn('Failed to estimate tokens for message:', error);
    // Fallback: rough estimate of 4 characters per token
    return Math.ceil(message.content.length / 4);
  }
}


export function estimateMessagesTokens(messages: Message[], model: ModelType, systemPrompt?: string): number {
  let totalTokens = messages.reduce((total, message) => {
    return total + estimateMessageTokens(message, model);
  }, 0);
  
  // Add system prompt tokens if provided
  if (systemPrompt) {
    totalTokens += estimateSystemPromptTokens(systemPrompt, model);
  }
  
  return totalTokens;
}


export function estimateSystemPromptTokens(systemPrompt: string, model: ModelType): number {
  try {
    return encode(systemPrompt).length + 5; // System role overhead
  } catch (error) {
    console.warn('Failed to estimate system prompt tokens:', error);
    return Math.ceil(systemPrompt.length / 4);
  }
}


export function estimateContextTokens(
  systemPrompt: string,
  messages: Message[], 
  model: ModelType
): number {
  const systemTokens = estimateSystemPromptTokens(systemPrompt, model);
  const messageTokens = estimateMessagesTokens(messages, model);
  
  // Add small overhead for conversation structure
  return systemTokens + messageTokens + Math.min(messages.length * 2, 20);
}


export function getModelContextLimit(model: ModelType): number {
  const provider = getModelProvider(model);
  
  switch (model) {
    case 'claude-sonnet-4-20250514':
    case 'claude-opus-4-20250514':
      return 200000;
    case 'gpt-4o':
    case 'o3':
    case 'o4-mini-high':
      return 128000;
    default:
      // Conservative default
      return 128000;
  }
}


export function wouldExceedContextLimit(
  systemPrompt: string,
  messages: Message[],
  model: ModelType,
  threshold: number
): boolean {
  const contextTokens = estimateContextTokens(systemPrompt, messages, model);
  const limit = getModelContextLimit(model);
  
  return contextTokens > (limit * threshold);
}