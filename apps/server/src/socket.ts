import { prisma } from "@repo/db";
import {
  StreamChunk,
  ServerToClientEvents,
  ClientToServerEvents,
  TerminalEntry,
  TerminalHistoryResponse,
  ModelType,
} from "@repo/types";
import http from "http";
import { Server, Socket } from "socket.io";
import { chatService } from "./app";
import config from "./config";
import { updateTaskStatus } from "./utils/task-status";
import { createToolExecutor } from "./execution";
import { setupSidecarNamespace } from "./services/sidecar-socket-handler";

interface ConnectionState {
  lastSeen: number;
  taskId?: string;
  reconnectCount: number;
  // Track buffer position for incremental updates
  bufferPosition: number;
}

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const connectionStates = new Map<string, ConnectionState>();
let currentStreamContent = "";
let isStreaming = false;
let io: Server<ClientToServerEvents, ServerToClientEvents>;

async function getTerminalHistory(taskId: string): Promise<TerminalEntry[]> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { workspacePath: true },
    });

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Create executor based on current mode
    const agentMode = config.agentMode;
    const executor = createToolExecutor(
      taskId,
      task.workspacePath || undefined,
      agentMode
    );

    if (executor.isRemote()) {
      const response = await fetch(
        `http://localhost:8080/terminal/history?count=100`
      );
      if (!response.ok) {
        throw new Error(`Sidecar terminal API error: ${response.status}`);
      }
      const data = (await response.json()) as TerminalHistoryResponse;
      return data.entries || [];
    } else {
      // For local mode, return empty for now (no local buffer yet)
      // TODO: Implement local terminal buffer
      return [];
    }
  } catch (error) {
    console.error("Error fetching terminal history:", error);
    return [];
  }
}

async function clearTerminal(taskId: string): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { workspacePath: true },
    });

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const agentMode = config.agentMode;
    const executor = createToolExecutor(
      taskId,
      task.workspacePath || undefined,
      agentMode
    );

    if (executor.isRemote()) {
      // Call sidecar terminal clear API
      const response = await fetch(`http://localhost:8080/terminal/clear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Sidecar terminal clear API error: ${response.status}`);
      }
    } else {
      // For local mode, nothing to clear yet
      // TODO: Implement local terminal buffer
    }
  } catch (error) {
    console.error("Error clearing terminal:", error);
    throw error;
  }
}

// Terminal polling for real-time updates (for remote mode)
const terminalPollingIntervals = new Map<string, NodeJS.Timeout>();

function startTerminalPolling(taskId: string) {
  // Avoid duplicate polling
  if (terminalPollingIntervals.has(taskId)) {
    return;
  }

  let lastSeenId = 0;

  const interval = setInterval(async () => {
    try {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { workspacePath: true },
      });

      if (!task) {
        stopTerminalPolling(taskId);
        return;
      }

      const agentMode = config.agentMode;
      const executor = createToolExecutor(
        taskId,
        task.workspacePath || undefined,
        agentMode
      );

      if (executor.isRemote()) {
        // Poll sidecar for new entries
        const response = await fetch(
          `http://localhost:8080/terminal/history?sinceId=${lastSeenId}`
        );
        if (response.ok) {
          const data = (await response.json()) as TerminalHistoryResponse;
          const newEntries = data.entries || [];

          // Emit new entries to connected clients in the task room
          newEntries.forEach((entry: TerminalEntry) => {
            if (entry.id > lastSeenId) {
              lastSeenId = entry.id;
              emitToTask(taskId, "terminal-output", { taskId, entry });
            }
          });
        }
      }
    } catch (error) {
      console.error(`Terminal polling error for task ${taskId}:`, error);
    }
  }, 1000); // Poll every second

  terminalPollingIntervals.set(taskId, interval);
  console.log(`[SOCKET] Started terminal polling for task ${taskId}`);
}

function stopTerminalPolling(taskId: string) {
  const interval = terminalPollingIntervals.get(taskId);
  if (interval) {
    clearInterval(interval);
    terminalPollingIntervals.delete(taskId);
    console.log(`[SOCKET] Stopped terminal polling for task ${taskId}`);
  }
}

