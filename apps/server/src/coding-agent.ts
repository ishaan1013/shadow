import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { ChatService } from "./chat";
import { prisma } from "../../../packages/db/src/client";

export class CodingAgentController {
  private chatService: ChatService;

  constructor() {
    this.chatService = new ChatService();
  }

  // Create a new coding task
  async createTask(req: Request, res: Response) {
    try {
          const { title, description, instructions, llmModel = "claude-3-5-sonnet-20241022" } = req.body;

    if (!title || !description || !instructions) {
      return res.status(400).json({
        error: "Missing required fields: title, description, instructions",
      });
    }

    // Create task in database
    const task = await prisma.task.create({
      data: {
        id: randomUUID(),
        title,
        description,
        status: "PENDING",
        llmModel,
        repoUrl: "",
        branch: "main",
        instructions,
        userId: "default-user", // For testing purposes
      },
    });

      res.json({
        taskId: task.id,
        message: "Task created successfully. Use /api/coding-agent/execute to start execution.",
      });
    } catch (error) {
      console.error("Error creating task:", error);
      res.status(500).json({ error: "Failed to create task" });
    }
  }

  // Execute a coding task
  async executeTask(req: Request, res: Response) {
    try {
      const { taskId, message } = req.body;

      if (!taskId || !message) {
        return res.status(400).json({
          error: "Missing required fields: taskId, message",
        });
      }

      // Check if task exists
      const task = await prisma.task.findUnique({
        where: { id: taskId },
      });

      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }

      // Update task status to running
      await prisma.task.update({
        where: { id: taskId },
        data: { status: "RUNNING" },
      });

      // Process the message asynchronously (don't await)
      this.chatService.processUserMessage(taskId, message, task.llmModel as any, true)
        .then(() => {
          console.log(`Task ${taskId} completed successfully`);
          // Update task status to completed
          return prisma.task.update({
            where: { id: taskId },
            data: { status: "COMPLETED" },
          });
        })
        .catch((error) => {
          console.error(`Task ${taskId} failed:`, error);
          // Update task status to failed
          return prisma.task.update({
            where: { id: taskId },
            data: { status: "FAILED" },
          });
        });

      res.json({
        message: "Task execution started. Monitor progress via websocket or chat history endpoint.",
      });
    } catch (error) {
      console.error("Error executing task:", error);
      res.status(500).json({ error: "Failed to execute task" });
    }
  }

  // Get available tools
  async getAvailableTools(req: Request, res: Response) {
    try {
      const tools = this.chatService.getAvailableTools();
      res.json({ tools });
    } catch (error) {
      console.error("Error getting tools:", error);
      res.status(500).json({ error: "Failed to get available tools" });
    }
  }
}