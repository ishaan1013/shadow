import { router as IndexingRouter } from "@/indexing/index";
import { prisma } from "@repo/db";
import { AvailableModels, ModelType } from "@repo/types";
import cors from "cors";
import express from "express";
import http from "http";
import { z } from "zod";
import config, { getCorsOrigins } from "./config";
import { ChatService } from "./agent/chat";
import { TaskInitializationEngine } from "./initialization";
import { errorHandler } from "./middleware/error-handler";
import { apiKeyAuth } from "./middleware/api-key-auth";
import { createSocketServer } from "./socket";
import { getGitHubAccessToken } from "./github/auth/account-service";
import { hasReachedTaskLimit } from "./services/task-limit";
import { createWorkspaceManager } from "./execution";
import { filesRouter } from "./files/router";
import { handleGitHubWebhook } from "./webhooks/github-webhook";
import { getIndexingStatus } from "./routes/indexing-status";
import { modelContextService } from "./services/model-context-service";
import { updateTaskStatus } from "./utils/task-status";

const app = express();
export const chatService = new ChatService();
const initializationEngine = new TaskInitializationEngine();

const initiateTaskSchema = z.object({
  message: z.string().min(1, "Message is required"),
  models: z
    .array(
      z.enum(Object.values(AvailableModels) as [string, ...string[]], {
        errorMap: () => ({ message: "Invalid model type" }),
      })
    )
    .min(1, "At least one model is required")
    .max(3, "Maximum 3 models allowed"),
  userId: z.string().min(1, "User ID is required"),
});

const socketIOServer = http.createServer(app);
createSocketServer(socketIOServer);

const corsOrigins = getCorsOrigins(config);

console.log(`[CORS] Allowing origins:`, corsOrigins);

app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);

// Special raw body handling for webhook endpoints (before JSON parsing)
app.use("/api/webhooks", express.raw({ type: "application/json" }));

app.use(express.json());

// API key authentication for protected routes
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/webhooks")) {
    return next();
  }
  return apiKeyAuth(req, res, next);
});

/* ROUTES */
app.get("/", (_req, res) => {
  res.send("<h1>Hello world</h1>");
});

app.get("/health", (_req, res) => {
  res
    .status(200)
    .json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Indexing routes
app.use("/api/indexing", IndexingRouter);

// Files routes
app.use("/api/tasks", filesRouter);

// GitHub webhook endpoint
app.post("/api/webhooks/github/pull-request", handleGitHubWebhook);

// Indexing status endpoint
app.get("/api/indexing-status/:repoFullName", async (req, res) => {
  try {
    const { repoFullName } = req.params;
    const decodedRepoFullName = decodeURIComponent(repoFullName);
    const status = await getIndexingStatus(decodedRepoFullName);
    res.json(status);
  } catch (error) {
    console.error("Error fetching indexing status:", error);
    res.status(500).json({ error: "Failed to fetch indexing status" });
  }
});

// Get task details
app.get("/api/tasks/:taskId", async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json(task);
  } catch (error) {
    console.error("Error fetching task:", error);
    res.status(500).json({ error: "Failed to fetch task" });
  }
});

