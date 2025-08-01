import { app, socketIOServer } from "./app";
import config from "./config";
import { stopAllFileSystemWatchers } from "./tools";
import { taskCleanupService } from "./services/task-cleanup";

const apiServer = app.listen(config.apiPort, () => {
  console.log(`Server running on port ${config.apiPort}`);
});

const socketServer = socketIOServer.listen(config.socketPort, () => {
  console.log(`Socket.IO server running on port ${config.socketPort}`);
  
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
  
  // Close servers
  apiServer.close(() => {
    console.log('[SERVER] HTTP server closed');
  });
  
  socketServer.close(() => {
    console.log('[SERVER] Socket.IO server closed');
    process.exit(0);
  });
  
  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('[SERVER] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
