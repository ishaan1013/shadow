import { prisma, InitStatus } from "@repo/db";
import {
  StreamChunk,
  ServerToClientEvents,
  ClientToServerEvents,
  TerminalEntry,
  TerminalHistoryResponse,
  ModelType,
  ApiKeys,
  VariantStatusUpdateEvent,
} from "@repo/types";
import http from "http";
import { Server, Socket } from "socket.io";
import { chatService } from "./app";
import config, { getCorsOrigins } from "./config";
import { createToolExecutor } from "./execution";
import { setupSidecarNamespace } from "./services/sidecar-socket-handler";
import { parseApiKeysFromCookies } from "./utils/cookie-parser";
import { modelContextService } from "./services/model-context-service";
import { ensureTaskInfrastructureExists } from "./utils/infrastructure-check";
import { updateTaskStatus } from "./utils/task-status";

interface ConnectionState {
  lastSeen: number;
  taskId?: string;
  reconnectCount: number;
  bufferPosition: number;
  apiKeys?: ApiKeys;
}

export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

interface TaskStreamState {
  chunks: StreamChunk[];
  isStreaming: boolean;
}

const connectionStates = new Map<string, ConnectionState>();
const taskStreamStates = new Map<string, TaskStreamState>();
let io: Server<ClientToServerEvents, ServerToClientEvents>;

// Helper functions for task stream state management
function getOrCreateTaskStreamState(taskId: string): TaskStreamState {
  if (!taskStreamStates.has(taskId)) {
    taskStreamStates.set(taskId, { chunks: [], isStreaming: false });
  }
  return taskStreamStates.get(taskId)!;
}