async function verifyTaskAccess(
  _socketId: string,
  taskId: string
): Promise<boolean> {
  try {
    console.log(`[SOCKET] Verifying access for task: ${taskId}`);
    // For now, just check if task exists
    // TODO: Add proper user authentication and authorization
    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });
    console.log(`[SOCKET] Task found:`, !!task, task ? `(${task.status})` : '(not found)');
    return !!task;
  } catch (error) {
    console.error(`[SOCKET] Error verifying task access:`, error);
    return false;
  }
}

function emitToTask(
  taskId: string,
  event: keyof ServerToClientEvents,
  data: unknown
) {
  io.to(`task-${taskId}`).emit(event, data);
}

export function createSocketServer(
  server: http.Server
): Server<ClientToServerEvents, ServerToClientEvents> {
  io = new Server(server, {
    cors: {
      origin: config.clientUrl,
      methods: ["GET", "POST"],
    },
  });

  // Set up sidecar namespace for filesystem watching (only in firecracker mode)
  const agentMode = config.agentMode;
  if (agentMode === "firecracker") {
    setupSidecarNamespace(io);
  }

  io.on("connection", (socket: TypedSocket) => {
    const connectionId = socket.id;
    console.log(`[SOCKET] User connected: ${connectionId}`);

    // Initialize connection state
    const existingState = connectionStates.get(connectionId);
    const connectionState: ConnectionState = {
      lastSeen: Date.now(),
      taskId: existingState?.taskId,
      reconnectCount: existingState ? existingState.reconnectCount + 1 : 0,
      bufferPosition: existingState?.bufferPosition || 0,
    };
    connectionStates.set(connectionId, connectionState);

    socket.emit("connection-info", {
      connectionId,
      reconnectCount: connectionState.reconnectCount,
      timestamp: connectionState.lastSeen,
    });

    // Send current stream state to new connections
    if (isStreaming && currentStreamContent) {
      console.log(
        `[SOCKET] Sending stream state to ${connectionId}:`,
        currentStreamContent.length
      );
      socket.emit("stream-state", {
        content: currentStreamContent,
        isStreaming: true,
        bufferPosition: currentStreamContent.length,
      });
    } else {
      socket.emit("stream-state", {
        content: "",
        isStreaming: false,
        bufferPosition: 0,
      });
    }

    socket.on("join-task", async (data) => {
      try {
        const hasAccess = await verifyTaskAccess(connectionId, data.taskId);
        if (!hasAccess) {
          socket.emit("message-error", { error: "Access denied to task" });
          return;
        }

        // Join the task room
        await socket.join(`task-${data.taskId}`);
        console.log(
          `[SOCKET] User ${connectionId} joined task room: ${data.taskId}`
        );

        // Update connection state
        const state = connectionStates.get(connectionId);
        if (state) {
          state.taskId = data.taskId;
          connectionStates.set(connectionId, state);
        }
      } catch (error) {
        console.error(`[SOCKET] Error joining task room:`, error);
        socket.emit("message-error", { error: "Failed to join task room" });
      }
    });

    socket.on("leave-task", async (data) => {
      try {
        await socket.leave(`task-${data.taskId}`);
        console.log(
          `[SOCKET] User ${connectionId} left task room: ${data.taskId}`
        );

        // Update connection state
        const state = connectionStates.get(connectionId);
        if (state) {
          state.taskId = undefined;
          connectionStates.set(connectionId, state);
        }
      } catch (error) {
        console.error(`[SOCKET] Error leaving task room:`, error);
      }
    });

    // Handle user message
    socket.on("user-message", async (data) => {
      try {
        console.log("Received user message:", data);

        const hasAccess = await verifyTaskAccess(connectionId, data.taskId);
        if (!hasAccess) {
          socket.emit("message-error", { error: "Access denied to task" });
          return;
        }

        // Update task status to running when user sends a new message
        await updateTaskStatus(data.taskId, "RUNNING", "SOCKET");

        // Start terminal polling for this task when user sends a message
        startTerminalPolling(data.taskId);

        // Get task workspace path from database
        const task = await prisma.task.findUnique({
          where: { id: data.taskId },
          select: { workspacePath: true },
        });

        await chatService.processUserMessage({
          taskId: data.taskId,
          userMessage: data.message,
          llmModel: data.llmModel as ModelType,
          workspacePath: task?.workspacePath || undefined,
          queue: data.queue || false,
        });
      } catch (error) {
        console.error("Error processing user message:", error);
        socket.emit("message-error", { error: "Failed to process message" });
      }
    });

    socket.on("clear-queued-message", async (data) => {
      try {
        chatService.clearQueuedMessage(data.taskId);
      } catch (error) {
        console.error("Error clearing queued message:", error);
      }
    });

    socket.on("edit-user-message", async (data) => {
      try {
        console.log("Received edit user message:", data);

        const hasAccess = await verifyTaskAccess(connectionId, data.taskId);
        if (!hasAccess) {
          socket.emit("message-error", { error: "Access denied to task" });
          return;
        }

        // Update task status to running when user edits a message
        await updateTaskStatus(data.taskId, "RUNNING", "SOCKET");

        // Start terminal polling for this task when user edits a message
        startTerminalPolling(data.taskId);

        // Get task workspace path from database
        const task = await prisma.task.findUnique({
          where: { id: data.taskId },
          select: { workspacePath: true },
        });

        await chatService.editUserMessage({
          taskId: data.taskId,
          messageId: data.messageId,
          newContent: data.message,
          newModel: data.llmModel,
          workspacePath: task?.workspacePath || undefined,
        });
      } catch (error) {
        console.error("Error editing user message:", error);
        socket.emit("message-error", { error: "Failed to edit message" });
      }
    });

    // Handle request for chat history
    socket.on("get-chat-history", async (data) => {
      try {
        const hasAccess = await verifyTaskAccess(connectionId, data.taskId);
        if (!hasAccess) {
          socket.emit("chat-history-error", { error: "Access denied to task" });
          return;
        }

        const history = await chatService.getChatHistory(data.taskId);
        socket.emit("chat-history", {
          taskId: data.taskId,
          messages: history,
          // If complete is true, the queued message will automatically get sent, so set it to empty string so the frontend removes it from the queue UI
          queuedMessage: data.complete
            ? null
            : chatService.getQueuedMessage(data.taskId) || null,
        });
      } catch (error) {
        console.error("Error getting chat history:", error);
        socket.emit("chat-history-error", {
          error: "Failed to get chat history",
        });
      }
    });

    socket.on("stop-stream", async (data) => {
      try {
        console.log("Received stop stream request for task:", data.taskId);

        const hasAccess = await verifyTaskAccess(connectionId, data.taskId);
        if (!hasAccess) {
          socket.emit("message-error", { error: "Access denied to task" });
          return;
        }

        await chatService.stopStream(data.taskId);

        endStream(data.taskId);

        emitToTask(data.taskId, "stream-complete", undefined);
      } catch (error) {
        console.error("Error stopping stream:", error);
        socket.emit("stream-error", { error: "Failed to stop stream" });
      }
    });

    socket.on("get-terminal-history", async (data) => {
      try {
        console.log(
          `[SOCKET] Getting terminal history for task: ${data.taskId}`
        );

        const hasAccess = await verifyTaskAccess(connectionId, data.taskId);
        if (!hasAccess) {
          socket.emit("terminal-history-error", {
            error: "Access denied to task",
          });
          return;
        }

        // Get terminal history from sidecar or local executor
        const history = await getTerminalHistory(data.taskId);

        socket.emit("terminal-history", {
          taskId: data.taskId,
          entries: history,
        });
      } catch (error) {
        console.error("Error getting terminal history:", error);
        socket.emit("terminal-history-error", {
          error: "Failed to get terminal history",
        });
      }
    });

    socket.on("clear-terminal", async (data) => {
      try {
        console.log(`[SOCKET] Clearing terminal for task: ${data.taskId}`);

        const hasAccess = await verifyTaskAccess(connectionId, data.taskId);
        if (!hasAccess) {
          socket.emit("terminal-error", { error: "Access denied to task" });
          return;
        }

        // Clear terminal via sidecar or local executor
        await clearTerminal(data.taskId);

        // Notify all clients in the task room that terminal was cleared
        emitToTask(data.taskId, "terminal-cleared", { taskId: data.taskId });
      } catch (error) {
        console.error("Error clearing terminal:", error);
        socket.emit("terminal-error", {
          error: "Failed to clear terminal",
        });
      }
    });

    // Handle heartbeat/keepalive
    socket.on("heartbeat", () => {
      const state = connectionStates.get(connectionId);
      if (state) {
        state.lastSeen = Date.now();
        connectionStates.set(connectionId, state);
      }
    });

    socket.on("request-history", async (data) => {
      try {
        const hasAccess = await verifyTaskAccess(connectionId, data.taskId);
        if (!hasAccess) {
          socket.emit("history-error", { error: "Access denied to task" });
          return;
        }

        const state = connectionStates.get(connectionId);
        if (state) {
          state.taskId = data.taskId;
          connectionStates.set(connectionId, state);
        }

        // Send incremental updates from position
        const fromPosition = data.fromPosition || 0;
        if (currentStreamContent.length > fromPosition) {
          const incrementalContent = currentStreamContent.slice(fromPosition);
          socket.emit("stream-update", {
            content: incrementalContent,
            isIncremental: true,
            fromPosition,
            totalLength: currentStreamContent.length,
          });
        }

        socket.emit("history-complete", {
          taskId: data.taskId,
          totalLength: currentStreamContent.length,
        });
      } catch (error) {
        console.error(
          `[SOCKET] Error sending history to ${connectionId}:`,
          error
        );
        socket.emit("history-error", { error: "Failed to retrieve history" });
      }
    });

    // Handle connection errors
    socket.on("error", (error) => {
      console.error(`[SOCKET] Connection error for ${connectionId}:`, error);
    });

    socket.on("disconnect", (reason) => {
      console.log(
        `[SOCKET] User disconnected: ${connectionId}, reason: ${reason}`
      );

      // Keep connection state for potential reconnection
      const state = connectionStates.get(connectionId);
      if (state) {
        // Mark as disconnected but keep state for 5 minutes
        setTimeout(
          () => {
            connectionStates.delete(connectionId);
            console.log(
              `[SOCKET] Cleaned up connection state for ${connectionId}`
            );
          },
          5 * 60 * 1000
        ); // 5 minutes
      }
    });
  });

  return io;
}

