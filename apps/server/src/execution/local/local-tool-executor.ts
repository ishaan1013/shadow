import {
  validateCommand,
  parseCommand,
  CommandSecurityLevel,
  SecurityLogger,
} from "@repo/command-security";
import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import fetch from "node-fetch";
import config from "../../config";
import { execAsync } from "../../utils/exec";
import { ToolExecutor } from "../interfaces/tool-executor";
import {
  CommandOptions,
  DeleteResult,
  DirectoryListing,
  FileResult,
  FileSearchResult,
  FileStatsResult,
  GrepOptions,
  GrepResult,
  GrepMatch,
  ReadFileOptions,
  WriteResult,
  SearchReplaceResult,
  SemanticSearchToolResult,
  SearchOptions,
  WebSearchResult,
  GitStatusResponse,
  GitDiffResponse,
  GitCommitResponse,
  GitPushResponse,
  GitCommitRequest,
  GitPushRequest,
} from "@repo/types";
import { CommandResult } from "../interfaces/types";
import { performSemanticSearch } from "@/utils/semantic-search";

/**
 * LocalToolExecutor implements tool operations for local filesystem execution
 */
export class LocalToolExecutor implements ToolExecutor {
  private taskId: string;
  private workspacePath: string;
  private securityLogger: SecurityLogger;

  constructor(taskId: string, workspacePath?: string) {
    this.taskId = taskId;
    this.workspacePath = workspacePath || config.workspaceDir;
    // Console logger for local execution
    this.securityLogger = {
      warn: (message: string, details?: Record<string, unknown>) => {
        console.warn(`[LOCAL_SECURITY] ${message}`, details);
      },
      info: (message: string, details?: Record<string, unknown>) => {
        console.log(`[LOCAL_SECURITY] ${message}`, details);
      },
    };
  }

