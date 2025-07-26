import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { config } from "./config";
import { logger } from "./utils/logger";
import { errorHandler, requestLogger } from "./api/middleware";
import { WorkspaceService } from "./services/workspace-service";
import { FileService } from "./services/file-service";
import { SearchService } from "./services/search-service";
import { CommandService } from "./services/command-service";
import { GitService } from "./services/git-service";
import { TerminalBuffer } from "./services/terminal-buffer";
import { FileSystemWatcher } from "./services/filesystem-watcher";
import { SocketClient } from "./services/socket-client";
import { createHealthRouter } from "./api/health";
import { createFilesRouter } from "./api/files";
import { createSearchRouter } from "./api/search";
import { createExecuteRouter } from "./api/execute";
import { createGitRouter } from "./api/git";

async function startServer() {
  const app = express();

  // Initialize services
  const workspaceService = new WorkspaceService();
  const fileService = new FileService(workspaceService);
  const searchService = new SearchService(workspaceService);
  const commandService = new CommandService(workspaceService);
  const gitService = new GitService(workspaceService);
  const terminalBuffer = new TerminalBuffer({
    maxSize: 10000,
    maxMemory: 50 * 1024 * 1024, // 50MB
    flushInterval: 60000, // 1 minute
  });

  // Ensure workspace exists
  await workspaceService.ensureWorkspace();
  logger.info("Workspace initialized", { 
    path: config.workspaceDir 
  });

  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: config.corsOrigin,
    credentials: true,
  }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMaxRequests,
    message: "Too many requests from this IP",
  });
  app.use(limiter);

  // Body parsing and compression
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(compression());

  // Request logging
  app.use(requestLogger);

  // Try to restore terminal buffer from previous session
  try {
    await terminalBuffer.restore('/tmp/terminal-buffer.json');
  } catch (error) {
    logger.info("No previous terminal buffer found, starting fresh");
  }

  // API routes
  app.use(createHealthRouter(workspaceService));
  app.use(createFilesRouter(fileService));
  app.use(createSearchRouter(searchService));
  app.use(createExecuteRouter(commandService, terminalBuffer));
  app.use(createGitRouter(gitService));

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: "NOT_FOUND",
      message: `Route ${req.method} ${req.path} not found`,
    });
  });

  // Error handling (must be last)
  app.use(errorHandler);

  // Start server
  const server = app.listen(config.port, () => {
    logger.info("Sidecar service started", {
      port: config.port,
      environment: config.nodeEnv,
      workspace: config.workspaceDir,
    });
  });

  // Initialize filesystem watching (only if environment variables are provided)
  let fileSystemWatcher: FileSystemWatcher | null = null;
  let socketClient: SocketClient | null = null;

  const taskId = process.env.TASK_ID;
  const serverUrl = process.env.SHADOW_SERVER_URL;
  const filesystemWatchEnabled = process.env.FILESYSTEM_WATCH_ENABLED !== 'false';

  if (taskId && serverUrl && filesystemWatchEnabled) {
    try {
      logger.info("Initializing filesystem watcher", {
        taskId,
        serverUrl,
        workspaceDir: config.workspaceDir
      });

      // Initialize Socket.IO client
      socketClient = new SocketClient(serverUrl, taskId);

      // Initialize filesystem watcher
      fileSystemWatcher = new FileSystemWatcher(taskId, socketClient);
      await fileSystemWatcher.startWatching(config.workspaceDir);

      logger.info("Filesystem watcher initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize filesystem watcher", { error });
      // Continue without filesystem watching - not critical for basic operation
    }
  } else {
    logger.info("Filesystem watcher disabled or missing configuration", {
      hasTaskId: !!taskId,
      hasServerUrl: !!serverUrl,
      filesystemWatchEnabled
    });
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, starting graceful shutdown...`);

    // Stop filesystem watcher
    if (fileSystemWatcher) {
      fileSystemWatcher.stop();
      logger.info("Filesystem watcher stopped");
    }

    // Disconnect socket client
    if (socketClient) {
      socketClient.disconnect();
      logger.info("Socket client disconnected");
    }

    // Kill all running processes
    commandService.killAllProcesses();

    // Persist terminal buffer
    try {
      await terminalBuffer.persist('/tmp/terminal-buffer.json');
      logger.info("Terminal buffer persisted");
    } catch (error) {
      logger.error("Failed to persist terminal buffer", { error });
    }

    // Destroy terminal buffer
    terminalBuffer.destroy();

    // Close server
    server.close(() => {
      logger.info("HTTP server closed");
      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Handle uncaught errors
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", { error });
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled rejection", { reason, promise });
    process.exit(1);
  });

  return server;
}

// Start the server
if (require.main === module) {
  startServer().catch((error) => {
    logger.error("Failed to start server", { error });
    process.exit(1);
  });
}

export { startServer };