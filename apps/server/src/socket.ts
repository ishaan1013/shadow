import { StreamChunk } from "@repo/types";
import http from "http";
import { Server } from "socket.io";
import { ChatService } from "./chat";
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

    // Handle user message (legacy format)
    socket.on(
      "user-message",
      async (data: { taskId: string; message: string; llmModel?: string }) => {
        try {
          console.log("Received user message:", data);
          await chatService.processUserMessage(
            data.taskId,
            data.message,
            data.llmModel || "claude-3-5-sonnet-20241022"
          );
        } catch (error) {
          console.error("Error processing user message:", error);
          socket.emit("message-error", { error: "Failed to process message" });
        }
      }
    );

    // Enhanced user message with AI SDK features
    socket.on(
      "user-message-enhanced",
      async (data: { 
        taskId: string; 
        message: string; 
        llmConfig?: {
          model?: string;
          provider?: string;
          tools?: Record<string, any>;
          maxSteps?: number;
          temperature?: number;
          maxTokens?: number;
        };
      }) => {
        try {
          console.log("Received enhanced user message:", data);
          
          if (data.llmConfig?.tools) {
            // Use tools-enabled processing
            await chatService.processUserMessageWithTools(
              data.taskId,
              data.message,
              data.llmConfig
            );
          } else {
            // Use standard processing
            await chatService.processUserMessage(
              data.taskId,
              data.message,
              data.llmConfig?.model || "claude-3-5-sonnet-20241022"
            );
          }
        } catch (error) {
          console.error("Error processing enhanced user message:", error);
          socket.emit("message-error", { error: "Failed to process message" });
        }
      }
    );

    // Handle model switching
    socket.on(
      "switch-model",
      async (data: { taskId: string; model: string; provider?: string }) => {
        try {
          console.log("Switching model:", data);
          // Could implement model validation here
          socket.emit("model-switched", { 
            model: data.model,
            provider: data.provider,
            success: true 
          });
        } catch (error) {
          console.error("Error switching model:", error);
          socket.emit("model-switched", { 
            success: false, 
            error: "Failed to switch model" 
          });
        }
      }
    );

    // Handle tool registration/configuration
    socket.on(
      "configure-tools",
      async (data: { taskId: string; tools: Record<string, any> }) => {
        try {
          console.log("Configuring tools:", data);
          // Store tool configuration for the task
          // This could be saved to database or session storage
          socket.emit("tools-configured", { 
            tools: Object.keys(data.tools),
            success: true 
          });
        } catch (error) {
          console.error("Error configuring tools:", error);
          socket.emit("tools-configured", { 
            success: false, 
            error: "Failed to configure tools" 
          });
        }
      }
    );

    socket.on("disconnect", () => {
      console.log("user disconnected");
    });
  });

  return io;
}

export function startStream(): void {
  isStreaming = true;
  currentStreamContent = "";
  if (io) {
    io.emit("stream-start");
  }
}

export function emitStreamChunk(chunk: StreamChunk): void {
  if (io) {
    io.emit("stream-chunk", chunk);
    
    // Accumulate content for state management
    if (chunk.type === "content" || (chunk.type === "text-delta" && chunk.content)) {
      currentStreamContent += chunk.content || chunk.textDelta || "";
    }
  }
}

export function endStream(): void {
  isStreaming = false;
  if (io) {
    io.emit("stream-end", { 
      finalContent: currentStreamContent,
      success: true 
    });
  }
}

export function handleStreamError(error: unknown): void {
  isStreaming = false;
  console.error("Stream error:", error);
  if (io) {
    io.emit("stream-error", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