  async readFile(
    targetFile: string,
    options?: ReadFileOptions
  ): Promise<FileResult> {
    try {
      const filePath = path.resolve(this.workspacePath, targetFile);
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");

      if (options?.shouldReadEntireFile) {
        return {
          success: true,
          content: content,
          totalLines: lines.length,
          message: `Read entire file: ${targetFile} (${lines.length} lines)`,
        };
      }

      const startLine = options?.startLineOneIndexed || 1;
      const endLine = options?.endLineOneIndexedInclusive || lines.length;

      if (startLine < 1 || endLine > lines.length || startLine > endLine) {
        throw new Error(
          `Invalid line range: ${startLine}-${endLine} for file with ${lines.length} lines`
        );
      }

      const selectedLines = lines.slice(startLine - 1, endLine);
      const selectedContent = selectedLines.join("\n");

      return {
        success: true,
        content: selectedContent,
        startLine,
        endLine,
        totalLines: lines.length,
        message: `Read lines ${startLine}-${endLine} of ${targetFile}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        message: `Failed to read file: ${targetFile}`,
      };
    }
  }

  async getFileStats(targetFile: string): Promise<FileStatsResult> {
    try {
      const filePath = path.resolve(this.workspacePath, targetFile);
      const stats = await fs.stat(filePath);

      return {
        success: true,
        stats: {
          size: stats.size,
          mtime: stats.mtime,
          isFile: stats.isFile(),
          isDirectory: stats.isDirectory(),
        },
        message: `Retrieved stats for: ${targetFile} (${stats.size} bytes)`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        message: `Failed to get file stats: ${targetFile}`,
      };
    }
  }

  async writeFile(
    targetFile: string,
    content: string,
    _instructions: string
  ): Promise<WriteResult> {
    try {
      const filePath = path.resolve(this.workspacePath, targetFile);
      const dirPath = path.dirname(filePath);

      // Ensure directory exists
      await fs.mkdir(dirPath, { recursive: true });

      // Check if this is a new file or editing existing
      let isNewFile = false;
      let existingContent = "";

      try {
        existingContent = await fs.readFile(filePath, "utf-8");
      } catch {
        isNewFile = true;
      }

      // Write the new content
      await fs.writeFile(filePath, content);

      if (isNewFile) {
        return {
          success: true,
          isNewFile: true,
          message: `Created new file: ${targetFile}`,
          linesAdded: content.split("\n").length,
        };
      } else {
        const existingLines = existingContent.split("\n").length;
        const newLines = content.split("\n").length;

        return {
          success: true,
          isNewFile: false,
          message: `Modified file: ${targetFile}`,
          linesAdded: Math.max(0, newLines - existingLines),
          linesRemoved: Math.max(0, existingLines - newLines),
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        message: `Failed to edit file: ${targetFile}`,
      };
    }
  }

  async deleteFile(targetFile: string): Promise<DeleteResult> {
    try {
      const filePath = path.resolve(this.workspacePath, targetFile);

      await fs.unlink(filePath);

      return {
        success: true,
        message: `Successfully deleted file: ${targetFile}`,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("ENOENT")) {
        return {
          success: true,
          message: `File does not exist: ${targetFile}`,
          wasAlreadyDeleted: true,
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        message: `Failed to delete file: ${targetFile}`,
      };
    }
  }

  async searchReplace(
    filePath: string,
    oldString: string,
    newString: string
  ): Promise<SearchReplaceResult> {
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

      const resolvedPath = path.resolve(this.workspacePath, filePath);
      
      // Read existing content
      let existingContent: string;
      try {
        existingContent = await fs.readFile(resolvedPath, "utf-8");
      } catch (error) {
        return {
          success: false,
          message: `File not found: ${filePath}`,
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
          message: `Text not found in file: ${filePath}`,
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
      await fs.writeFile(resolvedPath, newContent);

      return {
        success: true,
        message: `Successfully replaced text in ${filePath}: ${occurrences} occurrence(s), ${linesAdded} lines added, ${linesRemoved} lines removed`,
        isNewFile: false,
        linesAdded,
        linesRemoved,
        occurrences,
        oldLength: existingContent.length,
        newLength: newContent.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        message: `Failed to search and replace in file: ${filePath}`,
        isNewFile: false,
        linesAdded: 0,
        linesRemoved: 0,
        occurrences: 0,
        oldLength: 0,
        newLength: 0,
      };
    }
  }

  async listDirectory(
    relativeWorkspacePath: string
  ): Promise<DirectoryListing> {
    try {
      // Handle path resolution correctly - normalize relative paths
      let normalizedPath = relativeWorkspacePath;
      if (normalizedPath.startsWith("/")) {
        // Remove leading slash to make it truly relative
        normalizedPath = normalizedPath.slice(1);
      }
      if (normalizedPath === "") {
        // Empty string means workspace root
        normalizedPath = ".";
      }

      const dirPath = path.resolve(this.workspacePath, normalizedPath);
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      const contents = entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? ("directory" as const) : ("file" as const),
        isDirectory: entry.isDirectory(),
      }));

      return {
        success: true,
        contents,
        path: relativeWorkspacePath,
        message: `Listed ${contents.length} items in ${relativeWorkspacePath}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        message: `Failed to list directory: ${relativeWorkspacePath}`,
        path: relativeWorkspacePath,
      };
    }
  }

