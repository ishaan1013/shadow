import { db } from "@repo/db";
import { type Message } from "@repo/types";

export async function getTaskMessages(taskId: string): Promise<Message[]> {
  try {
    const messages = await db.chatMessage.findMany({
      where: { taskId },
      include: {
        pullRequestSnapshot: true,
      },
      orderBy: [
        { sequence: "asc" }, // Primary ordering by sequence for correct conversation flow
        { createdAt: "asc" }, // Fallback ordering by timestamp
      ],
    });

    return messages.map((msg) => ({
      id: msg.id,
      role: msg.role as "user" | "assistant" | "tool",
      content: msg.content,
      createdAt: msg.createdAt.toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: (msg.metadata as any) || { isStreaming: false },
      pullRequestSnapshot: msg.pullRequestSnapshot || undefined,
    }));
  } catch (err) {
    console.error("Failed to fetch task messages", err);
    return [];
  }
}
