import { ApiKeys } from "../api-keys";

export interface LLMConfig {
  model: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  provider: "anthropic" | "openai" | "openrouter" /* | "groq" | "ollama" */;
}

// Model Selection
export const AvailableModels = {
  // OpenAI models
  GPT_4_1: "gpt-4.1",
  GPT_4_1_MINI: "gpt-4.1-mini",
  GPT_4_1_NANO: "gpt-4.1-nano",
  GPT_4O: "gpt-4o",
  GPT_4O_MINI: "gpt-4o-mini",
  GPT_4O_AUDIO_PREVIEW: "gpt-4o-audio-preview",
  GPT_4_TURBO: "gpt-4-turbo",
  GPT_4: "gpt-4",
  GPT_3_5_TURBO: "gpt-3.5-turbo",
  GPT_5: "gpt-5-2025-08-07",
  // O1: "o1",
  // O1_MINI: "o1-mini",
  // O1_PREVIEW: "o1-preview",
  // O3_MINI: "o3-mini",
  // O3: "o3",
  // O4_MINI: "o4-mini",
  CHATGPT_4O_LATEST: "chatgpt-4o-latest",

  // Anthropic models
  CLAUDE_OPUS_4: "claude-opus-4-20250514",
  CLAUDE_SONNET_4: "claude-sonnet-4-20250514",
  CLAUDE_3_7_SONNET: "claude-3-7-sonnet-20250219",
  CLAUDE_3_5_HAIKU: "claude-3-5-haiku-20241022",
  CLAUDE_3_OPUS: "claude-3-opus-20240229",
  CLAUDE_3_SONNET: "claude-3-sonnet-20240229",
  CLAUDE_3_HAIKU: "claude-3-haiku-20240307",

  // OpenRouter models
  XAI_GROK_3: "x-ai/grok-3",
  // OPENAI_GPT_OSS_120B: "openai/gpt-oss-120b",
  // OPENAI_GPT_OSS_20B: "openai/gpt-oss-20b",
  OPENROUTER_HORIZON_BETA: "openrouter/horizon-beta",
  MISTRAL_CODESTRAL_2508: "mistralai/codestral-2508",
  DEEPSEEK_R1_0528: "deepseek/deepseek-r1-0528",
  DEEPSEEK_CHAT_V3_0324: "deepseek/deepseek-chat-v3-0324",
  // OPENAI_CODEX_MINI: "openai/codex-mini", // Removed - returns "Bad Request"
  // QWEN_2_5_CODER_32B_INSTRUCT_FREE: "qwen/qwen-2.5-coder-32b-instruct:free", // Removed - rate limiting issues
  // MOONSHOT_KIMI_K2_FREE: "moonshotai/kimi-k2:free", // Removed - rate limiting issues
  QWEN_3_235B_A22B_2507: "qwen/qwen3-235b-a22b-2507",

  // Groq models (commented out)
  // GROQ_MIXTRAL_8X7B: "mixtral-8x7b-32768",
  // GROQ_LLAMA3_70B: "llama3-70b-8192",
  // GROQ_LLAMA3_8B: "llama3-8b-8192",

  // Ollama models
  // OLLAMA_GPT_OSS_120B: "gpt-oss:120b",
  // OLLAMA_GPT_OSS_20B: "gpt-oss:20b",
} as const;

export type ModelType = (typeof AvailableModels)[keyof typeof AvailableModels];

export interface ModelInfo {
  id: ModelType;
  name: string;
  provider: "anthropic" | "openai" | "openrouter" /* | "groq" | "ollama" */;
}

