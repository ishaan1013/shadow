import { watch, FSWatcher } from 'fs';
import { join, relative } from 'path';
import { emitStreamChunk } from '../socket';
import { stat } from 'fs/promises';
import { GitignoreChecker } from '../utils/gitignore-parser';

interface FileSystemChangeEvent {
  operation: 'file-created' | 'file-modified' | 'file-deleted' | 'directory-created' | 'directory-deleted';
  filePath: string;
  timestamp: number;
  source: 'local' | 'remote';
  isDirectory: boolean;
}

/**
 * Local Filesystem Watcher for local execution mode
 * Watches workspace directory for changes and emits them via Socket.IO
 */
export class LocalFileSystemWatcher {
  private watcher: FSWatcher | null = null;
  private taskId: string;
  private variantId: string;
  private watchedPath: string;
  private changeBuffer = new Map<string, FileSystemChangeEvent>();
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly debounceMs = 100;
  private gitignoreChecker: GitignoreChecker | null = null;
  private isPaused = false;

  constructor(taskId: string, variantId: string) {
    this.taskId = taskId;
    this.variantId = variantId;
    this.watchedPath = '';
  }

  /**
   * Start watching the given workspace path
   */
  async startWatching(workspacePath: string): Promise<void> {
    if (this.watcher) {
      console.warn(`[LOCAL_FS_WATCHER] Already watching for task ${this.taskId}`);
      return;
    }

    this.watchedPath = workspacePath;
    
    // Initialize gitignore checker
    this.gitignoreChecker = new GitignoreChecker(workspacePath);

    try {
      console.log(`[LOCAL_FS_WATCHER] Starting filesystem watch for task ${this.taskId} at ${workspacePath}`);

      this.watcher = watch(workspacePath, {
        recursive: true,
        persistent: false // Don't keep the process alive
      }, (eventType, filename) => {
        if (filename) {
          this.handleFileChange(eventType, filename);
        }
      });

      this.watcher.on('error', (error) => {
        console.error(`[LOCAL_FS_WATCHER] Watch error for task ${this.taskId}:`, error);
      });

      console.log(`[LOCAL_FS_WATCHER] Successfully started watching ${workspacePath} for task ${this.taskId}`);
    } catch (error) {
      console.error(`[LOCAL_FS_WATCHER] Failed to start watching ${workspacePath}:`, error);
      throw error;
    }
  }

  /**
   * Handle individual file system change events
   */
  private async handleFileChange(eventType: string, filename: string): Promise<void> {
    // Skip processing if watcher is paused
    if (this.isPaused) {
      return;
    }

    const fullPath = join(this.watchedPath, filename);
    const relativePath = relative(this.watchedPath, fullPath);

    // Skip hidden files and common ignore patterns
    if (this.shouldIgnoreFile(relativePath)) {
      return;
    }

    try {
      // Determine if this is a directory and what operation occurred
      let isDirectory = false;
      let operation: FileSystemChangeEvent['operation'];

      try {
        const stats = await stat(fullPath);
        isDirectory = stats.isDirectory();

        // For existing files/directories, this is either created or modified
        operation = eventType === 'rename'
          ? (isDirectory ? 'directory-created' : 'file-created')
          : (isDirectory ? 'directory-created' : 'file-modified'); // Note: 'change' events are modifications
      } catch (_error) {
        // File doesn't exist, so it was deleted
        operation = isDirectory ? 'directory-deleted' : 'file-deleted';
      }

      const event: FileSystemChangeEvent = {
        operation,
        filePath: relativePath,
        timestamp: Date.now(),
        source: 'local',
        isDirectory
      };

      // Add to buffer for debouncing
      this.changeBuffer.set(relativePath, event);

      // Schedule flush if not already scheduled
      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushChanges();
        }, this.debounceMs);
      }

    } catch (error) {
      console.error(`[LOCAL_FS_WATCHER] Error processing change for ${relativePath}:`, error);
    }
  }

  /**
   * Determine if a file should be ignored based on gitignore rules and common patterns
   */
  private shouldIgnoreFile(filePath: string): boolean {
    if (this.gitignoreChecker) {
      return this.gitignoreChecker.shouldIgnoreFile(filePath);
    }

    // Fallback to legacy patterns if gitignore checker is not available
    const ignorePatterns = [
      /^\.git\//, // Git files
      /^node_modules\//, // Node.js dependencies
      /^\.vscode\//, // VS Code settings
      /^\.cursor\//, // Cursor settings
      /\.DS_Store$/, // macOS system files
      /\.tmp$/, // Temporary files
      /\.log$/, // Log files
      /~$/, // Temporary/backup files
      /^\./, // Other hidden files at root level
    ];

    return ignorePatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Flush buffered changes to prevent spam
   */
  private flushChanges(): void {
    if (this.changeBuffer.size === 0) {
      this.flushTimer = null;
      return;
    }

    // Check if paused - if so, clear buffer but don't emit
    if (this.isPaused) {
      this.changeBuffer.clear();
      this.flushTimer = null;
      return;
    }

    const changes = Array.from(this.changeBuffer.values());
    this.changeBuffer.clear();
    this.flushTimer = null;

    console.log(`[LOCAL_FS_WATCHER] Flushing ${changes.length} changes`);

    // Emit each change as a stream chunk
    for (const change of changes) {
      emitStreamChunk({
        type: "fs-change",
        fsChange: change
      }, this.variantId, this.taskId);
    }
  }

  /**
   * Stop watching the filesystem
   */
  stop(): void {
    if (this.watcher) {
      console.log(`[LOCAL_FS_WATCHER] Stopping filesystem watch for task ${this.taskId}`);

      this.watcher.close();
      this.watcher = null;

      // Flush any pending changes
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushChanges();
      }
    }
  }

  /**
   * Check if watcher is currently active
   */
  isWatching(): boolean {
    return this.watcher !== null;
  }

  /**
   * Pause filesystem watching (stop processing events)
   */
  pause(): void {
    if (!this.isPaused) {
      console.log(`[LOCAL_FS_WATCHER] Paused`);
      this.isPaused = true;
      
      // Clear any pending flush timer
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      
      // Clear the change buffer to avoid processing stale events
      this.changeBuffer.clear();
    }
  }

  /**
   * Resume filesystem watching (start processing events again)
   */
  resume(): void {
    if (this.isPaused) {
      console.log(`[LOCAL_FS_WATCHER] Resumed`);
      this.isPaused = false;
      
      // Clear buffer again to ensure no stale events from pause period
      this.changeBuffer.clear();
    }
  }

  /**
   * Check if watcher is currently paused
   */
  isPausedState(): boolean {
    return this.isPaused;
  }

  /**
   * Get watcher statistics
   */
  getStats() {
    return {
      taskId: this.taskId,
      watchedPath: this.watchedPath,
      isWatching: this.isWatching(),
      isPaused: this.isPaused,
      pendingChanges: this.changeBuffer.size
    };
  }
}