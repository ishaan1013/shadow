import { prisma } from "@repo/db";
import { 
  CompressionLevel, 
  CompressedVersions, 
  CompressedMessageVersion,
  ModelType 
} from "@repo/types";
import { TokenCounterService } from "./token-counter";
import { LLMService } from "../llm";



// Does the actual compression of messages
/**
 * MessageCompressor has 2 levels:
 * - NONE: No compression
 * - LIGHT: Remove verbose metadata, compress code blocks
 * - HEAVY: Full LLM-powered summarization, fallback to light if heavy fails
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

    console.log(`[COMPRESSION] Compressing message ${messageId} to ${targetLevel} level`);

    const message = await prisma.chatMessage.findUnique({
      where: { id: messageId }
    }); // Get message from database

    if (!message) {
      throw new Error(`Message ${messageId} not found`);
    }

    // Check if this compression level already exists - prevent re-compression
    const existingCompression = await this.getCompressedVersion(messageId, targetLevel, model);
    if (existingCompression) {
      console.log(`[COMPRESSION] Using existing ${targetLevel} compression for message ${messageId}`);
      return existingCompression;
    }

    // Perform compression based on level
    const compressedContent = await this.performCompression(
      message.content,
      targetLevel,
      model
    );

    // Count tokens in compressed content
    const compressedTokens = this.tokenCounter.countTokens(compressedContent, model);

    // Create compressed version
    const compressedVersion: CompressedMessageVersion = {
      content: compressedContent,
      tokens: compressedTokens,
      metadata: undefined, // Metadata is now cleared in convertDbMessages
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
    const message = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { content: true, totalTokens: true, createdAt: true, compressedVersions: true }
    });
    
    if (!message) return null;

    // Get original message version
    const originalVersion: CompressedMessageVersion = {
      content: message.content,
      tokens: message.totalTokens || this.tokenCounter.countTokens(message.content, model),
      metadata: undefined, // Metadata is now cleared in convertDbMessages
      compressedAt: message.createdAt.toISOString()
    };

    // If requesting NONE level, return original
    if (level === "NONE") {
      return originalVersion;
    }

    // Get all available compressed versions
    const versions = (message.compressedVersions as CompressedVersions) || {};
    const availableVersions: CompressedMessageVersion[] = [originalVersion];
    
    // Add compressed versions if they exist
    if (versions.LIGHT) {
      availableVersions.push(versions.LIGHT);
    }
    if (versions.HEAVY) {
      availableVersions.push(versions.HEAVY);
    }

    // Find the shortest version that meets or exceeds the requested compression level
    // Priority order: HEAVY (most compressed) > LIGHT > NONE (original)
    const levelPriority = { "HEAVY": 2, "LIGHT": 1, "NONE": 0 };
    const requestedPriority = levelPriority[level];

    // Filter versions that meet the requested compression level and sort by shortest content
    const suitableVersions = availableVersions.filter((version, index) => {
      if (index === 0) return true; // Original is always suitable
      if (versions.HEAVY === version && requestedPriority >= levelPriority.HEAVY) return true;
      if (versions.LIGHT === version && requestedPriority >= levelPriority.LIGHT) return true;
      return false;
    }).sort((a, b) => a.content.length - b.content.length);

    const shortestVersion = suitableVersions[0];
    if (!shortestVersion) {
      console.log(`[COMPRESSION] No suitable version found for ${level}, returning null`);
      return null;
    }
    
    console.log(`[COMPRESSION] Returning shortest suitable version for ${level}: ${shortestVersion.content.length} chars`);
    
    return shortestVersion;
  }

  // Ensure a message has the required compression level, always returning the best (shortest) available
  async ensureCompressionLevel(
    messageId: string, 
    level: CompressionLevel,
    model: ModelType
  ): Promise<CompressedMessageVersion> {
    console.log(`[COMPRESSION] Ensuring compression level ${level} for message ${messageId}`);
    
    // First check if we already have the requested level or better
    const existing = await this.getCompressedVersion(messageId, level, model);
    if (existing) {
      console.log(`[COMPRESSION] Found existing compression for ${level}: ${existing.content.length} chars`);
      return existing;
    }

    if (level === "NONE") {
      throw new Error("NONE level should always exist");
    }

    // If we need HEAVY compression but don't have it, create it
    if (level === "HEAVY") {
      const heavyVersion = await this.compressMessage(messageId, "HEAVY", model);
      
      // Also try to create LIGHT if we don't have it, in case LIGHT is shorter than HEAVY
      try {
        const message = await prisma.chatMessage.findUnique({
          where: { id: messageId },
          select: { compressedVersions: true }
        });
        
        const versions = (message?.compressedVersions as CompressedVersions) || {};
        if (!versions.LIGHT) {
          console.log(`[COMPRESSION] Creating LIGHT compression to compare with HEAVY`);
          await this.compressMessage(messageId, "LIGHT", model);
        }
      } catch (error) {
        console.warn(`[COMPRESSION] Failed to create LIGHT compression for comparison:`, error);
      }
      
      // Return the shortest available version
      return await this.getCompressedVersion(messageId, level, model) || heavyVersion;
    }

    // If we need LIGHT compression but don't have it, create it
    if (level === "LIGHT") {
      return await this.compressMessage(messageId, "LIGHT", model);
    }

    throw new Error(`Unknown compression level: ${level}`);
  }

  // Perform the actual compression based on level
  private async performCompression(
    content: string,
    level: CompressionLevel,
    model: ModelType
  ): Promise<string> {
    switch (level) {
      case "LIGHT":
        return await this.lightCompression(content, model);
      
      
      case "HEAVY":
        return await this.heavyCompression(content, model);


      default:
        return content;
    }
  }

  // Light compression: GPT-powered summarization to 6-8 sentences
  // More aggressive than regex-based approach but preserves important context
  private async lightCompression(content: string, model: ModelType): Promise<string> {
    console.log(`[COMPRESSION] Starting LIGHT compression on content (${content.length} chars) using model ${model}`);
    const startTime = Date.now();
    
    try {
      const compressionPrompt = `Please summarize the following message content in exactly 6-8 clear, informative sentences. Preserve all key technical details, important decisions, specific code changes, tool results, and essential context. Be comprehensive but concise:

${content}

Summary (6-8 sentences):`;

      const messages = [{
        id: "compress-light-" + Date.now(),
        role: "user" as const,
        content: compressionPrompt,
        llmModel: model,
        createdAt: new Date().toISOString()
      }];

      let summary = "";
      console.log(`[COMPRESSION] Calling LLM for LIGHT compression with ${model}`);
      
      for await (const chunk of this.llmService.createMessageStream(
        "You are a helpful assistant that summarizes technical content while preserving important details. Always provide exactly 6-8 sentences.",
        messages,
        model,
        false // No tools for compression
      )) {
        if (chunk.type === "content" && chunk.content) {
          summary += chunk.content;
        }
      }

      const endTime = Date.now();
      const duration = endTime - startTime;
      const finalSummary = summary.trim();
      
      if (finalSummary) {
        // Check if compression actually made it smaller, otherwise use original
        if (finalSummary.length < content.length) {
          const compressionRatio = ((content.length - finalSummary.length) / content.length * 100).toFixed(1);
          console.log(`[COMPRESSION] LIGHT compression successful: ${content.length} -> ${finalSummary.length} chars (${compressionRatio}% reduction) in ${duration}ms`);
          return finalSummary;
        } else {
          console.log(`[COMPRESSION] LIGHT compression resulted in larger content (${content.length} -> ${finalSummary.length} chars), returning original`);
          return content;
        }
      } else {
        console.log(`[COMPRESSION] LIGHT compression produced empty result, returning original content`);
        return content;
      }
    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;
      console.warn(`[COMPRESSION] LIGHT compression failed after ${duration}ms, returning original content:`, error);
      return content;
    }
  }


  // Heavy compression: Ultra-concise LLM-powered summarization to 1-3 sentences
  // Most aggressive compression, preserving only the absolute essentials
  private async heavyCompression(
    content: string, 
    model: ModelType
  ): Promise<string> {
    console.log(`[COMPRESSION] Starting HEAVY compression on content (${content.length} chars) using model ${model}`);
    const startTime = Date.now();
    
    try {
      const compressionPrompt = `Please summarize the following message content in exactly 1-3 sentences, preserving only the most essential information, key decisions, and critical outcomes. Be extremely concise:

${content}

Ultra-concise summary (1-3 sentences):`;

      const messages = [{
        id: "compress-heavy-" + Date.now(),
        role: "user" as const,
        content: compressionPrompt,
        llmModel: model,
        createdAt: new Date().toISOString()
      }];

      let summary = "";
      console.log(`[COMPRESSION] Calling LLM for HEAVY compression with ${model}`);
      
      for await (const chunk of this.llmService.createMessageStream(
        "You are a helpful assistant that creates ultra-concise summaries. Always provide exactly 1-3 sentences focusing on the most critical information only.",
        messages,
        model,
        false // No tools for compression
      )) {
        if (chunk.type === "content" && chunk.content) {
          summary += chunk.content;
        }
      }

      const endTime = Date.now();
      const duration = endTime - startTime;
      const finalSummary = summary.trim();
      
      if (finalSummary) {
        const compressionRatio = ((content.length - finalSummary.length) / content.length * 100).toFixed(1);
        console.log(`[COMPRESSION] HEAVY compression successful: ${content.length} -> ${finalSummary.length} chars (${compressionRatio}% reduction) in ${duration}ms`);
        return finalSummary;
      } else {
        console.log(`[COMPRESSION] HEAVY compression produced empty result, falling back to LIGHT compression`);
        return await this.lightCompression(content, model);
      }
    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;
      console.warn(`[COMPRESSION] HEAVY compression failed after ${duration}ms, falling back to LIGHT:`, error);
      return await this.lightCompression(content, model);
    }
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        compressedVersions: updatedVersions as any,
        activeCompressionLevel: level
      }
    });
  }
}