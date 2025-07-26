import type { Message } from '../chat/messages';
import type { StreamChunk } from '../chat/streaming';
import type { ModelType } from '../llm/models';

export interface TerminalEntry {
  id: number;
  timestamp: number;
  data: string;
  type: 'stdout' | 'stderr' | 'command' | 'system';
  processId?: number;
}

// Real-time Updates
export interface TaskStatusUpdateEvent {
  taskId: string;
  status: string; // Will match TaskStatus from database
  timestamp: string;
}

// Socket.IO Event Types
export interface ServerToClientEvents {
  // Connection events
  'connection-info': (data: {
    connectionId: string;
    reconnectCount: number;
    timestamp: number;
  }) => void;

  // Chat events
  'chat-history': (data: { taskId: string; messages: Message[] }) => void;
  'chat-history-error': (data: { error: string }) => void;
  'stream-state': (state: {
    content: string;
    isStreaming: boolean;
    bufferPosition: number;
  }) => void;
  'stream-chunk': (chunk: StreamChunk) => void;
  'stream-complete': () => void;
  'stream-error': (error: any) => void;
  'stream-update': (data: {
    content: string;
    isIncremental: boolean;
    fromPosition: number;
    totalLength: number;
  }) => void;
  'message-error': (data: { error: string }) => void;
  'history-complete': (data: { taskId: string; totalLength: number }) => void;
  'history-error': (data: { error: string }) => void;

  // Terminal events
  'terminal-history': (data: { taskId: string; entries: TerminalEntry[] }) => void;
  'terminal-history-error': (data: { error: string }) => void;
  'terminal-output': (data: { taskId: string; entry: TerminalEntry }) => void;
  'terminal-cleared': (data: { taskId: string }) => void;
  'terminal-error': (data: { error: string }) => void;

  // Task events
  'task-status-updated': (data: TaskStatusUpdateEvent) => void;
}

export interface ClientToServerEvents {
  // Task room management
  'join-task': (data: { taskId: string }) => void;
  'leave-task': (data: { taskId: string }) => void;

  // Chat events
  'user-message': (data: {
    taskId: string;
    message: string;
    llmModel?: ModelType;
  }) => void;
  'get-chat-history': (data: { taskId: string }) => void;
  'stop-stream': (data: { taskId: string }) => void;
  'request-history': (data: {
    taskId: string;
    fromPosition?: number;
  }) => void;

  // Terminal events
  'get-terminal-history': (data: { taskId: string }) => void;
  'clear-terminal': (data: { taskId: string }) => void;

  // Connection events  
  'heartbeat': () => void;
}