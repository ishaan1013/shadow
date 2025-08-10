import { router as IndexingRouter } from "@/indexing/index";
import { prisma } from "@repo/db";
import { AvailableModels, ModelType } from "@repo/types";
import cors from "cors";
import express from "express";
import http from "http";
import { z } from "zod";
import config, { getCorsOrigins } from "./config";
import { ChatService } from "./agent/chat";
import { TaskInitializationEngine } from "./initialization";
import { errorHandler } from "./middleware/error-handler";
import { apiKeyAuth } from "./middleware/api-key-auth";
import { createSocketServer } from "./socket";
import { getGitHubAccessToken } from "./github/auth/account-service";
import { updateTaskStatus } from "./utils/task-status";
import { hasReachedTaskLimit } from "./services/task-limit";
import { createWorkspaceManager } from "./execution";
import { filesRouter } from "./files/router";
import { handleGitHubWebhook } from "./webhooks/github-webhook";
import { getIndexingStatus } from "./routes/indexing-status";
import { modelContextService } from "./services/model-context-service";

const app = express();
export const chatService = new ChatService();
const initializationEngine = new TaskInitializationEngine();

const initiateTaskSchema = z.object({
  message: z.string().min(1, "Message is required"),
  model: z.enum(Object.values(AvailableModels) as [string, ...string[]], {
    errorMap: () => ({ message: "Invalid model type" }),
  }),
  userId: z.string().min(1, "User ID is required"),
});

const socketIOServer = http.createServer(app);
createSocketServer(socketIOServer);

const corsOrigins = getCorsOrigins(config);

console.log(`[CORS] Allowing origins:`, corsOrigins);

app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);

// Special raw body handling for webhook endpoints (before JSON parsing)
app.use("/api/webhooks", express.raw({ type: "application/json" }));

app.use(express.json());

// API key authentication for protected routes
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/webhooks")) {
    return next();
  }
  return apiKeyAuth(req, res, next);
});

/* ROUTES */
app.get("/", (_req, res) => {
  res.send("<h1>Hello world</h1>");
});

app.get("/health", (_req, res) => {
  res
    .status(200)
    .json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Indexing routes
app.use("/api/indexing", IndexingRouter);

// Files routes
app.use("/api/tasks", filesRouter);

// GitHub webhook endpoint
app.post("/api/webhooks/github/pull-request", handleGitHubWebhook);

// Indexing status endpoint
app.get("/api/indexing-status/:repoFullName", async (req, res) => {
  try {
    const { repoFullName } = req.params;
    const decodedRepoFullName = decodeURIComponent(repoFullName);
    const status = await getIndexingStatus(decodedRepoFullName);
    res.json(status);
  } catch (error) {
    console.error("Error fetching indexing status:", error);
    res.status(500).json({ error: "Failed to fetch indexing status" });
  }
});

// Get task details
app.get("/api/tasks/:taskId", async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json(task);
  } catch (error) {
    console.error("Error fetching task:", error);
    res.status(500).json({ error: "Failed to fetch task" });
  }
});

