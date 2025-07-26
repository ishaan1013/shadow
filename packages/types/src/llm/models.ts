export interface LLMConfig {
  model: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  provider: "anthropic" | "openai";
}

// Model Selection
export const AvailableModels = {
  // Anthropic models
  CLAUDE_SONNET_4: "claude-sonnet-4-20250514",
  CLAUDE_OPUS_4: "claude-opus-4-20250514",
  // OpenAI models
  GPT_4O: "gpt-4o",
  O3: "o3",
  O4_MINI_HIGH: "o4-mini-high",
} as const;

export type ModelType = (typeof AvailableModels)[keyof typeof AvailableModels];

export interface ModelInfo {
  id: ModelType;
  name: string;
  provider: "anthropic" | "openai";
  description: string;
  maxTokens: number;
  costPer1mTokensInput: number;
  costPer1mTokensOutput: number;
  supportsStreaming: boolean;
  supportsTools: boolean;
}

export const ModelInfos: Record<ModelType, ModelInfo> = {
  [AvailableModels.CLAUDE_SONNET_4]: {
    id: AvailableModels.CLAUDE_SONNET_4,
    name: "Claude Sonnet 4",
    provider: "anthropic",
    description: "High-performance model with exceptional reasoning capabilities",
    maxTokens: 200000,
    costPer1mTokensInput: 3,
    costPer1mTokensOutput: 15,
    supportsStreaming: true,
    supportsTools: true,
  },
  [AvailableModels.CLAUDE_OPUS_4]: {
    id: AvailableModels.CLAUDE_OPUS_4,
    name: "Claude Opus 4",
    provider: "anthropic",
    description: "Most powerful and capable Claude model",
    maxTokens: 200000,
    costPer1mTokensInput: 15,
    costPer1mTokensOutput: 75,
    supportsStreaming: true,
    supportsTools: true,
  },
  [AvailableModels.GPT_4O]: {
    id: AvailableModels.GPT_4O,
    name: "GPT-4o",
    provider: "openai",
    description: "Fast, intelligent, flexible GPT model",
    maxTokens: 128000,
    costPer1mTokensInput: 2.5,
    costPer1mTokensOutput: 10,
    supportsStreaming: true,
    supportsTools: true,
  },
  [AvailableModels.O3]: {
    id: AvailableModels.O3,
    name: "o3",
    provider: "openai",
    description: "Most powerful OpenAI reasoning model",
    maxTokens: 128000,
    costPer1mTokensInput: 2.5,
    costPer1mTokensOutput: 10,
    supportsStreaming: true,
    supportsTools: true,
  },
  [AvailableModels.O4_MINI_HIGH]: {
    id: AvailableModels.O4_MINI_HIGH,
    name: "o4 Mini High",
    provider: "openai",
    description: "Faster, more affordable reasoning model",
    maxTokens: 128000,
    costPer1mTokensInput: 2.5,
    costPer1mTokensOutput: 10,
    supportsStreaming: true,
    supportsTools: true,
  },
};

// Helper to get model provider
export function getModelProvider(model: ModelType): "anthropic" | "openai" {
  return ModelInfos[model].provider;
}

// Helper to get model info
export function getModelInfo(model: ModelType): ModelInfo {
  return ModelInfos[model];
}