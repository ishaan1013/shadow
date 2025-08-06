import type {
  CoreMessage,
  TextPart,
  ToolCallPart as BaseToolCallPart,
  ToolResultPart,
  FinishReason,
} from "ai";
import { ToolExecutionStatusType } from "../tools/execution";
import { ToolResultTypes } from "../tools/schemas";
import type { PullRequestSnapshot, TaskStatus } from "@repo/db";

// Error part type for AI SDK error chunks
export interface ErrorPart {
  type: "error";
  error: string;
  finishReason?: FinishReason;
}

// Thinking part type for extended thinking
export interface ThinkingPart {
  type: "thinking";
  thinking: string;
}

// Extended ToolCallPart with streaming state tracking
export interface ToolCallPart extends BaseToolCallPart {
  // Streaming state properties
  streamingState?: "starting" | "streaming" | "complete";
  argsComplete?: boolean; // Are args fully received?

  accumulatedArgsText?: string;
  partialArgs?: {
    target_file?: string;
    command?: string;
  };
}

export type AssistantMessagePart =
  | TextPart
  | ToolCallPart
  | ToolResultPart
  | ThinkingPart
  | ErrorPart;

export type CompletionTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type Message = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  llmModel: string;
  createdAt: string;
  metadata?: MessageMetadata;
  pullRequestSnapshot?: PullRequestSnapshot;
  stackedTaskId?: string;
  stackedTask?: {
    id: string;
    title: string;
    shadowBranch?: string;
    status?: TaskStatus;
  };
};

export interface MessageMetadata {
  thinking?: {
    content: string;
    duration: number; // seconds
  };

  tool?: {
    name: string;
    args: Record<string, unknown>;
    status: ToolExecutionStatusType;
    result?: ToolResultTypes["result"];
  };

  parts?: AssistantMessagePart[];

  isStreaming?: boolean;
  streamingState?: "starting" | "streaming" | "complete";
  partialArgs?: {
    target_file?: string;
    command?: string;
  };

  // LLM usage metadata
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };

  // Finish reason
  finishReason?: FinishReason;
}

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
