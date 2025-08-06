import { prisma } from "@repo/db";
import {
  AssistantMessagePart,
  ErrorPart,
  Message,
  MessageMetadata,
  ModelType,
  ApiKeys,
  QueuedActionUI,
} from "@repo/types";
import { TextPart, ToolCallPart, ToolResultPart } from "ai";
import { randomUUID } from "crypto";
import { type ChatMessage } from "../../../../packages/db/src/client";
import { LLMService } from "./llm";
import { getSystemPrompt, getDeepWikiMessage } from "./system-prompt";
import { createTools } from "./tools";
import type { ToolSet } from "ai";
import { GitManager } from "../services/git-manager";
import { PRManager } from "../services/pr-manager";
import { modelContextService } from "../services/model-context-service";
import { TaskModelContext } from "../services/task-model-context";
import { generateTaskTitleAndBranch } from "../utils/title-generation";
import { nanoid } from "nanoid";
import { MessageRole } from "@repo/db";
import {
  emitStreamChunk,
  emitToTask,
  endStream,
  handleStreamError,
  startStream,
  type TypedSocket,
} from "../socket";
import config from "../config";
import {
  updateTaskStatus,
  updateTaskActivity,
  scheduleTaskCleanup,
  cancelTaskCleanup,
} from "../utils/task-status";
import { createToolExecutor } from "../execution";
import { memoryService } from "../services/memory-service";
import { TaskInitializationEngine } from "@/initialization";

// Discriminated union types for queued actions
type QueuedMessageAction = {
  type: "message";
  data: {
    message: string;
    context: TaskModelContext;
    workspacePath?: string;
  };
};

type QueuedStackedPRAction = {
  type: "stacked-pr";
  data: {
    message: string;
    parentTaskId: string;
    model: ModelType;
    userId: string;
    socket: TypedSocket;
  };
};

type QueuedAction = QueuedMessageAction | QueuedStackedPRAction;

