import { prisma } from "@repo/db";
import { 
  CompressionLevel, 
  CompressedVersions, 
  CompressedMessageVersion,
  ModelType,
  MessageMetadata 
} from "@repo/types";
import { TokenCounterService } from "./token-counter";
import { LLMService } from "../llm";



// Does the actual compression of messages
/**
 * MessageCompressor has 3 levels:
 * - NONE: No compression
 * - LIGHT: Remove verbose metadata, compress code blocks
 * - MEDIUM: Summarize tool outputs and long responses
 * - HEAVY: Full summarization, fallback to medium if heavy fails
 * 
 */
export class MessageCompressor {
  private tokenCounter: TokenCounterService; // Token counter service (just estimates tokens)
  private llmService: LLMService; // LLM service (handles LLM calls)

  constructor() {
    this.tokenCounter = new TokenCounterService();
    this.llmService = new LLMService();
  }

  // Compress a message to a specific level and store in database
  async compressMessage(
    messageId: string, 
    targetLevel: CompressionLevel,
    model: ModelType
  ): Promise<CompressedMessageVersion> {
    if (targetLevel === "NONE") {
      throw new Error("Cannot compress to NONE level");
    }

    const message = await prisma.chatMessage.findUnique({
      where: { id: messageId }
    }); // Get message from database

    if (!message) {
      throw new Error(`Message ${messageId} not found`);
    }

    // Check if this compression level already exists - prevent re-compression
    const existingCompression = await this.getCompressedVersion(messageId, targetLevel, model);
    if (existingCompression) {
      return existingCompression;
    }

    // Perform compression based on level
    const compressedContent = await this.performCompression(
      message.content,
      message.metadata,
      targetLevel,
      model
    );

    // Count tokens in compressed content
    const compressedTokens = this.tokenCounter.countTokens(compressedContent, model);

    // Create compressed version
    const compressedVersion: CompressedMessageVersion = {
      content: compressedContent,
      tokens: compressedTokens,
      metadata: this.compressMetadata(message.metadata, targetLevel),
      compressedAt: new Date().toISOString()
    };

    // Update database with compressed version
    await this.storeCompressedVersion(messageId, targetLevel, compressedVersion);

    return compressedVersion;
  }