export const ModelInfos: Record<ModelType, ModelInfo> = {
  // OpenAI models
  [AvailableModels.GPT_4_1]: {
    id: AvailableModels.GPT_4_1,
    name: "GPT-4.1",
    provider: "openai",
  },
  [AvailableModels.GPT_4_1_MINI]: {
    id: AvailableModels.GPT_4_1_MINI,
    name: "GPT-4.1 Mini",
    provider: "openai",
  },
  [AvailableModels.GPT_4_1_NANO]: {
    id: AvailableModels.GPT_4_1_NANO,
    name: "GPT-4.1 Nano",
    provider: "openai",
  },
  [AvailableModels.GPT_4O]: {
    id: AvailableModels.GPT_4O,
    name: "GPT-4o",
    provider: "openai",
  },
  [AvailableModels.GPT_4O_MINI]: {
    id: AvailableModels.GPT_4O_MINI,
    name: "GPT-4o Mini",
    provider: "openai",
  },
  [AvailableModels.GPT_4O_AUDIO_PREVIEW]: {
    id: AvailableModels.GPT_4O_AUDIO_PREVIEW,
    name: "GPT-4o Audio Preview",
    provider: "openai",
  },
  [AvailableModels.GPT_4_TURBO]: {
    id: AvailableModels.GPT_4_TURBO,
    name: "GPT-4 Turbo",
    provider: "openai",
  },
  [AvailableModels.GPT_4]: {
    id: AvailableModels.GPT_4,
    name: "GPT-4",
    provider: "openai",
  },
  [AvailableModels.GPT_3_5_TURBO]: {
    id: AvailableModels.GPT_3_5_TURBO,
    name: "GPT-3.5 Turbo",
    provider: "openai",
  },
  [AvailableModels.GPT_5]: {
    id: AvailableModels.GPT_5,
    name: "GPT-5",
    provider: "openai",
  },
  // [AvailableModels.O1]: {
  //   id: AvailableModels.O1,
  //   name: "o1",
  //   provider: "openai",
  // },
  // [AvailableModels.O1_MINI]: {
  //   id: AvailableModels.O1_MINI,
  //   name: "o1-mini",
  //   provider: "openai",
  // },
  // [AvailableModels.O1_PREVIEW]: {
  //   id: AvailableModels.O1_PREVIEW,
  //   name: "o1-preview",
  //   provider: "openai",
  // },
  // [AvailableModels.O3_MINI]: {
  //   id: AvailableModels.O3_MINI,
  //   name: "o3-mini",
  //   provider: "openai",
  // },
  // [AvailableModels.O3]: {
  //   id: AvailableModels.O3,
  //   name: "o3",
  //   provider: "openai",
  // },
  // [AvailableModels.O4_MINI]: {
  //   id: AvailableModels.O4_MINI,
  //   name: "o4-mini",
  //   provider: "openai",
  // },
  [AvailableModels.CHATGPT_4O_LATEST]: {
    id: AvailableModels.CHATGPT_4O_LATEST,
    name: "ChatGPT-4o Latest",
    provider: "openai",
  },

  // Anthropic models
  [AvailableModels.CLAUDE_OPUS_4]: {
    id: AvailableModels.CLAUDE_OPUS_4,
    name: "Claude Opus 4",
    provider: "anthropic",
  },
  [AvailableModels.CLAUDE_SONNET_4]: {
    id: AvailableModels.CLAUDE_SONNET_4,
    name: "Claude Sonnet 4",
    provider: "anthropic",
  },
  [AvailableModels.CLAUDE_3_7_SONNET]: {
    id: AvailableModels.CLAUDE_3_7_SONNET,
    name: "Claude 3.7 Sonnet",
    provider: "anthropic",
  },

  [AvailableModels.CLAUDE_3_5_HAIKU]: {
    id: AvailableModels.CLAUDE_3_5_HAIKU,
    name: "Claude 3.5 Haiku",
    provider: "anthropic",
  },
  [AvailableModels.CLAUDE_3_OPUS]: {
    id: AvailableModels.CLAUDE_3_OPUS,
    name: "Claude 3 Opus",
    provider: "anthropic",
  },
  [AvailableModels.CLAUDE_3_SONNET]: {
    id: AvailableModels.CLAUDE_3_SONNET,
    name: "Claude 3 Sonnet",
    provider: "anthropic",
  },
  [AvailableModels.CLAUDE_3_HAIKU]: {
    id: AvailableModels.CLAUDE_3_HAIKU,
    name: "Claude 3 Haiku",
    provider: "anthropic",
  },

  // OpenRouter models
  [AvailableModels.XAI_GROK_3]: {
    id: AvailableModels.XAI_GROK_3,
    name: "Grok 3",
    provider: "openrouter",
  },
  // [AvailableModels.OPENAI_GPT_OSS_120B]: {
  //   id: AvailableModels.OPENAI_GPT_OSS_120B,
  //   name: "GPT OSS 120B",
  //   provider: "openrouter",
  // },
  // [AvailableModels.OPENAI_GPT_OSS_20B]: {
  //   id: AvailableModels.OPENAI_GPT_OSS_20B,
  //   name: "GPT OSS 20B",
  //   provider: "openrouter",
  // },
  [AvailableModels.OPENROUTER_HORIZON_BETA]: {
    id: AvailableModels.OPENROUTER_HORIZON_BETA,
    name: "Horizon Beta (Free)",
    provider: "openrouter",
  },
  [AvailableModels.MISTRAL_CODESTRAL_2508]: {
    id: AvailableModels.MISTRAL_CODESTRAL_2508,
    name: "Codestral 2508",
    provider: "openrouter",
  },
  [AvailableModels.DEEPSEEK_R1_0528]: {
    id: AvailableModels.DEEPSEEK_R1_0528,
    name: "DeepSeek R1 0528",
    provider: "openrouter",
  },
  [AvailableModels.DEEPSEEK_CHAT_V3_0324]: {
    id: AvailableModels.DEEPSEEK_CHAT_V3_0324,
    name: "DeepSeek Chat V3 0324",
    provider: "openrouter",
  },
  // [AvailableModels.OPENAI_CODEX_MINI]: {
  //   id: AvailableModels.OPENAI_CODEX_MINI,
  //   name: "Codex Mini",
  //   provider: "openrouter",
  // },
  // [AvailableModels.QWEN_2_5_CODER_32B_INSTRUCT_FREE]: {
  //   id: AvailableModels.QWEN_2_5_CODER_32B_INSTRUCT_FREE,
  //   name: "Qwen 2.5 Coder 32B Instruct (Free)",
  //   provider: "openrouter",
  // },
  // [AvailableModels.MOONSHOT_KIMI_K2_FREE]: {
  //   id: AvailableModels.MOONSHOT_KIMI_K2_FREE,
  //   name: "Moonshot Kimi K2 (Free)",
  //   provider: "openrouter",
  // },
  [AvailableModels.QWEN_3_235B_A22B_2507]: {
    id: AvailableModels.QWEN_3_235B_A22B_2507,
    name: "Qwen 3 235B A22B 2507",
    provider: "openrouter",
  },

  // Ollama models
  // [AvailableModels.OLLAMA_GPT_OSS_120B]: {
  //   id: AvailableModels.OLLAMA_GPT_OSS_120B,
  //   name: "GPT OSS 120B",
  //   provider: "ollama",
  // },
  // [AvailableModels.OLLAMA_GPT_OSS_20B]: {
  //   id: AvailableModels.OLLAMA_GPT_OSS_20B,
  //   name: "GPT OSS 20B",
  //   provider: "ollama",
  // },
};

