import { io, Socket } from 'socket.io-client';
import { logger } from '../utils/logger';
import type {
  FileSystemEvent,
  SidecarToServerEvents,
  ServerToSidecarEvents
} from '@repo/types';

/**
 * SocketClient handles real-time communication between sidecar and server
 */
export class SocketClient {
  private socket: Socket<ServerToSidecarEvents, SidecarToServerEvents>;
  private taskId: string;
  private connected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly reconnectionDelay = 1000;
  private readonly reconnectionDelayMax = 5000;
  private readonly timeout = 20000;

  constructor(serverUrl: string, taskId: string) {
    this.taskId = taskId;

    logger.info(`[SOCKET_CLIENT] Initializing connection to ${serverUrl}/sidecar for task ${taskId}`);

    this.socket = io(`${serverUrl}/sidecar`, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: this.reconnectionDelay,
      reconnectionDelayMax: this.reconnectionDelayMax,
      timeout: this.timeout,
    });

    this.setupEventHandlers();
  }

  /**
   * Set up Socket.IO event handlers
   */
  private setupEventHandlers(): void {
    this.socket.on('connect', () => {
      this.connected = true;
      this.reconnectAttempts = 0;

      logger.info(`[SOCKET_CLIENT] Connected to server, joining task ${this.taskId}`);

      // Join the task room
      this.socket.emit('join-task', {
        taskId: this.taskId,
        podId: process.env.HOSTNAME || 'unknown-pod'
      });
    });

    this.socket.on('task-joined', (data) => {
      if (data.success) {
        logger.info(`[SOCKET_CLIENT] Successfully joined task room: ${data.taskId}`);
      } else {
        logger.error(`[SOCKET_CLIENT] Failed to join task room: ${data.taskId}`);
      }
    });

    this.socket.on('config-update', (config) => {
      logger.info(`[SOCKET_CLIENT] Received config update`, { config });
      // TODO: Handle dynamic configuration updates
    });

    this.socket.on('disconnect', (reason) => {
      this.connected = false;
      logger.warn(`[SOCKET_CLIENT] Disconnected from server`, {
        reason,
        taskId: this.taskId
      });
    });

    this.socket.on('connect_error', (error) => {
      this.reconnectAttempts++;
      logger.error(`[SOCKET_CLIENT] Connection error (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`, {
        error: error.message,
        taskId: this.taskId
      });

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        logger.error(`[SOCKET_CLIENT] Max reconnection attempts reached, giving up`);
      }
    });
  }

  /**
   * Emit a filesystem change event to the server
   */
  emitFileSystemChange(event: FileSystemEvent): void {
    if (!this.connected) {
      logger.warn(`[SOCKET_CLIENT] Cannot send filesystem change - not connected`, {
        event: `${event.type}:${event.path}`,
        taskId: event.taskId
      });
      return;
    }

    logger.debug(`[SOCKET_CLIENT] Emitting filesystem change`, {
      type: event.type,
      path: event.path,
      taskId: event.taskId
    });

    this.socket.emit('fs-change', event);
  }

  /**
   * Send heartbeat to server
   */
  sendHeartbeat(): void {
    if (this.connected) {
      this.socket.emit('heartbeat');
    }
  }

  /**
   * Check if socket is connected
   */
  isConnected(): boolean {
    return this.connected && this.socket.connected;
  }

  /**
   * Gracefully disconnect from server
   */
  disconnect(): void {
    logger.info(`[SOCKET_CLIENT] Disconnecting from server for task ${this.taskId}`);

    if (this.socket) {
      this.socket.disconnect();
    }
  }

  /**
   * Get connection statistics
   */
  getStats() {
    return {
      connected: this.connected,
      reconnectAttempts: this.reconnectAttempts,
      taskId: this.taskId,
      socketId: this.socket.id
    };
  }
}