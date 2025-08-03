import { TaskStatus, InitStatus } from "@repo/db";
import type { Message } from "../chat/messages";
import type { StreamChunk } from "../chat/streaming";
import type { ModelType } from "../llm/models";

export interface TerminalEntry {
  id: number;
  timestamp: number;
  data: string;
  type: "stdout" | "stderr" | "command" | "system";
  processId?: number;
}

export interface TaskStatusUpdateEvent {
  taskId: string;
  status: TaskStatus;
  initStatus?: InitStatus;
  timestamp: string;
}

export interface ServerToClientEvents {
  "connection-info": (data: {
    connectionId: string;
    reconnectCount: number;
    timestamp: number;
  }) => void;

  "chat-history": (data: {
    taskId: string;
    messages: Message[];
    queuedMessage: string | null;
  }) => void;
  "chat-history-error": (data: { error: string }) => void;
  "stream-state": (state: {
    chunks: StreamChunk[];
    isStreaming: boolean;
    totalChunks: number;
  }) => void;
  "stream-chunk": (chunk: StreamChunk) => void;
  "stream-complete": () => void;
  "stream-error": (error: unknown) => void;
  "stream-update": (data: {
    content: string;
    isIncremental: boolean;
    fromPosition: number;
    totalLength: number;
  }) => void;
  "message-error": (data: { error: string }) => void;
  "history-complete": (data: { taskId: string; totalLength: number }) => void;
  "history-error": (data: { error: string }) => void;

  "terminal-history": (data: {
    taskId: string;
    entries: TerminalEntry[];
  }) => void;
  "terminal-history-error": (data: { error: string }) => void;
  "terminal-output": (data: { taskId: string; entry: TerminalEntry }) => void;
  "terminal-cleared": (data: { taskId: string }) => void;
  "terminal-error": (data: { error: string }) => void;

  "task-status-updated": (data: TaskStatusUpdateEvent) => void;
}

export interface ClientToServerEvents {
  "join-task": (data: { taskId: string }) => void;
  "leave-task": (data: { taskId: string }) => void;

  "user-message": (data: {
    taskId: string;
    message: string;
    llmModel?: ModelType;
    queue?: boolean;
  }) => void;
  "edit-user-message": (data: {
    taskId: string;
    messageId: string;
    message: string;
    llmModel: ModelType;
  }) => void;
  "get-chat-history": (data: { taskId: string; complete: boolean }) => void;
  "stop-stream": (data: { taskId: string }) => void;
  "request-history": (data: { taskId: string; fromPosition?: number }) => void;
  "clear-queued-message": (data: { taskId: string }) => void;

  "get-terminal-history": (data: { taskId: string }) => void;
  "clear-terminal": (data: { taskId: string }) => void;

  heartbeat: () => void;
}
