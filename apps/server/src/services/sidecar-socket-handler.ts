import { Server, Socket } from 'socket.io';
import { emitStreamChunk } from '../socket';
import type {
  FileSystemEvent,
  SidecarToServerEvents,
  ServerToSidecarEvents
} from '@repo/types';

/**
 * Set up the /sidecar namespace for sidecar Socket.IO connections
 */
export function setupSidecarNamespace(io: Server): void {
  const sidecarNamespace = io.of('/sidecar');

  sidecarNamespace.on('connection', (socket: Socket<SidecarToServerEvents, ServerToSidecarEvents>) => {
    console.log(`[SIDECAR_SOCKET] Sidecar connected: ${socket.id}`);

    // Handle task room joining
    socket.on('join-task', async (data: { taskId: string, podId?: string }) => {
      const { taskId, podId } = data;

      try {
        // Join the task room
        await socket.join(`task-${taskId}`);

        console.log(`[SIDECAR_SOCKET] Sidecar ${socket.id} (pod: ${podId || 'unknown'}) joined task ${taskId}`);

        // Confirm successful join
        socket.emit('task-joined', { taskId, success: true });
      } catch (error) {
        console.error(`[SIDECAR_SOCKET] Error joining task room:`, error);
        socket.emit('task-joined', { taskId, success: false });
      }
    });

    // Handle filesystem change events
    socket.on('fs-change', (event: FileSystemEvent) => {
      console.log(`[SIDECAR_SOCKET] Filesystem change received:`, {
        type: event.type,
        path: event.path,
        taskId: event.taskId,
        source: event.source
      });

      // Transform to StreamChunk format and broadcast to frontend clients
      emitStreamChunk({
        type: "fs-change",
        fsChange: {
          operation: event.type,
          filePath: event.path,
          timestamp: event.timestamp,
          source: event.source,
          isDirectory: event.isDirectory
        }
      }, event.taskId);
    });

    // Handle heartbeat
    socket.on('heartbeat', () => {
      // Simple acknowledgment - could be used for connection monitoring
      console.debug(`[SIDECAR_SOCKET] Heartbeat received from ${socket.id}`);
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      console.log(`[SIDECAR_SOCKET] Sidecar disconnected: ${socket.id}, reason: ${reason}`);
    });

    // Handle connection errors
    socket.on('error', (error) => {
      console.error(`[SIDECAR_SOCKET] Socket error for ${socket.id}:`, error);
    });
  });

  console.log(`[SIDECAR_SOCKET] Sidecar namespace initialized at /sidecar`);
}