export function startStream() {
  currentStreamContent = "";
  isStreaming = true;
}

export function endStream(taskId: string) {
  isStreaming = false;
  if (io) {
    emitToTask(taskId, "stream-complete", undefined);
  }
}

export function handleStreamError(error: unknown, taskId: string) {
  isStreaming = false;
  if (io) {
    emitToTask(taskId, "stream-error", error);
  }
}

export function emitTaskStatusUpdate(taskId: string, status: string) {
  if (io) {
    const statusUpdateEvent = {
      taskId,
      status,
      timestamp: new Date().toISOString(),
    };

    console.log(`[SOCKET] Emitting task status update:`, statusUpdateEvent);
    emitToTask(taskId, "task-status-updated", statusUpdateEvent);
  }
}

export function emitStreamChunk(chunk: StreamChunk, taskId: string) {
  // Accumulate content for state tracking
  if (chunk.type === "content" && chunk.content) {
    currentStreamContent += chunk.content;
  }

  if (io) {
    emitToTask(taskId, "stream-chunk", chunk);
  }

  if (chunk.type === "complete") {
    endStream(taskId);
  }
}

export function emitTerminalOutput(taskId: string, entry: TerminalEntry) {
  if (io) {
    emitToTask(taskId, "terminal-output", { taskId, entry });
  }
}
