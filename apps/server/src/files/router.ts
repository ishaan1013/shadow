import { Router } from "express";
import { prisma } from "@repo/db";
import { FILE_SIZE_LIMITS } from "@repo/types";
import { createWorkspaceManager, createGitService } from "../execution";
import { getGitHubFileChanges } from "../utils/github-file-changes";
import { buildFileTree } from "./build-tree";

const router = Router();

// Get file tree for a variant workspace
router.get("/:taskId/:variantId/files/tree", async (req, res) => {
  try {
    const { taskId, variantId } = req.params;

    // Get the specific variant and verify it belongs to the task
    const variant = await prisma.variant.findUnique({
      where: { id: variantId },
      select: {
        id: true,
        workspacePath: true,
        initStatus: true,
        task: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!variant || variant.task.id !== taskId) {
      return res.status(404).json({
        success: false,
        error: "Variant not found or does not belong to the specified task",
      });
    }

    if (
      !variant.workspacePath ||
      variant.task.status === "INITIALIZING" ||
      variant.initStatus === "PREPARE_WORKSPACE" ||
      variant.initStatus === "CREATE_VM" ||
      variant.initStatus === "WAIT_VM_READY"
    ) {
      return res.json({
        success: true,
        tree: [],
      });
    }

    const workspaceManager = createWorkspaceManager();
    const executor = await workspaceManager.getExecutor(taskId);

    const tree = await buildFileTree(executor);

    res.json({
      success: true,
      tree,
    });
  } catch (error) {
    console.error("[FILE_TREE_API_ERROR]", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Get file content for a variant workspace
router.get("/:taskId/:variantId/files/content", async (req, res) => {
  try {
    const { taskId, variantId } = req.params;
    const filePath = req.query.path as string;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: "File path is required",
      });
    }

    // Get the specific variant and verify it belongs to the task
    const variant = await prisma.variant.findUnique({
      where: { id: variantId },
      select: {
        id: true,
        workspacePath: true,
        initStatus: true,
        task: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!variant || variant.task.id !== taskId) {
      return res.status(404).json({
        success: false,
        error: "Variant not found or does not belong to the specified task",
      });
    }

    // Check if workspace is ready
    if (
      !variant.workspacePath ||
      variant.task.status === "INITIALIZING" ||
      variant.initStatus === "PREPARE_WORKSPACE" ||
      variant.initStatus === "CREATE_VM" ||
      variant.initStatus === "WAIT_VM_READY"
    ) {
      return res.status(400).json({
        success: false,
        error: "Workspace is still initializing",
      });
    }

    // Convert path: remove leading slash and handle relative paths
    const targetPath = filePath.startsWith("/") ? filePath.slice(1) : filePath;

    // 1. Get file stats and check size
    const workspaceManager = createWorkspaceManager();
    const executor = await workspaceManager.getExecutor(taskId);
    const statsResult = await executor.getFileStats(targetPath);

    if (!statsResult.success) {
      // Check if it's a file not found error (ENOENT)
      const isFileNotFound =
        statsResult.error?.includes("ENOENT") ||
        statsResult.error?.includes("no such file or directory");

      return res.status(isFileNotFound ? 404 : 400).json({
        success: false,
        error: statsResult.error || "Failed to get file stats",
        errorType: isFileNotFound ? "FILE_NOT_FOUND" : "UNKNOWN",
      });
    }

    if (!statsResult.stats?.isFile) {
      return res.status(400).json({
        success: false,
        error: "Path is not a file",
      });
    }

    // 2. Check size limit
    if (statsResult.stats.size > FILE_SIZE_LIMITS.MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({
        success: false,
        error: `File too large: ${statsResult.stats.size} bytes (max: ${FILE_SIZE_LIMITS.MAX_FILE_SIZE_BYTES} bytes)`,
      });
    }

    // 3. Read the file (any file type allowed)
    const result = await executor.readFile(targetPath);

    if (!result.success || !result.content) {
      return res.status(400).json({
        success: false,
        error: result.error || "Failed to read file",
      });
    }

    res.json({
      success: true,
      content: result.content,
      path: filePath,
      size: statsResult.stats.size,
      truncated: false,
    });
  } catch (error) {
    console.error("[FILE_CONTENT_API_ERROR]", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// GET /api/tasks/:taskId/:variantId/file-changes - Get git-based file changes
router.get("/:taskId/:variantId/file-changes", async (req, res) => {
  const startTime = Date.now();
  try {
    const { taskId, variantId } = req.params;

    // Get the specific variant with task info
    const variant = await prisma.variant.findUnique({
      where: { id: variantId },
      select: {
        id: true,
        workspacePath: true,
        shadowBranch: true,
        initStatus: true,
        task: {
          select: {
            id: true,
            status: true,
            baseBranch: true,
            repoFullName: true,
            userId: true,
          },
        },
      },
    });

    if (!variant || variant.task.id !== taskId) {
      return res.status(404).json({
        success: false,
        error: "Variant not found or does not belong to the specified task",
      });
    }

    // Don't return file changes if task is still initializing
    if (
      variant.task.status === "INITIALIZING" ||
      variant.initStatus === "PREPARE_WORKSPACE" ||
      variant.initStatus === "CREATE_VM" ||
      variant.initStatus === "WAIT_VM_READY"
    ) {
      return res.json({
        success: true,
        fileChanges: [],
        diffStats: { additions: 0, deletions: 0, totalFiles: 0 },
      });
    }

    // If variant workspace is INACTIVE (cleaned up), use GitHub API
    if (variant.initStatus === "INACTIVE") {
      if (!variant.task.repoFullName || !variant.shadowBranch) {
        return res.json({
          success: true,
          fileChanges: [],
          diffStats: { additions: 0, deletions: 0, totalFiles: 0 },
        });
      }

      const { fileChanges, diffStats } = await getGitHubFileChanges(
        variant.task.repoFullName,
        variant.task.baseBranch,
        variant.shadowBranch,
        variant.task.userId
      );

      return res.json({
        success: true,
        fileChanges,
        diffStats,
      });
    }

    // For ACTIVE tasks, use GitService abstraction (handles both local and remote modes)
    try {
      const gitService = await createGitService(variantId);

      const { fileChanges, diffStats } = await gitService.getFileChanges(
        variant.task.baseBranch
      );

      res.json({
        success: true,
        fileChanges,
        diffStats,
      });
      return;
    } catch (error) {
      console.error(
        `[FILE_CHANGES_DEBUG] GitService error - taskId: ${taskId}:`,
        error
      );

      // Fallback to empty response on error
      res.json({
        success: true,
        fileChanges: [],
        diffStats: { additions: 0, deletions: 0, totalFiles: 0 },
      });
      return;
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(
      `[FILE_CHANGES_DEBUG] Error in file-changes route - taskId: ${req.params.taskId}, duration: ${duration}ms`,
      error
    );
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export { router as filesRouter };
