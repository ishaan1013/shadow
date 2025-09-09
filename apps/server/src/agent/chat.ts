import { prisma } from "@repo/db";
import {
  AssistantMessagePart,
  ErrorPart,
  Message,
  MessageMetadata,
  ModelType,
  ApiKeys,
  QueuedActionUI,
  ReasoningPart,
  RedactedReasoningPart,
  generateTaskId,
} from "@repo/types";
import { TextPart, ToolCallPart, ToolResultPart } from "ai";
import { randomUUID } from "crypto";
import { type ChatMessage } from "../../../../packages/db/src/client";
import { LLMService } from "./llm";
import { getSystemPrompt, getShadowWikiMessage } from "./system-prompt";
import { createTools, stopMCPManager } from "./tools";
import type { ToolSet } from "ai";
import { GitManager } from "../services/git-manager";
import { PRManager } from "../services/pr-manager";
import { modelContextService } from "../services/model-context-service";
import { TaskModelContext } from "../services/task-model-context";
import { checkpointService } from "../services/checkpoint-service";
import { generateTaskTitleAndBranch } from "../utils/title-generation";
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
import { getGitHubAppEmail, getGitHubAppName } from "../config/shared";
import {
  updateVariantStatus,
} from "../utils/variant-status";
import {
  updateTaskStatus,
  resetTaskCleanupTimer,
} from "../utils/task-status";
import { createGitService } from "../execution";
import { memoryService } from "../services/memory-service";
import { TaskInitializationEngine } from "@/initialization";
import { databaseBatchService } from "../services/database-batch-service";
import { ChatSummarizationService } from "../services/chat-summarization-service";

// Discriminated union types for queued actions
type QueuedMessageAction = {
  type: "message";
  data: {
    message: string;
    variantId?: string;
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
    newTaskId?: string;
  };
};

type QueuedAction = QueuedMessageAction | QueuedStackedPRAction;

export class ChatService {
  private llmService: LLMService;
  // variantId -> AbortController
  private activeStreams: Map<string, AbortController> = new Map();
  // variantId set for which a stop has been requested
  private stopRequested: Set<string> = new Set();
  // Map key semantics:
  // - For "message" actions: key is variantId
  // - For "stacked-pr" actions: key is parentTaskId
  private queuedActions: Map<string, QueuedAction> = new Map();

  constructor() {
    this.llmService = new LLMService();
  }

