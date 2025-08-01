"use server";

import { auth } from "@/lib/auth/auth";
import { prisma } from "@repo/db";
import { headers } from "next/headers";
import { z } from "zod";

const editMessageSchema = z.object({
  taskId: z.string().min(1, "Task ID is required"),
  messageId: z.string().min(1, "Message ID is required"),
  content: z
    .string()
    .min(1, "Message content is required")
    .max(10000, "Message too long"),
  llmModel: z.string().min(1, "Model is required"),
});

export async function editMessage(formData: FormData) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const rawData = {
    taskId: formData.get("taskId") as string,
    messageId: formData.get("messageId") as string,
    content: formData.get("content") as string,
    llmModel: formData.get("llmModel") as string,
  };

  const validation = editMessageSchema.safeParse(rawData);
  if (!validation.success) {
    const errorMessage = validation.error.issues
      .map((err) => err.message)
      .join(", ");
    throw new Error(`Validation failed: ${errorMessage}`);
  }

  const { taskId, messageId, content, llmModel } = validation.data;

  try {
    // Verify user owns the task
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        userId: session.user.id,
      },
    });

    if (!task) {
      throw new Error("Task not found or access denied");
    }

    // Verify the message exists and belongs to the task
    const message = await prisma.chatMessage.findFirst({
      where: {
        id: messageId,
        taskId: taskId,
        role: "USER", // Only allow editing user messages
      },
    });

    if (!message) {
      throw new Error("Message not found or not editable");
    }

    // Update the message
    await prisma.chatMessage.update({
      where: { id: messageId },
      data: {
        content,
        llmModel,
        editedAt: new Date(),
      },
    });

    return {
      success: true,
      messageId,
    };
  } catch (error) {
    console.error("Failed to edit message:", error);
    throw new Error(
      error instanceof Error ? error.message : "Failed to edit message"
    );
  }
}
