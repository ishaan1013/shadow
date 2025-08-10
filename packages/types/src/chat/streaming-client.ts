import type { FinishReason } from "ai";
import type { InitStatus } from "@repo/db";
import { ToolResultTypes } from "../tools/schemas";
import { CompletionTokenUsage } from "./messages";

// Validation error result interface
export interface ValidationErrorResult {
  success: false;
  error: string;
  suggestedFix?: string;
  originalResult?: unknown;
  validationDetails?: {
    expectedType: string;
    receivedType: string;
    fieldPath?: string;
  };
}

export interface StreamChunk {
  type:
    | "content"
    | "usage"
    | "complete"
    | "error"
    | "tool-call"
    | "tool-call-start"
    | "tool-call-delta"
    | "tool-result"
    | "reasoning"
    | "reasoning-signature"
    | "redacted-reasoning"
    | "init-progress"
    | "fs-change"
    | "fs-override"
    | "todo-update";

  // For content chunks
  content?: string;

  // For reasoning chunks
  reasoning?: string; // Incremental reasoning text delta
  reasoningSignature?: string; // Verification signature
  redactedReasoningData?: string; // Complete redacted reasoning block

  usage?: CompletionTokenUsage & {
    // Provider-specific tokens
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };

  // For completion/error
  finishReason?: FinishReason;
  error?: string;

  // For tool calls
  toolCall?: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  };

  // For tool results
  toolResult?: {
    id: string;
    result: ToolResultTypes["result"] | ValidationErrorResult;
    isValid?: boolean;
  };

  // For tool call streaming start
  toolCallStart?: {
    id: string;
    name: string;
  };

  // For tool call deltas (incremental args)
  toolCallDelta?: {
    id: string;
    name: string;
    argsTextDelta: string; // Raw JSON delta from AI SDK
  };

  // For initialization progress
  initProgress?: InitializationProgress;

  // For filesystem changes
  fsChange?: {
    operation:
      | "file-created"
      | "file-modified"
      | "file-deleted"
      | "directory-created"
      | "directory-deleted";
    filePath: string;
    timestamp: number;
    source: "local" | "remote";
    isDirectory: boolean;
  };

  // For complete filesystem state override (checkpoint restoration)
  fsOverride?: {
    fileChanges: Array<{
      filePath: string;
      operation: "CREATE" | "UPDATE" | "DELETE" | "RENAME";
      additions: number;
      deletions: number;
      createdAt: string;
    }>;
    diffStats: {
      additions: number;
      deletions: number;
      totalFiles: number;
    };
    codebaseTree: Array<{
      name: string;
      type: "file" | "folder";
      path: string;
      children?: any[]; // Recursive structure
    }>;
    message: string;
  };

  // For todo updates
  todoUpdate?: {
    todos: Array<{
      id: string;
      content: string;
      status: "pending" | "in_progress" | "completed" | "cancelled";
      sequence: number;
    }>;
    action: "updated" | "replaced";
    totalTodos?: number;
    completedTodos?: number;
  };
}

// Initialization progress tracking
export interface InitializationProgress {
  type: "init-start" | "step-start" | "init-complete" | "init-error";
  taskId: string;

  // Current step info
  currentStep?: InitStatus;

  // Error details
  error?: string;
}
