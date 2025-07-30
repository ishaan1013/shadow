import * as fs from "fs/promises";
import * as path from "path";
import { config } from "../config";
import { logger } from "../utils/logger";
import { WorkspaceService } from "./workspace-service";
import {
  FileReadResponse,
  FileWriteResponse,
  SearchReplaceResponse,
  FileDeleteResponse,
  FileStatsResponse,
  DirectoryListResponse,
  DirectoryEntry,
} from "@repo/types";

export class FileService {
  constructor(private workspaceService: WorkspaceService) { }

  /**
   * Read file contents with optional line range
   */
  async readFile(
    relativePath: string,
    shouldReadEntireFile: boolean = true,
    startLine?: number,
    endLine?: number
  ): Promise<FileReadResponse> {
    try {
      const fullPath = this.workspaceService.resolvePath(relativePath);

      // Check file size before reading
      const stats = await fs.stat(fullPath);
      const maxSizeBytes = config.maxFileSizeMB * 1024 * 1024;

      if (stats.size > maxSizeBytes) {
        return {
          success: false,
          message: `File too large: ${stats.size} bytes (max: ${maxSizeBytes} bytes)`,
          error: "FILE_TOO_LARGE",
        };
      }

      const content = await fs.readFile(fullPath, "utf-8");
      const lines = content.split("\n");

      if (shouldReadEntireFile) {
        return {
          success: true,
          content,
          totalLines: lines.length,
          message: `Read entire file: ${relativePath} (${lines.length} lines)`,
        };
      }

      // Handle line range reading
      const startIdx = (startLine || 1) - 1;
      const endIdx = endLine || lines.length;

      if (startIdx < 0 || endIdx > lines.length || startIdx >= endIdx) {
        return {
          success: false,
          message: `Invalid line range: ${startLine}-${endLine} for file with ${lines.length} lines`,
          error: "INVALID_LINE_RANGE",
        };
      }

      const selectedLines = lines.slice(startIdx, endIdx);
      const selectedContent = selectedLines.join("\n");

      return {
        success: true,
        content: selectedContent,
        startLine: startIdx + 1,
        endLine: endIdx,
        totalLines: lines.length,
        message: `Read lines ${startIdx + 1}-${endIdx} of ${relativePath}`,
      };
    } catch (error) {
      logger.error("Failed to read file", { relativePath, error });

      if (error instanceof Error && error.message.includes("ENOENT")) {
        return {
          success: false,
          message: `File not found: ${relativePath}`,
          error: "FILE_NOT_FOUND",
        };
      }

      return {
        success: false,
        message: `Failed to read file: ${relativePath}`,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get file stats (size, modification time, type)
   */
  async getFileStats(relativePath: string): Promise<FileStatsResponse> {
    try {
      const fullPath = this.workspaceService.resolvePath(relativePath);
      const stats = await fs.stat(fullPath);

      return {
        success: true,
        stats: {
          size: stats.size,
          mtime: stats.mtime.toISOString(),
          isFile: stats.isFile(),
          isDirectory: stats.isDirectory(),
        },
        message: `Retrieved stats for: ${relativePath} (${stats.size} bytes)`,
      };
    } catch (error) {
      logger.error("Failed to get file stats", { relativePath, error });

      if (error instanceof Error && error.message.includes("ENOENT")) {
        return {
          success: false,
          message: `File not found: ${relativePath}`,
          error: "FILE_NOT_FOUND",
        };
      }

      return {
        success: false,
        message: `Failed to get file stats: ${relativePath}`,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Write file contents
   */
  async writeFile(
    relativePath: string,
    content: string,
    instructions: string
  ): Promise<FileWriteResponse> {
    try {
      const fullPath = this.workspaceService.resolvePath(relativePath);

      // Check if this is a new file
      let isNewFile = false;
      let existingLines = 0;

      try {
        const existingContent = await fs.readFile(fullPath, "utf-8");
        existingLines = existingContent.split("\n").length;
      } catch {
        isNewFile = true;
      }

      // Ensure directory exists
      const dirPath = path.dirname(fullPath);
      await fs.mkdir(dirPath, { recursive: true });

      // Write the file
      await fs.writeFile(fullPath, content, "utf-8");

      const newLines = content.split("\n").length;

      logger.info("File written", {
        relativePath,
        isNewFile,
        instructions,
        linesAdded: isNewFile ? newLines : Math.max(0, newLines - existingLines),
        linesRemoved: isNewFile ? 0 : Math.max(0, existingLines - newLines),
      });

      return {
        success: true,
        message: isNewFile
          ? `Created new file: ${relativePath}`
          : `Modified file: ${relativePath}`,
        isNewFile,
        linesAdded: isNewFile ? newLines : Math.max(0, newLines - existingLines),
        linesRemoved: isNewFile ? 0 : Math.max(0, existingLines - newLines),
      };
    } catch (error) {
      logger.error("Failed to write file", { relativePath, error });

      return {
        success: false,
        message: `Failed to write file: ${relativePath}`,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(relativePath: string): Promise<FileDeleteResponse> {
    try {
      const fullPath = this.workspaceService.resolvePath(relativePath);

      try {
        await fs.unlink(fullPath);
        logger.info("File deleted", { relativePath });

        return {
          success: true,
          message: `Successfully deleted file: ${relativePath}`,
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes("ENOENT")) {
          return {
            success: true,
            message: `File does not exist: ${relativePath}`,
            wasAlreadyDeleted: true,
          };
        }
        throw error;
      }
    } catch (error) {
      logger.error("Failed to delete file", { relativePath, error });

      return {
        success: false,
        message: `Failed to delete file: ${relativePath}`,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Search and replace text in a file
   */
  async searchReplace(
    relativePath: string,
    oldString: string,
    newString: string
  ): Promise<SearchReplaceResponse> {
    try {
      // Input validation
      if (!oldString) {
        return {
          success: false,
          message: "Old string cannot be empty",
          error: "EMPTY_OLD_STRING",
          isNewFile: false,
          linesAdded: 0,
          linesRemoved: 0,
          occurrences: 0,
          oldLength: 0,
          newLength: 0,
        };
      }

      if (oldString === newString) {
        return {
          success: false,
          message: "Old string and new string are identical",
          error: "IDENTICAL_STRINGS",
          isNewFile: false,
          linesAdded: 0,
          linesRemoved: 0,
          occurrences: 0,
          oldLength: 0,
          newLength: 0,
        };
      }

      const fullPath = this.workspaceService.resolvePath(relativePath);

      // Read existing content
      let existingContent: string;
      try {
        existingContent = await fs.readFile(fullPath, "utf-8");
      } catch (error) {
        return {
          success: false,
          message: `File not found: ${relativePath}`,
          error: error instanceof Error ? error.message : "File read error",
          isNewFile: false,
          linesAdded: 0,
          linesRemoved: 0,
          occurrences: 0,
          oldLength: 0,
          newLength: 0,
        };
      }

      // Count occurrences
      const occurrences = existingContent.split(oldString).length - 1;

      if (occurrences === 0) {
        return {
          success: false,
          message: `Text not found in file: ${relativePath}`,
          error: "TEXT_NOT_FOUND",
          isNewFile: false,
          linesAdded: 0,
          linesRemoved: 0,
          occurrences: 0,
          oldLength: existingContent.length,
          newLength: existingContent.length,
        };
      }

      if (occurrences > 1) {
        return {
          success: false,
          message: `Multiple occurrences found (${occurrences}). The old_string must be unique.`,
          error: "TEXT_NOT_UNIQUE",
          isNewFile: false,
          linesAdded: 0,
          linesRemoved: 0,
          occurrences,
          oldLength: existingContent.length,
          newLength: existingContent.length,
        };
      }

      // Perform replacement and calculate metrics
      const newContent = existingContent.replace(oldString, newString);
      
      // Calculate line changes
      const oldLines = existingContent.split("\n");
      const newLines = newContent.split("\n");
      const oldLineCount = oldLines.length;
      const newLineCount = newLines.length;
      
      const linesAdded = Math.max(0, newLineCount - oldLineCount);
      const linesRemoved = Math.max(0, oldLineCount - newLineCount);

      // Write the new content
      await fs.writeFile(fullPath, newContent);

      logger.info("Search and replace completed", {
        relativePath,
        occurrences,
        linesAdded,
        linesRemoved,
        oldLength: existingContent.length,
        newLength: newContent.length,
      });

      return {
        success: true,
        message: `Successfully replaced text in ${relativePath}: ${occurrences} occurrence(s), ${linesAdded} lines added, ${linesRemoved} lines removed`,
        isNewFile: false,
        linesAdded,
        linesRemoved,
        occurrences,
        oldLength: existingContent.length,
        newLength: newContent.length,
      };
    } catch (error) {
      logger.error("Failed to search and replace", { relativePath, error });

      return {
        success: false,
        message: `Failed to search and replace in file: ${relativePath}`,
        error: error instanceof Error ? error.message : "Unknown error",
        isNewFile: false,
        linesAdded: 0,
        linesRemoved: 0,
        occurrences: 0,
        oldLength: 0,
        newLength: 0,
      };
    }
  }

  /**
   * List directory contents
   */
  async listDirectory(relativePath: string): Promise<DirectoryListResponse> {
    try {
      const fullPath = this.workspaceService.resolvePath(relativePath);
      const entries = await fs.readdir(fullPath, { withFileTypes: true });

      const contents: DirectoryEntry[] = entries.map(entry => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
        isDirectory: entry.isDirectory(),
      }));

      // Sort: directories first, then files, alphabetically
      contents.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      return {
        success: true,
        path: relativePath,
        contents,
        message: `Listed ${contents.length} items in ${relativePath}`,
      };
    } catch (error) {
      logger.error("Failed to list directory", { relativePath, error });

      if (error instanceof Error && error.message.includes("ENOENT")) {
        return {
          success: false,
          path: relativePath,
          message: `Directory not found: ${relativePath}`,
          error: "DIRECTORY_NOT_FOUND",
        };
      }

      return {
        success: false,
        path: relativePath,
        message: `Failed to list directory: ${relativePath}`,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

export default FileService;