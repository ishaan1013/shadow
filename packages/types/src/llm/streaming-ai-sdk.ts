import type { FinishReason } from "ai";
import { CompletionTokenUsage } from "../chat/messages";

export interface TextDeltaChunk {
  type: "text-delta";
  textDelta: string;
}

export interface ToolCallChunk {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolResultChunk {
  type: "tool-result";
  toolCallId: string;
  result: unknown;
}

export interface ReasoningChunk {
  type: "reasoning"; // provider-agnostic reasoning/thinking chunk
  reasoning: string;
}

export interface FinishChunk {
  type: "finish";
  usage?: CompletionTokenUsage;
  finishReason: FinishReason;
}

export interface ErrorChunk {
  type: "error";
  error: unknown;
}

export interface ToolCallStreamingStartChunk {
  type: "tool-call-streaming-start";
  toolCallId: string;
  toolName: string;
}

export interface ToolCallDeltaChunk {
  type: "tool-call-delta";
  toolCallId: string;
  toolName: string;
  argsTextDelta: string;
}

// Discriminated-union representing every chunk variant we care about.
export type AIStreamChunk =
  | TextDeltaChunk
  | ToolCallChunk
  | ToolCallStreamingStartChunk
  | ToolCallDeltaChunk
  | ToolResultChunk
  | ReasoningChunk
  | FinishChunk
  | ErrorChunk;
