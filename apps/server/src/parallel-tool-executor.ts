import { nanoid } from "nanoid";
import { 
  ParallelExecutionContext, 
  ParallelToolCall, 
  ParallelToolBatchStartChunk,
  ParallelToolBatchCompleteChunk,
  ParallelToolProgressChunk 
} from "@repo/types";
import { createTools } from "./tools";

/**
 * Manager for executing tool calls in parallel
 * Provides real-time progress updates and error handling
 */
export class ParallelToolExecutor {
  private activeExecutions = new Map<string, ParallelExecutionContext>();

  /**
   * Determines if tool calls can be executed in parallel
   * Current heuristics:
   * - More than 1 tool call
   * - No dependencies between calls (e.g., one doesn't write a file another reads)
   * - All tools support parallel execution
   */
  canExecuteInParallel(toolCalls: ParallelToolCall[]): boolean {
    if (toolCalls.length <= 1) {
      return false;
    }

    // Check for potential dependencies
    const hasFileWrite = toolCalls.some(call => 
      call.name === 'edit_file' || call.name === 'search_replace'
    );
    const hasFileRead = toolCalls.some(call => 
      call.name === 'read_file' || call.name === 'grep_search'
    );

    // Simple heuristic: don't parallelize if we have both reads and writes
    // In a more sophisticated implementation, we'd analyze specific file paths
    if (hasFileWrite && hasFileRead) {
      return false;
    }

    // Don't parallelize tool calls that might have dependencies
    const dependentTools = ['run_terminal_cmd', 'todo_write'];
    const hasDependentTools = toolCalls.some(call => 
      dependentTools.includes(call.name)
    );

    if (hasDependentTools && toolCalls.length > 1) {
      return false;
    }

    return true;
  }

  /**
   * Execute multiple tool calls in parallel with progress tracking
   */
  async executeInParallel(
    taskId: string,
    workspacePath: string | undefined,
    toolCalls: ParallelToolCall[],
    onProgress: (chunk: ParallelToolBatchStartChunk | ParallelToolProgressChunk | ParallelToolBatchCompleteChunk) => void
  ): Promise<void> {
    const batchId = nanoid();
    const startTime = Date.now();

    // Create execution context
    const context: ParallelExecutionContext = {
      batchId,
      toolCalls,
      startTime,
      results: new Map()
    };

    // Initialize results map
    toolCalls.forEach(call => {
      context.results.set(call.id, { status: "pending" });
    });

    this.activeExecutions.set(batchId, context);

    // Emit batch start event
    onProgress({
      type: "parallel-tool-batch-start",
      batchId,
      toolCallIds: toolCalls.map(call => call.id)
    });

    try {
      // Create tools instance
      const tools = createTools(taskId, workspacePath);

      // Execute all tool calls in parallel
      const promises = toolCalls.map(async (toolCall) => {
        const toolStartTime = Date.now();
        
        try {
          // Mark as started
          const resultEntry = context.results.get(toolCall.id)!;
          resultEntry.status = "started";
          
          onProgress({
            type: "parallel-tool-progress",
            batchId,
            toolCallId: toolCall.id,
            status: "started"
          });

          // Get the tool function
          const tool = tools[toolCall.name as keyof typeof tools];
          if (!tool) {
            throw new Error(`Unknown tool: ${toolCall.name}`);
          }

          // Execute the tool
          const result = await tool.execute(toolCall.args as any, {
            toolCallId: toolCall.id,
            messages: [], // TODO: Pass actual messages if needed
            abortSignal: new AbortController().signal,
          });
          const executionTimeMs = Date.now() - toolStartTime;

          // Update result
          resultEntry.status = "completed";
          resultEntry.result = result;
          resultEntry.executionTimeMs = executionTimeMs;

          onProgress({
            type: "parallel-tool-progress",
            batchId,
            toolCallId: toolCall.id,
            status: "completed",
            result,
            executionTimeMs
          });

          return { toolCallId: toolCall.id, result, executionTimeMs };
        } catch (error) {
          const executionTimeMs = Date.now() - toolStartTime;
          const errorMessage = error instanceof Error ? error.message : String(error);

          // Update result with error
          const resultEntry = context.results.get(toolCall.id)!;
          resultEntry.status = "error";
          resultEntry.error = errorMessage;
          resultEntry.executionTimeMs = executionTimeMs;

          onProgress({
            type: "parallel-tool-progress",
            batchId,
            toolCallId: toolCall.id,
            status: "error",
            error: errorMessage,
            executionTimeMs
          });

          return { 
            toolCallId: toolCall.id, 
            result: null, 
            error: errorMessage, 
            executionTimeMs 
          };
        }
      });

      // Wait for all tool calls to complete
      const results = await Promise.all(promises);
      const totalExecutionTimeMs = Date.now() - startTime;

      // Emit batch complete event
      onProgress({
        type: "parallel-tool-batch-complete",
        batchId,
        results,
        totalExecutionTimeMs
      });

    } catch (error) {
      console.error(`[PARALLEL_TOOL_EXECUTOR] Batch ${batchId} failed:`, error);
      // In case of catastrophic failure, mark all as error
      toolCalls.forEach(call => {
        const resultEntry = context.results.get(call.id)!;
        if (resultEntry.status === "pending" || resultEntry.status === "started") {
          resultEntry.status = "error";
          resultEntry.error = error instanceof Error ? error.message : String(error);
        }
      });
    } finally {
      // Clean up
      this.activeExecutions.delete(batchId);
    }
  }

  /**
   * Get statistics about active parallel executions
   */
  getActiveExecutions(): ParallelExecutionContext[] {
    return Array.from(this.activeExecutions.values());
  }

  /**
   * Cancel a parallel execution batch
   */
  cancelExecution(batchId: string): boolean {
    const context = this.activeExecutions.get(batchId);
    if (context) {
      this.activeExecutions.delete(batchId);
      return true;
    }
    return false;
  }
}