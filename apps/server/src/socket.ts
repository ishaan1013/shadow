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

interface VariantStreamState {
  chunks: StreamChunk[];
  isStreaming: boolean;
}

const connectionStates = new Map<string, ConnectionState>();
const variantStreamStates = new Map<string, VariantStreamState>();
let io: Server<ClientToServerEvents, ServerToClientEvents>;

// Helper functions for variant stream state management
function getOrCreateVariantStreamState(variantId: string): VariantStreamState {
  if (!variantStreamStates.has(variantId)) {
    variantStreamStates.set(variantId, { chunks: [], isStreaming: false });
  }
  return variantStreamStates.get(variantId)!;
}

function cleanupVariantStreamState(variantId: string): void {
  variantStreamStates.delete(variantId);
  console.log(`[SOCKET] Cleaned up stream state for variant ${variantId}`);
}

async function getTerminalHistory(variantId: string): Promise<TerminalEntry[]> {
  try {
    const variant = await prisma.variant.findUnique({
      where: { id: variantId },
      select: { id: true, workspacePath: true, taskId: true },
    });

    if (!variant) {
      throw new Error(`Variant ${variantId} not found`);
    }

    // Create executor based on current mode
    const agentMode = config.agentMode;
    const executor = await createToolExecutor(
      variant.taskId,
      variant.workspacePath || undefined,
      agentMode
    );

    if (executor.isRemote()) {
      // Get the sidecar URL from the remote executor
      const sidecarUrl =
        "sidecarUrl" in executor
          ? (executor as { sidecarUrl: string }).sidecarUrl
          : undefined;
      if (!sidecarUrl) {
        throw new Error(`Sidecar URL not available for variant ${variantId}`);
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

async function clearTerminal(variantId: string): Promise<void> {
  try {
    const variant = await prisma.variant.findUnique({
      where: { id: variantId },
      select: { id: true, workspacePath: true, taskId: true },
    });

    if (!variant) {
      throw new Error(`Variant ${variantId} not found`);
    }

    const agentMode = config.agentMode;
    const executor = await createToolExecutor(
      variant.taskId,
      variant.workspacePath || undefined,
      agentMode
    );

    if (executor.isRemote()) {
      // Get the sidecar URL from the remote executor
      const sidecarUrl =
        "sidecarUrl" in executor
          ? (executor as { sidecarUrl: string }).sidecarUrl
          : undefined;
      if (!sidecarUrl) {
        throw new Error(`Sidecar URL not available for variant ${variantId}`);
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

function startTerminalPolling(variantId: string) {
  // Avoid duplicate polling
  if (terminalPollingIntervals.has(variantId)) {
    return;
  }

  let lastSeenId = 0;

  const interval = setInterval(async () => {
    try {
      // Query specific variant for workspace path
      const variant = await prisma.variant.findUnique({
        where: { id: variantId },
        select: { id: true, workspacePath: true, taskId: true },
      });

      if (!variant) {
        stopTerminalPolling(variantId);
        return;
      }

      const agentMode = config.agentMode;
      // Use taskId for executor discovery in remote mode
      const executor = await createToolExecutor(
        variant.taskId,
        variant.workspacePath || undefined,
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
            `[SOCKET] Sidecar URL not available for variant ${variantId}, stopping polling`
          );
          stopTerminalPolling(variantId);
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
              emitTerminalOutput(variantId, variant.taskId, entry);
            }
          });
        }
      }
    } catch (error) {
      console.error(`Terminal polling error for variant ${variantId}:`, error);
    }
  }, 1000); // Poll every second

  terminalPollingIntervals.set(variantId, interval);
  console.log(`[SOCKET] Started terminal polling for variant ${variantId}`);
}

function stopTerminalPolling(variantId: string) {
  const interval = terminalPollingIntervals.get(variantId);
  if (interval) {
    clearInterval(interval);
    terminalPollingIntervals.delete(variantId);
    console.log(`[SOCKET] Stopped terminal polling for variant ${variantId}`);
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

    // Send empty stream state for new connections
    // Variant-specific stream state will be sent when user selects a variant
    socket.emit("stream-state", {
      chunks: [],
      isStreaming: false,
      totalChunks: 0,
    });

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

        // Get task info and verify variant exists
        const task = await prisma.task.findUnique({
          where: { id: data.taskId },
          include: {
            variants: {
              where: { id: data.variantId },
              select: { id: true, workspacePath: true },
              take: 1,
            },
          },
        });

        if (!task) {
          socket.emit("message-error", { error: "Task not found" });
          return;
        }

        if (task.variants.length === 0) {
          socket.emit("message-error", { error: "Variant not found" });
          return;
        }

        // Variant validated above

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
        startTerminalPolling(data.variantId);

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
          variantId: data.variantId,
          userMessage: data.message,
          context: modelContext,
          queue: data.queue || false,
        });
      } catch (error) {
        console.error("Error processing user message:", error);
        socket.emit("message-error", { error: "Failed to process message" });
      }
    });

    socket.on(
      "clear-queued-action",
      async (data: { taskId: string; variantId: string }) => {
        try {
          chatService.clearQueuedActionForVariant(data.variantId);
        } catch (error) {
          console.error("Error clearing queued action:", error);
        }
      }
    );

    socket.on("create-stacked-pr", async (data) => {
      try {
        console.log("Received create stacked PR:", data);

        const hasAccess = await verifyTaskAccess(connectionId, data.taskId);
        if (!hasAccess) {
          socket.emit("message-error", { error: "Access denied to task" });
          return;
        }

        if (!data.variantId) {
          socket.emit("message-error", { error: "variantId is required" });
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
          parentVariantId: data.variantId,
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

        // Get task info and verify variant exists
        const task = await prisma.task.findUnique({
          where: { id: data.taskId },
          include: {
            variants: {
              where: { id: data.variantId },
              select: { id: true, workspacePath: true },
              take: 1,
            },
          },
        });

        if (!task) {
          socket.emit("message-error", { error: "Task not found" });
          return;
        }

        if (task.variants.length === 0) {
          socket.emit("message-error", { error: "Variant not found" });
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
        startTerminalPolling(data.variantId);

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
          variantId: data.variantId,
          messageId: data.messageId,
          newContent: data.message,
          newModel: data.llmModel,
          context: modelContext,
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

        if (!data.variantId) {
          socket.emit("chat-history-error", { error: "variantId is required" });
          return;
        }

        const history = await chatService.getChatHistory(
          data.taskId,
          data.variantId
        );
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
            : chatService.getQueuedActionForVariant(data.variantId),
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
        console.log(
          "Received stop stream request for variant:",
          data.variantId
        );

        const hasAccess = await verifyTaskAccess(connectionId, data.taskId);
        if (!hasAccess) {
          socket.emit("message-error", { error: "Access denied to task" });
          return;
        }

        await chatService.stopStream(data.taskId, data.variantId, true);

        endStream(data.variantId, data.taskId);

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

        const history = await getTerminalHistory(data.variantId);
        socket.emit("terminal-history", {
          taskId: data.taskId,
          variantId: data.variantId,
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

        await clearTerminal(data.variantId);
        emitToTask(data.taskId, "terminal-cleared", {
          taskId: data.taskId,
          variantId: data.variantId,
        });
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

        // For variant-specific stream state, frontend will request specific variant history
        // Send empty state for now - frontend needs to specify variantId
        socket.emit("stream-state", {
          chunks: [],
          isStreaming: false,
          totalChunks: 0,
        });

        socket.emit("history-complete", {
          taskId: data.taskId,
          totalLength: 0,
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

export function startStream(variantId: string | undefined, taskId: string) {
  if (!variantId) {
    throw new Error("variantId is required for stream operations");
  }
  const streamState = getOrCreateVariantStreamState(variantId);
  streamState.chunks = [];
  streamState.isStreaming = true;
  console.log(
    `[SOCKET] Started stream for variant ${variantId} in task ${taskId}`
  );
}

export function endStream(variantId: string, taskId: string) {
  const streamState = getOrCreateVariantStreamState(variantId);
  streamState.isStreaming = false;
  if (io) {
    emitToTask(taskId, "stream-complete", undefined);
  }
  console.log(
    `[SOCKET] Ended stream for variant ${variantId} in task ${taskId}`
  );
}

export function handleStreamError(
  error: unknown,
  variantId: string | undefined,
  taskId: string
) {
  if (!variantId) {
    console.error("variantId is required for stream error handling");
    return;
  }
  const streamState = getOrCreateVariantStreamState(variantId);
  streamState.isStreaming = false;
  if (io) {
    emitToTask(taskId, "stream-error", error);
  }
  console.log(
    `[SOCKET] Stream error for variant ${variantId} in task ${taskId}:`,
    error
  );
}

export async function emitTaskStatusUpdate(
  taskId: string,
  status: string,
  initStatus?: InitStatus
) {
  if (io) {
    // Task-level status updates don't include variant-specific initStatus/errorMessage
    const currentInitStatus = initStatus;

    const statusUpdateEvent = {
      taskId,
      status,
      initStatus: currentInitStatus,
      timestamp: new Date().toISOString(),
    };

    console.log(`[SOCKET] Emitting task status update:`, statusUpdateEvent);
    emitToTask(taskId, "task-status-updated", statusUpdateEvent);
  }
}

export function emitVariantStatusUpdate(
  taskId: string,
  data: VariantStatusUpdateEvent
) {
  if (io) {
    console.log(`[SOCKET] Emitting variant status update:`, data);
    emitToTask(taskId, "variant-status-updated", data);
  }
}

export function emitStreamChunk(
  chunk: StreamChunk,
  variantId: string | undefined,
  taskId: string
) {
  if (!variantId) {
    console.error("variantId is required for stream chunk emission");
    return;
  }
  // Add variantId to chunk for frontend routing
  const chunkWithVariant = { ...chunk, variantId };

  // Store the chunk for state recovery (exclude complete/error chunks from state)
  if (chunk.type !== "complete" && chunk.type !== "error") {
    const streamState = getOrCreateVariantStreamState(variantId);
    streamState.chunks.push(chunkWithVariant);
  }

  if (io) {
    emitToTask(taskId, "stream-chunk", chunkWithVariant);
  }

  if (chunk.type === "complete") {
    console.log(
      `[SOCKET] Chunk type: complete for variant ${variantId} in task ${taskId}`
    );
    endStream(variantId, taskId);
  }
}

export function emitTerminalOutput(
  variantId: string,
  taskId: string,
  entry: TerminalEntry
) {
  if (io) {
    emitToTask(taskId, "terminal-output", { taskId, variantId, entry });
  }
}

// Export cleanup functions for variant memory management
export { cleanupVariantStreamState };

// Also export terminal polling cleanup (already exists)
export { stopTerminalPolling };