  private async getNextSequence(taskId: string): Promise<number> {
    // Use a short transaction to atomically get the next sequence
    // This prevents race conditions when multiple operations need sequences
    return await prisma.$transaction(async (tx) => {
      const lastMessage = await tx.chatMessage.findFirst({
        where: { taskId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      return (lastMessage?.sequence || 0) + 1;
    });
  }

  // Helper method to atomically create any message with sequence generation
  private async createMessageWithAtomicSequence(
    taskId: string,
    messageData: {
      content: string;
      role: "USER" | "ASSISTANT" | "SYSTEM";
      llmModel: string;
      metadata?: MessageMetadata;
      finishReason?: string;
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    }
  ): Promise<ChatMessage> {
    return await prisma.$transaction(async (tx) => {
      // Atomically get next sequence within transaction
      const lastMessage = await tx.chatMessage.findFirst({
        where: { taskId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      const sequence = (lastMessage?.sequence || 0) + 1;

      // Create message with the atomic sequence
      return await tx.chatMessage.create({
        data: {
          taskId,
          content: messageData.content,
          role: messageData.role,
          sequence,
          llmModel: messageData.llmModel,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          metadata: (messageData.metadata as any) || undefined,
          promptTokens: messageData.promptTokens,
          completionTokens: messageData.completionTokens,
          totalTokens: messageData.totalTokens,
          finishReason: messageData.finishReason,
        },
      });
    });
  }

  async saveUserMessage(
    taskId: string,
    content: string,
    llmModel: string,
    metadata?: MessageMetadata
  ): Promise<ChatMessage> {
    // Use atomic sequence generation to prevent race conditions
    const message = await this.createMessageWithAtomicSequence(taskId, {
      content,
      role: "USER",
      llmModel,
      metadata,
    });

    // TODO: Update variant activity timestamp when user sends a message
    // await updateVariantActivity(variantId, "MESSAGE");

    return message;
  }

  async saveAssistantMessage(
    taskId: string,
    content: string,
    llmModel: string,
    sequence?: number,
    metadata?: MessageMetadata
  ): Promise<ChatMessage> {
    // If no sequence provided, generate atomically
    if (sequence === undefined) {
      const usage = metadata?.usage;
      return await this.createMessageWithAtomicSequence(taskId, {
        content,
        role: "ASSISTANT",
        llmModel,
        metadata,
        promptTokens: usage?.promptTokens,
        completionTokens: usage?.completionTokens,
        totalTokens: usage?.totalTokens,
        finishReason: metadata?.finishReason,
      });
    }

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
    sequence?: number,
    metadata?: MessageMetadata
  ): Promise<ChatMessage> {
    // If no sequence provided, generate atomically
    if (sequence === undefined) {
      return await this.createMessageWithAtomicSequence(taskId, {
        content,
        role: "SYSTEM",
        llmModel,
        metadata,
      });
    }

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

  /**
   * Commit changes to git if there are any changes after an LLM response
   */
  private async commitChangesIfAny(
    variantId: string,
    context: TaskModelContext,
    _workspacePath?: string
  ): Promise<boolean> {
    try {
      // Get variant info including task and user details
      const variant = await prisma.variant.findUnique({
        where: { id: variantId },
        include: {
          task: {
            include: { user: true },
          },
        },
      });

      if (!variant) {
        console.warn(`[CHAT] Variant not found for git commit: ${variantId}`);
        return false;
      }

      if (!variant.shadowBranch) {
        console.warn(
          `[CHAT] No shadow branch configured for variant ${variantId}, skipping git commit`
        );
        return false;
      }

      // Use unified git service for both local and remote modes (variant-scoped)
      const gitService = await createGitService(variantId);

      // Check if there are any uncommitted changes
      const hasChanges = await gitService.hasChanges();
      if (!hasChanges) {
        console.log(`[CHAT] No changes to commit for variant ${variantId}`);
        return false;
      }

      // Get diff for commit message generation
      const diff = await gitService.getDiff();

      // Generate commit message using existing logic
      let commitMessage = "Update code via Shadow agent";
      if (diff) {
        // Generate commit message using server-side GitManager (which has AI integration)
        const tempGitManager = new GitManager("");
        commitMessage = await tempGitManager.generateCommitMessage(
          diff,
          context
        );
      }

      console.log(
        `[CHAT] Generated commit message for variant ${variantId}: "${commitMessage}"`
      );

      // Commit changes with Shadow as author and user as co-author
      const commitResult = await gitService.commitChanges({
        user: {
          name: getGitHubAppName(config),
          email: getGitHubAppEmail(config),
        },
        coAuthor: {
          name: variant.task.user.name,
          email: variant.task.user.email,
        },
        message: commitMessage,
      });

      if (!commitResult.success) {
        console.error(
          `[CHAT] Failed to commit changes for variant ${variantId}: ${commitResult.message}`
        );
        return false;
      }

      console.log(
        `[CHAT] Successfully committed changes for variant ${variantId}`
      );

      // Push the commit to remote
      try {
        const pushResult = await gitService.pushBranch(
          variant.shadowBranch,
          false
        );
        if (!pushResult.success) {
          console.warn(
            `[CHAT] Failed to push changes for variant ${variantId}: ${pushResult.message}`
          );
          // Don't fail the operation - commit succeeded even if push failed
        } else {
          console.log(
            `[CHAT] Successfully pushed changes for variant ${variantId}`
          );
        }
      } catch (pushError) {
        console.warn(`[CHAT] Push failed for variant ${variantId}:`, pushError);
        // Don't throw - commit succeeded even if push failed
      }

      return true;
    } catch (error) {
      console.error(
        `[CHAT] Failed to commit changes for variant ${variantId}:`,
        error
      );
      // Don't throw here - we don't want git failures to break the chat flow
      return false;
    }
  }

  /**
   * Create a PR if needed after changes are committed
   */
  async createPRIfNeeded(
    taskId: string,
    variantId: string,
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
      variantId,
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
    variantId: string,
    workspacePath?: string,
    messageId?: string,
    context?: TaskModelContext
  ): Promise<void> {
    try {
      const variant = await prisma.variant.findUnique({
        where: { id: variantId },
        include: {
          task: {
            include: { user: true },
          },
        },
      });

      if (!variant) {
        console.warn(`[CHAT] Variant not found for PR creation: ${variantId}`);
        return;
      }

      if (!variant.shadowBranch) {
        console.warn(
          `[CHAT] No shadow branch configured for variant ${variantId}, skipping PR creation`
        );
        return;
      }

      const resolvedWorkspacePath = workspacePath || variant.workspacePath;
      if (!resolvedWorkspacePath) {
        console.warn(
          `[CHAT] No workspace path available for variant ${variantId}, skipping PR creation`
        );
        return;
      }

      const gitService = await createGitService(variantId);
      const prManager = new PRManager(gitService, this.llmService);

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
          variantId,
          repoFullName: variant.task.repoFullName,
          shadowBranch: variant.shadowBranch,
          baseBranch: variant.task.baseBranch,
          userId: variant.task.userId,
          taskTitle: variant.task.title,
          wasTaskCompleted: variant.status === "COMPLETED",
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
    variantId: string,
    workspacePath?: string,
    messageId?: string,
    context?: TaskModelContext
  ): Promise<void> {
    try {
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
        return;
      }

      if (!messageId) {
        console.warn(
          `[CHAT] No messageId provided for auto-PR creation for task ${taskId}`
        );
        return;
      }

      // Emit in-progress event before starting PR creation
      emitToTask(taskId, "auto-pr-status", {
        taskId,
        messageId,
        status: "in-progress" as const,
      });

      // Use the existing createPRIfNeeded method
      await this.createPRIfNeeded(
        taskId,
        variantId,
        workspacePath,
        messageId,
        context
      );
    } catch (error) {
      console.error(
        `[CHAT] Failed to check user auto-PR setting for task ${taskId}:`,
        error
      );

      // Emit failure event if messageId is available
      if (messageId) {
        emitToTask(taskId, "auto-pr-status", {
          taskId,
          messageId,
          status: "failed" as const,
          error:
            error instanceof Error
              ? error.message
              : "Failed to create pull request",
        });
      }

      // Non-blocking - don't throw
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
  private async handleFollowUpLogic(
    taskId: string,
    userId: string,
    context: TaskModelContext
  ): Promise<void> {
    try {
      // Always reset cleanup timer when user sends follow-up message (multi-variant aware)
      await resetTaskCleanupTimer(taskId, 30); // Reset to 30 minutes

      // For multi-variant tasks, we need to check if any variants need re-initialization
      const taskWithVariants = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
          variants: {
            select: {
              id: true,
              initStatus: true,
              status: true,
            },
          },
        },
      });

      if (!taskWithVariants) {
        console.warn(`[CHAT] Task not found for follow-up logic: ${taskId}`);
        return;
      }

      // Handle variants with inactive workspaces (VMs spun down)
      const inactiveVariants = taskWithVariants.variants.filter(
        (v) => v.initStatus === "INACTIVE"
      );

      if (inactiveVariants.length > 0) {
        console.log(
          `[CHAT] Task ${taskId} has ${inactiveVariants.length} inactive variants, re-initializing them...`
        );

        // Set task to INITIALIZING to indicate re-initialization is happening
        await updateTaskStatus(taskId, "INITIALIZING", "CHAT");

        const initializationEngine = new TaskInitializationEngine();
        const initSteps = await initializationEngine.getDefaultStepsForTask();

        // Re-initialize each inactive variant
        for (const variant of inactiveVariants) {
          try {
            await initializationEngine.initializeTask(
              variant.id,
              initSteps,
              userId,
              context
            );
          } catch (error) {
            console.error(
              `Failed to re-initialize variant ${variant.id}:`,
              error
            );
            await updateVariantStatus(
              variant.id,
              "FAILED",
              "CHAT",
              error instanceof Error
                ? error.message
                : "Re-initialization failed"
            );
          }
        }

        await updateTaskStatus(taskId, "RUNNING", "CHAT");
      }

      // ARCHIVED is permanent - no follow-up handling
      // For other statuses (RUNNING, INITIALIZING, FAILED), no special handling needed
    } catch (error) {
      console.error(
        `[CHAT] Error in follow-up logic for task ${taskId}:`,
        error
      );
      // Set task to failed state on initialization error
      await updateTaskStatus(
        taskId,
        "FAILED",
        "CHAT",
        error instanceof Error ? error.message : "Re-initialization failed"
      );
      throw error;
    }
  }

  /**
   * Process user message using TaskModelContext system
   */
  async processUserMessage({
    taskId,
    variantId,
    userMessage,
    context,
    enableTools = true,
    skipUserMessageSave = false,
    workspacePath,
    queue = false,
  }: {
    taskId: string;
    variantId: string;
    userMessage: string;
    context: TaskModelContext;
    enableTools?: boolean;
    skipUserMessageSave?: boolean;
    workspacePath?: string;
    queue?: boolean;
  }) {
    // In the new multi-variant architecture, variantId should be provided
    if (!variantId) {
      throw new Error("variantId is required in multi-variant mode");
    }
    // Update task's mainModel to keep it current
    await modelContextService.updateTaskMainModel(
      taskId,
      context.getMainModel()
    );

    return this._processUserMessageInternal({
      taskId,
      variantId,
      userMessage,
      context,
      enableTools,
      skipUserMessageSave,
      workspacePath,
      queue,
    });
  }

  /**
   * Internal method for processing user messages
   */
  private async _processUserMessageInternal({
    taskId,
    variantId,
    userMessage,
    context,
    enableTools = true,
    skipUserMessageSave = false,
    workspacePath,
    queue = false,
  }: {
    taskId: string;
    variantId: string;
    userMessage: string;
    context: TaskModelContext;
    enableTools?: boolean;
    skipUserMessageSave?: boolean;
    workspacePath?: string;
    queue?: boolean;
  }) {
    // Get task info for follow-up logic
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { userId: true },
    });

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Handle follow-up logic for COMPLETED tasks
    await this.handleFollowUpLogic(taskId, task.userId, context);

    if (queue) {
      if (this.activeStreams.has(variantId)) {
        // Support only one queued action at a time for now, can extend to a list later
        // Override the existing queued action if it exists
        this.queuedActions.set(variantId, {
          type: "message",
          data: {
            message: userMessage,
            variantId,
            context,
            workspacePath,
          },
        });
        return;
      }
    } else {
      // queue=false: interrupt any active stream and process immediately
      if (this.activeStreams.has(variantId)) {
        await this.stopStream(taskId, variantId);

        // Override queued action if it exists
        if (this.queuedActions.has(variantId)) {
          this.queuedActions.delete(variantId);
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

      const shadowWikiContent = await getShadowWikiMessage(taskId);
      if (shadowWikiContent) {
        const shadowWikiSequence = await this.getNextSequence(taskId);
        await this.saveSystemMessage(
          taskId,
          shadowWikiContent,
          context.getMainModel(),
          shadowWikiSequence
        );

        systemMessagesToAdd.push({
          id: randomUUID(),
          role: "system",
          content: shadowWikiContent,
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

      // Add Rules section if available
      const userRules = task?.user.userSettings?.rules;
      if (userRules && userRules.trim()) {
        const rulesContent = `
<rules>
CUSTOM USER INSTRUCTIONS:
${userRules.trim()}

These are specific instructions from the user that should be followed throughout the conversation. Apply these rules when relevant to your responses and actions.
</rules>`;

        const rulesSequence = await this.getNextSequence(taskId);
        await this.saveSystemMessage(
          taskId,
          rulesContent,
          context.getMainModel(),
          rulesSequence
        );

        systemMessagesToAdd.push({
          id: randomUUID(),
          role: "system",
          content: rulesContent,
          createdAt: new Date().toISOString(),
          llmModel: context.getMainModel(),
        });
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

    startStream(variantId, taskId);

    // Create AbortController for this stream
    const abortController = new AbortController();
    this.activeStreams.set(variantId, abortController);

    // Track structured assistant message parts in chronological order
    let assistantSequence: number | null = null;
    let assistantMessageId: string | null = null;
    const assistantParts: AssistantMessagePart[] = [];
    let usageMetadata: MessageMetadata["usage"];
    let finishReason: MessageMetadata["finishReason"];
    let hasError = false;

    // Track active reasoning parts for signature association
    const activeReasoningParts: Map<number, ReasoningPart> = new Map();
    let reasoningCounter = 0;

    // Create tools first so we can generate system prompt based on available tools
    let availableTools: ToolSet | undefined;
    if (enableTools && taskId) {
      availableTools = await createTools(taskId, workspacePath, variantId);
    }

    // Get system prompt with available tools context
    const taskSystemPrompt = await getSystemPrompt(availableTools);

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
        availableTools
      )) {
        if (this.stopRequested.has(variantId)) {
          break;
        }

        emitStreamChunk(chunk, variantId, taskId);

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
            // Schedule batched database update instead of immediate update
            if (assistantMessageId) {
              databaseBatchService.scheduleAssistantUpdate(taskId, {
                messageId: assistantMessageId,
                assistantParts: [...assistantParts], // Copy array
                context,
                usageMetadata,
                finishReason,
                lastUpdateTime: Date.now(),
              });
            }
          }
        }

        // Handle reasoning content chunks
        if (chunk.type === "reasoning" && chunk.reasoning) {
          // Create new reasoning part or continue existing one
          const currentReasoning = activeReasoningParts.get(
            reasoningCounter
          ) || {
            type: "reasoning" as const,
            text: "",
          };

          const updatedReasoning: ReasoningPart = {
            ...currentReasoning,
            text: currentReasoning.text + chunk.reasoning,
          };

          activeReasoningParts.set(reasoningCounter, updatedReasoning);

          // Create assistant message on first reasoning chunk if not already created
          if (assistantSequence === null) {
            assistantSequence = await this.getNextSequence(taskId);
            const assistantMsg = await this.saveAssistantMessage(
              taskId,
              chunk.reasoning, // Store some content for backward compatibility
              context.getMainModel(),
              assistantSequence,
              {
                isStreaming: true,
                parts: assistantParts,
              }
            );
            assistantMessageId = assistantMsg.id;
          }
        }

        if (chunk.type === "reasoning-signature" && chunk.reasoningSignature) {
          // Add signature to current reasoning part
          const currentReasoning = activeReasoningParts.get(reasoningCounter);
          if (currentReasoning) {
            currentReasoning.signature = chunk.reasoningSignature;
            // Finalize this reasoning part
            assistantParts.push(currentReasoning);
            // Remove from active parts to prevent duplication at stream end
            activeReasoningParts.delete(reasoningCounter);
            reasoningCounter++;

            // Schedule batched update with finalized reasoning part
            if (assistantMessageId) {
              databaseBatchService.scheduleAssistantUpdate(taskId, {
                messageId: assistantMessageId,
                assistantParts: [...assistantParts], // Copy array
                context,
                usageMetadata,
                finishReason,
                lastUpdateTime: Date.now(),
              });
            }
          }
        }

        if (
          chunk.type === "redacted-reasoning" &&
          chunk.redactedReasoningData
        ) {
          const redactedPart: RedactedReasoningPart = {
            type: "redacted-reasoning" as const,
            data: chunk.redactedReasoningData,
          };
          assistantParts.push(redactedPart);

          // Create assistant message if not already created
          if (assistantSequence === null) {
            assistantSequence = await this.getNextSequence(taskId);
            const assistantMsg = await this.saveAssistantMessage(
              taskId,
              "[Redacted reasoning]", // Store placeholder content
              context.getMainModel(),
              assistantSequence,
              {
                isStreaming: true,
                parts: assistantParts,
              }
            );
            assistantMessageId = assistantMsg.id;
          } else if (assistantMessageId) {
            // Schedule batched update with redacted reasoning part
            databaseBatchService.scheduleAssistantUpdate(taskId, {
              messageId: assistantMessageId,
              assistantParts: [...assistantParts], // Copy array
              context,
              usageMetadata,
              finishReason,
              lastUpdateTime: Date.now(),
            });
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

          // Schedule batched update with tool call part
          if (assistantMessageId) {
            databaseBatchService.scheduleAssistantUpdate(taskId, {
              messageId: assistantMessageId,
              assistantParts: [...assistantParts], // Copy array
              context,
              usageMetadata,
              finishReason,
              lastUpdateTime: Date.now(),
            });
          }
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

          // Schedule batched update with tool result part
          if (assistantMessageId) {
            databaseBatchService.scheduleAssistantUpdate(taskId, {
              messageId: assistantMessageId,
              assistantParts: [...assistantParts], // Copy array
              context,
              usageMetadata,
              finishReason,
              lastUpdateTime: Date.now(),
            });
          }
        }

        // Handle error chunks from LLM service
        if (chunk.type === "error") {
          console.error(
            `[CHAT] Received error chunk for task ${taskId}:`,
            chunk.error
          );
          finishReason = chunk.finishReason || "error";
          hasError = true;

          // Improve error messages for rate limits
          let userFriendlyError = chunk.error || "Unknown error occurred";
          if (
            userFriendlyError.includes("Too Many Requests") ||
            userFriendlyError.includes("rate limit")
          ) {
            userFriendlyError =
              "The model is currently experiencing high demand. Please try again in a few moments or switch to a different model.";
          } else if (userFriendlyError.includes("Failed after 3 attempts")) {
            userFriendlyError =
              "The model is temporarily unavailable. Please try again or switch to a different model.";
          }

          // Add error part to assistant message parts
          const errorPart: ErrorPart = {
            type: "error",
            error: userFriendlyError,
            finishReason: chunk.finishReason,
          };
          assistantParts.push(errorPart);

          // Flush any pending updates and immediately update with error
          if (assistantMessageId) {
            // Clear pending timer and flush immediately on error
            console.log(
              `[CHAT] Error occurred, immediately flushing DB update for task ${taskId}`
            );
            databaseBatchService.clear(taskId);

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
          await updateTaskStatus(taskId, "FAILED", "CHAT", userFriendlyError);

          // Clean up stream tracking
          this.activeStreams.delete(variantId);
          this.stopRequested.delete(variantId);
          endStream(variantId, taskId);

          // Clean up MCP manager for this task
          try {
            await stopMCPManager(taskId);
          } catch (mcpError) {
            console.error(
              `[CHAT] Error stopping MCP manager for task ${taskId}:`,
              mcpError
            );
          }

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
      const wasStoppedEarly = this.stopRequested.has(variantId);

      // Finalize any remaining reasoning parts that didn't receive signatures
      for (const reasoningPart of activeReasoningParts.values()) {
        assistantParts.push(reasoningPart);
      }
      activeReasoningParts.clear();

      // Flush any pending updates and perform final update with complete metadata
      if (assistantMessageId) {
        // Clear any pending timer and flush immediately for final update
        console.log(
          `[CHAT] Stream completed, performing final DB update for task ${taskId}`
        );
        databaseBatchService.clear(taskId);

        if (usageMetadata) {
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
        } else {
          // If no usage metadata, just flush any pending updates
          await databaseBatchService.flushAssistantUpdate(taskId);
        }
      }

      // Update task status and schedule cleanup based on how stream ended
      if (hasError) {
        // Error already handled above, just ensure cleanup happens
        await resetTaskCleanupTimer(taskId, 15);
      } else if (wasStoppedEarly) {
        await updateTaskStatus(taskId, "STOPPED", "CHAT");
        await resetTaskCleanupTimer(taskId, 15);
      } else {
        await updateTaskStatus(taskId, "COMPLETED", "CHAT");
        await resetTaskCleanupTimer(taskId, 15);

        // TODO: Update variant activity timestamp when assistant completes response
        // await updateVariantActivity(variantId, "CHAT");

        // Commit changes if there are any (only for successfully completed responses)
        if (variantId) {
          try {
            const changesCommitted = await this.commitChangesIfAny(
              variantId,
              context,
              workspacePath
            );

            // Create PR if changes were committed and user has auto-PR enabled
            if (changesCommitted && assistantMessageId) {
              await this.createPRIfUserEnabled(
                taskId,
                variantId,
                workspacePath,
                assistantMessageId,
                context
              );
            }

            // Create checkpoint after successful completion and commit
            if (changesCommitted && assistantMessageId) {
              await checkpointService.createCheckpoint(
                taskId,
                variantId,
                assistantMessageId
              );
            }
          } catch (error) {
            console.error(
              `[CHAT] Failed to commit changes for task ${taskId}:`,
              error
            );
            // Don't fail the entire response for git commit failures
          }
        } else {
          console.warn(
            `[CHAT] No variantId provided, skipping commit for taskId: ${taskId}`
          );
        }
      }
    } catch (error) {
      console.error(
        `[CHAT] Failed to commit/checkpoint for variant ${variantId}:`,
        error
      );
      // Non-blocking - don't throw, let chat continue even if git operations fail
    }

    // Clean up and finalization
    try {
      // Clean up stream tracking
      this.activeStreams.delete(variantId);
      this.stopRequested.delete(variantId);
      endStream(variantId, taskId);

      // Clean up MCP manager for this task
      try {
        await stopMCPManager(taskId);
      } catch (error) {
        console.error(
          `[CHAT] Error stopping MCP manager for task ${taskId}:`,
          error
        );
      }

      // Process any queued actions for this variant
      await this.processQueuedActionForVariant(variantId, taskId);
    } catch (error) {
      console.error("Error processing user message:", error);

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      // Update variant status to failed when stream processing fails
      // Note: This is in the outer catch block so variantId may not be available
      if (variantId) {
        await updateVariantStatus(variantId, "FAILED", "CHAT", errorMessage);
      } else {
        // For backward compatibility, log the error
        console.error(
          `[CHAT] Stream processing failed for task ${taskId}: ${errorMessage}`
        );
      }

      // Emit error chunk
      emitStreamChunk(
        {
          type: "error",
          error: errorMessage,
          finishReason: "error",
        },
        variantId,
        taskId
      );

      // Clean up stream tracking on error
      this.activeStreams.delete(variantId);
      this.stopRequested.delete(variantId);
      handleStreamError(error, variantId, taskId);

      // Clean up MCP manager for this task
      try {
        await stopMCPManager(taskId);
      } catch (mcpError) {
        console.error(
          `[CHAT] Error stopping MCP manager for task ${taskId}:`,
          mcpError
        );
      }

      // Clear any queued actions (don't process them after error)
      this.clearQueuedAction(taskId);
      throw error;
    }
  }

  // Process queued action for a specific variant if present
  private async processQueuedActionForVariant(variantId: string, taskId: string): Promise<void> {
    const queuedAction = this.queuedActions.get(variantId);
    if (queuedAction && queuedAction.type === "message") {
      this.queuedActions.delete(variantId);
      try {
        emitToTask(taskId, "queued-action-processing", {
          taskId,
          type: queuedAction.type,
          message: queuedAction.data.message,
          model: queuedAction.data.context.getMainModel(),
        });
        await this._processQueuedMessage(queuedAction.data, taskId);
        return;
      } catch (error) {
        console.error(
          `[CHAT] Error processing queued message for variant ${variantId} (task ${taskId}):`,
          error
        );
      }
    }

    // Fallback to task-scoped queued action types (e.g., stacked-pr)
    const taskQueuedAction = this.queuedActions.get(taskId);
    if (taskQueuedAction && taskQueuedAction.type === "stacked-pr") {
      this.queuedActions.delete(taskId);
      try {
        await this._processQueuedStackedPR(taskQueuedAction.data);
      } catch (error) {
        console.error(
          `[CHAT] Error processing queued stacked-pr for task ${taskId}:`,
          error
        );
      }
    }
  }

  private async _processQueuedMessage(
    data: QueuedMessageAction["data"],
    taskId: string
  ): Promise<void> {
    // Use the stored TaskModelContext directly
    await this.processUserMessage({
      taskId,
      variantId: data.variantId,
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
      newTaskId: data.newTaskId,
    });
  }

  async getAvailableModels(userApiKeys: ApiKeys): Promise<ModelType[]> {
    return await this.llmService.getAvailableModels(userApiKeys);
  }

  getQueuedAction(taskId: string): QueuedActionUI | null {
    // Prefer task-scoped actions (stacked-pr)
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

  async stopStream(
    taskId: string,
    variantId: string,
    updateStatus: boolean = false
  ): Promise<void> {
    // Mark stop requested so generator exits early
    this.stopRequested.add(variantId);

    const abortController = this.activeStreams.get(variantId);
    if (abortController) {
      abortController.abort();
      this.activeStreams.delete(variantId);
    }

    // Flush any pending database updates before stopping
    await databaseBatchService.flushAssistantUpdate(taskId);

    // Clean up MCP manager for this task
    try {
      await stopMCPManager(taskId);
    } catch (error) {
      console.error(
        `[CHAT] Error stopping MCP manager for task ${taskId}:`,
        error
      );
    }

    // Update task status to stopped only when explicitly requested (e.g., manual stop)
    if (updateStatus) {
      await updateTaskStatus(taskId, "STOPPED", "CHAT");
    }
  }

  async editUserMessage({
    taskId,
    variantId,
    messageId,
    newContent,
    newModel,
    context,
  }: {
    taskId: string;
    variantId: string;
    messageId: string;
    newContent: string;
    newModel: ModelType;
    context: TaskModelContext;
  }): Promise<void> {
    // First, stop any active stream for this variant and clear queued messages
    if (this.activeStreams.has(variantId)) {
      await this.stopStream(taskId, variantId);
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

    // TODO: Update variant activity timestamp when user edits a message
    // await updateVariantActivity(variantId, "MESSAGE");

    // Get the sequence of the edited message
    const editedMessage = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { sequence: true },
    });

    if (!editedMessage) {
      throw new Error("Edited message not found");
    }

    // variantId is provided as parameter - no need to query for first variant
    
    // variantId is now passed as a parameter
    
    await checkpointService.restoreCheckpoint(taskId, variantId, messageId);
    console.log(
      `[CHAT] ✅ Checkpoint restoration completed for message editing`
    );

    // Delete all messages that come after the edited message
    await prisma.chatMessage.deleteMany({
      where: {
        taskId,
        sequence: {
          gt: editedMessage.sequence,
        },
      },
    });

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
        variantId,
        userMessage: newContent,
        context: updatedContext,
        enableTools: true,
        skipUserMessageSave: true, // Don't save again, already updated
        queue: false,
      });
    } else {
      // Use existing context
      await this.processUserMessage({
        taskId,
        variantId,
        userMessage: newContent,
        context,
        enableTools: true,
        skipUserMessageSave: true, // Don't save again, already updated
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
    newTaskId,
  }: {
    parentTaskId: string;
    message: string;
    model: ModelType;
    userId: string;
    queue: boolean;
    socket: TypedSocket;
    newTaskId?: string;
  }): Promise<void> {
    try {
      // If there's an active stream and queue is true, queue the stacked PR
      if (this.activeStreams.has(parentTaskId) && queue) {
        this.queuedActions.set(parentTaskId, {
          type: "stacked-pr",
          data: {
            message,
            parentTaskId,
            model,
            userId,
            socket,
            newTaskId,
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
        newTaskId,
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
    newTaskId,
  }: {
    parentTaskId: string;
    message: string;
    model: ModelType;
    userId: string;
    newTaskId?: string;
  }): Promise<void> {
    try {
      // Get parent task details with variant info
      const parentTask = await prisma.task.findUnique({
        where: { id: parentTaskId },
        select: {
          repoFullName: true,
          repoUrl: true,
          userId: true,
          variants: {
            select: {
              shadowBranch: true,
            },
            take: 1, // Just need one variant's shadow branch for reference
          },
        },
      });

      if (!parentTask) {
        throw new Error("Parent task not found");
      }

      if (parentTask.userId !== userId) {
        throw new Error("Unauthorized to create stacked task");
      }

      const taskId = newTaskId || generateTaskId();

      const parentContext =
        await modelContextService.getContextForTask(parentTaskId);

      // Create TaskModelContext for title generation
      const context = await modelContextService.copyContext(
        taskId,
        parentContext!
      );

      // Generate title and branch for the new task
      const { title, shadowBranch } = await generateTaskTitleAndBranch(
        taskId,
        message,
        context
      );

      // Create the new stacked task
      await prisma.task.create({
        data: {
          id: taskId,
          title,
          repoFullName: parentTask.repoFullName,
          repoUrl: parentTask.repoUrl,
          baseBranch: parentTask.variants[0]?.shadowBranch || "main", // Use parent's shadow branch as base
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
          stackedTaskId: taskId,
          sequence: parentNextSequence,
        },
      });

      // Trigger task initialization (similar to the backend initiate endpoint)
      await this.initializeStackedTask(
        taskId,
        model,
        userId,
        parentTaskId
      );

      // Emit event to frontend for optimistic message display with full context
      emitToTask(parentTaskId, "queued-action-processing", {
        taskId: parentTaskId,
        type: "stacked-pr",
        message,
        model,
        shadowBranch,
        title,
        newTaskId: taskId,
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
    model: ModelType,
    _userId: string,
    parentTaskId: string
  ): Promise<void> {
    try {
      const initializationEngine = new TaskInitializationEngine();

      await updateTaskStatus(taskId, "RUNNING", "CHAT");

      // Get parent's API keys from cached context
      const parentContext =
        await modelContextService.getContextForTask(parentTaskId);
      if (!parentContext) {
        throw new Error(`Parent task context not found for ${parentTaskId}`);
      }

      // Create new task context inheriting parent's API keys
      const newTaskContext =
        await modelContextService.createContextWithInheritedKeys(
          taskId,
          model,
          parentContext.getApiKeys()
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
          // Generate conversation summary from parent task
          const chatSummarizationService = new ChatSummarizationService();
          const conversationSummary =
            await chatSummarizationService.summarizeParentChat(
              parentTaskId,
              newTaskContext
            );

          // Inject conversation summary as system message before user message
          if (conversationSummary && conversationSummary.trim()) {
            const contextMessage = `<parent_task_conversation_summary>${conversationSummary}</parent_task_conversation_summary>`;

            const contextSequence = await this.getNextSequence(taskId);
            await this.saveSystemMessage(
              taskId,
              contextMessage,
              newTaskContext.getMainModel(),
              contextSequence
            );
          }

          // TODO: For multi-variant support, need to create variants first and use specific variantId
          // For now, this stacked PR flow needs to be updated for multi-variant architecture
          throw new Error("Stacked PR creation needs multi-variant support - not yet implemented");
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
  async cleanupTask(taskId: string): Promise<void> {
    try {
      // Clean up active streams
      const abortController = this.activeStreams.get(taskId);
      if (abortController) {
        abortController.abort();
        this.activeStreams.delete(taskId);
      }

      // Clean up MCP manager for this task
      try {
        await stopMCPManager(taskId);
      } catch (mcpError) {
        console.error(
          `[CHAT] Error stopping MCP manager for task ${taskId}:`,
          mcpError
        );
      }

      // Clean up queued actions
      this.queuedActions.delete(taskId);

      // Clean up batched database updates
      databaseBatchService.clear(taskId);
    } catch (error) {
      console.error(
        `[CHAT] Error cleaning up ChatService memory for task ${taskId}:`,
        error
      );
    }
  }
}