// Initiate task with agent using new initialization system
app.post("/api/tasks/:taskId/initiate", async (req, res) => {
  try {
    console.log("RECEIVED TASK INITIATE REQUEST: /api/tasks/:taskId/initiate");
    const { taskId } = req.params;

    // Validate request body with Zod
    const validation = initiateTaskSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: validation.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const { message, models, userId } = validation.data;

    // Check task limit before processing (production only)
    const isAtLimit = await hasReachedTaskLimit(userId);
    if (isAtLimit) {
      return res.status(429).json({
        error: "Task limit reached",
        message:
          "You have reached the maximum number of active tasks. Please complete or archive existing tasks to create new ones.",
      });
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        variants: true,
      },
    });

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    console.log(
      `[TASK_INITIATE] Starting task ${taskId}: ${task.repoUrl}:${task.baseBranch || "unknown"}`
    );

    try {
      const githubAccessToken = await getGitHubAccessToken(userId);

      if (!githubAccessToken) {
        console.error(
          `[TASK_INITIATE] No GitHub access token found for user ${userId}`
        );

        await updateTaskStatus(taskId, "FAILED", "INIT");

        return res.status(400).json({
          error: "GitHub access token required",
          details: "Please connect your GitHub account to clone repositories",
        });
      }

      // Validate API keys for all models
      const invalidModels = [];
      for (const model of models) {
        const context = await modelContextService.createContext(
          taskId,
          req.headers.cookie,
          model as ModelType
        );

        if (!context.validateAccess()) {
          invalidModels.push({
            model,
            provider: context.getProvider(),
          });
        }
      }

      if (invalidModels.length > 0) {
        const errorMessages = invalidModels.map(({ model, provider }) => {
          const providerName =
            provider === "anthropic"
              ? "Anthropic"
              : provider === "openrouter"
                ? "OpenRouter"
                : "OpenAI";
          return `${providerName} API key required for ${model}`;
        });

        return res.status(400).json({
          error: "Missing API keys",
          details: errorMessages.join(", "),
        });
      }

      console.log(
        `⏳ [TASK_INITIATE] Task ${taskId} starting initialization for ${models.length} variants...`
      );

      // Initialize all variants in parallel
      const initPromises = task.variants.map(async (variant) => {
        const model = variant.modelType as ModelType;
        const variantContext = await modelContextService.createContext(
          taskId,
          req.headers.cookie,
          model
        );

        try {
          const initSteps = await initializationEngine.getDefaultStepsForTask();
          await initializationEngine.initializeTask(
            variant.id,
            initSteps,
            userId,
            variantContext
          );

          // Process initial user message for this variant
          await chatService.processUserMessage({
            taskId,
            variantId: variant.id,
            userMessage: message,
            context: variantContext,
            enableTools: true,
            skipUserMessageSave: true,
          });

          return { success: true, variantId: variant.id };
        } catch (error) {
          console.error(`[TASK_INITIATE] Variant ${variant.id} failed:`, error);
          return { success: false, variantId: variant.id, error };
        }
      });

      const results = await Promise.allSettled(initPromises);
      const successfulVariants = results
        .map((result, index) => ({ result, variant: task.variants[index] }))
        .filter(
          ({ result, variant }) =>
            variant && result.status === "fulfilled" && result.value.success
        )
        .map(({ variant }) => variant!.id);

      console.log(
        `✅ [TASK_INITIATE] Task ${taskId} initialized ${successfulVariants.length}/${task.variants.length} variants successfully`
      );

      res.json({
        success: true,
        message: "Task initiated successfully",
      });
    } catch (initError) {
      console.error(
        `[TASK_INITIATE] Initialization failed for task ${taskId}:`,
        initError
      );
      console.log(
        `❌ [TASK_INITIATE] Task ${taskId} initialization failed - setting status to FAILED`
      );

      await updateTaskStatus(taskId, "FAILED", "INIT");

      if (
        initError instanceof Error &&
        (initError.message.includes("authentication") ||
          initError.message.includes("access token") ||
          initError.message.includes("refresh"))
      ) {
        return res.status(401).json({
          error: "GitHub authentication failed",
          details: "Please reconnect your GitHub account and try again",
        });
      }

      return res.status(500).json({
        error: "Task initialization failed",
        details:
          initError instanceof Error ? initError.message : "Unknown error",
      });
    }
  } catch (error) {
    console.error("Error initiating task:", error);
    res.status(500).json({ error: "Failed to initiate task" });
  }
});

