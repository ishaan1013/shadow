import { readFileSync } from "fs";
import { join, dirname } from "path";
import { prisma, TodoStatus } from "@repo/db";
import { tool } from "ai";
import { z } from "zod";
import { createToolExecutor, isLocalMode } from "../execution";
import { LocalFileSystemWatcher } from "../services/local-filesystem-watcher";
import { emitTerminalOutput, emitStreamChunk } from "../socket";
import type { TerminalEntry } from "@repo/types";

// Map to track active filesystem watchers by task ID
const activeFileSystemWatchers = new Map<string, LocalFileSystemWatcher>();

// Terminal entry counter for unique IDs
let terminalEntryId = 1;

// Helper function to create and emit terminal entries
function createAndEmitTerminalEntry(
  taskId: string,
  type: TerminalEntry['type'],
  data: string,
  processId?: number
): void {
  const entry: TerminalEntry = {
    id: terminalEntryId++,
    timestamp: Date.now(),
    data,
    type,
    processId,
  };

  console.log(`[TERMINAL_OUTPUT] Emitting ${type} for task ${taskId}:`, data.slice(0, 100));
  emitTerminalOutput(taskId, entry);
}

// Helper function to read tool descriptions from markdown files
function readDescription(toolName: string): string {
  const descriptionPath = join(dirname(__filename), '../prompt/tools', toolName, "description.md");
  return readFileSync(descriptionPath, 'utf-8').trim();
}

// Factory function to create tools with task context using abstraction layer
export function createTools(taskId: string, workspacePath?: string) {
  console.log(
    `[TOOLS] Creating tools for task ${taskId} with workspace: ${workspacePath || "default"}${workspacePath ? " (task-specific)" : " (fallback)"}`
  );

  // Create tool executor through abstraction layer
  const executor = createToolExecutor(taskId, workspacePath);

  // Initialize filesystem watcher for local mode
  if (isLocalMode() && workspacePath) {
    // Check if we already have a watcher for this task
    if (!activeFileSystemWatchers.has(taskId)) {
      try {
        const watcher = new LocalFileSystemWatcher(taskId);
        watcher.startWatching(workspacePath);
        activeFileSystemWatchers.set(taskId, watcher);
        console.log(`[TOOLS] Started local filesystem watcher for task ${taskId}`);
      } catch (error) {
        console.error(`[TOOLS] Failed to start filesystem watcher for task ${taskId}:`, error);
        // Continue without filesystem watching - not critical for basic operation
      }
    }
  }

  return {
    todo_write: tool({
      description: readDescription('todo_write'),
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
              await prisma.todo.update({
                where: { taskId_id: { taskId, id: todo.id } },
                data: {
                  content: todo.content,
                  status: todo.status.toUpperCase() as TodoStatus,
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
              await prisma.todo.create({
                data: {
                  id: todo.id,
                  content: todo.content,
                  status: todo.status.toUpperCase() as TodoStatus,
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

          const totalTodos = merge ? await prisma.todo.count({ where: { taskId } }) : todos.length;
          const completedTodos = merge ? await prisma.todo.count({
            where: {
              taskId,
              status: 'COMPLETED'
            }
          }) : todos.filter(t => t.status === 'completed').length;

          const summary = `${merge ? "Merged" : "Replaced"} todos: ${results
            .map((r) => `${r.action} "${r.content}" (${r.status})`)
            .join(", ")}`;

          // Emit WebSocket event for real-time todo updates
          emitStreamChunk({
            type: "todo-update",
            todoUpdate: {
              todos: todos.map((todo, index) => ({
                id: todo.id,
                content: todo.content,
                status: todo.status as 'pending' | 'in_progress' | 'completed' | 'cancelled',
                sequence: index
              })),
              action: merge ? "updated" : "replaced",
              totalTodos,
              completedTodos
            }
          }, taskId);

          return {
            success: true,
            message: summary,
            todos: results,
            count: results.length,
            totalTodos,
            completedTodos,
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
      description: readDescription('codebase_search'),
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
        console.log(`[CODEBASE_SEARCH] ${explanation}`);
        const result = await executor.codebaseSearch(query, {
          targetDirectories: target_directories,
        });
        return result;
      },
    }),

    read_file: tool({
      description: readDescription('read_file'),
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
        console.log(`[READ_FILE] ${explanation}`);
        const result = await executor.readFile(target_file, {
          shouldReadEntireFile: should_read_entire_file,
          startLineOneIndexed: start_line_one_indexed,
          endLineOneIndexedInclusive: end_line_one_indexed_inclusive,
        });
        return result;
      },
    }),

    run_terminal_cmd: tool({
      description: readDescription('run_terminal_cmd'),
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

        // Emit the command being executed to the terminal
        createAndEmitTerminalEntry(taskId, "command", command);

        const result = await executor.executeCommand(command, {
          isBackground: is_background,
        });

        // Emit stdout output if present
        if (result.success && result.stdout) {
          createAndEmitTerminalEntry(taskId, "stdout", result.stdout);
        }

        // Emit stderr output if present
        if (result.stderr) {
          createAndEmitTerminalEntry(taskId, "stderr", result.stderr);
        }

        // Emit system message for command completion
        if (result.success) {
          createAndEmitTerminalEntry(
            taskId,
            "system",
            `Command completed successfully`
          );
        } else if (result.error) {
          createAndEmitTerminalEntry(
            taskId,
            "system",
            `Command failed: ${result.error}`
          );
        }

        return result;
      },
    }),

    list_dir: tool({
      description: readDescription('list_dir'),
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
        console.log(`[LIST_DIR] ${explanation}`);
        const result = await executor.listDirectory(relative_workspace_path);
        return result;
      },
    }),

    grep_search: tool({
      description: readDescription('grep_search'),
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
        console.log(`[GREP_SEARCH] ${explanation}`);
        const result = await executor.grepSearch(query, {
          includePattern: include_pattern,
          excludePattern: exclude_pattern,
          caseSensitive: case_sensitive,
        });
        return result;
      },
    }),

    edit_file: tool({
      description: readDescription('edit_file'),
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
        console.log(`[EDIT_FILE] ${instructions}`);
        const result = await executor.writeFile(target_file, code_edit, instructions);
        return result;
      },
    }),

    search_replace: tool({
      description: readDescription('search_replace'),
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
        console.log(`[SEARCH_REPLACE] Replacing text in ${file_path}`);
        const result = await executor.searchReplace(file_path, old_string, new_string);
        return result;
      },
    }),

    file_search: tool({
      description: readDescription('file_search'),
      parameters: z.object({
        query: z.string().describe("Fuzzy filename to search for"),
        explanation: z
          .string()
          .describe(
            "One sentence explanation as to why this tool is being used"
          ),
      }),
      execute: async ({ query, explanation }) => {
        console.log(`[FILE_SEARCH] ${explanation}`);
        const result = await executor.searchFiles(query);
        return result;
      },
    }),

    delete_file: tool({
      description: readDescription('delete_file'),
      parameters: z.object({
        target_file: z.string().describe("The path of the file to delete"),
        explanation: z
          .string()
          .describe(
            "One sentence explanation as to why this tool is being used"
          ),
      }),
      execute: async ({ target_file, explanation }) => {
        console.log(`[DELETE_FILE] ${explanation}`);
        const result = await executor.deleteFile(target_file);
        return result;
      },
    }),
    semantic_search: tool({
      description: readDescription('semantic_search'),
      parameters: z.object({
        query: z.string().describe("The query to search the codebase for"),
        explanation: z
          .string()
          .describe(
            "One sentence explanation as to why this tool is being used"
          ),
      }),
      execute: async ({ query, explanation }) => {
        console.log(`[SEMANTIC_SEARCH] ${explanation}`);

        const task = await prisma.task.findUnique({
          where: { id: taskId },
          select: { repoUrl: true }
        });

        if (!task) {
          throw new Error(`Task ${taskId} not found`);
        }

        const repoMatch = task.repoUrl.match(/github\.com\/([^\/]+\/[^\/]+)/);
        const repo = repoMatch ? repoMatch[1] : task.repoUrl;
        if (!repo) {
          console.warn(`[SEMANTIC_SEARCH] No repo found for task ${taskId}, falling back to codebase_search`);
          return await executor.codebaseSearch(query);
        } else {
          console.log(`[SEMANTIC_SEARCH] Using repo: ${repo}`);
          const result = await executor.semanticSearch(query, repo);
          return result;
        }
      },
    }),
    web_search: tool({
      description: readDescription('web_search'),
      parameters: z.object({
        query: z.string().describe("The search query"),
        domain: z.string().optional().describe("Optional domain to filter results to"),
        explanation: z
          .string()
          .describe(
            "One sentence explanation as to why this tool is being used"
          ),
      }),
      execute: async ({ query, domain, explanation }) => {
        console.log(`[WEB_SEARCH] ${explanation}`);
        const result = await executor.webSearch(query, domain);
        return result;
      },
    }),
  };
}


