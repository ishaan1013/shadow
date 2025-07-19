import { prisma } from "@repo/db";
import { ModelInfos } from "@repo/types";
import cors from "cors";
import express from "express";
import http from "http";
import { ChatService } from "./chat";
import { errorHandler } from "./middleware/error-handler";
import { GitHubCloneService } from "./services/github-clone";
import { createSocketServer, emitCloneProgress } from "./socket";
import { router as IndexingRouter } from "@/indexing/index";

const app = express();
const chatService = new ChatService();

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

// Initiate task with agent
app.post("/api/tasks/:taskId/initiate", async (req, res) => {
  try {
    const { taskId } = req.params;
    const { message, model } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    // Verify task exists and get task details
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        user: {
          include: {
            accounts: {
              where: { providerId: "github" },
            },
          },
        },
      },
    });

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    // Check if task has a GitHub repository to clone
    if (task.repoUrl && task.repoUrl !== "") {
      // Update task status to initializing
      await prisma.task.update({
        where: { id: taskId },
        data: { status: "INITIALIZING" },
      });

      // Get GitHub access token
      const githubAccount = task.user.accounts.find(
        (account) => account.providerId === "github"
      );

      if (!githubAccount?.accessToken) {
        return res.status(400).json({ 
          error: "GitHub account not connected or access token not available" 
        });
      }

      try {
        // Clone the repository
        const cloneService = new GitHubCloneService(githubAccount.accessToken);
        
        // Check if already cloned
        const isAlreadyCloned = await cloneService.isRepositoryCloned(taskId, task.repoUrl);
        
        if (!isAlreadyCloned) {
          console.log(`[TASK_INIT] Cloning repository for task ${taskId}: ${task.repoUrl} (${task.branch})`);
          
          await cloneService.cloneRepository({
            repoUrl: task.repoUrl,
            branch: task.branch,
            taskId,
            accessToken: githubAccount.accessToken,
          }, (progress) => {
            // Stream clone progress to frontend
            emitCloneProgress(taskId, progress);
          });
        } else {
          console.log(`[TASK_INIT] Repository already cloned for task ${taskId}`);
          emitCloneProgress(taskId, {
            status: "completed",
            message: "Repository already available",
            progress: 100,
          });
        }

        // Update task status to running
        await prisma.task.update({
          where: { id: taskId },
          data: { status: "RUNNING" },
        });

      } catch (cloneError) {
        console.error("Error cloning repository:", cloneError);
        
        // Update task status to failed
        await prisma.task.update({
          where: { id: taskId },
          data: { status: "FAILED" },
        });
        
        return res.status(500).json({ 
          error: `Failed to clone repository: ${cloneError instanceof Error ? cloneError.message : "Unknown error"}` 
        });
      }
    }

    // Process the message with the agent (this will start the LLM processing)
    // Skip saving user message since it's already saved in the server action
    await chatService.processUserMessage({
      taskId,
      userMessage: message,
      llmModel: model || "gpt-4o",
      enableTools: true,
      skipUserMessageSave: true,
    });

    res.json({ status: "initiated" });
  } catch (error) {
    console.error("Error initiating task:", error);
    res.status(500).json({ error: "Failed to initiate task" });
  }
});

// Test clone functionality (development endpoint)
app.post("/api/test-clone", async (req, res) => {
  try {
    const { repoUrl, branch, accessToken } = req.body;
    
    if (!repoUrl || !branch || !accessToken) {
      return res.status(400).json({ 
        error: "repoUrl, branch, and accessToken are required" 
      });
    }

    const testTaskId = `test-${Date.now()}`;
    const cloneService = new GitHubCloneService(accessToken);
    
    const clonedPath = await cloneService.cloneRepository({
      repoUrl,
      branch,
      taskId: testTaskId,
      accessToken,
    }, (progress) => {
      console.log(`Test clone progress: ${progress.message}`);
    });

    res.json({ 
      success: true, 
      clonedPath,
      message: `Successfully cloned ${repoUrl} (${branch}) to ${clonedPath}` 
    });
  } catch (error) {
    console.error("Test clone error:", error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : "Unknown error" 
    });
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

app.use(errorHandler);

export { app, socketIOServer };
