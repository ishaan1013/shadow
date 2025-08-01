import { logger } from "../utils/logger";

/**
 * Terminal output entry with timestamp and metadata
 */
interface TerminalEntry {
  id: number;
  timestamp: number;
  data: string;
  type: 'stdout' | 'stderr' | 'command' | 'system';
  processId?: number;
}

/**
 * Buffer configuration options
 */
interface BufferConfig {
  maxSize: number;           // Maximum number of entries
  maxMemory: number;         // Maximum memory usage in bytes
  flushInterval: number;     // Interval to flush old entries (ms)
  backpressureThreshold: number; // When to start dropping entries
}

/**
 * TerminalBuffer implements a circular buffer system for terminal output
 * Provides backpressure protection, history replay, and efficient memory management
 */
export class TerminalBuffer {
  private buffer: TerminalEntry[];
  private nextId: number;
  private currentSize: number;
  private memoryUsage: number;
  private config: BufferConfig;
  private flushTimer?: NodeJS.Timeout;
  private subscribers: Set<(entry: TerminalEntry) => void>;
  private backpressureActive: boolean;
  private droppedCount: number;

  constructor(config: Partial<BufferConfig> = {}) {
    this.config = {
      maxSize: config.maxSize || 10000,          // 10k entries default
      maxMemory: config.maxMemory || 50 * 1024 * 1024, // 50MB default
      flushInterval: config.flushInterval || 60000,     // 1 minute default
      backpressureThreshold: config.backpressureThreshold || 0.8, // 80% of max
    };

    this.buffer = [];
    this.nextId = 1;
    this.currentSize = 0;
    this.memoryUsage = 0;
    this.subscribers = new Set();
    this.backpressureActive = false;
    this.droppedCount = 0;

    this.startFlushTimer();
    
    logger.info("Terminal buffer initialized", {
      maxSize: this.config.maxSize,
      maxMemory: this.config.maxMemory,
      flushInterval: this.config.flushInterval,
    });
  }

  /**
   * Add new terminal output to the buffer
   */
  addEntry(data: string, type: TerminalEntry['type'] = 'stdout', processId?: number): boolean {
    // Check for backpressure
    if (this.shouldApplyBackpressure()) {
      if (!this.backpressureActive) {
        this.backpressureActive = true;
        logger.warn("Terminal buffer backpressure activated", {
          currentSize: this.currentSize,
          memoryUsage: this.memoryUsage,
          maxSize: this.config.maxSize,
          maxMemory: this.config.maxMemory,
        });
      }

      // Drop entry and increment counter
      this.droppedCount++;
      
      // Occasionally log dropped entries to avoid spam
      if (this.droppedCount % 100 === 0) {
        logger.warn(`Terminal buffer dropped ${this.droppedCount} entries due to backpressure`);
      }
      
      return false;
    }

    // Reset backpressure if we're back under threshold
    if (this.backpressureActive && !this.shouldApplyBackpressure()) {
      this.backpressureActive = false;
      logger.info("Terminal buffer backpressure deactivated", {
        totalDropped: this.droppedCount,
      });
    }

    const entry: TerminalEntry = {
      id: this.nextId++,
      timestamp: Date.now(),
      data,
      type,
      processId,
    };

    // Add to buffer
    this.buffer.push(entry);
    this.currentSize++;
    this.memoryUsage += this.estimateEntrySize(entry);

    // Maintain circular buffer by removing old entries
    this.maintainBufferSize();

    // Notify subscribers
    this.notifySubscribers(entry);

    return true;
  }

  /**
   * Add command entry (special type for command execution)
   */
  addCommand(command: string, processId?: number): boolean {
    return this.addEntry(`$ ${command}`, 'command', processId);
  }

  /**
   * Add system message (special type for system notifications)
   */
  addSystemMessage(message: string): boolean {
    return this.addEntry(`[SYSTEM] ${message}`, 'system');
  }

  /**
   * Get recent entries for history replay
   */
  getRecentEntries(count?: number): TerminalEntry[] {
    const requestedCount = count || Math.min(this.config.maxSize, 1000);
    const startIndex = Math.max(0, this.buffer.length - requestedCount);
    return this.buffer.slice(startIndex);
  }