function cleanupTaskStreamState(taskId: string): void {
  taskStreamStates.delete(taskId);
  console.log(`[SOCKET] Cleaned up stream state for task ${taskId}`);
}

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
    const executor = await createToolExecutor(
      taskId,
      task.workspacePath || undefined,
      agentMode
    );

    if (executor.isRemote()) {
      // Get the sidecar URL from the remote executor
      const sidecarUrl =
        "sidecarUrl" in executor
          ? (executor as { sidecarUrl: string }).sidecarUrl
          : undefined;
      if (!sidecarUrl) {
        throw new Error(`Sidecar URL not available for remote task ${taskId}`);
      }

      const response = await fetch(
        `${sidecarUrl}/api/terminal/history?count=100`
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
    const executor = await createToolExecutor(
      taskId,
      task.workspacePath || undefined,
      agentMode
    );

    if (executor.isRemote()) {
      // Get the sidecar URL from the remote executor
      const sidecarUrl =
        "sidecarUrl" in executor
          ? (executor as { sidecarUrl: string }).sidecarUrl
          : undefined;
      if (!sidecarUrl) {
        throw new Error(`Sidecar URL not available for remote task ${taskId}`);
      }

      // Call sidecar terminal clear API
      const response = await fetch(`${sidecarUrl}/api/terminal/clear`, {
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
      const executor = await createToolExecutor(
        taskId,
        task.workspacePath || undefined,
        agentMode
      );

      if (executor.isRemote()) {
        // Get the sidecar URL from the remote executor
        const sidecarUrl =
          "sidecarUrl" in executor
            ? (executor as { sidecarUrl: string }).sidecarUrl
            : undefined;
        if (!sidecarUrl) {
          console.error(
            `[SOCKET] Sidecar URL not available for remote task ${taskId}, stopping polling`
          );
          stopTerminalPolling(taskId);
          return;
        }

        // Poll sidecar for new entries
        const response = await fetch(
          `${sidecarUrl}/api/terminal/history?sinceId=${lastSeenId}`
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
    // For now, just check if task exists
    // TODO: Add proper user authentication and authorization
    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });
    return !!task;
  } catch (error) {
    console.error(`[SOCKET] Error verifying task access:`, error);
    return false;
  }
}

export function emitToTask(
  taskId: string,
  event: keyof ServerToClientEvents,
  data: unknown
) {
  io.to(`task-${taskId}`).emit(event, data);
}

export function createSocketServer(
  server: http.Server
): Server<ClientToServerEvents, ServerToClientEvents> {
  const socketCorsOrigins = getCorsOrigins(config);

  console.log(`[SOCKET] Allowing origins:`, socketCorsOrigins);

  const isProduction = config.nodeEnv === "production";

  io = new Server(server, {
    cors: {
      origin: socketCorsOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
    cookie: {
      name: "io",
      httpOnly: true,
      // Use "none" for production to allow cross-domain cookies, "lax" for development
      sameSite: isProduction ? "none" : "lax",
      secure: isProduction,
    },
  });

  // Set up sidecar namespace for filesystem watching (only in remote mode)
  const agentMode = config.agentMode;
  if (agentMode === "remote") {
    setupSidecarNamespace(io);
  }

  io.on("connection", (socket: TypedSocket) => {
    const connectionId = socket.id;

    const cookieHeader = socket.request.headers.cookie;

    console.log(`[SOCKET] User connected: ${connectionId}`);

    const apiKeys = parseApiKeysFromCookies(cookieHeader);

    // Initialize connection state
    const existingState = connectionStates.get(connectionId);
    const connectionState: ConnectionState = {
      lastSeen: Date.now(),
      taskId: existingState?.taskId,
      reconnectCount: existingState ? existingState.reconnectCount + 1 : 0,
      bufferPosition: existingState?.bufferPosition || 0,
      apiKeys,
    };
    connectionStates.set(connectionId, connectionState);

    socket.emit("connection-info", {
      connectionId,
      reconnectCount: connectionState.reconnectCount,
      timestamp: connectionState.lastSeen,
    });

    // Send current stream state to new connections
    if (connectionState.taskId) {
      const streamState = taskStreamStates.get(connectionState.taskId);
      if (
        streamState &&
        streamState.isStreaming &&
        streamState.chunks.length > 0
      ) {
        console.log(
          `[SOCKET] Sending stream state to ${connectionId} for task ${connectionState.taskId}:`,
          streamState.chunks.length
        );
        socket.emit("stream-state", {
          chunks: streamState.chunks,
          isStreaming: true,
          totalChunks: streamState.chunks.length,
        });
      } else {
        socket.emit("stream-state", {
          chunks: [],
          isStreaming: false,
          totalChunks: 0,
        });
      }
    } else {
      // No task associated yet, send empty state
      socket.emit("stream-state", {
        chunks: [],
        isStreaming: false,
        totalChunks: 0,
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

        // Get task workspace path and user info from database
        const task = await prisma.task.findUnique({
          where: { id: data.taskId },
          select: { workspacePath: true, userId: true },
        });

        if (!task) {
          socket.emit("message-error", { error: "Task not found" });
          return;
        }

        // Create model context for this task
        const modelContext = await modelContextService.createContext(
          data.taskId,
          socket.handshake.headers.cookie,
          data.llmModel as ModelType
        );

        await ensureTaskInfrastructureExists(
          data.taskId,
          task.userId,
          modelContext
        );

        await updateTaskStatus(data.taskId, "RUNNING", "SOCKET");
        startTerminalPolling(data.taskId);

        // Validate that user has the required API key for the selected model
        if (!modelContext.validateAccess()) {
          const provider = modelContext.getProvider();
          const providerName =
            provider === "anthropic"
              ? "Anthropic"
              : provider === "openrouter"
                ? "OpenRouter"
                : "OpenAI";
          socket.emit("message-error", {
            error: `${providerName} API key required. Please configure your API key in settings to use ${data.llmModel}.`,
          });
          return;
        }

        await chatService.processUserMessage({
          taskId: data.taskId,
          userMessage: data.message,
          context: modelContext,
          workspacePath: task?.workspacePath || undefined,
          queue: data.queue || false,
        });
      } catch (error) {
        console.error("Error processing user message:", error);
        socket.emit("message-error", { error: "Failed to process message" });
      }
    });

    socket.on("clear-queued-action", async (data: { taskId: string }) => {
      try {
        chatService.clearQueuedAction(data.taskId);
      } catch (error) {
        console.error("Error clearing queued action:", error);
      }
    });

    socket.on("create-stacked-pr", async (data) => {
      try {
        console.log("Received create stacked PR:", data);

        const hasAccess = await verifyTaskAccess(connectionId, data.taskId);
        if (!hasAccess) {
          socket.emit("message-error", { error: "Access denied to task" });
          return;
        }

        const parentTask = await prisma.task.findUnique({
          where: { id: data.taskId },
          select: { userId: true },
        });

        if (!parentTask) {
          socket.emit("message-error", { error: "Parent task not found" });
          return;
        }

        await chatService.createStackedPR({
          parentTaskId: data.taskId,
          message: data.message,
          model: data.llmModel as ModelType,
          userId: parentTask.userId,
          queue: data.queue || false,
          socket: socket,
          newTaskId: data.newTaskId,
        });
      } catch (error) {
        console.error("Error creating stacked PR:", error);
        socket.emit("message-error", { error: "Failed to create stacked PR" });
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

        // Get task workspace path and user info from database
        const task = await prisma.task.findUnique({
          where: { id: data.taskId },
          select: { workspacePath: true, userId: true },
        });

        if (!task) {
          socket.emit("message-error", { error: "Task not found" });
          return;
        }

        // Create model context for this task
        const modelContext = await modelContextService.createContext(
          data.taskId,
          socket.handshake.headers.cookie,
          data.llmModel as ModelType
        );

        // Ensure task infrastructure exists before proceeding
        await ensureTaskInfrastructureExists(
          data.taskId,
          task.userId,
          modelContext
        );

        await updateTaskStatus(data.taskId, "RUNNING", "SOCKET");
        startTerminalPolling(data.taskId);

        // Validate that user has the required API key for the selected model
        if (!modelContext.validateAccess()) {
          const provider = modelContext.getProvider();
          const providerName =
            provider === "anthropic"
              ? "Anthropic"
              : provider === "openrouter"
                ? "OpenRouter"
                : "OpenAI";
          socket.emit("message-error", {
            error: `${providerName} API key required. Please configure your API key in settings to use ${data.llmModel}.`,
          });
          return;
        }

        await chatService.editUserMessage({
          taskId: data.taskId,
          messageId: data.messageId,
          newContent: data.message,
          newModel: data.llmModel,
          context: modelContext,
          workspacePath: task?.workspacePath || undefined,
        });
      } catch (error) {
        console.error("Error editing user message:", error);
        socket.emit("message-error", { error: "Failed to edit message" });
      }
    });

    // Handle request for chat history
    socket.on("get-chat-history", async (data) => {
      console.log(`[SOCKET] Received get-chat-history request:`, {
        taskId: data.taskId,
        complete: data.complete,
        connectionId,
      });

      try {
        const hasAccess = await verifyTaskAccess(connectionId, data.taskId);
        if (!hasAccess) {
          console.warn(`[SOCKET] Access denied for chat history request:`, {
            taskId: data.taskId,
            connectionId,
          });
          socket.emit("chat-history-error", { error: "Access denied to task" });
          return;
        }

        const history = await chatService.getChatHistory(data.taskId);
        console.log(`[SOCKET] Successfully retrieved chat history:`, {
          taskId: data.taskId,
          messageCount: history.length,
          complete: data.complete,
        });

        socket.emit("chat-history", {
          taskId: data.taskId,
          messages: history,
          // If complete is true, the queued action will automatically get sent, so set it to null so the frontend removes it from the queue UI
          queuedAction: data.complete
            ? null
            : chatService.getQueuedAction(data.taskId),
        });
      } catch (error) {
        console.error(
          `[SOCKET] Error getting chat history for task ${data.taskId}:`,
          error
        );
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

        await chatService.stopStream(data.taskId, true);

        endStream(data.taskId);

        emitToTask(data.taskId, "stream-complete", undefined);
      } catch (error) {
        console.error("Error stopping stream:", error);
        socket.emit("stream-error", { error: "Failed to stop stream" });
      }
    });

    socket.on("get-terminal-history", async (data) => {
      try {
        const hasAccess = await verifyTaskAccess(connectionId, data.taskId);
        if (!hasAccess) {
          socket.emit("terminal-history-error", {
            error: "Access denied to task",
          });
          return;
        }

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
        const hasAccess = await verifyTaskAccess(connectionId, data.taskId);
        if (!hasAccess) {
          socket.emit("terminal-error", { error: "Access denied to task" });
          return;
        }

        await clearTerminal(data.taskId);
        emitToTask(data.taskId, "terminal-cleared", { taskId: data.taskId });
      } catch (error) {
        console.error("Error clearing terminal:", error);
        socket.emit("terminal-error", {
          error: "Failed to clear terminal",
        });
      }
    });

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

        // Send structured chunks instead of positional content
        const streamState = taskStreamStates.get(data.taskId);
        if (streamState && streamState.chunks.length > 0) {
          // Send all chunks - let frontend handle deduplication
          socket.emit("stream-state", {
            chunks: streamState.chunks,
            isStreaming: streamState.isStreaming,
            totalChunks: streamState.chunks.length,
          });
        }

        socket.emit("history-complete", {
          taskId: data.taskId,
          totalLength: streamState?.chunks.length || 0,
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

export function startStream(taskId: string) {
  const streamState = getOrCreateTaskStreamState(taskId);
  streamState.chunks = [];
  streamState.isStreaming = true;
  console.log(`[SOCKET] Started stream for task ${taskId}`);
}

export function endStream(taskId: string) {
  const streamState = getOrCreateTaskStreamState(taskId);
  streamState.isStreaming = false;
  if (io) {
    emitToTask(taskId, "stream-complete", undefined);
  }
  console.log(`[SOCKET] Ended stream for task ${taskId}`);
}

export function handleStreamError(error: unknown, taskId: string) {
  const streamState = getOrCreateTaskStreamState(taskId);
  streamState.isStreaming = false;
  if (io) {
    emitToTask(taskId, "stream-error", error);
  }
  console.log(`[SOCKET] Stream error for task ${taskId}:`, error);
}

export async function emitTaskStatusUpdate(
  taskId: string,
  status: string,
  initStatus?: InitStatus
) {
  if (io) {
    // If initStatus not provided, fetch current task state including error message
    let currentInitStatus = initStatus;
    let errorMessage: string | undefined;

    if (!currentInitStatus || status === "FAILED") {
      try {
        const task = await prisma.task.findUnique({
          where: { id: taskId },
          select: { initStatus: true, errorMessage: true },
        });
        currentInitStatus = currentInitStatus || task?.initStatus;
        errorMessage = task?.errorMessage || undefined;
      } catch (error) {
        console.error(
          `[SOCKET] Error fetching task data for ${taskId}:`,
          error
        );
      }
    }

    const statusUpdateEvent = {
      taskId,
      status,
      initStatus: currentInitStatus,
      timestamp: new Date().toISOString(),
      ...(errorMessage && { errorMessage }),
    };

    console.log(`[SOCKET] Emitting task status update:`, statusUpdateEvent);
    emitToTask(taskId, "task-status-updated", statusUpdateEvent);
  }
}

export function emitVariantStatusUpdate(taskId: string, data: VariantStatusUpdateEvent) {
  if (io) {
    console.log(`[SOCKET] Emitting variant status update:`, data);
    emitToTask(taskId, "variant-status-updated", data);
  }
}

export function emitStreamChunk(chunk: StreamChunk, taskId: string) {
  // Store the chunk for state recovery (exclude complete/error chunks from state)
  if (chunk.type !== "complete" && chunk.type !== "error") {
    const streamState = getOrCreateTaskStreamState(taskId);
    streamState.chunks.push(chunk);
  }

  if (io) {
    emitToTask(taskId, "stream-chunk", chunk);
  }

  if (chunk.type === "complete") {
    console.log(`[SOCKET] Chunk type: complete for task ${taskId}`);
    endStream(taskId);
  }
}

export function emitTerminalOutput(taskId: string, entry: TerminalEntry) {
  if (io) {
    emitToTask(taskId, "terminal-output", { taskId, entry });
  }
}

// Export cleanup functions for task memory management
export { cleanupTaskStreamState };

// Also export terminal polling cleanup (already exists)
export { stopTerminalPolling };
