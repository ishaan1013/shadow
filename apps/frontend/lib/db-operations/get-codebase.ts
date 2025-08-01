import { db } from "@repo/db";
import { CodebaseWithSummaries } from "@repo/types";
import { parseCodebaseSummaries } from "../codebase-understanding/parse-summaries";

export async function getCodebase(
  codebaseId: string
): Promise<CodebaseWithSummaries | null> {
  try {
    const codebase = await db.codebaseUnderstanding.findUnique({
      where: { id: codebaseId },
      include: {
        tasks: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!codebase) {
      return null;
    }

    const summaries = parseCodebaseSummaries(codebase);

    return { ...codebase, summaries };
  } catch (err) {
    console.error("Failed to fetch codebase", err);
    return null;
  }
}

// New function to get codebase by task ID (for our new shallow wiki system)
export async function getCodebaseByTaskId(
  taskId: string
): Promise<CodebaseWithSummaries | null> {
  try {
    const task = await db.task.findUnique({
      where: { id: taskId },
      include: {
        codebaseUnderstanding: {
          include: {
            tasks: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });

    if (!task?.codebaseUnderstanding) {
      return null;
    }

    const summaries = parseCodebaseSummaries(task.codebaseUnderstanding);

    return { ...task.codebaseUnderstanding, summaries };
  } catch (err) {
    console.error("Failed to fetch codebase by task ID", err);
    return null;
  }
}
