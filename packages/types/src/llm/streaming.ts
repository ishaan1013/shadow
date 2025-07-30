import type {
  FinishReason
} from "ai";
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

// New types for parallel tool execution
export interface ParallelToolBatchStartChunk {
  type: "parallel-tool-batch-start";
  batchId: string;
  toolCallIds: string[];
}

export interface ParallelToolBatchCompleteChunk {
  type: "parallel-tool-batch-complete";
  batchId: string;
  results: Array<{
    toolCallId: string;
    result: unknown;
    error?: string;
    executionTimeMs: number;
  }>;
  totalExecutionTimeMs: number;
}

export interface ParallelToolProgressChunk {
  type: "parallel-tool-progress";
  batchId: string;
  toolCallId: string;
  status: "started" | "completed" | "error";
  result?: unknown;
  error?: string;
  executionTimeMs?: number;
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

// Discriminated-union representing every chunk variant we care about.
export type AIStreamChunk =
  | TextDeltaChunk
  | ToolCallChunk
  | ToolResultChunk
  | ParallelToolBatchStartChunk
  | ParallelToolBatchCompleteChunk
  | ParallelToolProgressChunk
  | FinishChunk
  | ErrorChunk;

// Types for parallel execution management
export interface ParallelToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ParallelExecutionContext {
  batchId: string;
  toolCalls: ParallelToolCall[];
  startTime: number;
  results: Map<string, {
    result?: unknown;
    error?: string;
    executionTimeMs?: number;
    status: "pending" | "started" | "completed" | "error";
  }>;
}