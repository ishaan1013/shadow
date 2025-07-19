"use server";

import { auth } from "@/lib/auth";
import { prisma, Task } from "@repo/db";
import { MessageRole } from "@repo/types";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";

export async function createTask(formData: FormData) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const message = formData.get("message") as string;
  const model = formData.get("model") as string;
  const repoUrl = formData.get("repoUrl") as string;
  const branch = (formData.get("branch") as string) || "main";

  if (!message?.trim()) {
    throw new Error("Message is required");
  }

  if (!model) {
    throw new Error("Model is required");
  }

  let task: Task;

  try {
    // Create the task
    task = await prisma.task.create({
      data: {
        title: message.slice(0, 50) + (message.length > 50 ? "..." : ""),
        description: message,
        repoUrl: repoUrl || "",
        branch,
        userId: session.user.id,
        status: "PENDING",
        mode: "FULL_AUTO",
      },
    });

    // Create the initial user message
    await prisma.chatMessage.create({
      data: {
        content: message,
        role: MessageRole.USER,
        taskId: task.id,
        sequence: 1,
      },
    });

    // Schedule the backend API call to happen after the response is sent
    after(async () => {
      try {
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
            }),
          }
        );

        if (!response.ok) {
          console.error("Failed to initiate task:", await response.text());
        } else {
          console.log("Task initiated successfully:", task.id);
        }
      } catch (error) {
        console.error("Error initiating task:", error);
      }
    });

    revalidatePath("/");
  } catch (error) {
    console.error("Failed to create task:", error);
    throw new Error("Failed to create task");
  }

  return task.id;
}
