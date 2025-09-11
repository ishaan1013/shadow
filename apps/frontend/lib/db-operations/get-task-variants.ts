import { db } from "@repo/db";

export type TaskVariant = {
  id: string;
  modelType: string;
  sequence: number;
  shadowBranch: string | null;
  status: string | null;
};

export async function getTaskVariants(taskId: string): Promise<TaskVariant[]> {
  try {
    const variants = await db.variant.findMany({
      where: { taskId },
      orderBy: { sequence: "asc" },
      select: {
        id: true,
        modelType: true,
        sequence: true,
        shadowBranch: true,
        status: true,
      },
    });
    return variants;
  } catch (err) {
    console.error("Failed to fetch variants for task", taskId, err);
    return [];
  }
}

