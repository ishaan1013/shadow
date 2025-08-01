import { db } from "@repo/db";
import { ModelType, type Message } from "@repo/types";
import { getMostRecentMessageModel } from "../utils/model-utils";

export type TaskMessages = {
  messages: Message[];
  mostRecentMessageModel: ModelType | null;
};

export async function getTaskMessages(taskId: string): Promise<TaskMessages> {
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

    const finalMessages: Message[] = messages.map((msg) => ({
      id: msg.id,
      role: msg.role as "user" | "assistant" | "tool",
      content: msg.content,
      createdAt: msg.createdAt.toISOString(),
      llmModel: msg.llmModel,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: (msg.metadata as any) || { isStreaming: false },
      pullRequestSnapshot: msg.pullRequestSnapshot || undefined,
    }));

    const mostRecentMessageModel = getMostRecentMessageModel(finalMessages);

    return { messages: finalMessages, mostRecentMessageModel };
  } catch (err) {
    console.error("Failed to fetch task messages", err);
    return { messages: [], mostRecentMessageModel: null };
  }
}
