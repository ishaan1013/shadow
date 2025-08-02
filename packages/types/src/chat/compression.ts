import type { MessageMetadata } from "./messages";

export type CompressionLevel = "NONE" | "LIGHT" | "HEAVY"; // Iterative compression levels

export interface CompressedMessageVersion {
  content: string;
  tokens: number;
  metadata?: MessageMetadata;
  compressedAt: string;
}

export interface CompressedVersions {
  LIGHT?: CompressedMessageVersion;
  HEAVY?: CompressedMessageVersion;
}

export interface CompressionConfig {
  tokenLimit: number;
  compressionThreshold: number; // 0.5 = 50% Default threshold
  slidingWindowSize: number; // Number of recent messages to keep uncompressed
}

export interface ModelCompressionSettings {
  [modelId: string]: CompressionConfig;
}

export interface CompressionStats {
  originalTokens: number; // Original number of tokens
  compressedTokens: number; // Compressed num of tokens
  compressionRatio: number; // Compressed / original
  level: CompressionLevel; // Compression level
}

export interface CompressedMessage {
  id: string;
  content: string;
  tokens: number;
  compressionLevel: CompressionLevel;
  metadata?: MessageMetadata;
  compressedVersions?: CompressedVersions;
}

export const isCompressionLevel = (value: string): value is CompressionLevel => {
  return ["NONE", "LIGHT", "HEAVY"].includes(value);
};

export const hasCompressionLevel = (
  versions: CompressedVersions | undefined,
  level: CompressionLevel
): boolean => {
  if (!versions || level === "NONE") return false;
  return versions[level] !== undefined;
};

