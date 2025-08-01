import { Request, Response } from "express";
import { ContextManager } from "../services/context-manager";
import { ModelType } from "@repo/types";
import { prisma } from "@repo/db";

const contextManager = new ContextManager();

// Get the model currently being used for a task by looking at the most recent message
async function getTaskModel(taskId: string): Promise<ModelType> {
  const latestMessage = await prisma.chatMessage.findFirst({
    where: { taskId },
    orderBy: [
      { sequence: "desc" },
      { createdAt: "desc" }
    ],
    select: { llmModel: true }
  });
  
  return (latestMessage?.llmModel as ModelType) || "gpt-4o"; // fallback to gpt-4o
}

// GET /api/context/usage/:taskId - Get context usage statistics for a task
export async function getContextUsage(req: Request, res: Response) {
  try {
    const { taskId } = req.params;
    const { model } = req.query;

    if (!taskId) {
      return res.status(400).json({ error: "Task ID is required" });
    }

    // Use provided model or fallback to task's current model
    const resolvedModel = (model as ModelType) || await getTaskModel(taskId);

    const stats = await contextManager.getContextUsageStats(
      taskId,
      resolvedModel
    );

    res.json(stats);
  } catch (error) {
    console.error("Error getting context usage:", error);
    res.status(500).json({
      error: "Failed to get context usage statistics",
    });
  }
}