  async getCompressedVersion(
    messageId: string, 
    level: CompressionLevel,
    model: ModelType
  ): Promise<CompressedMessageVersion | null> {
    if (level === "NONE") {
      // Return original message
      const message = await prisma.chatMessage.findUnique({
        where: { id: messageId }
      });
      
      if (!message) return null;

      return {
        content: message.content,
        tokens: message.totalTokens || this.tokenCounter.countTokens(message.content, model),
        metadata: message.metadata as MessageMetadata,
        compressedAt: message.createdAt.toISOString()
      };
    }

    const message = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { compressedVersions: true }
    });

    if (!message?.compressedVersions) {
      return null;
    }

    const versions = message.compressedVersions as CompressedVersions;
    return versions[level] || null;
  }

  // Ensure a message has the required compression level
  async ensureCompressionLevel(
    messageId: string, 
    level: CompressionLevel,
    model: ModelType
  ): Promise<CompressedMessageVersion> {
    const existing = await this.getCompressedVersion(messageId, level, model);
    if (existing) {
      return existing;
    }

    if (level === "NONE") {
      throw new Error("NONE level should always exist");
    }

    return await this.compressMessage(messageId, level, model);
  }

  // Perform the actual compression based on level
  private async performCompression(
    content: string,
    metadata: unknown,
    level: CompressionLevel,
    model: ModelType
  ): Promise<string> {
    switch (level) {
      case "LIGHT":
        return this.lightCompression(content, metadata);
      
      case "MEDIUM":
        return this.mediumCompression(content, metadata);
      
      case "HEAVY":
        return await this.heavyCompression(content, metadata, model);
      
      default:
        return content;
    }
  }

  // Light compression: Remove verbose metadata, compress code blocks
  // Improved to preserve context while reducing size - keeps important parts visible
  private lightCompression(content: string, _metadata: unknown): string {
    let compressed = content;

    // Compress very large code blocks (>20 lines) - keep first few lines + summary
    compressed = compressed.replace(
      /```[\s\S]*?```/g,
      (match) => {
        const lines = match.split('\n');
        if (lines.length > 20) {
          const firstLine = lines[0]; // ```language
          const language = firstLine?.replace('```', '').trim();
          const firstCodeLines = lines.slice(1, 4).join('\n'); // First 3 lines of actual code
          const totalLines = lines.length - 2; // Exclude ``` lines
          return `${firstLine}\n${firstCodeLines}\n[... ${totalLines - 3} more lines of ${language} code]\n\`\`\``;
        }
        return match;
      }
    );

    // Compress very long file content (>500 chars) - keep beginning + summary  
    compressed = compressed.replace(
      /(File content:|Reading file:|File contents:)([\s\S]*?)(?=\n\n|$)/gi,
      (match, prefix, content) => {
        if (content && content.length > 500) {
          const truncated = content.substring(0, 200);
          const totalChars = content.length;
          return `${prefix}${truncated}\n[... file content truncated - ${totalChars} chars total]`;
        }
        return match;
      }
    );

    // Compress long lists (>10 items) - keep first few + summary
    compressed = compressed.replace(
      /(\n- [^\n]+(?:\n- [^\n]+){9,})/g,
      (match) => {
        const items = match.split('\n- ').filter(item => item.trim());
        if (items.length > 10) {
          const firstItems = items.slice(0, 3).map(item => `- ${item}`).join('\n');
          const remainingCount = items.length - 3;
          return `${firstItems}\n[... ${remainingCount} more items]`;
        }
        return match;
      }
    );

    // Remove extra whitespace
    compressed = compressed.replace(/\n{3,}/g, '\n\n'); // Remove 3+ newlines

    return compressed;
  }

  // Medium compression: Summarize tool outputs and long responses
  // More conservative than original - preserves context while reducing size
  private mediumCompression(content: string, metadata: unknown): string {
    let compressed = this.lightCompression(content, metadata);

    // Compress tool results to summaries
    compressed = compressed.replace(
      /Tool result:|Command output:|Search results:/gi, // Tool result:|Command output:|Search results:
      (match, offset, string) => {
        const section = string.slice(offset, offset + 500);
        const words = section.split(' ').length;
        if (words > 50) {
          return `${match} [Result summarized - ${words} words]`;
        }
        return match;
      }
    );

    // Compress very long paragraphs (8+ sentences) - keep first sentence + summary
    compressed = compressed.replace(
      /([A-Z][^.!?]*[.!?])(\s+[A-Z][^.!?]*[.!?]){7,}/g,
      (match) => {
        const sentences = match.split(/[.!?]/).filter(s => s.trim());
        if (sentences.length >= 8) {
          const firstSentence = sentences[0]?.trim() || "";
          const remainingCount = sentences.length - 1;
          return `${firstSentence}. [${remainingCount} additional sentences compressed]`;
        }
        return match;
      }
    );

    // Compress extremely long single sentences (>300 characters)
    compressed = compressed.replace(
      /[A-Z][^.!?]{300,}[.!?]/g,
      (match) => {
        const truncated = match.substring(0, 100);
        const charCount = match.length;
        return `${truncated}... [sentence truncated - ${charCount} chars total]`;
      }
    );

    return compressed;
  }

  // Heavy compression: Full LLM-powered summarization
  // TODO: By default this uses our server API key rather than the user's API key
  private async heavyCompression(
    content: string, 
    metadata: unknown, 
    model: ModelType
  ): Promise<string> {
    try {
      const compressionPrompt = `Please summarize the following message content in 2-3 sentences, preserving only the most essential information, key decisions, and important context:

${content}

Summary:`;


      const messages = [{
        id: "compress-" + Date.now(),
        role: "user" as const,
        content: compressionPrompt,
        llmModel: model,
        createdAt: new Date().toISOString()
      }];

      let summary = "";
      for await (const chunk of this.llmService.createMessageStream(
        "You are a helpful assistant that summarizes content concisely.",
        messages,
        model,
        false // No tools for compression
      )) {
        if (chunk.type === "content" && chunk.content) {
          summary += chunk.content;
        }
      }

      return summary.trim() || this.mediumCompression(content, metadata);
    } catch (error) {
      console.warn("Heavy compression failed, falling back to medium:", error);
      return this.mediumCompression(content, metadata);
    }
  }

  // Compress metadata by removing verbose parts
  private compressMetadata(metadata: unknown, level: CompressionLevel): MessageMetadata | undefined {
    if (!metadata || level === "NONE") {
      return metadata as MessageMetadata;
    }

    const meta = metadata as any;
    
    if (level === "LIGHT") {
      // Keep most metadata but remove verbose tool args
      if (meta.tool?.args) {
        return {
          ...meta,
          tool: {
            ...meta.tool,
            args: "[compressed]"
          }
        };
      }
    }

    if (level === "MEDIUM" || level === "HEAVY") {
      // Keep only essential metadata
      return {
        usage: meta.usage,
        finishReason: meta.finishReason
      };
    }

    return meta as MessageMetadata;
  }

  // Store compressed version in database
  private async storeCompressedVersion(
    messageId: string,
    level: CompressionLevel,
    compressedVersion: CompressedMessageVersion
  ): Promise<void> {
    // Get existing compressed versions
    const message = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { compressedVersions: true }
    });

    const existingVersions = (message?.compressedVersions as CompressedVersions) || {};
    
    // Add new compression level
    const updatedVersions: CompressedVersions = {
      ...existingVersions,
      [level]: compressedVersion
    };

    // Update database
    await prisma.chatMessage.update({
      where: { id: messageId },
      data: {
        compressedVersions: updatedVersions as any,
        activeCompressionLevel: level
      }
    });
  }
}