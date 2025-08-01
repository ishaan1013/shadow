import { ModelCompressionSettings, ModelType } from "@repo/types";

/**
 * Compression settings for different models
 * 
 * - tokenLimit: Maximum context window for the model
 * - compressionThreshold: Percentage of token limit that triggers compression (0.05 = 5%)  
 * - slidingWindowSize: Number of recent messages to keep uncompressed
 */
export const compressionSettings: ModelCompressionSettings = {
  "claude-sonnet-4-20250514": {
    tokenLimit: 200000,
    compressionThreshold: 0.05,
    slidingWindowSize: 10,
  },
  "claude-opus-4-20250514": {
    tokenLimit: 200000,
    compressionThreshold: 0.05,
    slidingWindowSize: 10,
  },
  "gpt-4o": {
    tokenLimit: 128000,
    compressionThreshold: 0.05,
    slidingWindowSize: 8,
  },
  "o3": {
    tokenLimit: 128000,
    compressionThreshold: 0.05,
    slidingWindowSize: 8,
  },
  "o4-mini-high": {
    tokenLimit: 128000,
    compressionThreshold: 0.5,
    slidingWindowSize: 8,
  },
};

// Get compression settings for a model with fallback
export function getCompressionSettings(model: ModelType) {
  const settings = compressionSettings[model] || compressionSettings["gpt-4o"];
  if (!settings) {
    throw new Error(`No compression settings found for model ${model} and fallback failed`);
  }
  return settings;
}