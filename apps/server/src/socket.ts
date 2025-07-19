import { ModelType, StreamChunk } from "@repo/types";
import http from "http";
import { Server } from "socket.io";
import { ChatService, DEFAULT_MODEL } from "./chat";
import config from "./config";

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
          await chatService.processUserMessage({
            taskId: data.taskId,
            userMessage: data.message,
            llmModel: data.llmModel || DEFAULT_MODEL,
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
    } else if (chunk.type === "usage" && chunk.usage) {
      console.log(
        `\n📊 [USAGE] Tokens: ${chunk.usage.totalTokens} (${chunk.usage.promptTokens} prompt + ${chunk.usage.completionTokens} completion)`
      );
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

// Clone progress streaming functions
export function emitCloneProgress(taskId: string, progress: {
  status: "cloning" | "completed" | "error";
  message: string;
  progress?: number;
}) {
  if (io) {
    io.emit("clone-progress", { taskId, ...progress });
    console.log(`[CLONE_PROGRESS] ${taskId}: ${progress.message}`);
  }
}