app.get("/api/tasks/:taskId/:variantId/messages", async (req, res) => {
  try {
    const { taskId, variantId } = req.params as {
      taskId: string;
      variantId: string;
    };
    const messages = await chatService.getChatHistory(taskId, variantId);
    res.json({ messages });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

app.delete("/api/tasks/:taskId/cleanup", async (req, res) => {
  try {
    const { taskId } = req.params;

    console.log(`[TASK_CLEANUP] Starting cleanup for task ${taskId}`);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        variants: {
          select: {
            id: true,
            workspacePath: true,
            workspaceCleanedUp: true,
          },
        },
      },
    });

    if (!task) {
      console.warn(`[TASK_CLEANUP] Task ${taskId} not found`);
      return res.status(404).json({
        success: false,
        error: "Task not found",
      });
    }

    // Check if all variants are already cleaned up
    const variantsNeedingCleanup = task.variants.filter(
      (v) => !v.workspaceCleanedUp
    );

    if (variantsNeedingCleanup.length === 0) {
      console.log(
        `[TASK_CLEANUP] All variants for task ${taskId} already cleaned up`
      );
      return res.json({
        success: true,
        message: "All workspaces already cleaned up",
        alreadyCleanedUp: true,
        task: {
          id: taskId,
          status: task.status,
          workspaceCleanedUp: task.workspaceCleanedUp,
        },
      });
    }

    const workspaceManager = createWorkspaceManager();
    console.log(
      `[TASK_CLEANUP] Cleaning up ${variantsNeedingCleanup.length} variant workspaces for task ${taskId} using ${workspaceManager.isRemote() ? "remote" : "local"} mode`
    );

    // Clean up each variant workspace
    const cleanupResults = [];
    for (const variant of variantsNeedingCleanup) {
      try {
        const cleanupResult = await workspaceManager.cleanupWorkspace(
          variant.id
        );

        if (cleanupResult.success) {
          // Mark variant as cleaned up
          await prisma.variant.update({
            where: { id: variant.id },
            data: { workspaceCleanedUp: true },
          });

          cleanupResults.push({
            variantId: variant.id,
            success: true,
            message: cleanupResult.message,
          });
        } else {
          cleanupResults.push({
            variantId: variant.id,
            success: false,
            error: cleanupResult.message,
          });
        }
      } catch (error) {
        cleanupResults.push({
          variantId: variant.id,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const successfulCleanups = cleanupResults.filter((r) => r.success);
    const failedCleanups = cleanupResults.filter((r) => !r.success);

    // Update task cleanup status if all variants are now cleaned up
    const allVariantsCleanedUp =
      (await prisma.variant.count({
        where: {
          taskId,
          workspaceCleanedUp: false,
        },
      })) === 0;

    if (allVariantsCleanedUp) {
      await prisma.task.update({
        where: { id: taskId },
        data: { workspaceCleanedUp: true },
      });
    }

    res.json({
      success: successfulCleanups.length > 0,
      message: `Cleaned up ${successfulCleanups.length}/${cleanupResults.length} variant workspaces`,
      task: {
        id: taskId,
        status: task.status,
        workspaceCleanedUp: allVariantsCleanedUp,
      },
      cleanupDetails: {
        mode: workspaceManager.isRemote() ? "remote" : "local",
        variantResults: cleanupResults,
        totalVariants: task.variants.length,
        cleanedUp: successfulCleanups.length,
        failed: failedCleanups.length,
      },
    });
  } catch (error) {
    console.error(
      `[TASK_CLEANUP] Error cleaning up task ${req.params.taskId}:`,
      error
    );
    res.status(500).json({
      success: false,
      error: "Failed to cleanup task",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/tasks/:taskId/pull-request", async (req, res) => {
  try {
    const { taskId } = req.params;
    const { userId } = req.body;

    console.log(`[PR_CREATION] Creating PR for task ${taskId}`);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        variants: {
          select: {
            id: true,
            shadowBranch: true,
            workspacePath: true,
            pullRequestNumber: true,
            status: true,
          },
        },
      },
    });

    if (!task) {
      console.warn(`[PR_CREATION] Task ${taskId} not found`);
      return res.status(404).json({
        success: false,
        error: "Task not found",
      });
    }

    if (task.userId !== userId) {
      console.warn(`[PR_CREATION] User ${userId} does not own task ${taskId}`);
      return res.status(403).json({
        success: false,
        error: "Unauthorized",
      });
    }

    // Check if any variants already have PRs
    const variantsWithPRs = task.variants.filter((v) => v.pullRequestNumber);
    const variantsWithoutPRs = task.variants.filter(
      (v) => !v.pullRequestNumber
    );

    if (variantsWithoutPRs.length === 0) {
      console.log(
        `[PR_CREATION] All variants for task ${taskId} already have PRs`
      );
      return res.json({
        success: true,
        existingPRs: variantsWithPRs.map((v) => ({
          variantId: v.id,
          prNumber: v.pullRequestNumber,
          prUrl: `${task.repoUrl}/pull/${v.pullRequestNumber}`,
        })),
        message: "Pull requests already exist for all variants",
      });
    }

    const latestAssistantMessage = await prisma.chatMessage.findFirst({
      where: {
        taskId,
        role: "ASSISTANT",
      },
      orderBy: {
        sequence: "desc",
      },
      select: {
        id: true,
      },
    });

    if (!latestAssistantMessage) {
      console.warn(
        `[PR_CREATION] No assistant messages found for task ${taskId}`
      );
      return res.status(400).json({
        success: false,
        error:
          "No assistant messages found. Cannot create PR without agent responses.",
      });
    }

    // Get or refresh model context for PR creation
    const modelContext = await modelContextService.refreshContext(
      taskId,
      req.headers.cookie
    );

    // Create PRs for all variants that don't have them yet
    const prCreationResults = [];

    for (const variant of variantsWithoutPRs) {
      try {
        if (modelContext) {
          await chatService.createPRIfNeeded(
            taskId,
            variant.id,
            variant.workspacePath || undefined,
            latestAssistantMessage.id,
            modelContext
          );
        } else {
          // Fallback if context unavailable
          await chatService.createPRIfNeeded(
            taskId,
            variant.id,
            variant.workspacePath || undefined,
            latestAssistantMessage.id
          );
        }

        // Get the updated variant to check if PR was created
        const updatedVariant = await prisma.variant.findUnique({
          where: { id: variant.id },
          select: { pullRequestNumber: true },
        });

        if (updatedVariant?.pullRequestNumber) {
          prCreationResults.push({
            variantId: variant.id,
            prNumber: updatedVariant.pullRequestNumber,
            prUrl: `${task.repoUrl}/pull/${updatedVariant.pullRequestNumber}`,
            success: true,
          });
        } else {
          prCreationResults.push({
            variantId: variant.id,
            success: false,
            error: "PR creation completed but no PR number found",
          });
        }
      } catch (error) {
        prCreationResults.push({
          variantId: variant.id,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const successfulPRs = prCreationResults.filter((r) => r.success);
    const failedPRs = prCreationResults.filter((r) => !r.success);

    console.log(
      `[PR_CREATION] Created ${successfulPRs.length} PRs for task ${taskId}, ${failedPRs.length} failed`
    );

    res.json({
      success: successfulPRs.length > 0,
      createdPRs: successfulPRs,
      failedPRs,
      messageId: latestAssistantMessage.id,
    });
  } catch (error) {
    console.error(
      `[PR_CREATION] Error creating PR for task ${req.params.taskId}:`,
      error
    );
    res.status(500).json({
      success: false,
      error: "Failed to create pull request",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.use(errorHandler);

export { app, socketIOServer };