/**
 * Stop filesystem watcher for a specific task
 */
export function stopFileSystemWatcher(taskId: string): void {
  const watcher = activeFileSystemWatchers.get(taskId);
  if (watcher) {
    watcher.stop();
    activeFileSystemWatchers.delete(taskId);
    console.log(`[TOOLS] Stopped filesystem watcher for task ${taskId}`);
  }
}

/**
 * Stop all active filesystem watchers (for graceful shutdown)
 */
export function stopAllFileSystemWatchers(): void {
  console.log(`[TOOLS] Stopping ${activeFileSystemWatchers.size} active filesystem watchers`);

  for (const [taskId, watcher] of activeFileSystemWatchers.entries()) {
    watcher.stop();
    console.log(`[TOOLS] Stopped filesystem watcher for task ${taskId}`);
  }

  activeFileSystemWatchers.clear();
}

/**
 * Get statistics about active filesystem watchers
 */
export function getFileSystemWatcherStats() {
  const stats = [];
  for (const [_taskId, watcher] of activeFileSystemWatchers.entries()) {
    stats.push(watcher.getStats());
  }
  return {
    activeWatchers: activeFileSystemWatchers.size,
    watcherDetails: stats
  };
}

// Default tools export for backward compatibility (without todo_write)
// Made lazy to avoid circular dependencies
let _defaultTools: ReturnType<typeof createTools> | undefined;
export const tools = new Proxy({} as ReturnType<typeof createTools>, {
  get(_target, prop) {
    if (!_defaultTools) {
      _defaultTools = createTools("placeholder-task-id");
    }
    return _defaultTools![prop as keyof ReturnType<typeof createTools>];
  }
});