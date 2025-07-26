import { watch, FSWatcher } from 'fs';
import { logger } from '../utils/logger';
import { SocketClient } from './socket-client';
import type { FileSystemEvent } from '@repo/types';

/**
 * FileSystemWatcher monitors filesystem changes and sends events to the server via Socket.IO
 */
export class FileSystemWatcher {
  private watcher: FSWatcher | null = null;
  private socketClient: SocketClient;
  private taskId: string;
  private changeBuffer = new Map<string, FileSystemEvent>();
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly debounceMs = 100; // Debounce rapid changes

  constructor(taskId: string, socketClient: SocketClient) {
    this.taskId = taskId;
    this.socketClient = socketClient;
  }

  /**
   * Start watching the workspace directory for filesystem changes
   */
  async startWatching(workspacePath: string): Promise<void> {
    try {
      logger.info(`[FS_WATCHER] Starting filesystem watcher for task ${this.taskId}`, {
        workspacePath,
        debounceMs: this.debounceMs
      });

      this.watcher = watch(workspacePath, {
        recursive: true,
        // Ignore common directories that create noise
        // Note: 'ignored' option is not available in Node.js fs.watch, so we'll filter in the handler
      }, (eventType, filename) => {
        if (filename) {
          this.handleFileSystemEvent(eventType, filename);
        }
      });

      logger.info(`[FS_WATCHER] Successfully started watching ${workspacePath}`);
    } catch (error) {
      logger.error(`[FS_WATCHER] Failed to start watching ${workspacePath}`, { error });
      throw error;
    }
  }

  /**
   * Stop watching filesystem changes
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.info(`[FS_WATCHER] Stopped filesystem watcher for task ${this.taskId}`);
    }

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush any remaining changes
    this.flushChanges();
  }

  /**
   * Handle individual filesystem events
   */
  private handleFileSystemEvent(eventType: string, filename: string): void {
    // Filter out noise from common directories/files
    if (this.shouldIgnoreFile(filename)) {
      return;
    }

    const event: FileSystemEvent = {
      id: this.generateEventId(),
      taskId: this.taskId,
      type: this.mapEventType(eventType, filename),
      path: filename,
      timestamp: Date.now(),
      source: 'remote',
      isDirectory: this.isDirectoryPath(filename)
    };

    logger.debug(`[FS_WATCHER] Detected ${event.type}: ${filename}`);

    // Buffer rapid changes to prevent spam
    this.changeBuffer.set(filename, event);

    // Reset debounce timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    this.flushTimer = setTimeout(() => {
      this.flushChanges();
    }, this.debounceMs);
  }

  /**
   * Flush buffered changes to the server
   */
  private flushChanges(): void {
    if (this.changeBuffer.size === 0) {
      return;
    }

    const changes = Array.from(this.changeBuffer.values());
    this.changeBuffer.clear();

    logger.info(`[FS_WATCHER] Flushing ${changes.length} filesystem changes`, {
      taskId: this.taskId,
      changes: changes.map(c => `${c.type}:${c.path}`)
    });

    // Send each change to the server
    for (const change of changes) {
      this.socketClient.emitFileSystemChange(change);
    }
  }

  /**
   * Map Node.js fs.watch event types to our semantic types
   */
  private mapEventType(eventType: string, filename: string): FileSystemEvent['type'] {
    const isDirectory = this.isDirectoryPath(filename);

    switch (eventType) {
      case 'rename':
        // In Node.js fs.watch, 'rename' can mean create, delete, or actual rename
        // We'll treat it as creation for now - deletions are harder to detect
        return isDirectory ? 'directory-created' : 'file-created';

      case 'change':
        // File content changed
        return isDirectory ? 'directory-created' : 'file-modified';

      default:
        logger.warn(`[FS_WATCHER] Unknown event type: ${eventType} for ${filename}`);
        return isDirectory ? 'directory-created' : 'file-modified';
    }
  }

  /**
   * Check if a file/directory should be ignored
   */
  private shouldIgnoreFile(filename: string): boolean {
    const ignoredPatterns = [
      /node_modules/,
      /\.git/,
      /\.DS_Store/,
      /\.nyc_output/,
      /coverage/,
      /dist/,
      /build/,
      /tmp/,
      /\.log$/,
      /\.tmp$/,
      /~$/,
      /\.swp$/,
      /\.swo$/,
    ];

    return ignoredPatterns.some(pattern => pattern.test(filename));
  }

  /**
   * Heuristic to determine if a path is likely a directory
   * Note: This is imperfect since we don't have access to stat() in the event handler
   */
  private isDirectoryPath(filename: string): boolean {
    // Common heuristics for directories:
    // - No file extension
    // - Ends with common directory names
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(filename);
    const commonDirNames = ['src', 'lib', 'components', 'pages', 'public', 'assets', 'utils', 'hooks'];
    const endsWithCommonDir = commonDirNames.some(dir => filename.endsWith(dir));

    return !hasExtension || endsWithCommonDir;
  }

  /**
   * Generate a unique event ID
   */
  private generateEventId(): string {
    return `fs-${this.taskId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}