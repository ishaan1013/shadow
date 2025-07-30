import type {
  CoreMessage,
  TextPart,
  ToolCallPart,
  ToolResultPart,
  FinishReason,
} from "ai";
import { randomUUID } from "crypto";
import { ToolExecutionStatusType } from "../tools/execution";
import { ToolResultTypes } from "../tools/results";
import type { PullRequestSnapshot } from "@repo/db";

// Error part type for AI SDK error chunks
export interface ErrorPart {
  type: "error";
  error: string;
  finishReason?: FinishReason;
}

export type AssistantMessagePart =
  | TextPart
  | ToolCallPart
  | ToolResultPart
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
  llmModel?: string; // Model used for this message (primarily for assistant messages)
  createdAt: string;
  metadata?: MessageMetadata;
  pullRequestSnapshot?: PullRequestSnapshot;
};

export interface MessageMetadata {
  // For assistant messages with thinking
  thinking?: {
    content: string;
    duration: number; // seconds
  };

  // For tool call messages - now properly typed
  tool?: {
    name: string;
    args: Record<string, unknown>;
    status: ToolExecutionStatusType;
    result?: ToolResultTypes["result"] | string; // Support both new objects and legacy strings
  };

  // For structured assistant messages - required for chronological tool call ordering
  parts?: AssistantMessagePart[];

  // Streaming indicator
  isStreaming?: boolean;

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