// Initiate task with agent using new initialization system
app.post("/api/tasks/:taskId/initiate", async (req, res) => {
  try {
    console.log("RECEIVED TASK INITIATE REQUEST: /api/tasks/:taskId/initiate");
    const { taskId } = req.params;

    // Validate request body with Zod
    const validation = initiateTaskSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: validation.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const { message, model, userId } = validation.data;

    // Check task limit before processing (production only)
    const isAtLimit = await hasReachedTaskLimit(userId);
    if (isAtLimit) {
      return res.status(429).json({
        error: "Task limit reached",
        message:
          "You have reached the maximum number of active tasks. Please complete or archive existing tasks to create new ones.",
      });
    }

    // Verify task exists
    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    console.log(
      `[TASK_INITIATE] Starting task ${taskId}: ${task.repoUrl}:${task.baseBranch || "unknown"}`
    );

    try {
      const githubAccessToken = await getGitHubAccessToken(userId);

      if (!githubAccessToken) {
        console.error(
          `[TASK_INITIATE] No GitHub access token found for user ${userId}`
        );

        await updateTaskStatus(taskId, "FAILED", "INIT");

        return res.status(400).json({
          error: "GitHub access token required",
          details: "Please connect your GitHub account to clone repositories",
        });
      }

      const initContext = await modelContextService.createContext(
        taskId,
        req.headers.cookie,
        model as ModelType
      );

      if (!initContext.validateAccess()) {
        const provider = initContext.getProvider();
        const providerName =
          provider === "anthropic"
            ? "Anthropic"
            : provider === "openrouter"
              ? "OpenRouter"
              : "OpenAI";

        await updateTaskStatus(taskId, "FAILED", "INIT");

        return res.status(400).json({
          error: `${providerName} API key required`,
          details: `Please configure your ${providerName} API key in settings to use ${model}.`,
        });
      }

      await updateTaskStatus(taskId, "INITIALIZING", "INIT");
      console.log(
        `⏳ [TASK_INITIATE] Task ${taskId} status set to INITIALIZING - starting initialization...`
      );

      const initSteps =
        await initializationEngine.getDefaultStepsForTask(userId);
      await initializationEngine.initializeTask(
        taskId,
        initSteps,
        userId,
        initContext
      );

      // Get updated task with workspace info
      const updatedTask = await prisma.task.findUnique({
        where: { id: taskId },
        select: { workspacePath: true },
      });

      // Update task status to running
      await updateTaskStatus(taskId, "RUNNING", "INIT");

      console.log(
        `🚀 [TASK_INITIATE] Task ${taskId} status changed: INITIALIZING → RUNNING`
      );
      console.log(`[TASK_INITIATE] Successfully initialized task ${taskId}`);

      // Process the message with the agent using the task workspace
      // Skip saving user message since it's already saved in the server action

      console.log("\n\n[TASK_INITIATE] PROCESSING USER MESSAGE\n\n");

      await chatService.processUserMessage({
        taskId,
        userMessage: message,
        context: initContext,
        enableTools: true,
        skipUserMessageSave: true,
        workspacePath: updatedTask?.workspacePath || undefined,
      });

      res.json({
        success: true,
        message: "Task initiated successfully",
      });
    } catch (initError) {
      console.error(
        `[TASK_INITIATE] Initialization failed for task ${taskId}:`,
        initError
      );
      console.log(
        `❌ [TASK_INITIATE] Task ${taskId} initialization failed - setting status to FAILED`
      );

      await updateTaskStatus(taskId, "FAILED", "INIT");

      if (
        initError instanceof Error &&
        (initError.message.includes("authentication") ||
          initError.message.includes("access token") ||
          initError.message.includes("refresh"))
      ) {
        return res.status(401).json({
          error: "GitHub authentication failed",
          details: "Please reconnect your GitHub account and try again",
        });
      }

      return res.status(500).json({
        error: "Task initialization failed",
        details:
          initError instanceof Error ? initError.message : "Unknown error",
      });
    }
  } catch (error) {
    console.error("Error initiating task:", error);
    res.status(500).json({ error: "Failed to initiate task" });
  }
});


