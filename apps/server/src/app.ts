import { ModelInfos } from "@repo/types";
import cors from "cors";
import express from "express";
import http from "http";
import { prisma } from "../../../packages/db/src/client";
import { ChatService } from "./chat";
import { CodingAgentController } from "./coding-agent";
import { errorHandler } from "./middleware/error-handler";
import { createSocketServer } from "./socket";

const app = express();
const chatService = new ChatService();
const codingAgentController = new CodingAgentController();

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

// Coding Agent routes
app.post("/api/coding-agent/create", (req, res) =>
  codingAgentController.createTask(req, res)
);

app.post("/api/coding-agent/execute", (req, res) =>
  codingAgentController.executeTask(req, res)
);

app.get("/api/coding-agent/tools", (req, res) =>
  codingAgentController.getAvailableTools(req, res)
);

app.use(errorHandler);

export { app, socketIOServer };
