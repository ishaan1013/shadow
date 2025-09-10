import { readFileSync } from "fs";
import { join, dirname } from "path";
import { z } from "zod";
import { prisma, TodoStatus, MemoryCategory } from "@repo/db";
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
} from "@repo/types";
import { createToolExecutor, isLocalMode } from "../../execution";
import { getLocalWorkspacePathForId } from "../../execution";
import { LocalFileSystemWatcher } from "../../services/local-filesystem-watcher";
import { emitTerminalOutput, emitStreamChunk } from "../../socket";
import { isIndexingComplete } from "../../initialization/background-indexing";
import type { TerminalEntry } from "@repo/types";
import { MCPManager } from "../mcp/mcp-manager";
import {
  transformMCPToolName,
  type MCPToolMeta,
  type MCPToolWrapper,
} from "@repo/types";

const MAX_CONTEXT7_TOKENS = 4000;

// Map to track active filesystem watchers by variant ID
const activeFileSystemWatchers = new Map<string, LocalFileSystemWatcher>();

// Map to track MCP managers by task ID
const activeMCPManagers = new Map<string, MCPManager>();

// MCP tool name processing is now handled by shared utilities in @repo/types

/**
 * Create a type-safe MCP tool wrapper for AI SDK compatibility
 */
function createMCPToolWrapper(
  originalName: string,
  mcpTool: {
    execute: (params: Record<string, unknown>) => Promise<unknown>;
    description: string;
    parameters: unknown;
  }
): MCPToolWrapper {
  const transformedName = transformMCPToolName(originalName);
  const [serverName, toolName] = originalName.includes(":")
    ? originalName.split(":")
    : [
        originalName.split("_")[0] || "unknown",
        originalName.split("_").slice(1).join("_") || "tool",
      ];

  const meta: MCPToolMeta = {
    originalName,
    transformedName,
    serverName: serverName || "unknown",
    toolName: toolName || "tool",
  };

  return {
    ...mcpTool,
    execute: async (params: Record<string, unknown>) => {
      console.log(
        `[MCP_TOOL] Executing ${originalName} (transformed from ${transformedName})`
      );

      const modifiedParams = { ...params };
      if (originalName.startsWith("context7:") && "tokens" in params) {
        const originalTokens = params.tokens;
        const maxTokens = MAX_CONTEXT7_TOKENS;

        if (typeof originalTokens === "number" && originalTokens > maxTokens) {
          modifiedParams.tokens = maxTokens;
          console.log(
            `[MCP_TOOL] Limited Context7 tokens: ${originalTokens} → ${maxTokens}`
          );
        }
      }

      try {
        return await mcpTool.execute(modifiedParams);
      } catch (error) {
        console.error(`[MCP_TOOL] Error executing ${originalName}:`, error);
        throw error;
      }
    },
    meta,
  };
}

/**
 * Get the active filesystem watcher for a task (local mode only)
 */
export function getFileSystemWatcher(
  variantId: string
): LocalFileSystemWatcher | null {
  return activeFileSystemWatchers.get(variantId) || null;
}

/**
 * Get the active MCP manager for a task
 */
export function getMCPManager(taskId: string): MCPManager | null {
  return activeMCPManagers.get(taskId) || null;
}

// Terminal entry counters for unique IDs per task
const taskTerminalCounters = new Map<string, number>();

// Helper function to get next terminal entry ID for a task
function getNextTerminalEntryId(taskId: string): number {
  const currentId = taskTerminalCounters.get(taskId) || 0;
  const nextId = currentId + 1;
  taskTerminalCounters.set(taskId, nextId);
  return nextId;
}

