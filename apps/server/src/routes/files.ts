import { Router } from "express";
import { prisma } from "@repo/db";
import { FILE_SIZE_LIMITS, FileNode } from "@repo/types";
import type { ToolExecutor } from "../execution/interfaces/tool-executor";
import { createToolExecutor } from "../execution";
import { getFileChanges, hasGitRepository } from "../utils/git-operations";

const router = Router();

// Folders to ignore while walking the repository
const IGNORE_DIRS = [
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "build",
];

async function buildFileTree(executor: ToolExecutor, dirPath: string = "."): Promise<FileNode[]> {
  try {
    const listing = await executor.listDirectory(dirPath);

    if (!listing.success) {
      console.error("[FILE_TREE_ERROR]", listing.error);
      return [];
    }

    const nodes: FileNode[] = [];

    for (const item of listing.contents || []) {
      // Skip ignored directories
      if (IGNORE_DIRS.includes(item.name)) continue;

      const itemPath = dirPath === "." ? item.name : `${dirPath}/${item.name}`;
      const displayPath = itemPath.startsWith("./") ? itemPath.slice(1) : `/${itemPath}`;

      if (item.type === "directory") {
        const children = await buildFileTree(executor, itemPath);
        // Only include folders that have children (files or non-empty subfolders)
        if (children.length > 0) {
          nodes.push({
            name: item.name,
            type: "folder",
            path: displayPath,
            children,
          });
        }
      } else {
        nodes.push({
          name: item.name,
          type: "file",
          path: displayPath,
        });
      }
    }

    // Sort: folders first, then files, both alphabetically
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return nodes;
  } catch (error) {
    console.error("[FILE_TREE_BUILD_ERROR]", error);
    return [];
  }
}

// Get file tree for a task workspace  
router.get("/:taskId/files/tree", async (req, res) => {
  try {
    const { taskId } = req.params;

    // Verify task exists
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        workspacePath: true
      },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        error: "Task not found"
      });
    }

    // Check if workspace is still initializing
    if (!task.workspacePath || task.status === "INITIALIZING") {
      return res.json({
        success: true,
        tree: [],
        status: "initializing",
        message: "Workspace is being prepared. Please try again in a moment."
      });
    }

    // Use execution abstraction layer to get file tree
    const executor = createToolExecutor(taskId, task.workspacePath);

    const tree = await buildFileTree(executor);

    res.json({
      success: true,
      tree,
      status: "ready"
    });
  } catch (error) {
    console.error("[FILE_TREE_API_ERROR]", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// Get file content for a task workspace
router.get("/:taskId/files/content", async (req, res) => {
  try {
    const { taskId } = req.params;
    const filePath = req.query.path as string;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: "File path is required"
      });
    }

    // Verify task exists
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        workspacePath: true
      },
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        error: "Task not found"
      });
    }

    // Check if workspace is ready
    if (!task.workspacePath || task.status === "INITIALIZING") {
      return res.status(400).json({
        success: false,
        error: "Workspace is still initializing"
      });
    }

    // Convert path: remove leading slash and handle relative paths
    const targetPath = filePath.startsWith("/") ? filePath.slice(1) : filePath;

    // 1. Get file stats and check size
    const executor = createToolExecutor(taskId, task.workspacePath);
    const statsResult = await executor.getFileStats(targetPath);

    if (!statsResult.success) {
      return res.status(400).json({
        success: false,
        error: statsResult.error || "Failed to get file stats"
      });
    }

    if (!statsResult.stats?.isFile) {
      return res.status(400).json({
        success: false,
        error: "Path is not a file"
      });
    }

    // 2. Check size limit
    if (statsResult.stats.size > FILE_SIZE_LIMITS.MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({
        success: false,
        error: `File too large: ${statsResult.stats.size} bytes (max: ${FILE_SIZE_LIMITS.MAX_FILE_SIZE_BYTES} bytes)`
      });
    }

    // 3. Read the file (any file type allowed)
    const result = await executor.readFile(targetPath);

    if (!result.success || !result.content) {
      return res.status(400).json({
        success: false,
        error: result.error || "Failed to read file"
      });
    }

    res.json({
      success: true,
      content: result.content,
      path: filePath,
      size: statsResult.stats.size,
      truncated: false
    });
  } catch (error) {
    console.error("[FILE_CONTENT_API_ERROR]", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// GET /api/tasks/:taskId/file-changes - Get git-based file changes
router.get('/:taskId/file-changes', async (req, res) => {
  try {
    const { taskId } = req.params;

    // Validate task exists and get full status
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, workspacePath: true, status: true }
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        error: "Task not found"
      });
    }

    // Don't return file changes if task is still initializing
    if (task.status === 'INITIALIZING') {
      return res.json({
        success: true,
        fileChanges: [],
        diffStats: { additions: 0, deletions: 0, totalFiles: 0 }
      });
    }

    // Check if workspace has git repository
    const hasGit = await hasGitRepository(taskId);
    if (!hasGit) {
      return res.json({
        success: true,
        fileChanges: [],
        diffStats: { additions: 0, deletions: 0, totalFiles: 0 }
      });
    }

    const { fileChanges, diffStats } = await getFileChanges(taskId);

    res.json({
      success: true,
      fileChanges,
      diffStats
    });

  } catch (error) {
    console.error("[FILE_CHANGES_API_ERROR]", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

export { router as filesRouter };