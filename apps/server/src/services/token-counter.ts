import { ModelType, getModelProvider } from "@repo/types";

// Simple estimation – doesn't use a real tokenizer, just estimates based on character length

export class TokenCounterService {
  countTokens(text: string, model: ModelType): number {
    // Cheap token extimation
    const provider = getModelProvider(model);
    
    // Estimate tokens based on character length
    const baseTokens = Math.ceil(text.length / 4);
    
    // Adjust for model characteristics
    switch (provider) {
      case "anthropic":
        return Math.ceil(baseTokens * 0.9);
      
      case "openai":
        return baseTokens;
      
      default:
        return baseTokens;
    }
  }


  countMessageTokens(content: string, metadata: unknown, model: ModelType): number {
    let totalTokens = this.countTokens(content, model);
    
    // Add tokens for metadata if present
    if (metadata) {
      const metadataString = JSON.stringify(metadata);
      totalTokens += this.countTokens(metadataString, model);
    }
    
    return totalTokens;
  }

  // Count total tokens for an array of messages
  countTotalTokens(messages: Array<{ content: string; metadata?: unknown }>, model: ModelType): number {
    return messages.reduce((total, message) => {
      return total + this.countMessageTokens(message.content, message.metadata, model);
    }, 0);
  }

  // Get the token limit for a specific model
  getTokenLimit(model: ModelType): number {
    const provider = getModelProvider(model);
    
    switch (model) {
      case "claude-sonnet-4-20250514":
        return 200000; // Claude 4 has 200k context window
      case "claude-opus-4-20250514":
        return 200000; // Claude 4 has 200k context window
      
      case "gpt-4o": // GPT-4o has 128k context window
        return 128000; 
      
      case "o3":
        return 128000; 
      
      case "o4-mini-high":
        return 128000; 
      
      default:
        return provider === "anthropic" ? 200000 : 128000;
    }
  }

  // Get compression threshold for a model
  getCompressionThreshold(model: ModelType, thresholdRatio: number = 0.5): number {
    return Math.floor(this.getTokenLimit(model) * thresholdRatio);
  }

  // Check if token count exceeds compression threshold
  shouldCompress(tokenCount: number, model: ModelType, thresholdRatio: number = 0.5): boolean {
    return tokenCount > this.getCompressionThreshold(model, thresholdRatio);
  }
}