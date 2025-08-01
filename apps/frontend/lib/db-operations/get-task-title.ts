import { db } from "@repo/db";

export async function getTaskTitle(taskId: string): Promise<string> {
  try {
    const title = await db.task.findUnique({
      where: { id: taskId },
      select: {
        title: true,
      },
    });

    return title?.title || "";
  } catch (err) {
    console.error("Failed to fetch task title", err);
    return "";
  }
}
