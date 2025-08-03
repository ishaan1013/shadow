import { readFileSync } from "fs";
import { join, dirname } from "path";
import { prisma, TodoStatus } from "@repo/db";
import { tool } from "ai";
import {
  TodoWriteParamsSchema,
  ReadFileParamsSchema,
  EditFileParamsSchema,
  SearchReplaceParamsSchema,
  RunTerminalCmdParamsSchema,
  ListDirParamsSchema,
  GrepSearchParamsSchema,
  FileSearchParamsSchema,
  DeleteFileParamsSchema,
  SemanticSearchParamsSchema,
  WebSearchParamsSchema,
} from "@repo/types";
import { createToolExecutor, isLocalMode } from "../../execution";
import { LocalFileSystemWatcher } from "../../services/local-filesystem-watcher";
import { emitTerminalOutput, emitStreamChunk } from "../../socket";
import type { TerminalEntry } from "@repo/types";

// Map to track active filesystem watchers by task ID
const activeFileSystemWatchers = new Map<string, LocalFileSystemWatcher>();

// Terminal entry counter for unique IDs
let terminalEntryId = 1;

// Helper function to create and emit terminal entries
function createAndEmitTerminalEntry(
  taskId: string,
  type: TerminalEntry["type"],
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

  console.log(
    `[TERMINAL_OUTPUT] Emitting ${type} for task ${taskId}:`,
    data.slice(0, 100)
  );
  emitTerminalOutput(taskId, entry);
}

// Helper function to read tool descriptions from markdown files
function readDescription(toolName: string): string {
  const descriptionPath = join(
    dirname(__filename),
    "prompts",
    toolName,
    "description.md"
  );
  return readFileSync(descriptionPath, "utf-8").trim();
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
        console.log(
          `[TOOLS] Started local filesystem watcher for task ${taskId}`
        );
      } catch (error) {
        console.error(
          `[TOOLS] Failed to start filesystem watcher for task ${taskId}:`,
          error
        );
        // Continue without filesystem watching - not critical for basic operation
      }
    }
  }

  return {
    todo_write: tool({
      description: readDescription("todo_write"),
      parameters: TodoWriteParamsSchema,
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

          const totalTodos = merge
            ? await prisma.todo.count({ where: { taskId } })
            : todos.length;
          const completedTodos = merge
            ? await prisma.todo.count({
                where: {
                  taskId,
                  status: "COMPLETED",
                },
              })
            : todos.filter((t: any) => t.status === "completed").length;

          const summary = `${merge ? "Merged" : "Replaced"} todos: ${results
            .map((r) => `${r.action} "${r.content}" (${r.status})`)
            .join(", ")}`;

          // Emit WebSocket event for real-time todo updates
          emitStreamChunk(
            {
              type: "todo-update",
              todoUpdate: {
                todos: todos.map((todo: any, index: number) => ({
                  id: todo.id,
                  content: todo.content,
                  status: todo.status as
                    | "pending"
                    | "in_progress"
                    | "completed"
                    | "cancelled",
                  sequence: index,
                })),
                action: merge ? "updated" : "replaced",
                totalTodos,
                completedTodos,
              },
            },
            taskId
          );

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

    read_file: tool({
      description: readDescription("read_file"),
      parameters: ReadFileParamsSchema,
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
      description: readDescription("run_terminal_cmd"),
      parameters: RunTerminalCmdParamsSchema,
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

        return result;
      },
    }),

    list_dir: tool({
      description: readDescription("list_dir"),
      parameters: ListDirParamsSchema,
      execute: async ({ relative_workspace_path, explanation }) => {
        console.log(`[LIST_DIR] ${explanation}`);
        const result = await executor.listDirectory(relative_workspace_path);
        return result;
      },
    }),

    grep_search: tool({
      description: readDescription("grep_search"),
      parameters: GrepSearchParamsSchema,
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
      description: readDescription("edit_file"),
      parameters: EditFileParamsSchema,
      execute: async ({ target_file, instructions, code_edit }) => {
        console.log(`[EDIT_FILE] ${instructions}`);
        const result = await executor.writeFile(
          target_file,
          code_edit,
          instructions
        );
        return result;
      },
    }),

    search_replace: tool({
      description: readDescription("search_replace"),
      parameters: SearchReplaceParamsSchema,
      execute: async ({ file_path, old_string, new_string }) => {
        console.log(`[SEARCH_REPLACE] Replacing text in ${file_path}`);
        const result = await executor.searchReplace(
          file_path,
          old_string,
          new_string
        );
        return result;
      },
    }),

    file_search: tool({
      description: readDescription("file_search"),
      parameters: FileSearchParamsSchema,
      execute: async ({ query, explanation }) => {
        console.log(`[FILE_SEARCH] ${explanation}`);
        const result = await executor.searchFiles(query);
        return result;
      },
    }),

    delete_file: tool({
      description: readDescription("delete_file"),
      parameters: DeleteFileParamsSchema,
      execute: async ({ target_file, explanation }) => {
        console.log(`[DELETE_FILE] ${explanation}`);
        const result = await executor.deleteFile(target_file);
        return result;
      },
    }),
    semantic_search: tool({
      description: readDescription("semantic_search"),
      parameters: SemanticSearchParamsSchema,
      execute: async ({ query, explanation }) => {
        console.log(`[SEMANTIC_SEARCH] ${explanation}`);

        const task = await prisma.task.findUnique({
          where: { id: taskId },
          select: { repoUrl: true },
        });

        if (!task) {
          throw new Error(`Task ${taskId} not found`);
        }

        // eslint-disable-next-line no-useless-escape
        const repoMatch = task.repoUrl.match(/github\.com\/([^\/]+\/[^\/]+)/);
        const repo = repoMatch ? repoMatch[1] : task.repoUrl;
        if (!repo) {
          console.warn(
            `[SEMANTIC_SEARCH] No repo found for task ${taskId}, falling back to grep_search`
          );
          const grepResult = await executor.grepSearch(query);

          // Convert GrepResult to SemanticSearchToolResult format
          const results =
            grepResult.detailedMatches?.map((match, i) => ({
              id: i + 1,
              content: match.content,
              relevance: 0.8,
              filePath: match.file,
              lineStart: match.lineNumber,
              lineEnd: match.lineNumber,
              language: "",
              kind: "",
            })) ||
            grepResult.matches.map((match, i) => ({
              id: i + 1,
              content: match,
              relevance: 0.8,
              filePath: "",
              lineStart: 0,
              lineEnd: 0,
              language: "",
              kind: "",
            }));

          return {
            success: grepResult.success,
            results,
            query: grepResult.query,
            searchTerms: grepResult.query.split(/\s+/),
            message: grepResult.message + " (fallback to grep)",
            error: grepResult.error,
          };
        } else {
          console.log(`[SEMANTIC_SEARCH] Using repo: ${repo}`);
          const result = await executor.semanticSearch(query, repo);
          return result;
        }
      },
    }),
    web_search: tool({
      description: readDescription("web_search"),
      parameters: WebSearchParamsSchema,
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
  console.log(
    `[TOOLS] Stopping ${activeFileSystemWatchers.size} active filesystem watchers`
  );

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
    watcherDetails: stats,
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
  },
});
