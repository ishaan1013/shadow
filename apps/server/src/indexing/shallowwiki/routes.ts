import express from "express";
import { LocalWorkspaceManager } from "@/execution/local/local-workspace-manager";
import { runShallowWiki } from "./core";
import { CodebaseUnderstandingStorage } from "./db-storage";
import fs from "fs";
import { db } from "@repo/db";

const shallowwikiRouter = express.Router();

/**
 * Generate codebase understanding summary for a task
 * POST /api/indexing/shallowwiki/generate/:taskId
 */
shallowwikiRouter.post("/generate/:taskId", async (req, res, next) => {
  const { taskId } = req.params;
  const { forceRefresh = false } = req.body;

  try {
    // Get task details
    const task = await db.task.findUnique({
      where: { id: taskId },
      include: { codebaseUnderstanding: true },
    });

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    // Check if summary already exists and no force refresh
    const storage = new CodebaseUnderstandingStorage(taskId);
    const hasExisting = await storage.hasExistingSummary();
    
    if (hasExisting && !forceRefresh) {
      return res.json({
        message: "Summary already exists. Use forceRefresh=true to regenerate.",
        taskId,
        codebaseUnderstandingId: task.codebaseUnderstanding?.id,
      });
    }

    // Get the workspace directory directly
    const workspaceManager = new LocalWorkspaceManager();
    const workspaceDir = workspaceManager.getWorkspacePath(taskId);

    if (!fs.existsSync(workspaceDir)) {
      return res.status(404).json({ 
        error: "Workspace directory not found. Task may not be initialized." 
      });
    }

    console.log(`[SHALLOW-WIKI] Analyzing workspace directly: ${workspaceDir}`);

    // Run shallow wiki analysis directly on workspace
    const result = await runShallowWiki(
      workspaceDir,
      taskId,
      task.repoFullName,
      task.repoUrl,
      task.userId,
      {
        concurrency: 12,
        model: "gpt-4o",
        modelMini: "gpt-4o-mini",
      }
    );

    res.json({
      message: "Summary generated successfully",
      taskId,
      codebaseUnderstandingId: result.codebaseUnderstandingId,
      stats: result.stats,
    });
  } catch (error) {
    console.error("Error generating summary:", error);
    next(error);
  }
});

export { shallowwikiRouter };
