import { prisma } from "@repo/db";
import {
  AssistantMessagePart,
  Message,
  MessageMetadata,
  ModelType,
} from "@repo/types";
import { TextPart, ToolCallPart, ToolResultPart } from "ai";
import { randomUUID } from "crypto";
import { type ChatMessage } from "../../../packages/db/src/client";
import { LLMService } from "./llm";
import { systemPrompt } from "./prompt/system-prompt";
import { GitManager } from "./services/git-manager";
import {
  emitStreamChunk,
  endStream,
  handleStreamError,
  startStream,
} from "./socket";
import config from "./config";
import { updateTaskStatus } from "./utils/task-status";
import { SidecarClient } from "./execution/remote/sidecar-client";

export const DEFAULT_MODEL: ModelType = "gpt-4o";

export class ChatService {
  private llmService: LLMService;
  private activeStreams: Map<string, AbortController> = new Map();
  private stopRequested: Set<string> = new Set();

  constructor() {
    this.llmService = new LLMService();
  }

  private async getNextSequence(taskId: string): Promise<number> {
    const lastMessage = await prisma.chatMessage.findFirst({
      where: { taskId },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });
    return (lastMessage?.sequence || 0) + 1;
  }

  async saveUserMessage(
    taskId: string,
    content: string,
    metadata?: MessageMetadata
  ): Promise<ChatMessage> {
    const sequence = await this.getNextSequence(taskId);
    return await prisma.chatMessage.create({
      data: {
        taskId,
        content,
        role: "USER",
        sequence,
        metadata: (metadata as any) || undefined,
      },
    });
  }

  async saveAssistantMessage(
    taskId: string,
    content: string,
    llmModel: string,
    sequence: number,
    metadata?: MessageMetadata
  ): Promise<ChatMessage> {
    // Extract usage info for denormalized storage
    const usage = metadata?.usage;

    return await prisma.chatMessage.create({
      data: {
        taskId,
        content,
        role: "ASSISTANT",
        llmModel,
        sequence,
        metadata: (metadata as any) || undefined,
        // Denormalized usage fields for easier querying
        promptTokens: usage?.promptTokens,
        completionTokens: usage?.completionTokens,
        totalTokens: usage?.totalTokens,
        finishReason: metadata?.finishReason,
      },
    });
  }

  async saveToolMessage(
    taskId: string,
    toolName: string,
    toolArgs: Record<string, any>,
    toolResult: string,
    sequence: number,
    metadata?: MessageMetadata
  ): Promise<ChatMessage> {
    return await prisma.chatMessage.create({
      data: {
        taskId,
        content: toolResult,
        role: "TOOL",
        sequence,
        metadata: {
          ...(metadata as any),
          tool: {
            name: toolName,
            args: toolArgs,
            status: "COMPLETED",
            result: toolResult,
          },
        } as any,
      },
    });
  }

  /**
   * Commit changes to git if there are any changes after an LLM response
   */
  private async commitChangesIfAny(taskId: string, workspacePath?: string): Promise<void> {
    try {
      // Get task info including user and workspace details
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: { user: true },
      });

      if (!task) {
        console.warn(`[CHAT] Task not found for git commit: ${taskId}`);
        return;
      }

      if (!task.shadowBranch) {
        console.warn(`[CHAT] No shadow branch configured for task ${taskId}, skipping git commit`);
        return;
      }

      // Determine workspace path - use provided path or fall back to task workspace path
      const resolvedWorkspacePath = workspacePath || task.workspacePath;
      if (!resolvedWorkspacePath) {
        console.warn(`[CHAT] No workspace path available for task ${taskId}, skipping git commit`);
        return;
      }

