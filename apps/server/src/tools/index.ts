import { prisma } from "@repo/db";
import { tool } from "ai";
import { exec } from "child_process";
import { createPatch } from "diff";
import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod";
import config from "../config";
import { emitStreamChunk } from "../socket";
import { execAsync } from "../utils/exec";

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

// Helper function to save file changes to database
async function saveFileChange(
  taskId: string,
  filePath: string,
  operation: "CREATE" | "UPDATE" | "DELETE" | "RENAME" | "MOVE",
  oldContent?: string,
  newContent?: string
): Promise<void> {
  try {
    // Generate git-style diff if both old and new content exist
    let diffPatch: string | undefined;
    let additions = 0;
    let deletions = 0;

    if (oldContent !== undefined && newContent !== undefined) {
      diffPatch = createPatch(
        filePath,
        oldContent,
        newContent,
        undefined, // oldHeader
        undefined, // newHeader
        { context: 3 } // 3 lines of context like git
      );

      // Calculate diff stats efficiently on server
      const lines = diffPatch.split("\n");
      lines.forEach((line) => {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          additions++;
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          deletions++;
        }
      });
    } else if (operation === "CREATE" && newContent) {
      // New file: count all lines as additions
      additions = newContent.split("\n").length;
    } else if (operation === "DELETE" && oldContent) {
      // Deleted file: count all lines as deletions
      deletions = oldContent.split("\n").length;
    }

    const savedFileChange = await prisma.fileChange.create({
      data: {
        taskId,
        filePath,
        operation,
        oldContent,
        newContent,
        diffPatch,
        additions,
        deletions,
      },
    });

    console.log(
      `[FILE_CHANGE] Recorded ${operation} for ${filePath} (+${additions} -${deletions})`
    );

    // Stream the file change in real-time
    emitStreamChunk({
      type: "file-change",
      fileChange: {
        id: savedFileChange.id,
        filePath,
        operation,
        oldContent,
        newContent,
        diffPatch,
        additions,
        deletions,
        createdAt: savedFileChange.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error(`[FILE_CHANGE_ERROR] Failed to save file change:`, error);
    // Don't throw error - file operation succeeded, logging is secondary
  }
}

// Factory function to create tools with task context
export function createTools(taskId: string, workspacePath?: string) {
  // Use provided workspace path or fall back to global config
  const toolWorkspacePath = workspacePath || config.workspaceDir;

  console.log(
    `[TOOLS] Creating tools for task ${taskId} with workspace: ${toolWorkspacePath}${workspacePath ? " (task-specific)" : " (fallback)"}`
  );
  return {
    todo_write: tool({
      description:
        "Create and manage a structured task list during coding sessions. Use this to track progress on complex multi-step tasks and demonstrate thoroughness.",
      parameters: z.object({
        merge: z
          .boolean()
          .describe(
            "Whether to merge with existing todos (true) or replace them (false)"
          ),
        todos: z
          .array(
            z.object({
              id: z.string().describe("Unique identifier for the todo item"),
              content: z.string().describe("Descriptive content of the todo"),
              status: z
                .enum(["pending", "in_progress", "completed", "cancelled"])
                .describe("Current status of the todo item"),
            })
          )
          .describe("Array of todo items to create or update"),
        explanation: z
          .string()
          .describe(
            "One sentence explanation as to why this tool is being used"
          ),
      }),
      execute: async ({ merge, todos, explanation }) => {
        try {
          console.log(`[TODO_WRITE] ${explanation}`);

          if (!merge) {
            // Replace: delete existing todos for this task
            await prisma.todo.deleteMany({
              where: { taskId },
            });
          }

          // Process todos in order
          const results = [];
          for (let i = 0; i < todos.length; i++) {
            const todo = todos[i];
            if (!todo) continue; // Skip undefined items

            // Check if todo exists (by id within the task)
            const existingTodo = await prisma.todo.findFirst({
              where: {
                taskId,
                id: todo.id,
              },
            });

            if (existingTodo) {
              // Update existing todo
              const updatedTodo = await prisma.todo.update({
                where: { id: existingTodo.id },
                data: {
                  content: todo.content,
                  status: todo.status.toUpperCase() as any,
                  sequence: i,
                },
              });
              results.push({
                action: "updated",
                id: todo.id,
                content: todo.content,
                status: todo.status,
              });
            } else {
              // Create new todo
              const newTodo = await prisma.todo.create({
                data: {
                  id: todo.id,
                  content: todo.content,
                  status: todo.status.toUpperCase() as any,
                  sequence: i,
                  taskId,
                },
              });
              results.push({
                action: "created",
                id: todo.id,
                content: todo.content,
                status: todo.status,
              });
            }
          }

          const summary = `${merge ? "Merged" : "Replaced"} todos: ${results
            .map((r) => `${r.action} "${r.content}" (${r.status})`)
            .join(", ")}`;

          return {
            success: true,
            message: summary,
            todos: results,
            count: results.length,
          };
        } catch (error) {
          console.error(`[TODO_WRITE_ERROR]`, error);
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            message: "Failed to manage todos",
          };
        }
      },
    }),

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
          .describe(
            "One sentence explanation as to why this tool is being used"
          ),
      }),
      execute: async ({ query, target_directories = [], explanation }) => {
        try {
          console.log(`[CODEBASE_SEARCH] ${explanation}`);
          console.log(
            `Searching for: "${query}" in directories: ${target_directories.join(", ") || "all"}`
          );

          // Use ripgrep for a basic semantic-like search with multiple patterns
          const searchTerms = query
            .split(" ")
            .filter((term) => term.length > 2);
          const searchPattern = searchTerms.join("|");

          let searchPath = toolWorkspacePath;
          if (target_directories.length > 0) {
            // For now, just use the first directory
            searchPath = path.resolve(
              toolWorkspacePath,
              target_directories[0] || "."
            );
          }

          // Use ripgrep with case-insensitive search and context
          const command = `rg -i -C 3 --max-count 10 "${searchPattern}" "${searchPath}"`;

          try {
            const { stdout } = await execAsync(command);
            const results = stdout
              .trim()
              .split("\n--\n")
              .map((chunk, index) => ({
                id: index + 1,
                content: chunk.trim(),
                relevance: 0.8, // Mock relevance score
              }))
              .filter((result) => result.content.length > 0);

            return {
              success: true,
              message: `Found ${results.length} relevant code snippets for "${query}"`,
              results: results.slice(0, 5), // Limit to top 5 results
              query,
              searchTerms,
            };
          } catch (error) {
            // If ripgrep fails (no matches), return empty results
            return {
              success: true,
              message: `No relevant code found for "${query}"`,
              results: [],
              query,
              searchTerms,
            };
          }
        } catch (error) {
          console.error(`[CODEBASE_SEARCH_ERROR]`, error);
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            message: `Failed to search codebase for: ${query}`,
          };
        }
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
          .describe(
            "One sentence explanation as to why this tool is being used"
          ),
      }),
      execute: async ({
        target_file,
        should_read_entire_file,
        start_line_one_indexed,
        end_line_one_indexed_inclusive,
        explanation,
      }) => {
        try {
          console.log(`[READ_FILE] ${explanation}`);

          const filePath = path.resolve(toolWorkspacePath, target_file);
          console.log(
            `[READ_FILE] Resolved path: ${filePath} (workspace: ${toolWorkspacePath})`
          );
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
      }),
      execute: async ({ command, is_background, explanation }) => {
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
          const options = {
            cwd: toolWorkspacePath,
            timeout: is_background ? undefined : 30000, // 30 second timeout for non-background commands
          };

          console.log(
            `[TERMINAL_CMD] Running in directory: ${toolWorkspacePath}`
          );

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
          .describe(
            "One sentence explanation as to why this tool is being used"
          ),
      }),
      execute: async ({ relative_workspace_path, explanation }) => {
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

          const dirPath = path.resolve(toolWorkspacePath, normalizedPath);
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
          .describe(
            "One sentence explanation as to why this tool is being used"
          ),
      }),
      execute: async ({
        query,
        include_pattern,
        exclude_pattern,
        case_sensitive = false,
        explanation,
      }) => {
        try {
          console.log(`[GREP_SEARCH] ${explanation}`);

          let command = `rg "${query}" "${toolWorkspacePath}"`;

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
      }),
      execute: async ({ target_file, instructions, code_edit }) => {
        try {
          console.log(`[EDIT_FILE] ${instructions}`);

          const filePath = path.resolve(toolWorkspacePath, target_file);
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
          await fs.writeFile(filePath, code_edit);

          // Save file change to database
          await saveFileChange(
            taskId,
            target_file,
            isNewFile ? "CREATE" : "UPDATE",
            isNewFile ? undefined : existingContent,
            code_edit
          );

          if (isNewFile) {
            return {
              success: true,
              isNewFile: true,
              message: `Created new file: ${target_file}`,
              linesAdded: code_edit.split("\n").length,
            };
          } else {
            const existingLines = existingContent.split("\n").length;
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
      }),
      execute: async ({ file_path, old_string, new_string }) => {
        try {
          console.log(`[SEARCH_REPLACE] Replacing text in ${file_path}`);

          const filePath = path.resolve(toolWorkspacePath, file_path);
          const existingContent = await fs.readFile(filePath, "utf-8");

          const occurrences = existingContent.split(old_string).length - 1;

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

          const newContent = existingContent.replace(old_string, new_string);
          await fs.writeFile(filePath, newContent);

          // Save file change to database
          await saveFileChange(
            taskId,
            file_path,
            "UPDATE",
            existingContent,
            newContent
          );

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
      description:
        "Fast file search based on fuzzy matching against file path.",
      parameters: z.object({
        query: z.string().describe("Fuzzy filename to search for"),
        explanation: z
          .string()
          .describe(
            "One sentence explanation as to why this tool is being used"
          ),
      }),
      execute: async ({ query, explanation }) => {
        try {
          console.log(`[FILE_SEARCH] ${explanation}`);

          const command = `find "${toolWorkspacePath}" -name "*${query}*" -type f | head -10`;
          const { stdout } = await execAsync(command);

          const files = stdout
            .trim()
            .split("\n")
            .filter((line) => line.length > 0)
            .map((file) => file.replace(toolWorkspacePath + "/", ""));

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
          .describe(
            "One sentence explanation as to why this tool is being used"
          ),
      }),
      execute: async ({ target_file, explanation }) => {
        try {
          console.log(`[DELETE_FILE] ${explanation}`);

          const filePath = path.resolve(toolWorkspacePath, target_file);

          // Get existing content before deletion for database record
          let existingContent: string | undefined;
          try {
            existingContent = await fs.readFile(filePath, "utf-8");
          } catch {
            // File doesn't exist, that's fine
          }

          await fs.unlink(filePath);

          // Save file change to database
          await saveFileChange(
            taskId,
            target_file,
            "DELETE",
            existingContent,
            undefined
          );

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
}

// Helper function to approve pending terminal commands
export function approveTerminalCommand(commandId: string, approved: boolean) {
  const pending = pendingCommands.get(commandId);
  if (!pending) {
    console.warn(`No pending command found for ID: ${commandId}`);
    return false;
  }

  if (approved) {
    pending.resolve({ approved: true });
  } else {
    pending.reject(new Error("Command was rejected by user"));
  }

  pendingCommands.delete(commandId);
  return true;
}

export function getPendingCommands() {
  return Array.from(pendingCommands.entries()).map(([id, cmd]) => ({
    id,
    command: cmd.command,
  }));
}

// Default tools export for backward compatibility (without todo_write)
export const tools = createTools("placeholder-task-id");
