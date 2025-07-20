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
import { WorkspaceManager } from "./workspace";
import { getGitHubTokenForUser } from "./github";

const app = express();
const chatService = new ChatService();
const workspaceManager = new WorkspaceManager();
const initializationEngine = new TaskInitializationEngine();

const socketIOServer = http.createServer(app);
createSocketServer(socketIOServer);

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Get available models
app.get("/api/models", (req, res) => {
  res.json({
    models: chatService.getAvailableModels().map((model) => ModelInfos[model]),
  });
});

// Get task details
app.get("/api/tasks/:taskId", async (req, res) => {
  try {
    const { taskId } = req.params;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
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

    // Get user's GitHub token
    const githubToken = await getGitHubTokenForUser(userId);
    if (!githubToken) {
      return res.status(400).json({ 
        error: "GitHub token not found. Please connect your GitHub account." 
      });
    }

    console.log(
      `[TASK_INITIATE] Starting task ${taskId}: ${task.repoUrl}:${task.branch}`
    );

    try {
      // Update task status to initializing
      await prisma.task.update({
        where: { id: taskId },
        data: { status: "INITIALIZING" },
      });

      // Run initialization steps with GitHub token
      const initSteps = initializationEngine.getDefaultStepsForTask("simple");
      await initializationEngine.initializeTask(taskId, initSteps, githubToken);

      // Get updated task with workspace info
      const updatedTask = await prisma.task.findUnique({
        where: { id: taskId },
        select: { workspacePath: true, commitSha: true },
      });

      // Update task status to running
      await prisma.task.update({
        where: { id: taskId },
        data: { status: "RUNNING" },
      });

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
        status: "initiated",
        workspacePath: updatedTask?.workspacePath,
        commitSha: updatedTask?.commitSha,
      });
    } catch (initError) {
      console.error(`[TASK_INITIATE] Initialization failed:`, initError);

      // Update task status to failed
      await prisma.task.update({
        where: { id: taskId },
        data: { 
          status: "FAILED",
          initializationStatus: "FAILED"
        },
      });

      // Return more specific error message
      const errorMessage = initError instanceof Error 
        ? initError.message 
        : "Unknown initialization error";

      res.status(500).json({ 
        error: `Task initialization failed: ${errorMessage}` 
      });
    }
  } catch (error) {
    console.error("Error initiating task:", error);
    res.status(500).json({ error: "Failed to initiate task" });
  }
});

// Get chat history for a task
app.get("/api/tasks/:taskId/messages", async (req, res) => {
  try {
    const { taskId } = req.params;

    const messages = await prisma.chatMessage.findMany({
      where: { taskId },
      orderBy: { sequence: "asc" },
    });

    res.json(messages);
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

// Mount indexing routes
app.use("/api/indexing", IndexingRouter);

// Error handling middleware
app.use(errorHandler);

export { app, socketIOServer };
