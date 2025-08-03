import { prisma } from "@repo/db";
import {
  AssistantMessagePart,
  ErrorPart,
  Message,
  MessageMetadata,
  ModelType,
} from "@repo/types";
import { TextPart, ToolCallPart, ToolResultPart } from "ai";
import { randomUUID } from "crypto";
import { type ChatMessage } from "../../../../packages/db/src/client";
import { LLMService } from "./llm";
import { getSystemPrompt, getDeepWikiMessage } from "./system-prompt";
import { GitManager } from "../services/git-manager";
import { PRManager } from "../services/pr-manager";

import {
  emitStreamChunk,
  endStream,
  handleStreamError,
  startStream,
} from "../socket";
import config from "../config";
import {
  updateTaskStatus,
  updateTaskActivity,
  scheduleTaskCleanup,
  cancelTaskCleanup,
} from "../utils/task-status";
import { createToolExecutor } from "../execution";

export class ChatService {
  private llmService: LLMService;
  private activeStreams: Map<string, AbortController> = new Map();
  private stopRequested: Set<string> = new Set();
  private queuedMessages: Map<
    string,
    {
      message: string;
      model: ModelType;
      workspacePath?: string;
      userApiKeys: { openai?: string; anthropic?: string };
    }
  > = new Map();

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
    llmModel: string,
    metadata?: MessageMetadata
  ): Promise<ChatMessage> {
    const sequence = await this.getNextSequence(taskId);
    const message = await prisma.chatMessage.create({
      data: {
        taskId,
        content,
        role: "USER",
        sequence,
        llmModel,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: (metadata as any) || undefined,
      },
    });

    // Update task activity timestamp when user sends a message
    await updateTaskActivity(taskId, "MESSAGE");

    return message;
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: (metadata as any) || undefined,
        // Denormalized usage fields for easier querying
        promptTokens: usage?.promptTokens,
        completionTokens: usage?.completionTokens,
        totalTokens: usage?.totalTokens,
        finishReason: metadata?.finishReason,
      },
    });
  }

  async saveSystemMessage(
    taskId: string,
    content: string,
    llmModel: string,
    sequence: number,
    metadata?: MessageMetadata
  ): Promise<ChatMessage> {
    return await prisma.chatMessage.create({
      data: {
        taskId,
        content,
        role: "SYSTEM",
        llmModel,
        sequence,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: (metadata as any) || undefined,
      },
    });
  }

  async saveToolMessage(
    taskId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
    toolResult: string,
    sequence: number,
    llmModel: string,
    metadata?: MessageMetadata
  ): Promise<ChatMessage> {
    return await prisma.chatMessage.create({
      data: {
        taskId,
        content: toolResult,
        role: "TOOL",
        sequence,
        llmModel,
        metadata: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(metadata as any),
          tool: {
            name: toolName,
            args: toolArgs,
            status: "COMPLETED",
            result: toolResult,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      },
    });
  }

  /**
   * Commit changes to git if there are any changes after an LLM response
   */
  private async commitChangesIfAny(
    taskId: string,
    workspacePath?: string
  ): Promise<boolean> {
    try {
      // Get task info including user and workspace details
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: { user: true },
      });

      if (!task) {
        console.warn(`[CHAT] Task not found for git commit: ${taskId}`);
        return false;
      }

      if (!task.shadowBranch) {
        console.warn(
          `[CHAT] No shadow branch configured for task ${taskId}, skipping git commit`
        );
        return false;
      }

      // Determine workspace path - use provided path or fall back to task workspace path
      const resolvedWorkspacePath = workspacePath || task.workspacePath;
      if (!resolvedWorkspacePath) {
        console.warn(
          `[CHAT] No workspace path available for task ${taskId}, skipping git commit`
        );
        return false;
      }

      // For remote mode, we use the tool executor to make API calls to the sidecar
      // For local mode, we use GitManager directly
      if (config.agentMode === "local") {
        const gitManager = new GitManager(resolvedWorkspacePath);

        const hasChanges = await gitManager.hasChanges();
        if (!hasChanges) {
          console.log(`[CHAT] No changes to commit for task ${taskId}`);
          return false;
        }

        // Commit changes with user and Shadow co-author
        const committed = await gitManager.commitChangesIfAny(
          {
            name: task.user.name,
            email: task.user.email,
          },
          {
            name: "Shadow",
            email: "noreply@shadowrealm.ai",
          }
        );

        if (committed) {
          console.log(
            `[CHAT] Successfully committed changes for task ${taskId}`
          );
        }

        return committed;
      } else {
        return await this.commitChangesRemoteMode(taskId, task);
      }
    } catch (error) {
      console.error(
        `[CHAT] Failed to commit changes for task ${taskId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Create a PR if needed after changes are committed
   */
  async createPRIfNeeded(
    taskId: string,
    workspacePath?: string,
    messageId?: string,
    userApiKeys?: { openai?: string; anthropic?: string }
  ): Promise<void> {
    try {
      console.log(`[CHAT] Attempting to create PR for task ${taskId}`);

      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: { user: true },
      });

      if (!task) {
        console.warn(`[CHAT] Task not found for PR creation: ${taskId}`);
        return;
      }

      if (!task.shadowBranch) {
        console.warn(
          `[CHAT] No shadow branch configured for task ${taskId}, skipping PR creation`
        );
        return;
      }

      const resolvedWorkspacePath = workspacePath || task.workspacePath;
      if (!resolvedWorkspacePath) {
        console.warn(
          `[CHAT] No workspace path available for task ${taskId}, skipping PR creation`
        );
        return;
      }

      const gitManager = new GitManager(resolvedWorkspacePath);
      const prManager = new PRManager(gitManager, this.llmService);

      if (!messageId) {
        console.warn(
          `[CHAT] No messageId provided for PR creation for task ${taskId}`
        );
        return;
      }

      await prManager.createPRIfNeeded(
        {
          taskId,
          repoFullName: task.repoFullName,
          shadowBranch: task.shadowBranch,
          baseBranch: task.baseBranch,
          userId: task.userId,
          taskTitle: task.title,
          wasTaskCompleted: task.status === "COMPLETED",
          messageId,
        },
        userApiKeys
      );
    } catch (error) {
      console.error(`[CHAT] Failed to create PR for task ${taskId}:`, error);
      // Non-blocking - don't throw
    }
  }

  /**
   * Create a PR if user has auto-PR enabled and changes are committed
   */
  private async createPRIfUserEnabled(
    taskId: string,
    workspacePath?: string,
    messageId?: string,
    userApiKeys?: { openai?: string; anthropic?: string }
  ): Promise<void> {
    try {
      console.log(`[CHAT] Checking user auto-PR setting for task ${taskId}`);

      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
          user: {
            include: {
              userSettings: true,
            },
          },
        },
      });

      if (!task) {
        console.warn(`[CHAT] Task not found for PR creation: ${taskId}`);
        return;
      }

      // Check if user has auto-PR enabled (default to true if no settings exist)
      const autoPREnabled = task.user.userSettings?.autoPullRequest ?? true;

      if (!autoPREnabled) {
        console.log(
          `[CHAT] Auto-PR disabled for user ${task.userId}, skipping PR creation`
        );
        return;
      }

      console.log(
        `[CHAT] Auto-PR enabled for user ${task.userId}, creating PR`
      );

      // Use the existing createPRIfNeeded method
      await this.createPRIfNeeded(
        taskId,
        workspacePath,
        messageId,
        userApiKeys
      );
    } catch (error) {
      console.error(
        `[CHAT] Failed to check user auto-PR setting for task ${taskId}:`,
        error
      );
      // Non-blocking - don't throw
    }
  }

  /**
   * Commit changes in remote mode using tool executor git APIs
   */
  private async commitChangesRemoteMode(
    taskId: string,
    task: {
      user: { name: string; email: string };
      shadowBranch: string | null;
    }
  ): Promise<boolean> {
    try {
      console.log(
        `[CHAT] Checking for changes to commit in remote mode for task ${taskId}`
      );

      // Create tool executor for this task
      const toolExecutor = createToolExecutor(taskId);

      // Check if there are any uncommitted changes
      const statusResponse = await toolExecutor.getGitStatus();

      if (!statusResponse.success) {
        console.error(
          `[CHAT] Failed to check git status for task ${taskId}: ${statusResponse.message}`
        );
        return false;
      }

      if (!statusResponse.hasChanges) {
        console.log(
          `[CHAT] No changes to commit for task ${taskId} in remote mode`
        );
        return false;
      }

      // Get diff from tool executor to generate commit message on server side
      const diffResponse = await toolExecutor.getGitDiff();

      let commitMessage = "Update code via Shadow agent";
      if (diffResponse.success && diffResponse.diff) {
        // Generate commit message using server-side GitManager (which has AI integration)
        const tempGitManager = new GitManager("");
        commitMessage = await tempGitManager.generateCommitMessage(
          diffResponse.diff
        );
      }

      // Commit changes with user and Shadow co-author
      const commitResponse = await toolExecutor.commitChanges({
        user: {
          name: task.user.name,
          email: task.user.email,
        },
        coAuthor: {
          name: "Shadow",
          email: "noreply@shadowrealm.ai",
        },
        message: commitMessage,
      });

      if (!commitResponse.success) {
        console.error(
          `[CHAT] Failed to commit changes for task ${taskId}: ${commitResponse.message}`
        );
        return false;
      }

      // Push the commit
      if (!task.shadowBranch) {
        console.warn(
          `[CHAT] No shadow branch configured for task ${taskId}, skipping push`
        );
        return false;
      }

      const pushResponse = await toolExecutor.pushBranch({
        branchName: task.shadowBranch,
        setUpstream: false,
      });

      if (!pushResponse.success) {
        console.warn(
          `[CHAT] Failed to push changes for task ${taskId}: ${pushResponse.message}`
        );
        // Don't throw here - commit succeeded even if push failed
      }

      console.log(
        `[CHAT] Successfully committed changes for task ${taskId} in remote mode`
      );
      return true;
    } catch (error) {
      console.error(
        `[CHAT] Error in remote mode git commit for task ${taskId}:`,
        error
      );
      // Don't throw here - we don't want git failures to break the chat flow
      return false;
    }
  }

  async getChatHistory(taskId: string): Promise<Message[]> {
    const dbMessages = await prisma.chatMessage.findMany({
      where: { taskId },
      include: {
        pullRequestSnapshot: true,
      },
      orderBy: [
        { sequence: "asc" }, // Primary ordering by sequence
        { createdAt: "asc" }, // Fallback ordering by timestamp
      ],
    });

    return dbMessages.map((msg) => ({
      id: msg.id,
      role: msg.role.toLowerCase() as Message["role"],
      content: msg.content,
      llmModel: msg.llmModel,
      createdAt: msg.createdAt.toISOString(),
      metadata: msg.metadata as MessageMetadata | undefined,
      pullRequestSnapshot: msg.pullRequestSnapshot || undefined,
    }));
  }

  /**
   * Handle follow-up logic for tasks
   */
  private async handleFollowUpLogic(taskId: string): Promise<void> {
    try {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: {
          status: true,
          initStatus: true,
          scheduledCleanupAt: true,
        },
      });

      if (!task) {
        console.warn(`[CHAT] Task not found for follow-up logic: ${taskId}`);
        return;
      }

      // Handle COMPLETED or STOPPED tasks with scheduled cleanup
      if (
        (task.status === "COMPLETED" || task.status === "STOPPED") &&
        task.scheduledCleanupAt
      ) {
        console.log(
          `[CHAT] Following up on ${task.status.toLowerCase()} task ${taskId}, cancelling cleanup`
        );

        await cancelTaskCleanup(taskId);
        await updateTaskStatus(taskId, "RUNNING", "CHAT");

        return;
      }

      // Handle COMPLETED or STOPPED tasks without scheduled cleanup (need re-initialization)
      if (
        (task.status === "COMPLETED" || task.status === "STOPPED") &&
        !task.scheduledCleanupAt
      ) {
        console.log(
          `[CHAT] Following up on ${task.status.toLowerCase()} task ${taskId}, requires re-initialization`
        );

        // Set task back to INITIALIZING and reset init status
        await updateTaskStatus(taskId, "INITIALIZING", "CHAT");
        await prisma.task.update({
          where: { id: taskId },
          data: { initStatus: "INACTIVE" },
        });

        // Note: Re-initialization will be triggered by the initialization system
        // when it detects INITIALIZING status with INACTIVE init status
        return;
      }

      // ARCHIVED is permanent - no follow-up handling
      // For other statuses (RUNNING, INITIALIZING, FAILED), no special handling needed
    } catch (error) {
      console.error(
        `[CHAT] Error in follow-up logic for task ${taskId}:`,
        error
      );
    }
  }

  async processUserMessage({
    taskId,
    userMessage,
    llmModel,
    userApiKeys,
    enableTools = true,
    skipUserMessageSave = false,
    workspacePath,
    queue = false,
  }: {
    taskId: string;
    userMessage: string;
    llmModel: ModelType;
    userApiKeys: { openai?: string; anthropic?: string };
    enableTools?: boolean;
    skipUserMessageSave?: boolean;
    workspacePath?: string;
    queue?: boolean;
  }) {
    // Handle follow-up logic for COMPLETED tasks
    await this.handleFollowUpLogic(taskId);

    if (queue) {
      if (this.activeStreams.has(taskId)) {
        console.log(
          `[CHAT] Queuing message for task ${taskId} (stream in progress)`
        );

        // Support only one queued message at a time for now, can extend to a list later
        // Override the existing queued message if it exists
        this.queuedMessages.set(taskId, {
          message: userMessage,
          model: llmModel,
          workspacePath,
          userApiKeys,
        });
        return;
      }
    } else {
      // queue=false: interrupt any active stream and process immediately
      if (this.activeStreams.has(taskId)) {
        console.log(
          `[CHAT] Interrupting active stream for task ${taskId} due to new message`
        );
        await this.stopStream(taskId);

        // Override queued message if it exists
        if (this.queuedMessages.has(taskId)) {
          this.queuedMessages.delete(taskId);
        }

        // Cleanup time buffer
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Save user message to database (unless skipped, e.g. on task initialization)
    if (!skipUserMessageSave) {
      await this.saveUserMessage(taskId, userMessage, llmModel);
    }

    const history = await this.getChatHistory(taskId);

    // Prepare messages for LLM (exclude the user message we just saved to avoid duplication)
    // Filter out tool messages since they're embedded in assistant messages as parts
    const messages: Message[] = history
      .slice(0, -1) // Remove the last message (the one we just saved)
      .filter(
        (msg) =>
          msg.role === "user" ||
          msg.role === "assistant" ||
          msg.role === "system"
      );

    // Check if deep wiki system message already exists in conversation
    const hasDeepWikiMessage = history.some((msg) => msg.role === "system");

    // Add deep wiki content as the first system message only if no system messages exist yet
    if (!hasDeepWikiMessage) {
      const deepWikiContent = await getDeepWikiMessage(taskId);
      if (deepWikiContent) {
        // Save the deep wiki as a system message in the database
        const deepWikiSequence = await this.getNextSequence(taskId);
        await this.saveSystemMessage(
          taskId,
          deepWikiContent,
          llmModel,
          deepWikiSequence
        );

        // Insert at the beginning, right after system prompt
        messages.unshift({
          id: randomUUID(),
          role: "system",
          content: deepWikiContent,
          createdAt: new Date().toISOString(),
          llmModel,
        });
      }
    }

    // Add the current user message last
    messages.push({
      id: randomUUID(),
      role: "user",
      content: userMessage,
      createdAt: new Date().toISOString(),
      llmModel,
    });

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
    let hasError = false;

    // Map to track tool call sequences as they're created
    const toolCallSequences = new Map<string, number>();

    // Get clean system prompt (deep wiki content is now in messages array)
    const taskSystemPrompt = await getSystemPrompt();

    try {
      for await (const chunk of this.llmService.createMessageStream(
        taskSystemPrompt,
        messages,
        llmModel,
        userApiKeys,
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
        emitStreamChunk(chunk, taskId);

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
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
            llmModel,
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
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
              const resultString =
                typeof chunk.toolResult.result === "string"
                  ? chunk.toolResult.result
                  : JSON.stringify(chunk.toolResult.result);

              await prisma.chatMessage.update({
                where: { id: toolMessage.id },
                data: {
                  content: resultString,
                  metadata: {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ...(toolMessage.metadata as any),
                    tool: {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

        // Handle error chunks from LLM service
        if (chunk.type === "error") {
          console.error(
            `[CHAT] Received error chunk for task ${taskId}:`,
            chunk.error
          );
          finishReason = chunk.finishReason || "error";
          hasError = true;

          // Add error part to assistant message parts
          const errorPart: ErrorPart = {
            type: "error",
            error: chunk.error || "Unknown error occurred",
            finishReason: chunk.finishReason,
          };
          assistantParts.push(errorPart);

          // Update assistant message with error part if we have one
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
                  isStreaming: false,
                  parts: assistantParts,
                  finishReason,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any,
              },
            });
          }

          // Update task status to failed
          await updateTaskStatus(taskId, "FAILED", "CHAT");

          // Clean up stream tracking
          this.activeStreams.delete(taskId);
          this.stopRequested.delete(taskId);
          endStream(taskId);

          // Clear any queued messages (don't process them after error)
          this.clearQueuedMessage(taskId);

          // Exit the streaming loop
          break;
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      // Update task status and schedule cleanup based on how stream ended
      if (hasError) {
        // Error already handled above, just ensure cleanup happens
        await scheduleTaskCleanup(taskId, 10);
      } else if (wasStoppedEarly) {
        await updateTaskStatus(taskId, "STOPPED", "CHAT");
        await scheduleTaskCleanup(taskId, 10);
      } else {
        await updateTaskStatus(taskId, "COMPLETED", "CHAT");
        await scheduleTaskCleanup(taskId, 10);

        // Update task activity timestamp when assistant completes response
        await updateTaskActivity(taskId, "CHAT");

        // Commit changes if there are any (only for successfully completed responses)
        try {
          const changesCommitted = await this.commitChangesIfAny(
            taskId,
            workspacePath
          );

          // Create PR if changes were committed and user has auto-PR enabled
          if (changesCommitted && assistantMessageId) {
            await this.createPRIfUserEnabled(
              taskId,
              workspacePath,
              assistantMessageId,
              userApiKeys
            );
          }
        } catch (error) {
          console.error(
            `[CHAT] Failed to commit changes for task ${taskId}:`,
            error
          );
          // Don't fail the entire response for git commit failures
        }
      }

      // Clean up stream tracking
      this.activeStreams.delete(taskId);
      this.stopRequested.delete(taskId);
      endStream(taskId);

      // Process any queued message
      await this.processQueuedMessage(taskId);
    } catch (error) {
      console.error("Error processing user message:", error);

      // Update task status to failed when stream processing fails
      await updateTaskStatus(taskId, "FAILED", "CHAT");

      // Emit error chunk
      emitStreamChunk(
        {
          type: "error",
          error:
            error instanceof Error ? error.message : "Unknown error occurred",
          finishReason: "error",
        },
        taskId
      );

      // Clean up stream tracking on error
      this.activeStreams.delete(taskId);
      this.stopRequested.delete(taskId);
      handleStreamError(error, taskId);

      await this.processQueuedMessage(taskId);
      throw error;
    }
  }

  private async processQueuedMessage(taskId: string): Promise<void> {
    const queuedMessage = this.queuedMessages.get(taskId);
    if (!queuedMessage) {
      return;
    }

    this.queuedMessages.delete(taskId);

    console.log(`[CHAT] Processing queued message for task ${taskId}`);

    try {
      await this.processUserMessage({
        taskId,
        userMessage: queuedMessage.message,
        llmModel: queuedMessage.model,
        userApiKeys: queuedMessage.userApiKeys,
        enableTools: true,
        skipUserMessageSave: false,
        workspacePath: queuedMessage.workspacePath,
        queue: false,
      });
    } catch (error) {
      console.error(
        `[CHAT] Error processing queued message for task ${taskId}:`,
        error
      );
    }
  }

  getAvailableModels(userApiKeys: {
    openai?: string;
    anthropic?: string;
  }): ModelType[] {
    return this.llmService.getAvailableModels(userApiKeys);
  }

  getQueuedMessage(taskId: string): string | undefined {
    return this.queuedMessages.get(taskId)?.message;
  }

  clearQueuedMessage(taskId: string): void {
    this.queuedMessages.delete(taskId);
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

  async editUserMessage({
    taskId,
    messageId,
    newContent,
    newModel,
    userApiKeys,
    workspacePath,
  }: {
    taskId: string;
    messageId: string;
    newContent: string;
    newModel: ModelType;
    userApiKeys: { openai?: string; anthropic?: string };
    workspacePath?: string;
  }): Promise<void> {
    console.log(`[CHAT] Editing user message ${messageId} in task ${taskId}`);

    // First, stop any active stream and clear queued messages
    if (this.activeStreams.has(taskId)) {
      await this.stopStream(taskId);
    }
    this.clearQueuedMessage(taskId);

    // Update the message in database
    await prisma.chatMessage.update({
      where: { id: messageId },
      data: {
        content: newContent,
        llmModel: newModel,
        editedAt: new Date(),
      },
    });

    // Update task activity timestamp when user edits a message
    await updateTaskActivity(taskId, "MESSAGE");

    // Get the sequence of the edited message
    const editedMessage = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { sequence: true },
    });

    if (!editedMessage) {
      throw new Error("Edited message not found");
    }

    // Delete all messages that come after the edited message
    await prisma.chatMessage.deleteMany({
      where: {
        taskId,
        sequence: {
          gt: editedMessage.sequence,
        },
      },
    });

    console.log(
      `[CHAT] Deleted messages after sequence ${editedMessage.sequence} in task ${taskId}`
    );

    // Get chat history up to the edited message
    const history = await this.getChatHistory(taskId);

    // Process the edited message as if it were a new message
    // Filter out tool messages and use the updated content
    const messages: Message[] = history
      .filter((msg) => msg.role === "user" || msg.role === "assistant")
      .map((msg) => {
        if (msg.id === messageId) {
          return {
            ...msg,
            content: newContent,
            llmModel: newModel,
          };
        }
        return msg;
      });

    console.log(
      `[CHAT] Re-processing from edited message with ${messages.length} context messages`
    );

    // Start streaming from the edited message
    await this.processUserMessage({
      taskId,
      userMessage: newContent,
      llmModel: newModel,
      userApiKeys,
      enableTools: true,
      skipUserMessageSave: true, // Don't save again, already updated
      workspacePath,
      queue: false,
    });
  }
}
