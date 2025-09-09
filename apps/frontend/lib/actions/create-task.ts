"use server";

import { auth } from "@/lib/auth/auth";
import { MessageRole, prisma, Task } from "@repo/db";
import { headers } from "next/headers";
import { after } from "next/server";
import { z, ZodIssue } from "zod";
import { generateTaskTitleAndBranch } from "./generate-title-branch";
import { generateTaskId, generateVariantId, generateShadowBranch, MAX_TASKS_PER_USER_PRODUCTION } from "@repo/types";
import { makeBackendRequest } from "../make-backend-request";

const createTaskSchema = z.object({
  message: z
    .string()
    .min(1, "Message is required")
    .max(100000, "Message too long"),
  models: z.array(z.string()).min(1, "At least one model is required").max(3, "Maximum 3 models allowed"),
  repoFullName: z.string().min(1, "Repository name is required"),
  repoUrl: z
    .string()
    .url("Invalid repository URL")
    .refine(
      (url) => url.includes("github.com"),
      "Only GitHub repositories are supported"
    ),
  baseBranch: z.string().min(1, "Base branch is required").default("main"),
});

export async function createTask(formData: FormData) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const modelsData = formData.get("models") as string;
  const models = modelsData ? JSON.parse(modelsData) : [];
  
  const rawData = {
    message: formData.get("message") as string,
    models: Array.isArray(models) ? models : [models].filter(Boolean),
    repoFullName: formData.get("repoFullName") as string,
    repoUrl: formData.get("repoUrl") as string,
    baseBranch: (formData.get("baseBranch") as string) || "main",
  };
  const validation = createTaskSchema.safeParse(rawData);
  if (!validation.success) {
    const errorMessage = validation.error.issues
      .map((err: ZodIssue) => err.message)
      .join(", ");
    throw new Error(`Validation failed: ${errorMessage}`);
  }

  const { message, models, repoUrl, baseBranch, repoFullName } = validation.data;

  // Check task limit in production only
  if (process.env.NODE_ENV === "production") {
    const activeTaskCount = await prisma.task.count({
      where: {
        userId: session.user.id,
        status: {
          notIn: ["COMPLETED", "FAILED", "ARCHIVED"]
        }
      }
    });

    if (activeTaskCount >= MAX_TASKS_PER_USER_PRODUCTION) {
      throw new Error(`You have reached the maximum of ${MAX_TASKS_PER_USER_PRODUCTION} active tasks. Please complete or archive existing tasks to create new ones.`);
    }
  }

  const taskId = generateTaskId();
  let task: Task;

  try {
    // Generate a title for the task
    const { title } = await generateTaskTitleAndBranch(
      taskId,
      message
    );

    // Create variants data
    const variantsData = models.map((model, index) => {
      const variantId = generateVariantId();
      const shadowBranch = generateShadowBranch(taskId, index + 1);
      
      return {
        id: variantId,
        modelType: model,
        sequence: index + 1,
        shadowBranch,
        status: "INITIALIZING" as const,
        initStatus: "INACTIVE" as const,
        hasBeenInitialized: false,
        workspaceCleanedUp: false,
      };
    });

    // Create the task with variants and initial messages
    task = await prisma.task.create({
      data: {
        id: taskId,
        title,
        repoFullName,
        repoUrl,
        baseBranch,
        baseCommitSha: "pending",
        user: {
          connect: {
            id: session.user.id,
          },
        },
        variants: {
          create: variantsData,
        },
        messages: {
          create: variantsData.map((variant, index) => ({
            content: message,
            role: MessageRole.USER,
            sequence: 1,
            llmModel: variant.modelType,
            variantId: variant.id,
          })),
        },
      },
      include: {
        variants: true,
      },
    });

    // Schedule the backend API call and title generation to happen after the response is sent
    after(async () => {
      try {
        // Initiate the task on the backend
        // Forward cookies from the original request
        const requestHeaders = await headers();
        const cookieHeader = requestHeaders.get("cookie");

        const response = await makeBackendRequest(
          `/api/tasks/${task.id}/initiate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(cookieHeader && { Cookie: cookieHeader }),
            },
            body: JSON.stringify({
              message,
              models,
              userId: session.user.id,
            }),
          }
        );

        if (!response.ok) {
          console.error("Failed to initiate task:", await response.text());
        }
      } catch (error) {
        console.error("Error initiating task:", error);
      }
    });
  } catch (error) {
    console.error("Failed to create task:", error);
    throw new Error("Failed to create task");
  }

  return task.id;
}
