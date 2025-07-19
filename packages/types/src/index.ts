// === Chat Message Types ===

import type { CoreMessage } from "ai";
import { randomUUID } from "crypto";

export interface BaseMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  llmModel?: string; // Model used for this message (primarily for assistant messages)
  createdAt: string;
  metadata?: MessageMetadata;
}

export interface MessageMetadata {
  // For assistant messages with thinking
  thinking?: {
    content: string;
    duration: number; // seconds
  };

  // For streaming indication
  isStreaming?: boolean;

  // For tool messages
  tool?: {
    name: string;
    args: Record<string, any>;
    status: ToolStatusType;
    result?: string;
    error?: string;
    changes?: {
      linesAdded?: number;
      linesRemoved?: number;
      filePath?: string;
    };
  };

  // For usage tracking
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    // Provider-specific tokens
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };

  // Finish reason
  finishReason?:
    | "stop"
    | "length"
    | "content-filter"
    | "function_call"
    | "tool_calls";
}

export type Message = BaseMessage;

// Type guards for runtime type checking
export const isUserMessage = (
  message: Message
): message is Message & { role: "user" } =>
  message.role.toLowerCase() === "user";

export const isAssistantMessage = (
  message: Message
): message is Message & { role: "assistant" } =>
  message.role.toLowerCase() === "assistant";

export const isToolMessage = (
  message: Message
): message is Message & { role: "tool" } =>
  message.role.toLowerCase() === "tool";

export const isSystemMessage = (
  message: Message
): message is Message & { role: "system" } =>
  message.role.toLowerCase() === "system";

// AI SDK compatible message conversion
export function toCoreMessage(message: Message): CoreMessage {
  return {
    role: message.role,
    content: message.content,
  } as CoreMessage;
}

export function fromCoreMessage(
  coreMessage: CoreMessage,
  id?: string
): Omit<Message, "createdAt"> {
  return {
    id: id || randomUUID(),
    role: coreMessage.role,
    content:
      typeof coreMessage.content === "string"
        ? coreMessage.content
        : Array.isArray(coreMessage.content)
          ? coreMessage.content
              .map((part) =>
                typeof part === "string"
                  ? part
                  : "text" in part
                    ? part.text
                    : "image" in part
                      ? "[image]"
                      : JSON.stringify(part)
              )
              .join("")
          : JSON.stringify(coreMessage.content),
  };
}

// === Streaming Types ===

export interface StreamChunk {
  type:
    | "content"
    | "thinking"
    | "usage"
    | "complete"
    | "error"
    | "tool-call"
    | "tool-result";

  // For content chunks
  content?: string;

  // For thinking/reasoning chunks
  thinking?: string;

  // For usage tracking
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    // Provider-specific tokens
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };

  // For completion/error
  finishReason?:
    | "stop"
    | "length"
    | "content-filter"
    | "function_call"
    | "tool_calls"
    | "error";
  error?: string;

  // For tool calls
  toolCall?: {
    id: string;
    name: string;
    args: Record<string, any>;
  };

  // For tool results
  toolResult?: {
    id: string;
    result: string;
  };
}

// === Database Enums ===

export const MessageRole = {
  USER: "USER",
  ASSISTANT: "ASSISTANT",
  TOOL: "TOOL",
  SYSTEM: "SYSTEM",
} as const;

export type MessageRoleType = (typeof MessageRole)[keyof typeof MessageRole];

// Tool status that aligns with database TaskStatus
export const ToolStatus = {
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

export type ToolStatusType = (typeof ToolStatus)[keyof typeof ToolStatus];

// === LLM Integration Types ===

export interface LLMConfig {
  model: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  provider: "anthropic" | "openai";
}

// === Model Selection ===

export const AvailableModels = {
  // Anthropic models
  CLAUDE_3_5_SONNET: "claude-3-5-sonnet-20241022",
  CLAUDE_3_5_HAIKU: "claude-3-5-haiku-20241022",
  // OpenAI models
  GPT_4O: "gpt-4o",
  GPT_4O_MINI: "gpt-4o-mini",
  GPT_4_TURBO: "gpt-4-turbo",
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
  [AvailableModels.CLAUDE_3_5_SONNET]: {
    id: AvailableModels.CLAUDE_3_5_SONNET,
    name: "Claude 3.5 Sonnet",
    provider: "anthropic",
    description: "Most capable model for complex reasoning and coding",
    maxTokens: 200000,
    costPer1mTokensInput: 3,
    costPer1mTokensOutput: 15,
    supportsStreaming: true,
    supportsTools: true,
  },
  [AvailableModels.CLAUDE_3_5_HAIKU]: {
    id: AvailableModels.CLAUDE_3_5_HAIKU,
    name: "Claude 3.5 Haiku",
    provider: "anthropic",
    description: "Fastest and most cost-effective model",
    maxTokens: 200000,
    costPer1mTokensInput: 1,
    costPer1mTokensOutput: 5,
    supportsStreaming: true,
    supportsTools: true,
  },
  [AvailableModels.GPT_4O]: {
    id: AvailableModels.GPT_4O,
    name: "GPT-4o",
    provider: "openai",
    description: "Most advanced multimodal model",
    maxTokens: 128000,
    costPer1mTokensInput: 2.5,
    costPer1mTokensOutput: 10,
    supportsStreaming: true,
    supportsTools: true,
  },
  [AvailableModels.GPT_4O_MINI]: {
    id: AvailableModels.GPT_4O_MINI,
    name: "GPT-4o Mini",
    provider: "openai",
    description: "Cost-efficient small model for simple tasks",
    maxTokens: 128000,
    costPer1mTokensInput: 0.15,
    costPer1mTokensOutput: 0.6,
    supportsStreaming: true,
    supportsTools: true,
  },
  [AvailableModels.GPT_4_TURBO]: {
    id: AvailableModels.GPT_4_TURBO,
    name: "GPT-4 Turbo",
    provider: "openai",
    description: "Previous generation model with large context",
    maxTokens: 128000,
    costPer1mTokensInput: 10,
    costPer1mTokensOutput: 30,
    supportsStreaming: true,
    supportsTools: true,
  },
  [AvailableModels.O3]: {
    id: AvailableModels.O3,
    name: "o3",
    provider: "openai",
    description: "Most advanced model",
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
    description: "Advanced Reasoning",
    maxTokens: 128000,
    costPer1mTokensInput: 2.5,
    costPer1mTokensOutput: 10,
    supportsStreaming: true,
    supportsTools: true,
  },
};

// === AI SDK Integration Types ===

// Helper to get model provider
export function getModelProvider(model: ModelType): "anthropic" | "openai" {
  return ModelInfos[model].provider;
}

// Helper to get model info
export function getModelInfo(model: ModelType): ModelInfo {
  return ModelInfos[model];
}
