"use server";

import { auth } from "@/lib/auth/auth";
import { MessageRole, prisma, Task } from "@repo/db";
import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import { generateTaskTitleAndBranch } from "./generate-title-branch";
import { saveLayoutCookie } from "./save-sidebar-cookie";
import callIndexApi, { gitHubUrlToRepoName } from "./index-repo";

const createTaskSchema = z.object({
  message: z.string().min(1, "Message is required").max(1000, "Message too long"),
  model: z.string().min(1, "Model is required"),
  repoUrl: z.string().url("Invalid repository URL").refine(
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

  // Reset the agent environment layout cookie on task creation. This can happen asynchronously so no need to await.
  saveLayoutCookie("taskLayout", [100, 0]);

  // Extract and validate form data
  const rawData = {
    message: formData.get("message") as string,
    model: formData.get("model") as string,
    repoUrl: formData.get("repoUrl") as string,
    baseBranch: (formData.get("baseBranch") as string) || "main",
  };

  const validation = createTaskSchema.safeParse(rawData);
  if (!validation.success) {
    const errorMessage = validation.error.errors.map(err => err.message).join(", ");
    throw new Error(`Validation failed: ${errorMessage}`);
  }

  const { message, model, repoUrl, baseBranch } = validation.data;

  const taskId = crypto.randomUUID();
  let task: Task;

  try {
    // Generate a title for the task
    const { title, shadowBranch } = await generateTaskTitleAndBranch(taskId, message);

    // Create the task
    task = await prisma.task.create({
      data: {
        id: taskId,
        title,
        description: message,
        repoUrl,
        baseBranch,
        shadowBranch,
        baseCommitSha: "pending", // Will be updated when workspace is prepared
        status: "INITIALIZING",
        mode: "FULL_AUTO",
        user: {
          connect: {
            id: session.user.id,
          },
        },
        messages: {
          create: {
            content: message,
            role: MessageRole.USER,
            sequence: 1,
          },
        },
      },
    });

    // Schedule the backend API call and title generation to happen after the response is sent
    after(async () => {
      try {
        // Initiate the task on the backend
        const baseUrl =
          process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:4000";
        const response = await fetch(
          `${baseUrl}/api/tasks/${task.id}/initiate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message,
              model,
              userId: session.user.id,
            }),
          }
        );
        
        const repoName = gitHubUrlToRepoName(repoUrl);
        console.log("Indexing repo", repoName);
        await callIndexApi(repoName, task.id, true);
        console.log("Repo indexed");
        if (!response.ok) {
          console.error("Failed to initiate task:", await response.text());
        } else {
          console.log("Task initiated successfully:", task.id);
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
