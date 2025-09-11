import { db } from "@repo/db";
import { generateTaskId } from "@repo/types";

export class CodebaseUnderstandingStorage {
  private taskId: string;

  constructor(taskId: string) {
    this.taskId = taskId;
  }

  async storeSummary(
    repoFullName: string,
    repoUrl: string,
    summaryContent: any,
    userId: string,
    options?: { forceUpdate?: boolean }
  ): Promise<string> {
    try {
      // Check if task already has a codebase understanding
      const task = await db.task.findUnique({
        where: { id: this.taskId },
        include: { codebaseUnderstanding: true },
      });

      if (!task) {
        throw new Error(`Task ${this.taskId} not found`);
      }

      let codebaseUnderstanding;

      if (task.codebaseUnderstanding) {
        // Update existing
        codebaseUnderstanding = await db.codebaseUnderstanding.update({
          where: { id: task.codebaseUnderstanding.id },
          data: {
            content: summaryContent,
            updatedAt: new Date(),
          },
        });
      } else {
        // Check if a CodebaseUnderstanding already exists for this repo
        const existing = await db.codebaseUnderstanding.findUnique({
          where: { repoFullName },
        });

        if (existing) {
          // Update if forced; otherwise reuse existing as-is
          if (options?.forceUpdate) {
            codebaseUnderstanding = await db.codebaseUnderstanding.update({
              where: { id: existing.id },
              data: {
                content: summaryContent,
                updatedAt: new Date(),
              },
            });
          } else {
            codebaseUnderstanding = existing;
          }
        } else {
          // Create new
          const codebaseUnderstandingId = generateTaskId();

          codebaseUnderstanding = await db.codebaseUnderstanding.create({
            data: {
              id: codebaseUnderstandingId,
              repoFullName,
              repoUrl,
              content: summaryContent,
              userId,
            },
          });
        }

        // Link to task
        await db.task.update({
          where: { id: this.taskId },
          data: { codebaseUnderstandingId: codebaseUnderstanding.id },
        });
      }

      console.log(`💾 Stored summary for task: ${this.taskId}`);
      return codebaseUnderstanding.id;
    } catch (error) {
      console.error(`Failed to store summary for task ${this.taskId}:`, error);
      throw error;
    }
  }

  /**
   * Get summary for a task
   */
  async getSummary(): Promise<any | null> {
    try {
      const task = await db.task.findUnique({
        where: { id: this.taskId },
        include: { codebaseUnderstanding: true },
      });

      if (!task?.codebaseUnderstanding) {
        return null;
      }

      return {
        id: task.codebaseUnderstanding.id,
        repoFullName: task.codebaseUnderstanding.repoFullName,
        repoUrl: task.codebaseUnderstanding.repoUrl,
        content: task.codebaseUnderstanding.content,
        createdAt: task.codebaseUnderstanding.createdAt,
        updatedAt: task.codebaseUnderstanding.updatedAt,
      };
    } catch (error) {
      console.error(`Failed to get summary for task ${this.taskId}:`, error);
      return null;
    }
  }

  /**
   * Check if summary exists for this task
   */
  async hasExistingSummary(): Promise<boolean> {
    try {
      const task = await db.task.findUnique({
        where: { id: this.taskId },
        select: { codebaseUnderstandingId: true },
      });

      return !!task?.codebaseUnderstandingId;
    } catch (error) {
      console.error(
        `Failed to check existing summary for task ${this.taskId}:`,
        error
      );
      return false;
    }
  }
}
