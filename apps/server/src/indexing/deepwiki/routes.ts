import express from "express";
import { LocalWorkspaceManager } from "@/execution/local/local-workspace-manager";
import { runDeepWiki } from "./core";
import { CodebaseUnderstandingStorage } from "./db-storage";
import fs from "fs";
import { db } from "@repo/db";
import { ModelType } from "@repo/types";
import { parseApiKeysFromCookies } from "@/utils/cookie-parser";

const deepwikiRouter = express.Router();

/**
 * Generate codebase understanding summary for a task
 * POST /api/indexing/deepwiki/generate/:taskId
 */
deepwikiRouter.post("/generate/:taskId", async (req, res, next) => {
  const { taskId } = req.params;
  const { forceRefresh = false, model, modelMini } = req.body;

  try {
    // Extract API keys from cookies
    const userApiKeys = parseApiKeysFromCookies(req.headers.cookie);

    if (!userApiKeys.openai && !userApiKeys.anthropic) {
      return res.status(400).json({
        error:
          "No API keys found. Please configure your OpenAI or Anthropic API key in settings.",
      });
    }
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
        error: "Workspace directory not found. Task may not be initialized.",
      });
    }

    console.log(`[DEEP-WIKI] Analyzing workspace directly: ${workspaceDir}`);

    // Run deep wiki analysis directly on workspace
    const result = await runDeepWiki(
      workspaceDir,
      taskId,
      task.repoFullName,
      task.repoUrl,
      task.userId,
      userApiKeys,
      {
        concurrency: 12,
        model: model as ModelType,
        modelMini: modelMini as ModelType,
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

export { deepwikiRouter };