// Helper function to create and emit terminal entries
function createAndEmitTerminalEntry(
  taskId: string,
  variantId: string,
  type: TerminalEntry["type"],
  data: string,
  processId?: number
): void {
  const entry: TerminalEntry = {
    id: getNextTerminalEntryId(taskId),
    timestamp: Date.now(),
    data,
    type,
    processId,
  };

  console.log(
    `[TERMINAL_OUTPUT] Emitting ${type} for task ${taskId}:`,
    data.slice(0, 100)
  );
  emitTerminalOutput(variantId, taskId, entry);
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
export async function createTools(
  taskId: string,
  variantId: string,
  workspacePath?: string
) {
  console.log(
    `[TOOLS] Creating tools for task ${taskId} (variant ${variantId}) with workspace: ${workspacePath || "default"}${workspacePath ? " (task-specific)" : " (fallback)"}`
  );

  if (isLocalMode() && !workspacePath) {
    workspacePath = getLocalWorkspacePathForId(variantId);
  }

  // Create tool executor through abstraction layer
  // The factory function is now smart enough to handle mode detection internally:
  // - Local mode: uses workspacePath for filesystem operations
  // - Remote mode: uses dynamic pod discovery to find actual running VMs
  const executor = await createToolExecutor(taskId, workspacePath);

  // Initialize MCP manager if enabled
  let mcpManager: MCPManager | undefined;
  try {
    // Check if we already have an MCP manager for this task
    if (!activeMCPManagers.has(taskId)) {
      console.log(`[TOOLS] Initializing MCP manager for task ${taskId}`);
      mcpManager = new MCPManager();
      await mcpManager.initializeConnections();
      activeMCPManagers.set(taskId, mcpManager);
      console.log(`[TOOLS] MCP manager initialized for task ${taskId}`);
    } else {
      mcpManager = activeMCPManagers.get(taskId);
      console.log(`[TOOLS] Reusing existing MCP manager for task ${taskId}`);
    }
  } catch (error) {
    console.error(
      `[TOOLS] Failed to initialize MCP manager for task ${taskId}:`,
      error
    );
  }

  // Initialize filesystem watcher for local mode
  if (isLocalMode() && workspacePath) {
    // Check if we already have a watcher for this task
    if (!activeFileSystemWatchers.has(variantId)) {
      try {
        const watcher = new LocalFileSystemWatcher(taskId, variantId);
        watcher.startWatching(workspacePath);
        activeFileSystemWatchers.set(variantId, watcher);
        console.log(
          `[TOOLS] Started local filesystem watcher for variant ${variantId} (task ${taskId}) at ${workspacePath}`
        );
      } catch (error) {
        console.error(
          `[TOOLS] Failed to start filesystem watcher for variant ${variantId} (task ${taskId}):`,
          error
        );
      }
    }
  }

  // Check if semantic search should be available
  let includeSemanticSearch = false;
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { repoUrl: true },
    });

    if (task) {
      const repoMatch = task.repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
      const repo = repoMatch ? repoMatch[1] : null;
      if (repo) {
        includeSemanticSearch = await isIndexingComplete(repo);
        console.log(
          `[TOOLS] Semantic search ${includeSemanticSearch ? "enabled" : "disabled"} for repo ${repo} (indexing ${includeSemanticSearch ? "complete" : "incomplete"})`
        );
      }
    }
  } catch (error) {
    console.error(
      `[TOOLS] Failed to check indexing status for task ${taskId}:`,
      error
    );
  }

  const baseTools = {
    todo_write: tool({
      description: readDescription("todo_write"),
      parameters: TodoWriteParamsSchema,
      execute: async ({ merge, todos, explanation }) => {
        try {
          console.log(`[TODO_WRITE] ${explanation}`);

          if (!merge) {
            // Replace: delete existing todos for this variant
            await prisma.todo.deleteMany({
              where: { taskId, variantId },
            });
          }

          // Process todos in order
          const results = [];
          for (let i = 0; i < todos.length; i++) {
            const todo = todos[i];
            if (!todo) continue; // Skip undefined items

            // Check if todo exists (by id within the task)
            const existingTodo = await prisma.todo.findFirst({
              where: { taskId, variantId, id: todo.id },
            });

            if (existingTodo) {
              // Update existing todo
              await prisma.todo.update({
                where: { taskId_id: { taskId, id: todo.id } },
                data: {
                  content: todo.content,
                  status: todo.status.toUpperCase() as TodoStatus,
                  sequence: i,
                  variantId,
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
                  variantId,
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
            ? await prisma.todo.count({
                where: { taskId, variantId },
              })
            : todos.length;
          const completedTodos = merge
            ? await prisma.todo.count({
                where: { taskId, variantId, status: "COMPLETED" },
              })
            : todos.filter((t) => t.status === "completed").length;

          const summary = `${merge ? "Merged" : "Replaced"} todos: ${results
            .map((r) => `${r.action} "${r.content}" (${r.status})`)
            .join(", ")}`;

          // Emit WebSocket event for real-time todo updates
          emitStreamChunk(
            {
              type: "todo-update",
              todoUpdate: {
                todos: todos.map((todo, index: number) => ({
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
            variantId,
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
        createAndEmitTerminalEntry(taskId, variantId, "command", command);

        const result = await executor.executeCommand(command, {
          isBackground: is_background,
        });

        // Emit stdout output if present
        if (result.success && result.stdout) {
          createAndEmitTerminalEntry(
            taskId,
            variantId,
            "stdout",
            result.stdout
          );
        }

        // Emit stderr output if present
        if (result.stderr) {
          createAndEmitTerminalEntry(
            taskId,
            variantId,
            "stderr",
            result.stderr
          );
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
      execute: async ({
        target_file,
        instructions,
        code_edit,
        is_new_file,
      }) => {
        console.log(`[EDIT_FILE] ${instructions}`);
        const result = await executor.writeFile(
          target_file,
          code_edit,
          instructions,
          is_new_file
        );
        return result;
      },
    }),

    search_replace: tool({
      description: readDescription("search_replace"),
      parameters: SearchReplaceParamsSchema,
      execute: async ({ file_path, old_string, new_string, is_new_file }) => {
        console.log(`[SEARCH_REPLACE] Replacing text in ${file_path}`);
        const result = await executor.searchReplace(
          file_path,
          old_string,
          new_string,
          is_new_file
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

    add_memory: tool({
      description: readDescription("add_memory"),
      parameters: z.object({
        content: z.string().describe("Concise memory content to store"),
        category: z
          .enum([
            "INFRA",
            "SETUP",
            "STYLES",
            "ARCHITECTURE",
            "TESTING",
            "PATTERNS",
            "BUGS",
            "PERFORMANCE",
            "CONFIG",
            "GENERAL",
          ])
          .describe("Category for organizing the memory"),
        explanation: z
          .string()
          .describe(
            "One sentence explanation for why this memory is being added"
          ),
      }),
      execute: async ({ content, category, explanation }) => {
        try {
          console.log(`[ADD_MEMORY] ${explanation}`);

          // Get task info for repository context
          const task = await prisma.task.findUnique({
            where: { id: taskId },
            select: { repoFullName: true, repoUrl: true, userId: true },
          });

          if (!task) {
            throw new Error(`Task ${taskId} not found`);
          }

          // Create repository-specific memory
          const memory = await prisma.memory.create({
            data: {
              content,
              category: category as MemoryCategory,
              repoFullName: task.repoFullName,
              repoUrl: task.repoUrl,
              userId: task.userId,
              taskId,
            },
          });

          return {
            success: true,
            memory: {
              id: memory.id,
              content: memory.content,
              category: memory.category,
              repoFullName: memory.repoFullName,
              createdAt: memory.createdAt,
            },
            message: `Added repository memory: ${content}`,
          };
        } catch (error) {
          console.error(`[ADD_MEMORY_ERROR]`, error);
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            message: "Failed to add memory",
          };
        }
      },
    }),

    list_memories: tool({
      description: readDescription("list_memories"),
      parameters: z.object({
        category: z
          .enum([
            "INFRA",
            "SETUP",
            "STYLES",
            "ARCHITECTURE",
            "TESTING",
            "PATTERNS",
            "BUGS",
            "PERFORMANCE",
            "CONFIG",
            "GENERAL",
          ])
          .optional()
          .describe("Optional category filter"),
        explanation: z
          .string()
          .describe(
            "One sentence explanation for why memories are being listed"
          ),
      }),
      execute: async ({ category, explanation }) => {
        try {
          console.log(`[LIST_MEMORIES] ${explanation}`);

          // Get task info
          const task = await prisma.task.findUnique({
            where: { id: taskId },
            select: { repoFullName: true, userId: true },
          });

          if (!task) {
            throw new Error(`Task ${taskId} not found`);
          }

          // Build filter conditions
          const whereConditions: {
            userId: string;
            repoFullName: string;
            category?: MemoryCategory;
          } = {
            userId: task.userId,
            repoFullName: task.repoFullName,
          };

          if (category) {
            whereConditions.category = category as MemoryCategory;
          }

          // Get memories
          const memories = await prisma.memory.findMany({
            where: whereConditions,
            orderBy: [{ category: "asc" }, { createdAt: "desc" }],
            select: {
              id: true,
              content: true,
              category: true,
              repoFullName: true,
              createdAt: true,
            },
          });

          // Group by category for better organization
          const memoriesByCategory = memories.reduce(
            (acc, memory) => {
              if (!acc[memory.category]) {
                acc[memory.category] = [];
              }
              acc[memory.category]!.push(memory);
              return acc;
            },
            {} as Record<string, typeof memories>
          );

          return {
            success: true,
            memories,
            memoriesByCategory,
            totalCount: memories.length,
            message: `Found ${memories.length} memories`,
          };
        } catch (error) {
          console.error(`[LIST_MEMORIES_ERROR]`, error);
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            message: "Failed to list memories",
          };
        }
      },
    }),

    remove_memory: tool({
      description: readDescription("remove_memory"),
      parameters: z.object({
        memoryId: z.string().describe("ID of the memory to remove"),
        explanation: z
          .string()
          .describe(
            "One sentence explanation for why this memory is being removed"
          ),
      }),
      execute: async ({ memoryId, explanation }) => {
        try {
          console.log(`[REMOVE_MEMORY] ${explanation}`);

          // Get task info
          const task = await prisma.task.findUnique({
            where: { id: taskId },
            select: { userId: true },
          });

          if (!task) {
            throw new Error(`Task ${taskId} not found`);
          }

          // Get memory to verify ownership
          const memory = await prisma.memory.findFirst({
            where: {
              id: memoryId,
              userId: task.userId,
            },
          });

          if (!memory) {
            return {
              success: false,
              error: "Memory not found or access denied",
              message:
                "Cannot remove memory that doesn't exist or belong to you",
            };
          }

          // Delete the memory
          await prisma.memory.delete({
            where: { id: memoryId },
          });

          return {
            success: true,
            removedMemory: {
              id: memory.id,
              content: memory.content,
              category: memory.category,
            },
            message: `Removed memory: ${memory.content}`,
          };
        } catch (error) {
          console.error(`[REMOVE_MEMORY_ERROR]`, error);
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            message: "Failed to remove memory",
          };
        }
      },
    }),
  };

  // Get MCP tools if manager is available
  const mcpTools: Record<string, MCPToolWrapper> = {};
  if (mcpManager) {
    try {
      const rawMCPTools = await mcpManager.getAvailableTools();
      console.log(
        `[TOOLS] Retrieved ${Object.keys(rawMCPTools).length} raw MCP tools for task ${taskId}`
      );

      for (const [originalName, mcpTool] of Object.entries(rawMCPTools)) {
        const transformedName = transformMCPToolName(originalName);

        console.log(`[MCP_TRANSFORM] ${originalName} → ${transformedName}`);

        const wrappedTool = createMCPToolWrapper(
          originalName,
          mcpTool as {
            execute: (params: Record<string, unknown>) => Promise<unknown>;
            description: string;
            parameters: unknown;
          }
        );

        mcpTools[transformedName] = wrappedTool;
      }

      console.log(
        `✅ [MCP_SUCCESS] Registered ${Object.keys(mcpTools).length} MCP tools:`,
        Object.keys(mcpTools)
      );
    } catch (error) {
      console.error(
        `[TOOLS] Failed to get MCP tools for task ${taskId}:`,
        error
      );
    }
  }

  // Conditionally add semantic search tool if indexing is complete
  if (includeSemanticSearch) {
    return {
      ...baseTools,
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
              (grepResult.matches || []).map((match, i) => ({
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
              query: query,
              searchTerms: query.split(/\s+/).filter((term) => term.length > 0),
              message:
                (grepResult.message || "Failed to search") +
                " (fallback to grep)",
              error: grepResult.error,
            };
          } else {
            console.log(`[SEMANTIC_SEARCH] Using repo: ${repo}`);
            const result = await executor.semanticSearch(query, repo);
            return result;
          }
        },
      }),
      ...mcpTools, // Add MCP tools to the toolset
    };
  }

  return {
    ...baseTools,
    ...mcpTools, // Add MCP tools to the toolset
  };
}

/**
 * Stop filesystem watcher for a specific task
 */
export function stopFileSystemWatcher(variantId: string): void {
  const watcher = activeFileSystemWatchers.get(variantId);
  if (watcher) {
    watcher.stop();
    activeFileSystemWatchers.delete(variantId);
    console.log(`[TOOLS] Stopped filesystem watcher for variant ${variantId}`);
  }
}

/**
 * Stop MCP manager for a specific task
 */
export async function stopMCPManager(taskId: string): Promise<void> {
  const manager = activeMCPManagers.get(taskId);
  if (manager) {
    try {
      await manager.closeAllConnections();
      activeMCPManagers.delete(taskId);
      console.log(`[TOOLS] Stopped MCP manager for task ${taskId}`);
    } catch (error) {
      console.error(
        `[TOOLS] Error stopping MCP manager for task ${taskId}:`,
        error
      );
      // Still remove from map even if cleanup failed
      activeMCPManagers.delete(taskId);
    }
  }
}

/**
 * Stop all active filesystem watchers (for graceful shutdown)
 */
export function stopAllFileSystemWatchers(): void {
  console.log(
    `[TOOLS] Stopping ${activeFileSystemWatchers.size} active filesystem watchers`
  );

  for (const [variantId, watcher] of Array.from(
    activeFileSystemWatchers.entries()
  )) {
    watcher.stop();
    console.log(`[TOOLS] Stopped filesystem watcher for variant ${variantId}`);
  }

  activeFileSystemWatchers.clear();
}

/**
 * Stop all active MCP managers (for graceful shutdown)
 */
export async function stopAllMCPManagers(): Promise<void> {
  console.log(`[TOOLS] Stopping ${activeMCPManagers.size} active MCP managers`);

  const stopPromises = Array.from(activeMCPManagers.entries()).map(
    async ([taskId, manager]) => {
      try {
        await manager.closeAllConnections();
        console.log(`[TOOLS] Stopped MCP manager for task ${taskId}`);
      } catch (error) {
        console.error(
          `[TOOLS] Error stopping MCP manager for task ${taskId}:`,
          error
        );
      }
    }
  );

  await Promise.allSettled(stopPromises);
  activeMCPManagers.clear();
}

/**
 * Get statistics about active filesystem watchers
 */
export function getFileSystemWatcherStats() {
  const stats = [];
  for (const [_variantId, watcher] of Array.from(
    activeFileSystemWatchers.entries()
  )) {
    stats.push(watcher.getStats());
  }
  return {
    activeWatchers: activeFileSystemWatchers.size,
    watcherDetails: stats,
  };
}

/**
 * Clean up terminal counter for a specific task
 */
export function cleanupTaskTerminalCounters(taskId: string): void {
  taskTerminalCounters.delete(taskId);
  console.log(`[TOOLS] Cleaned up terminal counters for task ${taskId}`);
}

// Default tools export
// Made lazy to avoid circular dependencies
let _defaultTools: Awaited<ReturnType<typeof createTools>> | undefined;
let _defaultToolsPromise:
  | Promise<Awaited<ReturnType<typeof createTools>>>
  | undefined;

export const tools = new Proxy({} as Awaited<ReturnType<typeof createTools>>, {
  get(_target, prop) {
    if (!_defaultTools && !_defaultToolsPromise) {
      _defaultToolsPromise = createTools(
        "placeholder-task-id",
        "placeholder-variant-id"
      ).then((tools) => {
        _defaultTools = tools;
        return tools;
      });
    }
    if (_defaultTools) {
      return _defaultTools[
        prop as keyof Awaited<ReturnType<typeof createTools>>
      ];
    }
    // If tools aren't ready yet, throw an error indicating they need to be awaited
    throw new Error(
      "Tools are not ready yet. Use createTools() directly for async initialization."
    );
  },
});