export function getModelProvider(
  model: ModelType
): "anthropic" | "openai" | "openrouter" /* | "ollama" */ {
  return ModelInfos[model].provider;
}

export function getModelInfo(model: ModelType): ModelInfo {
  return ModelInfos[model];
}

/**
 * Get all possible models based on user API keys (for settings UI)
 */
export async function getAllPossibleModels(
  userApiKeys: ApiKeys
): Promise<ModelType[]> {
  const models: ModelType[] = [];

  if (userApiKeys.anthropic) {
    models.push(
      AvailableModels.CLAUDE_OPUS_4,
      AvailableModels.CLAUDE_SONNET_4,
      AvailableModels.CLAUDE_3_7_SONNET
    );
  }

  if (userApiKeys.openai) {
    models.push(
      AvailableModels.GPT_4_1,
      AvailableModels.GPT_4O,
      AvailableModels.GPT_4O_MINI,
      AvailableModels.GPT_5
      // AvailableModels.O3,
      // AvailableModels.O4_MINI
    );
  }

  if (userApiKeys.openrouter) {
    models.push(
      AvailableModels.XAI_GROK_3,
      // AvailableModels.OPENAI_GPT_OSS_120B,
      // AvailableModels.OPENAI_GPT_OSS_20B,
      AvailableModels.OPENROUTER_HORIZON_BETA,
      AvailableModels.MISTRAL_CODESTRAL_2508,
      AvailableModels.DEEPSEEK_R1_0528,
      AvailableModels.DEEPSEEK_CHAT_V3_0324,
      // AvailableModels.OPENAI_CODEX_MINI, // Removed - returns "Bad Request"
      // AvailableModels.QWEN_2_5_CODER_32B_INSTRUCT_FREE, // Removed - rate limiting issues
      // AvailableModels.MOONSHOT_KIMI_K2_FREE, // Removed - rate limiting issues
      AvailableModels.QWEN_3_235B_A22B_2507
    );
  }

  // if (userApiKeys.groq) {
  //   models.push(
  //     AvailableModels.GROQ_MIXTRAL_8X7B,
  //     AvailableModels.GROQ_LLAMA3_70B,
  //     AvailableModels.GROQ_LLAMA3_8B
  //   );
  // }

  // if (userApiKeys.ollama) {
  //   // models.push(
  //   //   AvailableModels.OLLAMA_GPT_OSS_120B,
  //   //   AvailableModels.OLLAMA_GPT_OSS_20B
  //   // );
  // }

  return models;
}

