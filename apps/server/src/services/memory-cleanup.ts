import { cleanupVariantStreamState, stopTerminalPolling } from "../socket";
import {
  stopFileSystemWatcher,
  cleanupTaskTerminalCounters,
} from "../agent/tools";
import { chatService } from "../app";

/**
 * Memory cleanup service for task and variant-related data structures
 * Prevents memory leaks by cleaning up Maps and other structures when tasks complete
 */
export class MemoryCleanupService {
  /**
   * Clean up all memory structures associated with a task
   */
  static cleanupTaskMemory(taskId: string): void {
    console.log(`[MEMORY_CLEANUP] Starting memory cleanup for task ${taskId}`);

    try {
      chatService.cleanupTask(taskId);
      // Task-level cleanup no longer stops per-variant filesystem watchers here
      cleanupTaskTerminalCounters(taskId);

      console.log(
        `[MEMORY_CLEANUP] Successfully cleaned up task-level memory for task ${taskId}`
      );
    } catch (error) {
      console.error(
        `[MEMORY_CLEANUP] Error cleaning up task memory for task ${taskId}:`,
        error
      );
      // Don't throw - cleanup should be best-effort and not fail task completion
    }
  }

  /**
   * Clean up all memory structures associated with a variant
   */
  static cleanupVariantMemory(variantId: string): void {
    console.log(`[MEMORY_CLEANUP] Starting memory cleanup for variant ${variantId}`);

    try {
      cleanupVariantStreamState(variantId);
      stopTerminalPolling(variantId);
      // Stop per-variant filesystem watcher
      stopFileSystemWatcher(variantId);

      console.log(
        `[MEMORY_CLEANUP] Successfully cleaned up variant memory for variant ${variantId}`
      );
    } catch (error) {
      console.error(
        `[MEMORY_CLEANUP] Error cleaning up variant memory for variant ${variantId}:`,
        error
      );
      // Don't throw - cleanup should be best-effort and not fail task completion
    }
  }
}
