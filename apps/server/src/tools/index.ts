import { tool } from "ai";
import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import { z } from "zod";
import config from "../config";

const execAsync = promisify(exec);

// Configuration flag for terminal command approval
export const REQUIRE_TERMINAL_APPROVAL = false; // Set to true to require approval

// Terminal command approval queue
const pendingCommands = new Map<
  string,
  {
    command: string;
    resolve: (result: any) => void;
    reject: (error: any) => void;
  }
>();

export const tools = {
  codebase_search: tool({
    description:
      "Find snippets of code from the codebase most relevant to the search query.",
    parameters: z.object({
      query: z.string().describe("The search query to find relevant code"),
      target_directories: z
        .array(z.string())
        .optional()
        .describe("Glob patterns for directories to search over"),
      explanation: z
        .string()
        .describe("One sentence explanation as to why this tool is being used"),
    }),
    execute: async ({ query, target_directories = [], explanation }) => {
      // For now, return a placeholder implementation
      // In a real implementation, this would integrate with vector search/embeddings
      console.log(`[CODEBASE_SEARCH] ${explanation}`);
      console.log(
        `Searching for: "${query}" in directories: ${target_directories.join(", ") || "all"}`
      );

      return {
        success: true,
        message: `Semantic search for "${query}" completed. This would normally return relevant code snippets.`,
        results: [],
      };
    },
  }),

  read_file: tool({
    description: "Read the contents of a file with line range support.",
    parameters: z.object({
      target_file: z.string().describe("The path of the file to read"),
      should_read_entire_file: z
        .boolean()
        .describe("Whether to read the entire file"),
      start_line_one_indexed: z
        .number()
        .optional()
        .describe("The one-indexed line number to start reading from"),
      end_line_one_indexed_inclusive: z
        .number()
        .optional()
        .describe("The one-indexed line number to end reading at"),
      explanation: z
        .string()
        .describe("One sentence explanation as to why this tool is being used"),
      workspaceDir: z
        .string()
        .optional()
        .describe("Workspace directory override"),
    }),
    execute: async ({
      target_file,
      should_read_entire_file,
      start_line_one_indexed,
      end_line_one_indexed_inclusive,
      explanation,
      workspaceDir,
    }) => {
      try {
        console.log(`[READ_FILE] ${explanation}`);

        const baseDir = workspaceDir || config.workspaceDir;
        const filePath = path.resolve(baseDir, target_file);
        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.split("\n");

        if (should_read_entire_file) {
          return {
            success: true,
            content: content,
            totalLines: lines.length,
            message: `Read entire file: ${target_file} (${lines.length} lines)`,
          };
        }

        const startLine = start_line_one_indexed || 1;
        const endLine = end_line_one_indexed_inclusive || lines.length;

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
          message: `Read lines ${startLine}-${endLine} of ${target_file}`,
        };
      } catch (error) {
        console.error(`[READ_FILE ERROR]`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          message: `Failed to read file: ${target_file}`,
        };
      }
    },
  }),

  run_terminal_cmd: tool({
    description: "Execute a terminal command with optional user approval.",
    parameters: z.object({
      command: z.string().describe("The terminal command to execute"),
      is_background: z
        .boolean()
        .describe("Whether the command should be run in the background"),
      explanation: z
        .string()
        .describe(
          "One sentence explanation as to why this command needs to be run"
        ),
      workspaceDir: z
        .string()
        .optional()
        .describe("Workspace directory override"),
    }),
    execute: async ({ command, is_background, explanation, workspaceDir }) => {
      console.log(`[TERMINAL_CMD] ${explanation}`);
      console.log(`Command: ${command} (background: ${is_background})`);

      if (REQUIRE_TERMINAL_APPROVAL) {
        console.log(
          `[APPROVAL_REQUIRED] Waiting for user approval for command: ${command}`
        );
        return {
          success: false,
          requiresApproval: true,
          message: `Command "${command}" requires user approval before execution.`,
          command,
        };
      }

      try {
        const baseDir = workspaceDir || config.workspaceDir;
        const options = {
          cwd: baseDir,
          timeout: is_background ? undefined : 30000, // 30 second timeout for non-background commands
        };

        if (is_background) {
          // For background commands, start and don't wait
          exec(command, options, (error, stdout, stderr) => {
            if (error) {
              console.error(`[BACKGROUND_CMD_ERROR] ${error.message}`);
            } else {
              console.log(`[BACKGROUND_CMD_OUTPUT] ${stdout}`);
              if (stderr) console.error(`[BACKGROUND_CMD_STDERR] ${stderr}`);
            }
          });

          return {
            success: true,
            message: `Background command started: ${command}`,
            isBackground: true,
          };
        } else {
          const { stdout, stderr } = await execAsync(command, options);
          return {
            success: true,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            message: `Command executed successfully: ${command}`,
          };
        }
      } catch (error) {
        console.error(`[TERMINAL_CMD_ERROR]`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          message: `Failed to execute command: ${command}`,
        };
      }
    },
  }),

  list_dir: tool({
    description: "List the contents of a directory.",
    parameters: z.object({
      relative_workspace_path: z
        .string()
        .describe("Path to list contents of, relative to the workspace root"),
      explanation: z
        .string()
        .describe("One sentence explanation as to why this tool is being used"),
      workspaceDir: z
        .string()
        .optional()
        .describe("Workspace directory override"),
    }),
    execute: async ({ relative_workspace_path, explanation, workspaceDir }) => {
      try {
        console.log(`[LIST_DIR] ${explanation}`);

        // Handle path resolution correctly - normalize relative paths
        let normalizedPath = relative_workspace_path;
        if (normalizedPath.startsWith("/")) {
          // Remove leading slash to make it truly relative
          normalizedPath = normalizedPath.slice(1);
        }
        if (normalizedPath === "") {
          // Empty string means workspace root
          normalizedPath = ".";
        }

        const baseDir = workspaceDir || config.workspaceDir;
        const dirPath = path.resolve(baseDir, normalizedPath);
        console.log(`[LIST_DIR] Resolved path: ${dirPath}`);
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        const contents = entries.map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
          isDirectory: entry.isDirectory(),
        }));

        return {
          success: true,
          contents,
          path: relative_workspace_path,
          message: `Listed ${contents.length} items in ${relative_workspace_path}`,
        };
      } catch (error) {
        console.error(`[LIST_DIR_ERROR]`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          message: `Failed to list directory: ${relative_workspace_path}`,
        };
      }
    },
  }),

  grep_search: tool({
    description: "Fast, exact regex searches over text files using ripgrep.",
    parameters: z.object({
      query: z.string().describe("The regex pattern to search for"),
      include_pattern: z
        .string()
        .optional()
        .describe("Glob pattern for files to include"),
      exclude_pattern: z
        .string()
        .optional()
        .describe("Glob pattern for files to exclude"),
      case_sensitive: z
        .boolean()
        .optional()
        .describe("Whether the search should be case sensitive"),
      explanation: z
        .string()
        .describe("One sentence explanation as to why this tool is being used"),
      workspaceDir: z
        .string()
        .optional()
        .describe("Workspace directory override"),
    }),
    execute: async ({
      query,
      include_pattern,
      exclude_pattern,
      case_sensitive = false,
      explanation,
      workspaceDir,
    }) => {
      try {
        console.log(`[GREP_SEARCH] ${explanation}`);

        const baseDir = workspaceDir || config.workspaceDir;
        let command = `rg "${query}" "${baseDir}"`;

        if (!case_sensitive) {
          command += " -i";
        }

        if (include_pattern) {
          command += ` --glob "${include_pattern}"`;
        }

        if (exclude_pattern) {
          command += ` --glob "!${exclude_pattern}"`;
        }

        command += " --max-count 50"; // Limit results

        const { stdout, stderr } = await execAsync(command);

        const matches = stdout
          .trim()
          .split("\n")
          .filter((line) => line.length > 0);

        return {
          success: true,
          matches,
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
            query,
            matchCount: 0,
            message: `No matches found for pattern: ${query}`,
          };
        }

        console.error(`[GREP_SEARCH_ERROR]`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          message: `Failed to search for pattern: ${query}`,
        };
      }
    },
  }),

  edit_file: tool({
    description: "Propose an edit to an existing file or create a new file.",
    parameters: z.object({
      target_file: z.string().describe("The target file to modify"),
      instructions: z
        .string()
        .describe(
          "A single sentence instruction describing what you are going to do"
        ),
      code_edit: z
        .string()
        .describe("The precise lines of code to edit or create"),
      workspaceDir: z
        .string()
        .optional()
        .describe("Workspace directory override"),
    }),
    execute: async ({ target_file, instructions, code_edit, workspaceDir }) => {
      try {
        console.log(`[EDIT_FILE] ${instructions}`);

        const baseDir = workspaceDir || config.workspaceDir;
        const filePath = path.resolve(baseDir, target_file);
        const dirPath = path.dirname(filePath);

        // Ensure directory exists
        await fs.mkdir(dirPath, { recursive: true });

        // Check if this is a new file or editing existing
        let isNewFile = false;
        try {
          await fs.access(filePath);
        } catch {
          isNewFile = true;
        }

        if (isNewFile) {
          // Create new file
          await fs.writeFile(filePath, code_edit);
          return {
            success: true,
            isNewFile: true,
            message: `Created new file: ${target_file}`,
            linesAdded: code_edit.split("\n").length,
          };
        } else {
          // For existing files, this is a simplified implementation
          // In a real system, you'd want to apply the edit more intelligently
          const existingContent = await fs.readFile(filePath, "utf-8");
          const existingLines = existingContent.split("\n").length;

          // For now, we'll replace the entire file content
          // A more sophisticated implementation would parse the edit instructions
          await fs.writeFile(filePath, code_edit);

          const newLines = code_edit.split("\n").length;

          return {
            success: true,
            isNewFile: false,
            message: `Modified file: ${target_file}`,
            linesAdded: Math.max(0, newLines - existingLines),
            linesRemoved: Math.max(0, existingLines - newLines),
          };
        }
      } catch (error) {
        console.error(`[EDIT_FILE_ERROR]`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          message: `Failed to edit file: ${target_file}`,
        };
      }
    },
  }),

  search_replace: tool({
    description:
      "Replace ONE occurrence of old_string with new_string in a file.",
    parameters: z.object({
      file_path: z
        .string()
        .describe("The path to the file to search and replace in"),
      old_string: z
        .string()
        .describe("The text to replace (must be unique within the file)"),
      new_string: z
        .string()
        .describe("The edited text to replace the old_string"),
      workspaceDir: z
        .string()
        .optional()
        .describe("Workspace directory override"),
    }),
    execute: async ({ file_path, old_string, new_string, workspaceDir }) => {
      try {
        console.log(`[SEARCH_REPLACE] Replacing text in ${file_path}`);

        const baseDir = workspaceDir || config.workspaceDir;
        const filePath = path.resolve(baseDir, file_path);
        const content = await fs.readFile(filePath, "utf-8");

        const occurrences = content.split(old_string).length - 1;

        if (occurrences === 0) {
          return {
            success: false,
            message: `Text not found in file: ${file_path}`,
            searchText:
              old_string.substring(0, 100) +
              (old_string.length > 100 ? "..." : ""),
          };
        }

        if (occurrences > 1) {
          return {
            success: false,
            message: `Multiple occurrences found (${occurrences}). The old_string must be unique.`,
            searchText:
              old_string.substring(0, 100) +
              (old_string.length > 100 ? "..." : ""),
          };
        }

        const newContent = content.replace(old_string, new_string);
        await fs.writeFile(filePath, newContent);

        return {
          success: true,
          message: `Successfully replaced text in ${file_path}`,
          replacementMade: true,
        };
      } catch (error) {
        console.error(`[SEARCH_REPLACE_ERROR]`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          message: `Failed to search and replace in file: ${file_path}`,
        };
      }
    },
  }),

  file_search: tool({
    description: "Fast file search based on fuzzy matching against file path.",
    parameters: z.object({
      query: z.string().describe("Fuzzy filename to search for"),
      explanation: z
        .string()
        .describe("One sentence explanation as to why this tool is being used"),
      workspaceDir: z
        .string()
        .optional()
        .describe("Workspace directory override"),
    }),
    execute: async ({ query, explanation, workspaceDir }) => {
      try {
        console.log(`[FILE_SEARCH] ${explanation}`);

        const baseDir = workspaceDir || config.workspaceDir;
        const command = `find "${baseDir}" -name "*${query}*" -type f | head -10`;
        const { stdout } = await execAsync(command);

        const files = stdout
          .trim()
          .split("\n")
          .filter((line) => line.length > 0)
          .map((file) => file.replace(baseDir + "/", ""));

        return {
          success: true,
          files,
          query,
          count: files.length,
          message: `Found ${files.length} files matching: ${query}`,
        };
      } catch (error) {
        console.error(`[FILE_SEARCH_ERROR]`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          message: `Failed to search for files: ${query}`,
        };
      }
    },
  }),

  delete_file: tool({
    description: "Delete a file at the specified path.",
    parameters: z.object({
      target_file: z.string().describe("The path of the file to delete"),
      explanation: z
        .string()
        .describe("One sentence explanation as to why this tool is being used"),
      workspaceDir: z
        .string()
        .optional()
        .describe("Workspace directory override"),
    }),
    execute: async ({ target_file, explanation, workspaceDir }) => {
      try {
        console.log(`[DELETE_FILE] ${explanation}`);

        const baseDir = workspaceDir || config.workspaceDir;
        const filePath = path.resolve(baseDir, target_file);
        await fs.unlink(filePath);

        return {
          success: true,
          message: `Successfully deleted file: ${target_file}`,
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes("ENOENT")) {
          return {
            success: true,
            message: `File does not exist: ${target_file}`,
            wasAlreadyDeleted: true,
          };
        }

        console.error(`[DELETE_FILE_ERROR]`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          message: `Failed to delete file: ${target_file}`,
        };
      }
    },
  }),
};

// Helper function to approve pending terminal commands
export function approveTerminalCommand(commandId: string, approved: boolean) {
  const pending = pendingCommands.get(commandId);
  if (!pending) {
    return false;
  }

  pendingCommands.delete(commandId);

  if (approved) {
    // Execute the approved command
    const { command, resolve } = pending;
    // Note: For pending commands, we use the default workspace dir
    // since we don't have access to the task context here
    execAsync(command, { cwd: config.workspaceDir })
      .then(({ stdout, stderr }) => {
        resolve({
          success: true,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          message: `Command executed successfully: ${command}`,
        });
      })
      .catch((error) => {
        resolve({
          success: false,
          error: error.message,
          message: `Failed to execute command: ${command}`,
        });
      });
  } else {
    pending.resolve({
      success: false,
      message: `Command rejected by user: ${pending.command}`,
      rejected: true,
    });
  }

  return true;
}

// Get list of pending commands for approval UI
export function getPendingCommands() {
  return Array.from(pendingCommands.entries()).map(([id, { command }]) => ({
    id,
    command,
  }));
}