// Get chat messages for a task
app.get("/api/tasks/:taskId/messages", async (req, res) => {
  try {
    const { taskId } = req.params;
    const messages = await chatService.getChatHistory(taskId);
    res.json({ messages });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// Cleanup workspace for a task
app.delete("/api/tasks/:taskId/cleanup", async (req, res) => {
  try {
    const { taskId } = req.params;

    console.log(`[TASK_CLEANUP] Starting cleanup for task ${taskId}`);

    // Verify task exists and get current status
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        workspacePath: true,
        workspaceCleanedUp: true,
        repoUrl: true,
      },
    });

    if (!task) {
      console.warn(`[TASK_CLEANUP] Task ${taskId} not found`);
      return res.status(404).json({
        success: false,
        error: "Task not found",
      });
    }

    // Check if already cleaned up
    if (task.workspaceCleanedUp) {
      console.log(`[TASK_CLEANUP] Task ${taskId} workspace already cleaned up`);
      return res.json({
        success: true,
        message: "Workspace already cleaned up",
        alreadyCleanedUp: true,
        task: {
          id: taskId,
          status: task.status,
          workspaceCleanedUp: true,
        },
      });
    }

    // Create workspace manager using abstraction layer
    const workspaceManager = createWorkspaceManager();

    console.log(
      `[TASK_CLEANUP] Cleaning up workspace for task ${taskId} using ${workspaceManager.isRemote() ? "remote" : "local"} mode`
    );

    // Perform cleanup
    const cleanupResult = await workspaceManager.cleanupWorkspace(taskId);

    if (!cleanupResult.success) {
      console.error(
        `[TASK_CLEANUP] Cleanup failed for task ${taskId}:`,
        cleanupResult.message
      );
      return res.status(500).json({
        success: false,
        error: "Workspace cleanup failed",
        details: cleanupResult.message,
      });
    }

    // Update task to mark workspace as cleaned up
    await prisma.task.update({
      where: { id: taskId },
      data: { workspaceCleanedUp: true },
    });

    console.log(
      `[TASK_CLEANUP] Successfully cleaned up workspace for task ${taskId}`
    );

    res.json({
      success: true,
      message: cleanupResult.message,
      task: {
        id: taskId,
        status: task.status,
        workspaceCleanedUp: true,
      },
      cleanupDetails: {
        mode: workspaceManager.isRemote() ? "remote" : "local",
        workspacePath: task.workspacePath,
      },
    });
  } catch (error) {
    console.error(
      `[TASK_CLEANUP] Error cleaning up task ${req.params.taskId}:`,
      error
    );
    res.status(500).json({
      success: false,
      error: "Failed to cleanup task",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Create PR for a task
app.post("/api/tasks/:taskId/pull-request", async (req, res) => {
  try {
    const { taskId } = req.params;
    const { userId } = req.body;

    console.log(`[PR_CREATION] Creating PR for task ${taskId}`);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        userId: true,
        repoFullName: true,
        shadowBranch: true,
        baseBranch: true,
        title: true,
        status: true,
        repoUrl: true,
        pullRequestNumber: true,
        workspacePath: true,
      },
    });

    if (!task) {
      console.warn(`[PR_CREATION] Task ${taskId} not found`);
      return res.status(404).json({
        success: false,
        error: "Task not found",
      });
    }

    if (task.userId !== userId) {
      console.warn(`[PR_CREATION] User ${userId} does not own task ${taskId}`);
      return res.status(403).json({
        success: false,
        error: "Unauthorized",
      });
    }

    if (task.pullRequestNumber) {
      console.log(
        `[PR_CREATION] Task ${taskId} already has PR #${task.pullRequestNumber}`
      );
      return res.json({
        success: true,
        prNumber: task.pullRequestNumber,
        prUrl: `${task.repoUrl}/pull/${task.pullRequestNumber}`,
        message: "Pull request already exists",
      });
    }

    // Find the most recent assistant message for this task
    const latestAssistantMessage = await prisma.chatMessage.findFirst({
      where: {
        taskId,
        role: "ASSISTANT",
      },
      orderBy: {
        sequence: "desc",
      },
      select: {
        id: true,
      },
    });

    if (!latestAssistantMessage) {
      console.warn(
        `[PR_CREATION] No assistant messages found for task ${taskId}`
      );
      return res.status(400).json({
        success: false,
        error:
          "No assistant messages found. Cannot create PR without agent responses.",
      });
    }

    // Get or refresh model context for PR creation
    const modelContext = await modelContextService.refreshContext(
      taskId,
      req.headers.cookie
    );

    if (modelContext) {
      await chatService.createPRIfNeeded(
        taskId,
        task.workspacePath || undefined,
        latestAssistantMessage.id,
        modelContext
      );
    } else {
      // Fallback if context unavailable
      await chatService.createPRIfNeeded(
        taskId,
        task.workspacePath || undefined,
        latestAssistantMessage.id
      );
    }

    const updatedTask = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        pullRequestNumber: true,
        repoUrl: true,
      },
    });

    if (!updatedTask?.pullRequestNumber) {
      throw new Error("PR creation completed but no PR number found");
    }

    console.log(
      `[PR_CREATION] Successfully created PR #${updatedTask.pullRequestNumber} for task ${taskId}`
    );

    res.json({
      success: true,
      prNumber: updatedTask.pullRequestNumber,
      prUrl: `${updatedTask.repoUrl}/pull/${updatedTask.pullRequestNumber}`,
      messageId: latestAssistantMessage.id,
    });
  } catch (error) {
    console.error(
      `[PR_CREATION] Error creating PR for task ${req.params.taskId}:`,
      error
    );
    res.status(500).json({
      success: false,
      error: "Failed to create pull request",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.use(errorHandler);

export { app, socketIOServer };