export class ChatService {
  private llmService: LLMService;
  private activeStreams: Map<string, AbortController> = new Map();
  private stopRequested: Set<string> = new Set();
  private queuedActions: Map<string, QueuedAction> = new Map();

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
    context: TaskModelContext,
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
          },
          context
        );

        if (committed) {
          console.log(
            `[CHAT] Successfully committed changes for task ${taskId}`
          );
        }

        return committed;
      } else {
        return await this.commitChangesRemoteMode(taskId, task, context);
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
    context?: TaskModelContext
  ): Promise<void> {
    // Get or create context if not provided
    let modelContext: TaskModelContext;
    if (context) {
      modelContext = context;
    } else {
      const taskContext = await modelContextService.getContextForTask(taskId);
      if (!taskContext) {
        console.warn(
          `[CHAT] No model context available for task ${taskId}, skipping PR creation`
        );
        return;
      }
      modelContext = taskContext;
    }

    return this._createPRIfNeededInternal(
      taskId,
      workspacePath,
      messageId,
      modelContext
    );
  }

  /**
   * Internal method for PR creation
   */
  private async _createPRIfNeededInternal(
    taskId: string,
    workspacePath?: string,
    messageId?: string,
    context?: TaskModelContext
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

      if (!context) {
        console.warn(
          `[CHAT] No context available for PR creation, skipping PR for task ${taskId}`
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
        context
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
    context?: TaskModelContext
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
      await this.createPRIfNeeded(taskId, workspacePath, messageId, context);
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
    },
    context: TaskModelContext
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
          diffResponse.diff,
          context
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
        stackedTask: {
          select: {
            id: true,
            title: true,
            shadowBranch: true,
            status: true,
          },
        },
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
      stackedTaskId: msg.stackedTaskId || undefined,
      stackedTask: msg.stackedTask || undefined,
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

      // Handle tasks with inactive workspaces (VM spun down)
      if (task.initStatus === "INACTIVE") {
        // If task has scheduled cleanup, cancel it since user wants to resume
        if (task.scheduledCleanupAt) {
          console.log(
            `[CHAT] Resuming task ${taskId} with scheduled cleanup, cancelling cleanup`
          );
          await cancelTaskCleanup(taskId);
        } else {
          console.log(
            `[CHAT] Resuming inactive task ${taskId}, requires re-initialization`
          );
        }

        // Set task to INITIALIZING to trigger workspace spin-up
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

  /**
   * Process user message using TaskModelContext system
   */
  async processUserMessage({
    taskId,
    userMessage,
    context,
    enableTools = true,
    skipUserMessageSave = false,
    workspacePath,
    queue = false,
    thinkingConfig,
  }: {
    taskId: string;
    userMessage: string;
    context: TaskModelContext;
    enableTools?: boolean;
    skipUserMessageSave?: boolean;
    workspacePath?: string;
    queue?: boolean;
    thinkingConfig?: {
      enabled: boolean;
      budgetTokens?: number;
    };
  }) {
    // Update task's mainModel to keep it current
    await modelContextService.updateTaskMainModel(
      taskId,
      context.getMainModel()
    );

    return this._processUserMessageInternal({
      taskId,
      userMessage,
      context,
      enableTools,
      skipUserMessageSave,
      workspacePath,
      queue,
      thinkingConfig,
    });
  }

  /**
   * Internal method for processing user messages
   */
  private async _processUserMessageInternal({
    taskId,
    userMessage,
    context,
    enableTools = true,
    skipUserMessageSave = false,
    workspacePath,
    queue = false,
    thinkingConfig,
  }: {
    taskId: string;
    userMessage: string;
    context: TaskModelContext;
    enableTools?: boolean;
    skipUserMessageSave?: boolean;
    workspacePath?: string;
    queue?: boolean;
    thinkingConfig?: {
      enabled: boolean;
      budgetTokens?: number;
    };
  }) {
    // Handle follow-up logic for COMPLETED tasks
    await this.handleFollowUpLogic(taskId);

    if (queue) {
      if (this.activeStreams.has(taskId)) {
        console.log(
          `[CHAT] Queuing message for task ${taskId} (stream in progress)`
        );

        // Support only one queued action at a time for now, can extend to a list later
        // Override the existing queued action if it exists
        this.queuedActions.set(taskId, {
          type: "message",
          data: {
            message: userMessage,
            context,
            workspacePath,
          },
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

        // Override queued action if it exists
        if (this.queuedActions.has(taskId)) {
          this.queuedActions.delete(taskId);
        }

        // Cleanup time buffer
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Save user message to database (unless skipped, e.g. on task initialization)
    if (!skipUserMessageSave) {
      await this.saveUserMessage(taskId, userMessage, context.getMainModel());
    }

    const history = await this.getChatHistory(taskId);

    const messages: Message[] = history
      .slice(0, -1)
      .filter(
        (msg) =>
          (msg.role === "user" && !msg.stackedTaskId) ||
          msg.role === "assistant" ||
          msg.role === "system"
      );

    const isFirstMessage = !messages.some((msg) => msg.role === "system");

    if (isFirstMessage) {
      const systemMessagesToAdd: Message[] = [];

      const deepWikiContent = await getDeepWikiMessage(taskId);
      if (deepWikiContent) {
        const deepWikiSequence = await this.getNextSequence(taskId);
        await this.saveSystemMessage(
          taskId,
          deepWikiContent,
          context.getMainModel(),
          deepWikiSequence
        );

        systemMessagesToAdd.push({
          id: randomUUID(),
          role: "system",
          content: deepWikiContent,
          createdAt: new Date().toISOString(),
          llmModel: context.getMainModel(),
        });
      }

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

      const memoriesEnabled = task?.user.userSettings?.memoriesEnabled ?? true;

      if (memoriesEnabled) {
        const memoryContext = await memoryService.getMemoriesForTask(taskId);
        if (memoryContext && memoryContext.memories.length > 0) {
          const memoryContent =
            memoryService.formatMemoriesForPrompt(memoryContext);

          const memorySequence = await this.getNextSequence(taskId);
          await this.saveSystemMessage(
            taskId,
            memoryContent,
            context.getMainModel(),
            memorySequence
          );

          systemMessagesToAdd.push({
            id: randomUUID(),
            role: "system",
            content: memoryContent,
            createdAt: new Date().toISOString(),
            llmModel: context.getMainModel(),
          });
        }
      }

      messages.unshift(...systemMessagesToAdd);
    }

    messages.push({
      id: randomUUID(),
      role: "user",
      content: userMessage,
      createdAt: new Date().toISOString(),
      llmModel: context.getMainModel(),
    });

    console.log(
      `[CHAT] Processing message for task ${taskId} with ${messages.length} context messages`
    );
    console.log(
      `[CHAT] Using model: ${context.getMainModel()}, Tools enabled: ${enableTools}`
    );

    startStream(taskId);

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

    const toolCallSequences = new Map<string, number>();

    // Create tools first so we can generate system prompt based on available tools
    let availableTools: ToolSet | undefined;
    if (enableTools && taskId) {
      availableTools = await createTools(taskId, workspacePath);
    }

    // Get system prompt with available tools context
    const taskSystemPrompt = await getSystemPrompt(availableTools);

    console.log(`[CHAT] Task MODEL:`, context.getMainModel());

    // Debug API key context before LLM call
    console.log(`[API_KEY_DEBUG] Context provider: ${context.getProvider()}`);
    console.log(
      `[API_KEY_DEBUG] Context validates access: ${context.validateAccess()}`
    );
    console.log(
      `[API_KEY_DEBUG] API key for provider: ${context.getProviderApiKey() ? "PRESENT" : "MISSING"}`
    );
    console.log(
      `[API_KEY_DEBUG] API keys object: ${JSON.stringify(Object.keys(context.getApiKeys()))}`
    );

    try {
      for await (const chunk of this.llmService.createMessageStream(
        taskSystemPrompt,
        messages,
        context.getMainModel(),
        context.getApiKeys(),
        enableTools,
        taskId, // Pass taskId to enable todo tool context
        workspacePath, // Pass workspace path for tool operations
        abortController.signal,
        availableTools,
        thinkingConfig
      )) {
        if (this.stopRequested.has(taskId)) {
          console.log(`[CHAT] Stop requested during stream for task ${taskId}`);
          break;
        }

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
              context.getMainModel(),
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
            context.getMainModel(),
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

          // Clear any queued actions (don't process them after error)
          this.clearQueuedAction(taskId);

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
            context,
            workspacePath
          );

          // Create PR if changes were committed and user has auto-PR enabled
          if (changesCommitted && assistantMessageId) {
            await this.createPRIfUserEnabled(
              taskId,
              workspacePath,
              assistantMessageId,
              context
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

      // Process any queued actions
      await this.processQueuedActions(taskId);
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

      // Clear any queued actions (don't process them after error)
      this.clearQueuedAction(taskId);
      throw error;
    }
  }

  private async processQueuedActions(taskId: string): Promise<void> {
    const queuedAction = this.queuedActions.get(taskId);
    if (!queuedAction) {
      return;
    }

    this.queuedActions.delete(taskId);

    console.log(
      `[CHAT] Processing queued ${queuedAction.type} for task ${taskId}`
    );

    try {
      switch (queuedAction.type) {
        case "message":
          // Emit event for regular messages before processing
          emitToTask(taskId, "queued-action-processing", {
            taskId,
            type: queuedAction.type,
            message: queuedAction.data.message,
            model: queuedAction.data.context.getMainModel(),
          });
          await this._processQueuedMessage(queuedAction.data, taskId);
          break;
        case "stacked-pr":
          await this._processQueuedStackedPR(queuedAction.data);
          break;
      }
    } catch (error) {
      console.error(
        `[CHAT] Error processing queued ${queuedAction.type} for task ${taskId}:`,
        error
      );
    }
  }

  private async _processQueuedMessage(
    data: QueuedMessageAction["data"],
    taskId: string
  ): Promise<void> {
    // Use the stored TaskModelContext directly
    await this.processUserMessage({
      taskId,
      userMessage: data.message,
      context: data.context,
      enableTools: true,
      skipUserMessageSave: false,
      workspacePath: data.workspacePath,
      queue: false,
    });
  }

  private async _processQueuedStackedPR(
    data: QueuedStackedPRAction["data"]
  ): Promise<void> {
    await this._createStackedTaskInternal({
      parentTaskId: data.parentTaskId,
      message: data.message,
      model: data.model,
      userId: data.userId,
    });
  }

  async getAvailableModels(userApiKeys: ApiKeys): Promise<ModelType[]> {
    return await this.llmService.getAvailableModels(userApiKeys);
  }

  getQueuedAction(taskId: string): QueuedActionUI | null {
    const action = this.queuedActions.get(taskId);
    if (!action) return null;

    // Model is now required for both action types
    const model =
      action.type === "stacked-pr"
        ? action.data.model
        : action.data.context?.getMainModel();

    if (!model) {
      console.warn(
        `[CHAT] No model available for queued ${action.type} action in task ${taskId}`
      );
      return null;
    }

    return {
      type: action.type,
      message: action.data.message,
      model,
    };
  }

  clearQueuedAction(taskId: string): void {
    this.queuedActions.delete(taskId);
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
    context,
    workspacePath,
  }: {
    taskId: string;
    messageId: string;
    newContent: string;
    newModel: ModelType;
    context: TaskModelContext;
    workspacePath?: string;
  }): Promise<void> {
    console.log(`[CHAT] Editing user message ${messageId} in task ${taskId}`);

    // First, stop any active stream and clear queued messages
    if (this.activeStreams.has(taskId)) {
      await this.stopStream(taskId);
    }
    this.clearQueuedAction(taskId);

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
    // Filter out tool messages and stacked-PR messages, use the updated content
    const messages: Message[] = history
      .filter(
        (msg) =>
          (msg.role === "user" && !msg.stackedTaskId) ||
          msg.role === "assistant"
      )
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
    // Update context with new model if it has changed
    if (context.getMainModel() !== newModel) {
      // Create new context with updated model
      const updatedContext = new TaskModelContext(
        taskId,
        newModel,
        context.getApiKeys()
      );
      await this.processUserMessage({
        taskId,
        userMessage: newContent,
        context: updatedContext,
        enableTools: true,
        skipUserMessageSave: true, // Don't save again, already updated
        workspacePath,
        queue: false,
      });
    } else {
      // Use existing context
      await this.processUserMessage({
        taskId,
        userMessage: newContent,
        context,
        enableTools: true,
        skipUserMessageSave: true, // Don't save again, already updated
        workspacePath,
        queue: false,
      });
    }
  }

  /**
   * Create a stacked PR (new task based on current task's shadow branch)
   */
  async createStackedPR({
    parentTaskId,
    message,
    model,
    userId,
    queue,
    socket,
  }: {
    parentTaskId: string;
    message: string;
    model: ModelType;
    userId: string;
    queue: boolean;
    socket: TypedSocket;
  }): Promise<void> {
    try {
      console.log(`[CHAT] Creating stacked PR for parent task ${parentTaskId}`);

      // If there's an active stream and queue is true, queue the stacked PR
      if (this.activeStreams.has(parentTaskId) && queue) {
        console.log(
          `[CHAT] Queuing stacked PR for task ${parentTaskId} (stream in progress)`
        );
        this.queuedActions.set(parentTaskId, {
          type: "stacked-pr",
          data: {
            message,
            parentTaskId,
            model,
            userId,
            socket,
          },
        });
        return;
      }

      // Create the stacked task immediately
      await this._createStackedTaskInternal({
        parentTaskId,
        message,
        model,
        userId,
      });
    } catch (error) {
      console.error(`[CHAT] Error creating stacked PR:`, error);
      socket.emit("message-error", {
        error: "Failed to create stacked PR",
      });
    }
  }

  /**
   * Internal method to create stacked task
   */
  private async _createStackedTaskInternal({
    parentTaskId,
    message,
    model,
    userId,
  }: {
    parentTaskId: string;
    message: string;
    model: ModelType;
    userId: string;
  }): Promise<void> {
    try {
      // Get parent task details
      const parentTask = await prisma.task.findUnique({
        where: { id: parentTaskId },
        select: {
          repoFullName: true,
          repoUrl: true,
          shadowBranch: true,
          userId: true,
        },
      });

      if (!parentTask) {
        throw new Error("Parent task not found");
      }

      if (parentTask.userId !== userId) {
        throw new Error("Unauthorized to create stacked task");
      }

      const newTaskId = nanoid();

      const parentContext =
        await modelContextService.getContextForTask(parentTaskId);

      console.log("\n\n[CHAT] Parent context:", parentContext);

      // Create TaskModelContext for title generation
      const context = await modelContextService.copyContext(
        newTaskId,
        parentContext!
      );

      // Generate title and branch for the new task
      const { title, shadowBranch } = await generateTaskTitleAndBranch(
        newTaskId,
        message,
        context
      );

      // Create the new stacked task
      await prisma.task.create({
        data: {
          id: newTaskId,
          title,
          repoFullName: parentTask.repoFullName,
          repoUrl: parentTask.repoUrl,
          baseBranch: parentTask.shadowBranch, // Use parent's shadow branch as base
          shadowBranch,
          baseCommitSha: "pending",
          status: "INITIALIZING",
          user: {
            connect: {
              id: userId,
            },
          },
          messages: {
            create: {
              content: message,
              role: MessageRole.USER,
              sequence: 1,
              llmModel: model,
            },
          },
        },
      });

      // Create a message in the parent task referencing the stacked task
      const parentNextSequence = await this.getNextSequence(parentTaskId);
      await prisma.chatMessage.create({
        data: {
          content: message,
          role: MessageRole.USER,
          llmModel: model,
          taskId: parentTaskId,
          stackedTaskId: newTaskId,
          sequence: parentNextSequence,
        },
      });

      // Trigger task initialization (similar to the backend initiate endpoint)
      await this.initializeStackedTask(
        newTaskId,
        message,
        model,
        userId,
        parentTaskId
      );

      console.log(
        `[CHAT] Successfully created stacked task ${newTaskId} from parent ${parentTaskId}`
      );

      // Emit event to frontend for optimistic message display with full context
      emitToTask(parentTaskId, "queued-action-processing", {
        taskId: parentTaskId,
        type: "stacked-pr",
        message,
        model,
        shadowBranch,
        title,
      });
    } catch (error) {
      console.error(`[CHAT] Error in _createStackedTaskInternal:`, error);
      throw error;
    }
  }

  /**
   * Initialize a stacked task (similar to the backend initiate endpoint)
   */
  private async initializeStackedTask(
    taskId: string,
    message: string,
    model: ModelType,
    _userId: string,
    parentTaskId: string
  ): Promise<void> {
    try {
      console.log(`[CHAT] Initializing stacked task ${taskId}`);

      const initializationEngine = new TaskInitializationEngine();

      await updateTaskStatus(taskId, "RUNNING", "CHAT");

      // Get parent's API keys from cached context
      const parentContext =
        await modelContextService.getContextForTask(parentTaskId);
      if (!parentContext) {
        throw new Error(`Parent task context not found for ${parentTaskId}`);
      }

      // Debug parent context
      console.log(
        `[API_KEY_DEBUG] Parent context validation: ${parentContext.validateAccess()}`
      );
      console.log(
        `[API_KEY_DEBUG] Parent API keys available: ${JSON.stringify(Object.keys(parentContext.getApiKeys()))}`
      );
      console.log(
        `[API_KEY_DEBUG] Parent provider: ${parentContext.getProvider()}`
      );

      // Create new task context inheriting parent's API keys
      const newTaskContext =
        await modelContextService.createContextWithInheritedKeys(
          taskId,
          model,
          parentContext.getApiKeys()
        );

      // Debug new context
      console.log(
        `[API_KEY_DEBUG] New context validation: ${newTaskContext.validateAccess()}`
      );
      console.log(
        `[API_KEY_DEBUG] New context API keys available: ${JSON.stringify(Object.keys(newTaskContext.getApiKeys()))}`
      );
      console.log(
        `[API_KEY_DEBUG] New context provider: ${newTaskContext.getProvider()}`
      );

      // Start task initialization in background (non-blocking)
      // This will handle workspace setup, VM creation, etc.
      initializationEngine
        .initializeTask(
          taskId,
          undefined, // Use default steps
          _userId,
          newTaskContext
        )
        .catch((error: unknown) => {
          console.error(
            `[CHAT] Failed to initialize stacked task ${taskId}:`,
            error
          );
        });

      setTimeout(async () => {
        try {
          await this.processUserMessage({
            taskId,
            userMessage: message,
            context: newTaskContext,
            workspacePath: undefined,
            queue: false,
            skipUserMessageSave: true, // Don't duplicate message - it's already in parent task
          });
        } catch (error) {
          console.error(
            `[CHAT] Failed to process first message for stacked task ${taskId}:`,
            error
          );
        }
      }, 1000);
    } catch (error) {
      console.error(`[CHAT] Error initializing stacked task ${taskId}:`, error);
    }
  }

  /**
   * Clean up task-related memory structures
   */
  cleanupTask(taskId: string): void {
    console.log(`[CHAT] Cleaning up ChatService memory for task ${taskId}`);

    try {
      // Clean up active streams
      const abortController = this.activeStreams.get(taskId);
      if (abortController) {
        abortController.abort();
        this.activeStreams.delete(taskId);
      }

      // Clean up queued actions
      this.queuedActions.delete(taskId);

      console.log(
        `[CHAT] Successfully cleaned up ChatService memory for task ${taskId}`
      );
    } catch (error) {
      console.error(
        `[CHAT] Error cleaning up ChatService memory for task ${taskId}:`,
        error
      );
    }
  }
}
