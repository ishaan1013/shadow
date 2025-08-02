import { router as IndexingRouter } from "@/indexing/index";
import { prisma } from "@repo/db";
import { ModelInfos, AvailableModels, ModelType } from "@repo/types";
import cors from "cors";
import express from "express";
import http from "http";
import { z } from "zod";
import { ChatService } from "./chat";
import { TaskInitializationEngine } from "./initialization";
import { errorHandler } from "./middleware/error-handler";
import { createSocketServer } from "./socket";
import { getGitHubAccessToken } from "./github/auth/account-service";
import { updateTaskStatus } from "./utils/task-status";
import { createWorkspaceManager } from "./execution";
import { filesRouter } from "./routes/files";
import { generateIssuePrompt } from "./github/issues";
import { GitHubApiClient } from "./github/github-api";

const app = express();
export const chatService = new ChatService();
const initializationEngine = new TaskInitializationEngine();
const githubApiClient = new GitHubApiClient();

// Helper function to parse API keys from cookies
function parseApiKeysFromCookies(cookieHeader?: string): {
  openai?: string;
  anthropic?: string;
} {
  if (!cookieHeader) {
    console.log("[APP] No cookie header provided to parseApiKeysFromCookies");
    return {};
  }

  console.log(
    `[APP] Parsing cookies from header (length: ${cookieHeader.length})`
  );
  console.log(
    `[APP] Cookie header preview: ${cookieHeader.substring(0, 100)}...`
  );

  const cookies: Record<string, string> = {};
  cookieHeader.split(";").forEach((cookie) => {
    const trimmedCookie = cookie.trim();
    const equalIndex = trimmedCookie.indexOf("=");

    if (equalIndex > 0) {
      const name = trimmedCookie.substring(0, equalIndex);
      const value = trimmedCookie.substring(equalIndex + 1);

      // Log individual cookie parsing for debugging
      if (name === "openai-key" || name === "anthropic-key") {
        console.log(
          `[APP] Parsing cookie "${name}": length=${value.length}, starts with="${value.substring(0, 10)}..."`
        );
      }

      // Only decode if the value contains URL-encoded characters
      // API keys typically don't need decoding, but session tokens might
      cookies[name] = value.includes("%") ? decodeURIComponent(value) : value;
    }
  });

  console.log("[APP] Extracted API keys:", {
    hasOpenAI: !!cookies["openai-key"],
    hasAnthropic: !!cookies["anthropic-key"],
    openaiLength: cookies["openai-key"]?.length || 0,
    anthropicLength: cookies["anthropic-key"]?.length || 0,
  });

  return {
    openai: cookies["openai-key"] || undefined,
    anthropic: cookies["anthropic-key"] || undefined,
  };
}

const initiateTaskSchema = z.object({
  message: z.string().min(1, "Message is required"),
  model: z.enum(Object.values(AvailableModels) as [string, ...string[]], {
    errorMap: () => ({ message: "Invalid model type" }),
  }),
  userId: z.string().min(1, "User ID is required"),
  githubIssueNumber: z.number().optional(),
});

const socketIOServer = http.createServer(app);
createSocketServer(socketIOServer);

app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());

/* ROUTES */
app.get("/", (_req, res) => {
  res.send("<h1>Hello world</h1>");
});

// Indexing routes
app.use("/api/indexing", IndexingRouter);

// Files routes
app.use("/api/tasks", filesRouter);

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

    const { message, model, userId, githubIssueNumber } = validation.data;

    // Verify task exists
    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    // If issue number provided, fetch issue and generate contextualized prompt
    let finalMessage = message;

    if (githubIssueNumber) {
      try {
        const issue = await githubApiClient.getIssue(
          task.repoFullName,
          githubIssueNumber,
          userId
        );
        finalMessage = generateIssuePrompt(issue || undefined);

        console.log(
          `[TASK_INITIATE] ${issue ? "Fetched" : "Could not fetch"} issue #${githubIssueNumber} for contextualized prompt`
        );
      } catch (error) {
        console.warn(
          `[TASK_INITIATE] Failed to fetch issue #${githubIssueNumber}:`,
          error
        );
        finalMessage = generateIssuePrompt();
      }
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

      await updateTaskStatus(taskId, "INITIALIZING", "INIT");

      const initSteps = initializationEngine.getDefaultStepsForTask();
      await initializationEngine.initializeTask(taskId, initSteps, userId);

      // Get updated task with workspace info
      const updatedTask = await prisma.task.findUnique({
        where: { id: taskId },
        select: { workspacePath: true },
      });

      // Update task status to running
      await updateTaskStatus(taskId, "RUNNING", "INIT");

      console.log(`[TASK_INITIATE] Successfully initialized task ${taskId}`);

      // Process the message with the agent using the task workspace
      // Skip saving user message since it's already saved in the server action
      const userApiKeys = parseApiKeysFromCookies(req.headers.cookie);

      // Validate that user has the required API key for the selected model
      const modelProvider = model.includes("claude") ? "anthropic" : "openai";
      if (!userApiKeys[modelProvider]) {
        const providerName =
          modelProvider === "anthropic" ? "Anthropic" : "OpenAI";
        return res.status(400).json({
          error: `${providerName} API key required`,
          details: `Please configure your ${providerName} API key in settings to use ${model}.`,
        });
      }

      console.log("userApiKeys", userApiKeys, "model", model);

      // Update task with GitHub issue number if provided
      if (githubIssueNumber) {
        await prisma.task.update({
          where: { id: taskId },
          data: { githubIssueNumber },
        });
      }

      await chatService.processUserMessage({
        taskId,
        userMessage: finalMessage,
        llmModel: model as ModelType,
        userApiKeys,
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

// Get available models
app.get("/api/models", async (req, res) => {
  try {
    const userApiKeys = parseApiKeysFromCookies(req.headers.cookie);
    const availableModels = chatService.getAvailableModels(userApiKeys);
    const modelsWithInfo = availableModels.map((modelId) => ({
      ...ModelInfos[modelId],
      id: modelId,
    }));

    res.json({ models: modelsWithInfo });
  } catch (error) {
    console.error("Error fetching models:", error);
    res.status(500).json({ error: "Failed to fetch models" });
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

app.use(errorHandler);

export { app, socketIOServer };
