import { router as IndexingRouter } from "@/indexing/index";
import { prisma } from "@repo/db";
import { ModelInfos } from "@repo/types";
import cors from "cors";
import express from "express";
import http from "http";
import { ChatService, DEFAULT_MODEL } from "./chat";
import { TaskInitializationEngine } from "./initialization";
import { errorHandler } from "./middleware/error-handler";
import { createSocketServer } from "./socket";
import { getGitHubAccessToken } from "./utils/github-account";
import { updateTaskStatus } from "./utils/task-status";
import { WorkspaceManager } from "./workspace";

const app = express();
const chatService = new ChatService();
const workspaceManager = new WorkspaceManager();
const initializationEngine = new TaskInitializationEngine();

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
app.get("/", (req, res) => {
  res.send("<h1>Hello world</h1>");
});

// Indexing routes
app.use("/api/indexing", IndexingRouter);

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
    const { message, model, userId } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    // Verify task exists
    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    console.log(
      `[TASK_INITIATE] Starting task ${taskId}: ${task.repoUrl}:${task.branch}`
    );

    try {
      // Get user's GitHub access token to validate authentication
      const githubAccessToken = await getGitHubAccessToken(userId);

      if (!githubAccessToken) {
        console.error(
          `[TASK_INITIATE] No GitHub access token found for user ${userId}`
        );

        // Update task status to failed
        await updateTaskStatus(taskId, "FAILED", "INIT");

        return res.status(400).json({
          error: "GitHub access token required",
          details: "Please connect your GitHub account to clone repositories",
        });
      }

      // Update task status to initializing
      await updateTaskStatus(taskId, "INITIALIZING", "INIT");

      // Run initialization steps using userId (token management is handled internally)
      const initSteps = initializationEngine.getDefaultStepsForTask("simple");
      await initializationEngine.initializeTask(taskId, initSteps, userId);

      // Get updated task with workspace info
      const updatedTask = await prisma.task.findUnique({
        where: { id: taskId },
        select: { workspacePath: true, commitSha: true },
      });

      // Update task status to running
      await updateTaskStatus(taskId, "RUNNING", "INIT");

      console.log(`[TASK_INITIATE] Successfully initialized task ${taskId}`);

      // Process the message with the agent using the task workspace
      // Skip saving user message since it's already saved in the server action
      await chatService.processUserMessage({
        taskId,
        userMessage: message,
        llmModel: model || DEFAULT_MODEL,
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

      // Update task status to failed with specific error message
      await updateTaskStatus(taskId, "FAILED", "INIT");

      // Update description if it's an auth error
      if (
        initError instanceof Error &&
        initError.message.includes("authentication")
      ) {
        await prisma.task.update({
          where: { id: taskId },
          data: {
            description: `${task.description}\n\nError: ${initError.message}`,
          },
        });
      }

      // Return appropriate error response
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
    const availableModels = chatService.getAvailableModels();
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
app.post("/api/tasks/:taskId/cleanup", async (req, res) => {
  try {
    const { taskId } = req.params;

    // Verify task exists
    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    console.log(`[TASK_CLEANUP] Cleaning up workspace for task ${taskId}`);

    // Clean up workspace
    await workspaceManager.cleanupTaskWorkspace(taskId);

    // Update task to mark workspace as cleaned up
    await prisma.task.update({
      where: { id: taskId },
      data: { workspaceCleanedUp: true },
    });

    res.json({ status: "cleaned" });
  } catch (error) {
    console.error("Error cleaning up task:", error);
    res.status(500).json({ error: "Failed to cleanup task" });
  }
});

app.use(errorHandler);

export { app, socketIOServer };
