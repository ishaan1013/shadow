import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { config } from "../config";
import { logger } from "../utils/logger";
import { WorkspaceStatusResponse } from "@repo/types";

const execAsync = promisify(exec);

export class WorkspaceService {
  private workspaceDir: string;

  constructor() {
    this.workspaceDir = config.workspaceDir;
  }

  /**
   * Get the workspace directory path
   */
  getWorkspacePath(): string {
    return this.workspaceDir;
  }

  /**
   * Ensure the workspace directory exists
   */
  async ensureWorkspace(): Promise<void> {
    try {
      await fs.access(this.workspaceDir);
    } catch {
      logger.info(`Creating workspace directory: ${this.workspaceDir}`);
      await fs.mkdir(this.workspaceDir, { recursive: true });
    }
  }

  /**
   * Get workspace status
   */
  async getStatus(): Promise<WorkspaceStatusResponse> {
    try {
      const stats = await fs.stat(this.workspaceDir);

      // Get workspace size using du command
      let sizeBytes = 0;
      try {
        const { stdout } = await execAsync("du -sb .", { cwd: this.workspaceDir });
        const match = stdout.match(/^(\d+)/);
        sizeBytes = match?.[1] ? parseInt(match[1], 10) : 0;
      } catch (error) {
        logger.warn("Failed to get workspace size", { error });
      }

      return {
        success: true,
        exists: true,
        path: this.workspaceDir,
        isReady: stats.isDirectory(),
        sizeBytes,
      };
    } catch (error) {
      return {
        success: false,
        exists: false,
        path: this.workspaceDir,
        isReady: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Resolve a relative path to an absolute workspace path
   */
  resolvePath(relativePath: string): string {
    // Remove leading slash if present
    const cleanPath = relativePath.startsWith("/")
      ? relativePath.slice(1)
      : relativePath;

    // Resolve and normalize the path
    const resolvedPath = path.resolve(this.workspaceDir, cleanPath);

    // Security check: ensure path is within workspace directory
    // Use path.relative() to detect traversal attempts, including via symlinks
    const relativeToWorkspace = path.relative(this.workspaceDir, resolvedPath);
    if (relativeToWorkspace.startsWith('..') || path.isAbsolute(relativeToWorkspace)) {
      throw new Error("Path traversal detected");
    }

    return resolvedPath;
  }

  /**
   * Check if a path exists within the workspace
   */
  async pathExists(relativePath: string): Promise<boolean> {
    try {
      const fullPath = this.resolvePath(relativePath);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the workspace root directory
   */
  getWorkspaceDir(): string {
    return this.workspaceDir;
  }
}

export default WorkspaceService;