  async searchFiles(
    query: string,
    _options?: SearchOptions
  ): Promise<FileSearchResult> {
    try {
      const command = `find "${this.workspacePath}" -name "*${query}*" -type f | head -10`;
      const { stdout } = await execAsync(command);

      const files = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((file) => file.replace(this.workspacePath + "/", ""));

      return {
        success: true,
        files,
        query,
        count: files.length,
        message: `Found ${files.length} files matching: ${query}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        message: `Failed to search for files: ${query}`,
        files: [],
        query,
        count: 0,
      };
    }
  }

  async grepSearch(query: string, options?: GrepOptions): Promise<GrepResult> {
    try {
      // Build ripgrep command with file names and line numbers
      let command = `rg -n --with-filename "${query}" "${this.workspacePath}"`;
      
      if (!options?.caseSensitive) {
        command += " -i";
      }

      if (options?.includePattern) {
        command += ` --glob "${options.includePattern}"`;
      }

      if (options?.excludePattern) {
        command += ` --glob "!${options.excludePattern}"`;
      }

      command += " --max-count 50"; // Limit results

      const { stdout } = await execAsync(command);

      const rawMatches = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0);

      // Parse structured output: "file:line:content"
      const detailedMatches: GrepMatch[] = [];
      const matches: string[] = [];

      for (const rawMatch of rawMatches) {
        const colonIndex = rawMatch.indexOf(':');
        const secondColonIndex = rawMatch.indexOf(':', colonIndex + 1);
        
        if (colonIndex > 0 && secondColonIndex > colonIndex) {
          const file = rawMatch.substring(0, colonIndex); // Full absolute path
          const lineNumber = parseInt(rawMatch.substring(colonIndex + 1, secondColonIndex), 10);
          let content = rawMatch.substring(secondColonIndex + 1); // Complete line content
          
          // Truncate content to 250 characters max
          if (content.length > 250) {
            content = content.substring(0, 250) + "...";
          }
          
          detailedMatches.push({ file, lineNumber, content });
          matches.push(rawMatch); // Keep original format for backward compatibility
        } else {
          // Fallback for unexpected format
          matches.push(rawMatch);
        }
      }

      return {
        success: true,
        matches,
        detailedMatches,
        query,
        matchCount: matches.length,
        message: `Found ${matches.length} matches for pattern: ${query}`,
      };
    } catch (error) {
      // ripgrep returns exit code 1 when no matches found, which is normal
      if (error instanceof Error && error.message.includes("exit code 1")) {
        return {
          success: true,
          matches: [],
          detailedMatches: [],
          query,
          matchCount: 0,
          message: `No matches found for pattern: ${query}`,
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        message: `Failed to search for pattern: ${query}`,
        matches: [],
        detailedMatches: [],
        query,
        matchCount: 0,
      };
    }
  }


  async semanticSearch(
    query: string,
    repo: string,
    _options?: SearchOptions
  ): Promise<SemanticSearchToolResult> {
    try {
      return await performSemanticSearch({ query, repo });
    } catch (error) {
      console.error(
        `[SEMANTIC_SEARCH_ERROR] Failed to query indexing service:`,
        error
      );

      // Fallback to grep search if indexing service is unavailable
      const fallbackResult = await this.grepSearch(query);
      
      // Convert GrepResult to SemanticSearchToolResult format
      return {
        success: fallbackResult.success,
        results: fallbackResult.matches.map((match, i) => ({
          id: i + 1,
          content: match,
          relevance: 0.8,
          filePath: "",
          lineStart: 0,
          lineEnd: 0,
          language: "",
          kind: "",
        })),
        query: fallbackResult.query,
        searchTerms: fallbackResult.query.split(/\s+/),
        message: fallbackResult.message + " (fallback to grep)",
        error: fallbackResult.error,
      };
    }
  }
  async webSearch(query: string, domain?: string): Promise<WebSearchResult> {
    try {
      if (!config.exaApiKey) {
        throw new Error("EXA_API_KEY is not configured");
      }

      interface ExaApiRequestBody {
        query: string;
        type: "fast" | "auto" | "keyword" | "neural";
        contents: {
          text: boolean;
        };
        num_results: number;
        include_domains?: string[];
      }

      const requestBody: ExaApiRequestBody = {
        query,
        type: "fast",
        contents: {
          text: true,
        },
        num_results: 5,
      };

      if (domain) {
        requestBody.include_domains = [domain];
      }

      // Use node-fetch to make the API call
      const response = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": config.exaApiKey,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Exa API error (${response.status}): ${errorText}`);
      }

      interface ExaSearchResult {
        text: string;
        url: string;
        title?: string;
      }

      const data = (await response.json()) as { results?: ExaSearchResult[] };

      const results =
        data.results?.map((result: ExaSearchResult) => ({
          text: result.text || "",
          url: result.url || "",
          title: result.title || undefined,
        })) || [];

      return {
        success: true,
        results,
        query,
        domain,
        message: `Found ${results.length} web search results for query: ${query}`,
      };
    } catch (error) {
      console.error("Web search error:", error);
      return {
        success: false,
        results: [],
        query,
        domain,
        message: `Failed to perform web search: ${query}`,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async executeCommand(
    command: string,
    options?: CommandOptions
  ): Promise<CommandResult> {
    console.log(`[LOCAL] Executing command: ${command}`);

    // Parse and validate command
    const { command: baseCommand, args } = parseCommand(command);
    const validation = validateCommand(
      baseCommand,
      args,
      this.workspacePath,
      this.securityLogger
    );

    if (!validation.isValid) {
      return {
        success: false,
        error: validation.error,
        message: `Security validation failed: ${validation.error}`,
        securityLevel: validation.securityLevel,
      };
    }

    // Log potentially dangerous commands
    if (validation.securityLevel === CommandSecurityLevel.APPROVAL_REQUIRED) {
      console.log(
        `[LOCAL] Executing potentially dangerous command: ${baseCommand}`,
        { args }
      );
    }

    const sanitizedCommand = validation.sanitizedCommand!;
    const sanitizedArgs = validation.sanitizedArgs!;

    try {
      if (options?.isBackground) {
        // For background commands, use spawn for better security
        const child = spawn(sanitizedCommand, sanitizedArgs, {
          cwd: this.workspacePath,
          detached: true,
          stdio: "ignore",
        });

        child.unref(); // Allow parent to exit

        console.log(`[LOCAL] Background command started: ${sanitizedCommand}`);

        return {
          success: true,
          message: `Background command started: ${sanitizedCommand}`,
          isBackground: true,
          securityLevel: validation.securityLevel,
        };
      } else {
        // For foreground commands, use secure spawn with timeout
        const result = await this.executeSecureCommand(
          sanitizedCommand,
          sanitizedArgs,
          30000 // 30 second timeout
        );

        return {
          success: true,
          stdout: result.stdout.trim(),
          stderr: result.stderr.trim(),
          message: `Command executed successfully: ${sanitizedCommand}`,
          securityLevel: validation.securityLevel,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      return {
        success: false,
        error: errorMessage,
        message: `Failed to execute command: ${sanitizedCommand}`,
        securityLevel: validation.securityLevel,
      };
    }
  }

  /**
   * Execute command securely using spawn with timeout
   */
  private async executeSecureCommand(
    command: string,
    args: string[],
    timeout: number
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: this.workspacePath,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timeoutId: NodeJS.Timeout | null = null;

      // Set up timeout
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);
      }

      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      // Handle process exit
      child.on("close", (code) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          const error = new Error(
            `Command failed with exit code ${code}: ${stderr || stdout}`
          ) as Error & {
            stdout: string;
            stderr: string;
          };
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
        }
      });

      // Handle process errors
      child.on("error", (error) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        reject(error);
      });
    });
  }

  getWorkspacePath(): string {
    return this.workspacePath;
  }

  isRemote(): boolean {
    return false;
  }

  getTaskId(): string {
    return this.taskId;
  }

  /**
   * Get git status (stub - delegates to GitManager in chat.ts for local mode)
   */
  async getGitStatus(): Promise<GitStatusResponse> {
    // For local mode, git operations are handled directly by GitManager in chat.ts
    // This is a stub implementation for interface compatibility
    return {
      success: false,
      message: "Git operations in local mode are handled by GitManager",
      hasChanges: false,
    };
  }

  /**
   * Get git diff (stub - delegates to GitManager in chat.ts for local mode)
   */
  async getGitDiff(): Promise<GitDiffResponse> {
    // For local mode, git operations are handled directly by GitManager in chat.ts
    // This is a stub implementation for interface compatibility
    return {
      success: false,
      message: "Git operations in local mode are handled by GitManager",
      diff: "",
    };
  }

  /**
   * Commit changes (stub - delegates to GitManager in chat.ts for local mode)
   */
  async commitChanges(_request: GitCommitRequest): Promise<GitCommitResponse> {
    // For local mode, git operations are handled directly by GitManager in chat.ts
    // This is a stub implementation for interface compatibility
    return {
      success: false,
      message: "Git operations in local mode are handled by GitManager",
    };
  }

  /**
   * Push branch (stub - delegates to GitManager in chat.ts for local mode)
   */
  async pushBranch(_request: GitPushRequest): Promise<GitPushResponse> {
    // For local mode, git operations are handled directly by GitManager in chat.ts
    // This is a stub implementation for interface compatibility
    return {
      success: false,
      message: "Git operations in local mode are handled by GitManager",
    };
  }
}