/**
 * Get default selected models based on user API keys
 */
export async function getDefaultSelectedModels(
  userApiKeys: ApiKeys
): Promise<ModelType[]> {
  const defaultModels: ModelType[] = [];

  // Add defaults for each provider (matching the user's request)
  if (userApiKeys.openai) {
    defaultModels.push(
      AvailableModels.GPT_4_1, // default
      AvailableModels.GPT_4O, // default
      AvailableModels.GPT_5 // default
      // AvailableModels.O3, // default
      // AvailableModels.O4_MINI // default
    );
  }

  if (userApiKeys.anthropic) {
    defaultModels.push(
      AvailableModels.CLAUDE_OPUS_4, // default
      AvailableModels.CLAUDE_SONNET_4, // default
      AvailableModels.CLAUDE_3_7_SONNET // default
    );
  }

  if (userApiKeys.openrouter) {
    // All OpenRouter models default
    defaultModels.push(
      AvailableModels.XAI_GROK_3,
      // AvailableModels.OPENAI_GPT_OSS_120B,
      // AvailableModels.OPENAI_GPT_OSS_20B,
      AvailableModels.OPENROUTER_HORIZON_BETA,
      AvailableModels.MISTRAL_CODESTRAL_2508,
      AvailableModels.DEEPSEEK_R1_0528,
      AvailableModels.DEEPSEEK_CHAT_V3_0324,
      // AvailableModels.OPENAI_CODEX_MINI, // Removed - returns "Bad Request"
      // AvailableModels.QWEN_2_5_CODER_32B_INSTRUCT_FREE, // Removed - rate limiting issues
      // AvailableModels.MOONSHOT_KIMI_K2_FREE, // Removed - rate limiting issues
      AvailableModels.QWEN_3_235B_A22B_2507
    );
  }

  // if (userApiKeys.ollama) {
  //   // For Ollama, we get the dynamic models but use static fallbacks for defaults
  //   // defaultModels.push(
  //   //   AvailableModels.OLLAMA_GPT_OSS_120B,
  //   //   AvailableModels.OLLAMA_GPT_OSS_20B
  //   // );
  // }

  return defaultModels;
}

/**
 * Get available models based on user API keys and selected models in settings
 */
export async function getAvailableModels(
  userApiKeys: ApiKeys,
  selectedModels?: ModelType[]
): Promise<ModelType[]> {
  const allPossible = await getAllPossibleModels(userApiKeys);

  // If no user selection, return all possible (backward compatibility)
  if (!selectedModels || selectedModels.length === 0) {
    return allPossible;
  }

  // Filter selected models to only include those that user has API keys for
  return selectedModels.filter((model) => allPossible.includes(model));
}