      // For remote mode, we would need to make API calls to the sidecar
      // For now, only handle local mode
      if (config.agentMode === "local") {
        const gitManager = new GitManager(resolvedWorkspacePath, taskId);

        // Check if there are changes to commit
        const hasChanges = await gitManager.hasChanges();
        if (!hasChanges) {
          console.log(`[CHAT] No changes to commit for task ${taskId}`);
          return;
        }

        // Commit changes with user and Shadow co-author
        const committed = await gitManager.commitChangesIfAny(
          {
            name: task.user.name,
            email: task.user.email,
          },
          {
            name: "Shadow",
            email: "noreply@shadow.ai",
          }
        );

        if (committed) {
          console.log(`[CHAT] Successfully committed changes for task ${taskId}`);
        }
      } else {
        // Remote mode: Use sidecar git APIs instead of direct git operations
        await this.commitChangesRemoteMode(taskId, task);
      }
    } catch (error) {
      console.error(`[CHAT] Failed to commit changes for task ${taskId}:`, error);
      throw error;
    }
  }

  /**
   * Commit changes in remote mode using sidecar git APIs
   */
  private async commitChangesRemoteMode(taskId: string, task: { user: { name: string; email: string }; shadowBranch: string | null }): Promise<void> {
    try {
      console.log(`[CHAT] Checking for changes to commit in remote mode for task ${taskId}`);

      // Create sidecar client for this task
      const sidecarClient = new SidecarClient(taskId);

      // Check if there are any uncommitted changes
      const statusResponse = await sidecarClient.getGitStatus();

      if (!statusResponse.success) {
        console.error(`[CHAT] Failed to check git status for task ${taskId}: ${statusResponse.message}`);
        return;
      }

      if (!statusResponse.hasChanges) {
        console.log(`[CHAT] No changes to commit for task ${taskId} in remote mode`);
        return;
      }

      // Get diff from sidecar to generate commit message on server side
      const diffResponse = await sidecarClient.getGitDiff();

      let commitMessage = "Update code via Shadow agent";
      if (diffResponse.success && diffResponse.diff) {
        // Generate commit message using server-side GitManager (which has AI integration)
        const tempGitManager = new GitManager("", taskId);
        commitMessage = await tempGitManager.generateCommitMessage(diffResponse.diff);
      }

      // Commit changes with user and Shadow co-author
      const commitResponse = await sidecarClient.commitChanges(
        {
          name: task.user.name,
          email: task.user.email,
        },
        {
          name: "Shadow",
          email: "noreply@shadow.ai",
        },
        commitMessage
      );

      if (!commitResponse.success) {
        console.error(`[CHAT] Failed to commit changes for task ${taskId}: ${commitResponse.message}`);
        return;
      }

      // Push the commit
      if (!task.shadowBranch) {
        console.warn(`[CHAT] No shadow branch configured for task ${taskId}, skipping push`);
        return;
      }

      const pushResponse = await sidecarClient.pushBranch(task.shadowBranch, false);

      if (!pushResponse.success) {
        console.warn(`[CHAT] Failed to push changes for task ${taskId}: ${pushResponse.message}`);
        // Don't throw here - commit succeeded even if push failed
      }

      console.log(`[CHAT] Successfully committed changes for task ${taskId} in remote mode`);
    } catch (error) {
      console.error(`[CHAT] Error in remote mode git commit for task ${taskId}:`, error);
      // Don't throw here - we don't want git failures to break the chat flow
    }
  }


  async getChatHistory(taskId: string): Promise<Message[]> {
    const dbMessages = await prisma.chatMessage.findMany({
      where: { taskId },
      orderBy: [
        { sequence: "asc" }, // Primary ordering by sequence
        { createdAt: "asc" }, // Fallback ordering by timestamp
      ],
    });

    return dbMessages.map((msg) => ({
      id: msg.id,
      role: msg.role.toLowerCase() as Message["role"],
      content: msg.content,
      llmModel: msg.llmModel || undefined,
      createdAt: msg.createdAt.toISOString(),
      metadata: msg.metadata as MessageMetadata | undefined,
    }));
  }

  async processUserMessage({
    taskId,
    userMessage,
    llmModel = DEFAULT_MODEL,
    enableTools = true,
    skipUserMessageSave = false,
    workspacePath,
  }: {
    taskId: string;
    userMessage: string;
    llmModel?: ModelType;
    enableTools?: boolean;
    skipUserMessageSave?: boolean;
    workspacePath?: string;
  }) {
    // Save user message to database (unless skipped)
    if (!skipUserMessageSave) {
      await this.saveUserMessage(taskId, userMessage);
    }

    // Get chat history for context
    const history = await this.getChatHistory(taskId);

    // Prepare messages for LLM (exclude the user message we just saved to avoid duplication)
    // Filter out tool messages since they're embedded in assistant messages as parts
    const messages: Message[] = history
      .slice(0, -1) // Remove the last message (the one we just saved)
      .filter((msg) => msg.role === "user" || msg.role === "assistant")
      .concat([
        {
          id: randomUUID(),
          role: "user",
          content: userMessage,
          createdAt: new Date().toISOString(),
        },
      ]);

    console.log(
      `[CHAT] Processing message for task ${taskId} with ${messages.length} context messages`
    );
    console.log(
      `[CHAT] Using model: ${llmModel}, Tools enabled: ${enableTools}`
    );

    // Start streaming
    startStream();

    // Create AbortController for this stream
    const abortController = new AbortController();
    this.activeStreams.set(taskId, abortController);

    // Track structured assistant message parts in chronological order
    let assistantSequence: number | null = null;
    let assistantMessageId: string | null = null;
    const assistantParts: AssistantMessagePart[] = [];
    let usageMetadata: MessageMetadata["usage"];
    let finishReason: MessageMetadata["finishReason"];

    // Map to track tool call sequences as they're created
    const toolCallSequences = new Map<string, number>();

    try {
      for await (const chunk of this.llmService.createMessageStream(
        systemPrompt,
        messages,
        llmModel,
        enableTools,
        taskId, // Pass taskId to enable todo tool context
        workspacePath, // Pass workspace path for tool operations
        abortController.signal
      )) {
        // If a stop was requested, break out of the loop immediately
        if (this.stopRequested.has(taskId)) {
          console.log(`[CHAT] Stop requested during stream for task ${taskId}`);
          break;
        }

        // Emit the chunk directly to clients
        emitStreamChunk(chunk);

        // Handle text content chunks
        if (chunk.type === "content" && chunk.content) {
          // Add text part to assistant message
          const textPart: TextPart = {
            type: "text",
            text: chunk.content,
          };
          assistantParts.push(textPart);

          // Create assistant message on first content chunk
          if (assistantSequence === null) {
            assistantSequence = await this.getNextSequence(taskId);
            const assistantMsg = await this.saveAssistantMessage(
              taskId,
              chunk.content, // Still store some content for backward compatibility
              llmModel,
              assistantSequence,
              {
                isStreaming: true,
                parts: assistantParts,
              }
            );
            assistantMessageId = assistantMsg.id;
          } else {
            // Update existing assistant message with current parts
            if (assistantMessageId) {
              const fullContent = assistantParts
                .filter((part) => part.type === "text")
                .map((part) => (part as TextPart).text)
                .join("");

              await prisma.chatMessage.update({
                where: { id: assistantMessageId },
                data: {
                  content: fullContent,
                  metadata: {
                    isStreaming: true,
                    parts: assistantParts,
                  } as any,
                },
              });
            }
          }
        }

        // Handle tool calls
        if (chunk.type === "tool-call" && chunk.toolCall) {
          // Add tool call part to assistant message
          const toolCallPart: ToolCallPart = {
            type: "tool-call",
            toolCallId: chunk.toolCall.id,
            toolName: chunk.toolCall.name,
            args: chunk.toolCall.args,
          };
          assistantParts.push(toolCallPart);

          // Update assistant message with tool call part
          if (assistantMessageId) {
            const fullContent = assistantParts
              .filter((part) => part.type === "text")
              .map((part) => (part as TextPart).text)
              .join("");

            await prisma.chatMessage.update({
              where: { id: assistantMessageId },
              data: {
                content: fullContent,
                metadata: {
                  isStreaming: true,
                  parts: assistantParts,
                } as any,
              },
            });
          }

          // ALSO save separate tool message for backward compatibility and separate tool results
          const toolSequence = await this.getNextSequence(taskId);
          toolCallSequences.set(chunk.toolCall.id, toolSequence);

          await this.saveToolMessage(
            taskId,
            chunk.toolCall.name,
            chunk.toolCall.args,
            "Running...", // Placeholder content
            toolSequence,
            {
              tool: {
                name: chunk.toolCall.name,
                args: chunk.toolCall.args,
                status: "RUNNING",
                result: undefined,
              },
              isStreaming: true,
            }
          );

          console.log(
            `[TOOL_CALL] ${chunk.toolCall.name}:`,
            chunk.toolCall.args
          );
        }

        // Update tool results when they complete
        if (chunk.type === "tool-result" && chunk.toolResult) {
          // Add tool result part to assistant message
          const toolResultPart: ToolResultPart = {
            type: "tool-result",
            toolCallId: chunk.toolResult.id,
            toolName: "", // We'll need to find the tool name from the corresponding call
            result: chunk.toolResult.result,
          };

          // Find the corresponding tool call to get the tool name
          const correspondingCall = assistantParts.find(
            (part) =>
              part.type === "tool-call" &&
              part.toolCallId === chunk.toolResult!.id
          );
          if (correspondingCall && correspondingCall.type === "tool-call") {
            toolResultPart.toolName = correspondingCall.toolName;
          }

          assistantParts.push(toolResultPart);

          // Update assistant message with tool result part
          if (assistantMessageId) {
            const fullContent = assistantParts
              .filter((part) => part.type === "text")
              .map((part) => (part as TextPart).text)
              .join("");

            await prisma.chatMessage.update({
              where: { id: assistantMessageId },
              data: {
                content: fullContent,
                metadata: {
                  isStreaming: true,
                  parts: assistantParts,
                } as any,
              },
            });
          }

          const toolSequence = toolCallSequences.get(chunk.toolResult.id);
          if (toolSequence !== undefined) {
            // Find and update the tool message with the result
            const toolMessage = await prisma.chatMessage.findFirst({
              where: {
                taskId,
                sequence: toolSequence,
                role: "TOOL",
              },
            });

            if (toolMessage) {
              // Convert result to string for content field, keep object in metadata
              const resultString = typeof chunk.toolResult.result === 'string'
                ? chunk.toolResult.result
                : JSON.stringify(chunk.toolResult.result);

              await prisma.chatMessage.update({
                where: { id: toolMessage.id },
                data: {
                  content: resultString,
                  metadata: {
                    ...(toolMessage.metadata as any),
                    tool: {
                      ...(toolMessage.metadata as any)?.tool,
                      status: "COMPLETED",
                      result: chunk.toolResult.result, // Keep as object for type safety
                    },
                    isStreaming: false,
                  },
                },
              });
            }
          }

          console.log(
            `[TOOL_RESULT] ${chunk.toolResult.id}:`,
            chunk.toolResult.result
          );
        }

        // Track usage information
        if (chunk.type === "usage" && chunk.usage) {
          usageMetadata = {
            promptTokens: chunk.usage.promptTokens,
            completionTokens: chunk.usage.completionTokens,
            totalTokens: chunk.usage.totalTokens,
          };
        }
      }

      // Check if stream was stopped early
      const wasStoppedEarly = this.stopRequested.has(taskId);

      // Update final assistant message with complete metadata
      if (assistantMessageId && usageMetadata) {
        const fullContent = assistantParts
          .filter((part) => part.type === "text")
          .map((part) => (part as TextPart).text)
          .join("");

        const finalMetadata: MessageMetadata = {
          usage: usageMetadata,
          finishReason,
          isStreaming: false,
          parts: assistantParts,
        };

        await prisma.chatMessage.update({
          where: { id: assistantMessageId },
          data: {
            content: fullContent,
            metadata: finalMetadata as any,
            promptTokens: usageMetadata.promptTokens,
            completionTokens: usageMetadata.completionTokens,
            totalTokens: usageMetadata.totalTokens,
            finishReason: finishReason,
          },
        });
      }

      console.log(`[CHAT] Completed processing for task ${taskId}`);
      console.log(`[CHAT] Assistant parts: ${assistantParts.length}`);
      console.log(`[CHAT] Tool calls executed: ${toolCallSequences.size}`);

      // Update task status based on how stream ended
      if (wasStoppedEarly) {
        await updateTaskStatus(taskId, "STOPPED", "CHAT");
      } else {
        await updateTaskStatus(taskId, "COMPLETED", "CHAT");

        // Commit changes if there are any (only for successfully completed responses)
        try {
          await this.commitChangesIfAny(taskId, workspacePath);
        } catch (error) {
          console.error(`[CHAT] Failed to commit changes for task ${taskId}:`, error);
          // Don't fail the entire response for git commit failures
        }
      }

      // Clean up stream tracking
      this.activeStreams.delete(taskId);
      this.stopRequested.delete(taskId);
      endStream();
    } catch (error) {
      console.error("Error processing user message:", error);

      // Update task status to failed when stream processing fails
      await updateTaskStatus(taskId, "FAILED", "CHAT");

      // Emit error chunk
      emitStreamChunk({
        type: "error",
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
        finishReason: "error",
      });

      // Clean up stream tracking on error
      this.activeStreams.delete(taskId);
      this.stopRequested.delete(taskId);
      handleStreamError(error);
      throw error;
    }
  }

  // Get available models from LLM service
  getAvailableModels(): ModelType[] {
    return this.llmService.getAvailableModels();
  }

  // Method to process coding tasks with specific configuration
  async processCodingTask(
    taskId: string,
    userMessage: string,
    llmModel: ModelType = DEFAULT_MODEL,
    workspacePath?: string
  ) {
    console.log(`[CODING_TASK] Starting coding task for ${taskId}`);
    console.log(`[CODING_TASK] Task: ${userMessage.substring(0, 100)}...`);

    // Update task status to running when processing a coding task
    await updateTaskStatus(taskId, "RUNNING", "CODING");

    return this.processUserMessage({
      taskId,
      userMessage,
      llmModel,
      enableTools: true,
      workspacePath,
    });
  }

  async stopStream(taskId: string): Promise<void> {
    // Mark stop requested so generator exits early
    this.stopRequested.add(taskId);

    console.log(`[CHAT] Stopping stream for task ${taskId}`);

    const abortController = this.activeStreams.get(taskId);
    if (abortController) {
      abortController.abort();
      this.activeStreams.delete(taskId);
      console.log(`[CHAT] Stream stopped for task ${taskId}`);
    }

    // Update task status to stopped when manually stopped by user
    await updateTaskStatus(taskId, "STOPPED", "CHAT");
  }
}
