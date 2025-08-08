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

export interface ReasoningChunk {
  type: "reasoning";
  textDelta: string;
}

export interface ReasoningSignatureChunk {
  type: "reasoning-signature";
  signature: string;
}

export interface RedactedReasoningChunk {
  type: "redacted-reasoning";
  data: string;
}

// Provider step lifecycle events (used as a heuristic for reasoning-in-progress)
export interface StepStartChunk {
  type: "step-start";
}

export interface StepFinishChunk {
  type: "step-finish";
}

// Discriminated-union representing every chunk variant we care about.
export type AIStreamChunk =
  | TextDeltaChunk
  | ToolCallChunk
  | ToolCallStreamingStartChunk
  | ToolCallDeltaChunk
  | ToolResultChunk
  | ReasoningChunk
  | ReasoningSignatureChunk
  | RedactedReasoningChunk
  | StepStartChunk
  | StepFinishChunk
  | FinishChunk
  | ErrorChunk;