  /**
   * Get entries since a specific ID (for incremental updates)
   */
  getEntriesSince(sinceId: number): TerminalEntry[] {
    const index = this.buffer.findIndex(entry => entry.id > sinceId);
    return index >= 0 ? this.buffer.slice(index) : [];
  }

  /**
   * Get entries in a time range
   */
  getEntriesInRange(startTime: number, endTime: number): TerminalEntry[] {
    return this.buffer.filter(entry => 
      entry.timestamp >= startTime && entry.timestamp <= endTime
    );
  }

  /**
   * Subscribe to new entries
   */
  subscribe(callback: (entry: TerminalEntry) => void): () => void {
    this.subscribers.add(callback);
    
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Get buffer statistics
   */
  getStats(): {
    totalEntries: number;
    memoryUsage: number;
    droppedCount: number;
    backpressureActive: boolean;
    oldestEntry?: number;
    newestEntry?: number;
  } {
    return {
      totalEntries: this.currentSize,
      memoryUsage: this.memoryUsage,
      droppedCount: this.droppedCount,
      backpressureActive: this.backpressureActive,
      oldestEntry: this.buffer.length > 0 ? this.buffer[0]?.timestamp : undefined,
      newestEntry: this.buffer.length > 0 ? this.buffer[this.buffer.length - 1]?.timestamp : undefined,
    };
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.buffer = [];
    this.currentSize = 0;
    this.memoryUsage = 0;
    this.droppedCount = 0;
    this.backpressureActive = false;
    
    logger.info("Terminal buffer cleared");
  }


  /**
   * Destroy the buffer and cleanup resources
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    
    this.subscribers.clear();
    this.buffer = [];
    this.currentSize = 0;
    this.memoryUsage = 0;
    
    logger.info("Terminal buffer destroyed");
  }

  /**
   * Check if backpressure should be applied
   */
  private shouldApplyBackpressure(): boolean {
    const sizeThreshold = this.config.maxSize * this.config.backpressureThreshold;
    const memoryThreshold = this.config.maxMemory * this.config.backpressureThreshold;
    
    return this.currentSize >= sizeThreshold || this.memoryUsage >= memoryThreshold;
  }

  /**
   * Maintain buffer size by removing old entries
   */
  private maintainBufferSize(): void {
    // Remove entries if we exceed limits
    while (this.currentSize > this.config.maxSize || this.memoryUsage > this.config.maxMemory) {
      const removedEntry = this.buffer.shift();
      if (removedEntry) {
        this.currentSize--;
        this.memoryUsage -= this.estimateEntrySize(removedEntry);
      } else {
        break; // Safety check
      }
    }
  }

  /**
   * Estimate memory usage of a terminal entry
   */
  private estimateEntrySize(entry: TerminalEntry): number {
    // Rough estimation: string data + object overhead
    return entry.data.length * 2 + 100; // 2 bytes per char + object overhead
  }

  /**
   * Notify all subscribers of a new entry
   */
  private notifySubscribers(entry: TerminalEntry): void {
    this.subscribers.forEach(callback => {
      try {
        callback(entry);
      } catch (error) {
        logger.error("Error in terminal buffer subscriber", { error });
      }
    });
  }

  /**
   * Start periodic flush timer to remove very old entries
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flushOldEntries();
    }, this.config.flushInterval);
  }

  /**
   * Remove entries older than flush interval
   */
  private flushOldEntries(): void {
    const cutoffTime = Date.now() - (this.config.flushInterval * 2); // Keep 2x flush interval
    const initialLength = this.buffer.length;
    
    // Find first entry to keep
    let keepFromIndex = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const entry = this.buffer[i];
      if (entry && entry.timestamp > cutoffTime) {
        keepFromIndex = i;
        break;
      }
    }

    if (keepFromIndex > 0) {
      // Calculate memory to be freed
      const removedEntries = this.buffer.slice(0, keepFromIndex);
      const freedMemory = removedEntries.reduce((total, entry) => 
        total + this.estimateEntrySize(entry), 0
      );

      // Remove old entries
      this.buffer = this.buffer.slice(keepFromIndex);
      this.currentSize = this.buffer.length;
      this.memoryUsage -= freedMemory;

      const removedCount = initialLength - this.buffer.length;
      if (removedCount > 0) {
        logger.debug("Flushed old terminal entries", {
          removedCount,
          freedMemory,
          remainingEntries: this.buffer.length,
        });
      }
    }
  }
}

export default TerminalBuffer;