import { prisma } from "@repo/db";
import { CheckpointData, MessageMetadata } from "@repo/types";
import type { Todo } from "@repo/db";
import { emitStreamChunk } from "../socket";
import { createToolExecutor, createGitService } from "../execution";
import { getFileSystemWatcher } from "../agent/tools";
import { buildTreeFromEntries } from "../files/build-tree";
import config from "../config";

/**
 * CheckpointService handles creating and restoring message-level checkpoints
 * for time-travel editing functionality
 */
export class CheckpointService {
  /**
   * Create a checkpoint for a message after successful completion
   */
  async createCheckpoint(taskId: string, messageId: string): Promise<void> {
    console.log(
      `[CHECKPOINT] ✨ Starting checkpoint creation for task ${taskId}, message ${messageId}`
    );

    try {
      // Create git service for the task (handles both local and remote modes)
      console.log(`[CHECKPOINT] 🔧 Creating git service for task ${taskId}...`);
      const gitService = await createGitService(taskId);

      // 1. Ensure all changes are committed (reuse existing logic)
      console.log(`[CHECKPOINT] 🔍 Checking for uncommitted changes...`);
      const hasChanges = await gitService.hasChanges();
      if (hasChanges) {
        console.warn(
          `[CHECKPOINT] ⚠️ Skipping checkpoint creation - workspace has uncommitted changes`
        );
        return; // Skip checkpoint if workspace is dirty
      }

      // 2. Capture current state
      console.log(`[CHECKPOINT] 📸 Capturing current state...`);
      const commitSha = await gitService.getCurrentCommitSha();
      const todoSnapshot = await this.getTodoSnapshot(taskId);

      console.log(`[CHECKPOINT] 🎯 Captured commit SHA: ${commitSha}`);
      console.log(`[CHECKPOINT] 📝 Captured ${todoSnapshot.length} todos`);
      if (todoSnapshot.length > 0) {
        console.log(
          `[CHECKPOINT] Todo statuses: ${todoSnapshot.map((t) => `${t.content.substring(0, 30)}... (${t.status})`).join(", ")}`
        );
      }

      // 3. Get existing message metadata
      const existingMessage = await prisma.chatMessage.findUnique({
        where: { id: messageId },
        select: { metadata: true },
      });

      const existingMetadata = existingMessage?.metadata || {};

      // 4. Store checkpoint in message metadata
      const checkpointData: CheckpointData = {
        commitSha,
        todoSnapshot,
        createdAt: new Date().toISOString(),
        workspaceState: "clean",
      };

      const metadata = {
        ...(existingMetadata as MessageMetadata),
        checkpoint: checkpointData,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      await prisma.chatMessage.update({
        where: { id: messageId },
        data: {
          metadata,
        },
      });

      console.log(
        `[CHECKPOINT] ✅ Successfully created checkpoint for message ${messageId} at commit ${commitSha}`
      );
    } catch (error) {
      console.error(
        `[CHECKPOINT] ❌ Failed to create checkpoint for message ${messageId}:`,
        error
      );
      // Non-blocking - don't fail the chat flow
    }
  }

  /**
   * Restore workspace to the state at a specific message
   * Now variant-specific for proper workspace restoration
   */
  async restoreCheckpoint(
    taskId: string,
    variantId: string,
    targetMessageId: string
  ): Promise<void> {
    console.log(
      `[CHECKPOINT] 🔄 Starting checkpoint restoration for task ${taskId}, target message ${targetMessageId}`
    );

    try {
      // 1. Find the most recent assistant message at or before target with checkpoint data
      console.log(
        `[CHECKPOINT] 🔍 Looking for checkpoint message at or before target...`
      );
      const checkpointMessage = await this.findCheckpointMessage(
        taskId,
        targetMessageId
      );

      if (!checkpointMessage?.metadata?.checkpoint) {
        console.log(
          `[CHECKPOINT] 📍 No checkpoint found - restoring to initial repository state for message ${targetMessageId}`
        );
        await this.restoreToInitialState(taskId, variantId);
        return;
      }

      const checkpoint = checkpointMessage.metadata
        .checkpoint as CheckpointData;

      console.log(
        `[CHECKPOINT] 🎯 Found checkpoint from message ${checkpointMessage.id}`
      );
      console.log(
        `[CHECKPOINT] 📅 Checkpoint created at: ${checkpoint.createdAt}`
      );
      console.log(`[CHECKPOINT] 🎯 Target commit SHA: ${checkpoint.commitSha}`);
      console.log(
        `[CHECKPOINT] 📝 Checkpoint has ${checkpoint.todoSnapshot.length} todos`
      );

      // Create git service for the task (handles both local and remote modes)
      console.log(`[CHECKPOINT] 🔧 Creating git service for task ${taskId}...`);
      const gitService = await createGitService(taskId);

      // 2. Pause filesystem watcher to prevent spurious events from git operations
      await this.pauseFilesystemWatcher(taskId);

      // 3. Handle uncommitted changes
      console.log(`[CHECKPOINT] 🔍 Checking for uncommitted changes...`);
      const hasChanges = await gitService.hasChanges();
      if (hasChanges) {
        console.warn(
          `[CHECKPOINT] ⚠️ Uncommitted changes detected before checkpoint restoration. Git checkout will fail if these changes would be overwritten.`
        );
      } else {
        console.log(
          `[CHECKPOINT] ✨ Workspace is clean, proceeding with restore`
        );
      }

      // 4. Restore git state
      console.log(
        `[CHECKPOINT] ⏪ Attempting git checkout to ${checkpoint.commitSha}...`
      );
      const success = await gitService.safeCheckoutCommit(checkpoint.commitSha);
      if (!success) {
        console.warn(
          `[CHECKPOINT] ⚠️ Could not checkout to ${checkpoint.commitSha}, continuing with current state`
        );
      } else {
        console.log(
          `[CHECKPOINT] ✅ Successfully checked out to commit ${checkpoint.commitSha}`
        );
      }

      // Restore todo state
      await this.restoreTodoState(taskId, checkpoint.todoSnapshot);
      this.emitTodoUpdate(taskId, variantId, checkpoint.todoSnapshot);

      // Wait for git state to settle, then recompute and emit file state
      await new Promise((resolve) => setTimeout(resolve, 150));
      await this.recomputeAndEmitFileState(taskId, variantId);

      // Resume filesystem watcher after fs-override has been sent
      await new Promise((resolve) => setTimeout(resolve, 200));
      await this.resumeFilesystemWatcher(taskId);

      console.log(`[CHECKPOINT] Restored to message ${checkpointMessage.id}`);
    } catch (error) {
      console.error(`[CHECKPOINT] Failed to restore checkpoint:`, error);
      // Continue with edit flow even if restore fails
    }
  }

  /**
   * Get a snapshot of the current todo state
   */
  private async getTodoSnapshot(taskId: string): Promise<Todo[]> {
    return await prisma.todo.findMany({
      where: { taskId },
      orderBy: { sequence: "asc" },
    });
  }

  /**
   * Restore todo state from a snapshot
   */
  private async restoreTodoState(
    taskId: string,
    snapshot: Todo[]
  ): Promise<void> {
    console.log(
      `[CHECKPOINT] 💾 Starting database transaction to restore todos...`
    );

    await prisma.$transaction(async (tx) => {
      // Delete current todos
      console.log(
        `[CHECKPOINT] 🗑️ Deleting current todos for task ${taskId}...`
      );
      const deleteResult = await tx.todo.deleteMany({ where: { taskId } });
      console.log(
        `[CHECKPOINT] ✅ Deleted ${deleteResult.count} existing todos`
      );

      // Recreate from snapshot
      if (snapshot.length > 0) {
        console.log(
          `[CHECKPOINT] ➕ Creating ${snapshot.length} todos from snapshot...`
        );
        await tx.todo.createMany({
          data: snapshot.map((todo) => ({
            id: todo.id,
            content: todo.content,
            status: todo.status,
            sequence: todo.sequence,
            taskId, // Ensure correct task association
            createdAt: todo.createdAt,
            updatedAt: new Date(), // Update timestamp
          })),
        });
        console.log(
          `[CHECKPOINT] ✅ Successfully created ${snapshot.length} todos from snapshot`
        );
      } else {
        console.log(
          `[CHECKPOINT] 📝 No todos in snapshot, task will have empty todo list`
        );
      }
    });

    console.log(
      `[CHECKPOINT] ✅ Database transaction completed - restored ${snapshot.length} todos from snapshot`
    );
  }

  /**
   * Recompute and emit complete file state after checkpoint restoration
   * Now variant-specific instead of using arbitrary first variant
   */
  private async recomputeAndEmitFileState(
    taskId: string,
    variantId: string
  ): Promise<void> {
    try {
      console.log(
        `[CHECKPOINT] 📊 Recomputing file state after restoration for variant ${variantId}...`
      );

      // Get specific variant and task details
      const variant = await prisma.variant.findUnique({
        where: { id: variantId },
        select: {
          workspacePath: true,
          task: {
            select: { baseBranch: true },
          },
        },
      });

      if (!variant?.workspacePath) {
        console.warn(
          `[CHECKPOINT] ❌ Missing workspace path for variant ${variantId} file state computation`
        );
        return;
      }

      // Create git service and compute current file changes
      console.log(`[CHECKPOINT] 📁 Computing file changes from GitService...`);
      const gitService = await createGitService(variantId);
      const { fileChanges, diffStats } = await gitService.getFileChanges(
        variant.task.baseBranch
      );
      console.log(`[CHECKPOINT] ✅ Found ${fileChanges.length} file changes`);
      console.log(
        `[CHECKPOINT] 📊 Diff stats: +${diffStats.additions} -${diffStats.deletions} (${diffStats.totalFiles} files)`
      );

      // Get current codebase tree using tool executor
      console.log(`[CHECKPOINT] 🌳 Computing codebase tree...`);
      const toolExecutor = await createToolExecutor(taskId, variant.workspacePath);
      const treeResult = await toolExecutor.listDirectoryRecursive(".");

      const codebaseTree = treeResult.success
        ? buildTreeFromEntries(treeResult.entries)
        : [];

      console.log(`[CHECKPOINT] ✅ Found ${codebaseTree.length} tree entries`);

      // Emit fs-override event with complete file state
      console.log(`[CHECKPOINT] 🔗 Emitting fs-override event to frontend...`);
      emitStreamChunk(
        {
          type: "fs-override",
          fsOverride: {
            fileChanges: fileChanges.map((fc: any) => ({
              filePath: fc.filePath,
              operation: fc.operation,
              additions: fc.additions,
              deletions: fc.deletions,
              createdAt: fc.createdAt,
            })),
            diffStats: {
              additions: diffStats.additions,
              deletions: diffStats.deletions,
              totalFiles: diffStats.totalFiles,
            },
            codebaseTree,
            message: "File state synchronized after checkpoint restoration",
          },
        },
        variantId,
        taskId
      );

      console.log(
        `[CHECKPOINT] ✅ Successfully emitted file state override with ${fileChanges.length} changes, ${codebaseTree.length} tree entries, and diff stats (+${diffStats.additions} -${diffStats.deletions})`
      );
    } catch (error) {
      console.error(
        `[CHECKPOINT] ❌ Failed to recompute file state for task ${taskId}:`,
        error
      );
      // Non-blocking - continue even if file state computation fails
    }
  }

  /**
   * Emit todo update to frontend via WebSocket
   */
  private emitTodoUpdate(taskId: string, variantId: string, todos: Todo[]): void {
    try {
      const todoUpdate = {
        todos: todos.map((todo, index) => ({
          id: todo.id,
          content: todo.content,
          status: todo.status.toLowerCase() as
            | "pending"
            | "in_progress"
            | "completed"
            | "cancelled",
          sequence: index,
        })),
        action: "replaced" as const,
        totalTodos: todos.length,
        completedTodos: todos.filter((t) => t.status === "COMPLETED").length,
      };

      emitStreamChunk(
        {
          type: "todo-update",
          todoUpdate,
        },
        variantId,
        taskId
      );

      console.log(
        `[CHECKPOINT] Emitted todo update to frontend: ${todos.length} todos`
      );
    } catch (error) {
      console.error(
        `[CHECKPOINT] Failed to emit todo update for task ${taskId}:`,
        error
      );
      // Non-blocking - continue even if emission fails
    }
  }

  /**
   * Restore workspace to initial repository state (before any assistant changes)
   * Now variant-specific for proper workspace restoration
   */
  private async restoreToInitialState(taskId: string, variantId: string): Promise<void> {
    console.log(
      `[CHECKPOINT] 🏁 Restoring to initial repository state for task ${taskId}`
    );

    try {
      // Get task's initial commit SHA
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { baseCommitSha: true },
      });

      if (!task?.baseCommitSha) {
        console.warn(
          `[CHECKPOINT] ❌ Missing base commit SHA for task ${taskId}`
        );
        return;
      }

      console.log(
        `[CHECKPOINT] 🎯 Target base commit SHA: ${task.baseCommitSha}`
      );

      // Create git service for the task (handles both local and remote modes)
      console.log(`[CHECKPOINT] 🔧 Creating git service for task ${taskId}...`);
      const gitService = await createGitService(taskId);

      // Pause filesystem watcher to prevent spurious events from git operations
      await this.pauseFilesystemWatcher(taskId);

      // Handle uncommitted changes
      console.log(`[CHECKPOINT] 🔍 Checking for uncommitted changes...`);
      const hasChanges = await gitService.hasChanges();
      if (hasChanges) {
        console.warn(
          `[CHECKPOINT] ⚠️ Uncommitted changes detected before initial state restoration. Git checkout will fail if these changes would be overwritten.`
        );
      } else {
        console.log(
          `[CHECKPOINT] ✨ Workspace is clean, proceeding with restore`
        );
      }

      // Restore git state to initial commit
      const success = await gitService.safeCheckoutCommit(task.baseCommitSha);
      if (!success) {
        console.warn(`[CHECKPOINT] Could not checkout to initial commit`);
      }

      // Clear all todos (initial state has none)
      await this.restoreTodoState(taskId, []); // Empty array = no todos
      this.emitTodoUpdate(taskId, variantId, []);

      // Wait for git state to settle, then recompute and emit file state
      await new Promise((resolve) => setTimeout(resolve, 150));
      await this.recomputeAndEmitFileState(taskId, variantId);

      // Resume filesystem watcher after fs-override has been sent
      await new Promise((resolve) => setTimeout(resolve, 200));
      await this.resumeFilesystemWatcher(taskId);

      console.log(`[CHECKPOINT] Restored to initial state`);
    } catch (error) {
      console.error(`[CHECKPOINT] Failed to restore to initial state:`, error);
      // Continue with edit flow even if restore fails
    }
  }

  /**
   * Find the most recent assistant message with checkpoint data strictly before the target message
   */
  private async findCheckpointMessage(
    taskId: string,
    targetMessageId: string
  ): Promise<{ id: string; metadata: MessageMetadata } | null> {
    // Get the sequence number of the target message
    const targetMessage = await prisma.chatMessage.findUnique({
      where: { id: targetMessageId },
      select: { sequence: true },
    });

    if (!targetMessage) {
      console.warn(`[CHECKPOINT] Target message ${targetMessageId} not found`);
      return null;
    }

    // Find the most recent assistant message strictly before this sequence with checkpoint data
    const checkpointMessage = await prisma.chatMessage.findFirst({
      where: {
        taskId,
        role: "ASSISTANT",
        sequence: { lt: targetMessage.sequence },
        metadata: {
          path: ["checkpoint"],
          not: "null",
        },
      },
      orderBy: { sequence: "desc" },
      select: { id: true, metadata: true },
    });

    return checkpointMessage as {
      id: string;
      metadata: MessageMetadata;
    } | null;
  }

  /**
   * Pause filesystem watcher to prevent spurious events during git operations
   */
  private async pauseFilesystemWatcher(taskId: string): Promise<void> {
    try {
      if (config.agentMode === "local") {
        // Local mode: pause the local filesystem watcher
        const watcher = getFileSystemWatcher(taskId);
        if (watcher) {
          // Pause local watcher
          watcher.pause();
        } else {
          // No local watcher found
        }
      } else {
        // Remote mode: call sidecar API to pause watcher
        const toolExecutor = await createToolExecutor(taskId);
        try {
          // Call sidecar API to pause filesystem watcher
          // Access the sidecar URL using established pattern from codebase
          const sidecarUrl =
            "sidecarUrl" in toolExecutor
              ? (toolExecutor as { sidecarUrl: string }).sidecarUrl
              : null;
          if (!sidecarUrl) {
            console.warn(
              `[CHECKPOINT] No sidecar URL available for task ${taskId}`
            );
            return;
          }

          const response = await fetch(`${sidecarUrl}/api/watcher/pause`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
          });

          if (response.ok) {
            (await response.json()) as { message: string };
            // Remote watcher paused successfully
          } else {
            const error = await response.text();
            console.warn(
              `[CHECKPOINT] Failed to pause remote watcher: ${error}`
            );
          }
        } catch (error) {
          console.warn(
            `[CHECKPOINT] Failed to pause remote watcher for task ${taskId}:`,
            error
          );
        }
      }
    } catch (error) {
      console.warn(
        `[CHECKPOINT] Error pausing filesystem watcher for task ${taskId}:`,
        error
      );
      // Non-blocking - continue even if watcher pause fails
    }
  }

  /**
   * Resume filesystem watcher after git operations are complete
   */
  private async resumeFilesystemWatcher(taskId: string): Promise<void> {
    try {
      if (config.agentMode === "local") {
        // Local mode: resume the local filesystem watcher
        const watcher = getFileSystemWatcher(taskId);
        if (watcher) {
          // Resume local watcher
          watcher.resume();
        } else {
          // No local watcher found
        }
      } else {
        // Resume remote watcher
        const toolExecutor = await createToolExecutor(taskId);
        try {
          // Call sidecar API to resume filesystem watcher
          // Access the sidecar URL using established pattern from codebase
          const sidecarUrl =
            "sidecarUrl" in toolExecutor
              ? (toolExecutor as { sidecarUrl: string }).sidecarUrl
              : null;
          if (!sidecarUrl) {
            console.warn(
              `[CHECKPOINT] No sidecar URL available for task ${taskId}`
            );
            return;
          }

          const response = await fetch(`${sidecarUrl}/api/watcher/resume`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
          });

          if (response.ok) {
            (await response.json()) as { message: string };
            // Remote watcher resumed successfully
          } else {
            const error = await response.text();
            console.warn(
              `[CHECKPOINT] Failed to resume remote watcher: ${error}`
            );
          }
        } catch (error) {
          console.warn(
            `[CHECKPOINT] Failed to resume remote watcher for task ${taskId}:`,
            error
          );
        }
      }
    } catch (error) {
      console.warn(
        `[CHECKPOINT] Error resuming filesystem watcher for task ${taskId}:`,
        error
      );
      // Non-blocking - continue even if watcher resume fails
    }
  }
}

// Export singleton instance
export const checkpointService = new CheckpointService();
