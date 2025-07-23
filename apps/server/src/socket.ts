import { prisma } from "@repo/db";
import { ModelType, StreamChunk } from "@repo/types";
import http from "http";
import { Server } from "socket.io";
import { ChatService, DEFAULT_MODEL } from "./chat";
import config from "./config";
import { updateTaskStatus } from "./utils/task-status";

// In-memory stream state
let currentStreamContent = "";
let isStreaming = false;
let io: Server;
let chatService: ChatService;

export function createSocketServer(server: http.Server): Server {
  io = new Server(server, {
    cors: {
      origin: config.clientUrl,
      methods: ["GET", "POST"],
    },
  });

  // Initialize chat service
  chatService = new ChatService();

  io.on("connection", (socket) => {
    console.log("a user connected");

    // Send current stream state to new connections
    if (isStreaming && currentStreamContent) {
      console.log("sending stream state", currentStreamContent);
      socket.emit("stream-state", {
        content: currentStreamContent,
        isStreaming: true,
      });
    } else {
      socket.emit("stream-state", {
        content: "",
        isStreaming: false,
      });
    }

    // Handle user message
    socket.on(
      "user-message",
      async (data: {
        taskId: string;
        message: string;
        llmModel?: ModelType;
      }) => {
        try {
          console.log("Received user message:", data);

          // Update task status to running when user sends a new message
          await updateTaskStatus(data.taskId, "RUNNING", "SOCKET");

          // Get task workspace path from database
          const task = await prisma.task.findUnique({
            where: { id: data.taskId },
            select: { workspacePath: true },
          });

          await chatService.processUserMessage({
            taskId: data.taskId,
            userMessage: data.message,
            llmModel: data.llmModel || DEFAULT_MODEL,
            workspacePath: task?.workspacePath || undefined,
          });
        } catch (error) {
          console.error("Error processing user message:", error);
          socket.emit("message-error", { error: "Failed to process message" });
        }
      }
    );

    // Handle request for chat history
    socket.on("get-chat-history", async (data: { taskId: string }) => {
      try {
        const history = await chatService.getChatHistory(data.taskId);
        socket.emit("chat-history", { taskId: data.taskId, messages: history });
      } catch (error) {
        console.error("Error getting chat history:", error);
        socket.emit("chat-history-error", {
          error: "Failed to get chat history",
        });
      }
    });

    // Handle stop stream request
    socket.on("stop-stream", async (data: { taskId: string }) => {
      try {
        console.log("Received stop stream request for task:", data.taskId);

        // Stop the current streaming operation
        await chatService.stopStream(data.taskId);

        // Update stream state
        endStream();

        // Notify all clients that the stream has been stopped
        io.emit("stream-complete");
      } catch (error) {
        console.error("Error stopping stream:", error);
        socket.emit("stream-error", { error: "Failed to stop stream" });
      }
    });

    socket.on("disconnect", () => {
      console.log("a user disconnected");
    });
  });

  return io;
}

export function startStream() {
  currentStreamContent = "";
  isStreaming = true;
}

export function endStream() {
  isStreaming = false;
  // Only emit if socket server is initialized (not in terminal mode)
  if (io) {
    io.emit("stream-complete");
  }
}

export function handleStreamError(error: any) {
  isStreaming = false;
  // Only emit if socket server is initialized (not in terminal mode)
  if (io) {
    io.emit("stream-error", error);
  }
}

export function emitTaskStatusUpdate(taskId: string, status: string) {
  // Only emit if socket server is initialized (not in terminal mode)
  if (io) {
    const statusUpdateEvent = {
      taskId,
      status,
      timestamp: new Date().toISOString(),
    };

    console.log(`[SOCKET] Emitting task status update:`, statusUpdateEvent);
    io.emit("task-status-updated", statusUpdateEvent);
  }
}

export function emitStreamChunk(chunk: StreamChunk) {
  // Accumulate content for state tracking
  if (chunk.type === "content" && chunk.content) {
    currentStreamContent += chunk.content;
  }

  // Broadcast the chunk directly to all connected Socket.IO clients
  // Only emit if socket server is initialized (not in terminal mode)
  if (io) {
    io.emit("stream-chunk", chunk);
  } else {
    // In terminal mode, just log the content
    if (chunk.type === "content" && chunk.content) {
      process.stdout.write(chunk.content);
    } else if (chunk.type === "tool-call" && chunk.toolCall) {
      console.log(`\n🔧 [TOOL_CALL] ${chunk.toolCall.name}`);
      if (Object.keys(chunk.toolCall.args).length > 0) {
        console.log(`   Args:`, JSON.stringify(chunk.toolCall.args, null, 2));
      }
    } else if (chunk.type === "tool-result" && chunk.toolResult) {
      console.log(`\n✅ [TOOL_RESULT] ${chunk.toolResult.id}:`);
      console.log(`   ${chunk.toolResult.result}`);
    } else if (chunk.type === "file-change" && chunk.fileChange) {
      console.log(
        `\n📝 [FILE_CHANGE] ${chunk.fileChange.operation} ${chunk.fileChange.filePath}`
      );
      console.log(
        `   Changes: +${chunk.fileChange.additions} -${chunk.fileChange.deletions}`
      );
    } else if (chunk.type === "usage" && chunk.usage) {
      console.log(
        `\n📊 [USAGE] Tokens: ${chunk.usage.totalTokens} (${chunk.usage.promptTokens} prompt + ${chunk.usage.completionTokens} completion)`
      );
    } else if (chunk.type === "init-progress" && chunk.initProgress) {
      console.log(`\n🔄 [INIT] ${chunk.initProgress.message}`);
      if (chunk.initProgress.currentStep) {
        console.log(
          `   Step: ${chunk.initProgress.stepName || chunk.initProgress.currentStep}`
        );
        if (chunk.initProgress.stepNumber && chunk.initProgress.totalSteps) {
          console.log(
            `   Progress: ${chunk.initProgress.stepNumber}/${chunk.initProgress.totalSteps}`
          );
        }
      }
      if (chunk.initProgress.error) {
        console.log(`   Error: ${chunk.initProgress.error}`);
      }
    } else if (chunk.type === "complete") {
      console.log(
        `\n\n✅ [COMPLETE] Finished with reason: ${chunk.finishReason}`
      );
    } else if (chunk.type === "error") {
      console.log(`\n❌ [ERROR] ${chunk.error}`);
    }
  }

  // Handle completion
  if (chunk.type === "complete") {
    endStream();
  }

  // Handle errors
  if (chunk.type === "error") {
    handleStreamError(chunk.error);
  }
}
