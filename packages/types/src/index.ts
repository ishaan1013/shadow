// === AI SDK Core Types (Re-exported for consistency) ===
import type { CoreMessage, CoreTool, CoreToolChoice, GenerateTextResult, StreamTextResult } from 'ai';

export type { CoreMessage, CoreTool, CoreToolChoice, GenerateTextResult, StreamTextResult };

// === Enhanced Message Types ===

export interface BaseMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string | Array<{
    type: "text" | "image" | "tool-call" | "tool-result";
    text?: string;
    image?: string | Uint8Array | URL;
    toolCallId?: string;
    toolName?: string;
    args?: Record<string, any>;
    result?: any;
  }>;
  llmModel?: string; // Model used for this message (primarily for assistant messages)
  createdAt: string;
  metadata?: MessageMetadata;
  // AI SDK compatibility fields
  toolInvocations?: Array<{
    toolCallId: string;
    toolName: string;
    args: Record<string, any>;
    result?: any;
  }>;
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
    status: "running" | "success" | "error";
    result?: string;
    error?: string;
    changes?: {
      linesAdded?: number;
      linesRemoved?: number;
      filePath?: string;
    };
  };

  // Enhanced usage tracking (AI SDK compatible)
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    // Legacy fields for backward compatibility
    inputTokens?: number;
    outputTokens?: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
    thoughtsTokenCount?: number;
    totalCost?: number;
  };

  // AI SDK finish reason
  finishReason?: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other" | "unknown";
}

export type Message = BaseMessage;

// Type guards for runtime type checking
export const isUserMessage = (
  message: Message
): message is Message & { role: "user" } => message.role === "user";

export const isAssistantMessage = (
  message: Message
): message is Message & { role: "assistant" } => message.role === "assistant";

export const isToolMessage = (
  message: Message
): message is Message & { role: "tool" } => message.role === "tool";

export const isSystemMessage = (
  message: Message
): message is Message & { role: "system" } => message.role === "system";

// === AI SDK Compatible Streaming Types ===

export interface StreamChunk {
  type: "text-delta" | "tool-call" | "tool-result" | "step-finish" | "finish" | "error";

  // For text deltas
  textDelta?: string;

  // For tool calls
  toolCall?: {
    toolCallId: string;
    toolName: string;
    args: Record<string, any>;
  };

  // For tool results
  toolResult?: {
    toolCallId: string;
    result: any;
  };

  // For step completion
  stepType?: "initial" | "tool-call" | "tool-result" | "continue";
  
  // For completion/error
  finishReason?: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other" | "unknown";
  error?: string;

  // Usage tracking (AI SDK format)
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };

  // Legacy format for backward compatibility
  content?: string;
  thinking?: string;
}

// === AI SDK Configuration Types ===

export interface LLMConfig {
  model: string;
  apiKey?: string;
  baseURL?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  systemPrompt?: string;
  tools?: Record<string, CoreTool>;
  toolChoice?: CoreToolChoice;
  maxSteps?: number;
}

// === Provider Configuration ===

export const SupportedProviders = {
  ANTHROPIC: "anthropic",
  OPENAI: "openai",
  GOOGLE: "google",
  MISTRAL: "mistral",
  GROQ: "groq",
} as const;

export type ProviderType = (typeof SupportedProviders)[keyof typeof SupportedProviders];

// === Model Selection (AI SDK Compatible) ===

export const AvailableModels = {
  // Anthropic
  CLAUDE_3_5_SONNET: "claude-3-5-sonnet-20241022",
  CLAUDE_3_5_HAIKU: "claude-3-5-haiku-20241022", 
  CLAUDE_3_OPUS: "claude-3-opus-20240229",
  
  // OpenAI
  GPT_4O: "gpt-4o",
  GPT_4O_MINI: "gpt-4o-mini",
  GPT_4_TURBO: "gpt-4-turbo",
  O1_PREVIEW: "o1-preview",
  O1_MINI: "o1-mini",
  
  // Google
  GEMINI_PRO: "gemini-pro",
  GEMINI_PRO_VISION: "gemini-pro-vision",
  
  // Groq
  LLAMA_3_70B: "llama3-70b-8192",
  MIXTRAL_8X7B: "mixtral-8x7b-32768",
} as const;

export type ModelType = (typeof AvailableModels)[keyof typeof AvailableModels];

export interface ModelInfo {
  id: ModelType;
  name: string;
  provider: ProviderType;
  description: string;
  maxTokens: number;
  costPer1kTokens: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
}

// === Database Enums ===

export const MessageRole = {
  USER: "USER",
  ASSISTANT: "ASSISTANT",
  TOOL: "TOOL",
  SYSTEM: "SYSTEM",
} as const;

export type MessageRoleType = (typeof MessageRole)[keyof typeof MessageRole];

// === Legacy Types (for backward compatibility) ===

export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

// === Utility Functions ===

export function coreMessageToMessage(coreMessage: CoreMessage, id: string, createdAt: string): Message {
  return {
    id,
    role: coreMessage.role,
    content: typeof coreMessage.content === 'string' ? coreMessage.content : JSON.stringify(coreMessage.content),
    createdAt,
    toolInvocations: coreMessage.role === 'assistant' ? (coreMessage as any).toolInvocations : undefined,
  };
}

export function messageToCoreMessage(message: Message): CoreMessage {
  const coreMessage: CoreMessage = {
    role: message.role,
    content: message.content,
  };

  if (message.toolInvocations) {
    (coreMessage as any).toolInvocations = message.toolInvocations;
  }

  return coreMessage;
}
