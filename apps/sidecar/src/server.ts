import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
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
  try {
    logger.info("Starting server initialization...");

    const app = express();
    logger.info("Express app created successfully");

    // Initialize services
    logger.info("Initializing services...");
    const workspaceService = new WorkspaceService();
    const fileService = new FileService(workspaceService);
    const searchService = new SearchService(workspaceService);
    const commandService = new CommandService(workspaceService);
    const gitService = new GitService(workspaceService);
    logger.info("Core services initialized");

    const terminalBuffer = new TerminalBuffer({
      maxSize: 10000,
      maxMemory: 50 * 1024 * 1024, // 50MB
      flushInterval: 60000, // 1 minute
    });
    logger.info("Terminal buffer initialized", {
      maxSize: 10000,
      maxMemory: 52428800,
      flushInterval: 60000,
    });

    // Ensure workspace exists
    logger.info("Ensuring workspace exists...");
    await workspaceService.ensureWorkspace();
    logger.info("Workspace initialized", {
      path: config.workspaceDir,
    });

    // Security middleware
    logger.info("Setting up security middleware...");
    app.use(helmet());
    app.use(
      cors({
        origin: config.corsOrigin,
        credentials: true,
      })
    );

    // Body parsing and compression
    logger.info("Setting up body parsing and compression...");
    app.use(express.json({ limit: "10mb" }));
    app.use(express.urlencoded({ extended: true }));
    app.use(compression());

    // Request logging
    logger.info("Setting up request logging...");
    app.use(requestLogger);

    // API routes - test each router individually
    logger.info("Setting up API routes...");
    
    try {
      logger.info("Adding health router...");
      app.use(createHealthRouter(workspaceService));
      logger.info("Health router added successfully");
      
      logger.info("Adding files router...");
      app.use('/api', createFilesRouter(fileService));
      logger.info("Files router added successfully");
      
      logger.info("Adding search router...");
      app.use('/api', createSearchRouter(searchService));
      logger.info("Search router added successfully");
      
      logger.info("Adding execute router...");
      app.use('/api', createExecuteRouter(commandService, terminalBuffer));
      logger.info("Execute router added successfully");
      
      logger.info("Adding git router...");
      app.use(createGitRouter(gitService));
      logger.info("Git router added successfully");
      
      logger.info("All API routes configured");
    } catch (routerError) {
      logger.error("Router setup failed", {
        error: routerError instanceof Error ? routerError.message : String(routerError),
        stack: routerError instanceof Error ? routerError.stack : "No stack trace",
      });
      throw routerError;
    }

    // 404 handler
    app.use((req, res) => {
      res.status(404).json({
        error: "NOT_FOUND",
        message: `Route ${req.method} ${req.path} not found`,
      });
    });

    // Error handling (must be last)
    app.use(errorHandler);

    // Start server with explicit error handling
    let server;
    try {
      server = app.listen(config.port, () => {
        logger.info("Sidecar service started", {
          port: config.port,
          environment: config.nodeEnv,
          workspace: config.workspaceDir,
        });
      });

      // Handle server startup errors
      server.on("error", (err: Error) => {
        logger.error("Server startup error", {
          error: err.message,
          stack: err.stack,
          port: config.port,
        });
        process.exit(1);
      });
    } catch (error) {
      logger.error("Failed to start server", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : "No stack trace",
        port: config.port,
      });
      process.exit(1);
    }

    // Initialize filesystem watching (only if environment variables are provided)
    let fileSystemWatcher: FileSystemWatcher | null = null;
    let socketClient: SocketClient | null = null;

    const taskId = process.env.TASK_ID;
    const serverUrl = process.env.SHADOW_SERVER_URL;
    const filesystemWatchEnabled =
      process.env.FILESYSTEM_WATCH_ENABLED !== "false";

    if (taskId && serverUrl && filesystemWatchEnabled) {
      try {
        logger.info("Initializing filesystem watcher", {
          taskId,
          serverUrl,
          workspaceDir: config.workspaceDir,
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
        filesystemWatchEnabled,
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

      // Destroy terminal buffer
      terminalBuffer.destroy();

      // Close server
      if (server) {
        server.close(() => {
          logger.info("HTTP server closed");
          process.exit(0);
        });
      } else {
        logger.warn("Server was not initialized, exiting immediately");
        process.exit(0);
      }

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
  } catch (initError) {
    logger.error("Server initialization failed", {
      error: initError instanceof Error ? initError.message : String(initError),
      stack: initError instanceof Error ? initError.stack : "No stack trace",
    });
    throw initError;
  }
}

// Start the server
if (require.main === module) {
  startServer().catch((error) => {
    logger.error("Failed to start server", { error });
    process.exit(1);
  });
}

export { startServer };
