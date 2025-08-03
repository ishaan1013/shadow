import { socketIOServer } from "./app";
import config from "./config";
import { stopAllFileSystemWatchers } from "./agent/tools";
import { taskCleanupService } from "./services/task-cleanup";

// Use single server for both HTTP and WebSocket
const server = socketIOServer.listen(config.apiPort, () => {
  console.log(`Server (HTTP + WebSocket) running on port ${config.apiPort}`);

  // Start background cleanup service
  taskCleanupService.start();
});

// Graceful shutdown handling
const shutdown = (signal: string) => {
  console.log(`\n[SERVER] Received ${signal}, starting graceful shutdown...`);

  // Stop cleanup service
  taskCleanupService.stop();

  // Stop all filesystem watchers first
  stopAllFileSystemWatchers();

  // Close server (handles both HTTP and WebSocket)
  server.close(() => {
    console.log("[SERVER] Server closed (HTTP + WebSocket)");
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error("[SERVER] Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
