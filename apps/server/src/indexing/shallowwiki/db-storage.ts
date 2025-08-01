import { db } from "@repo/db";

/**
 * Simple database storage for codebase understanding summaries
 * Uses the new Prisma CodebaseUnderstanding model linked to tasks
 */
export class CodebaseUnderstandingStorage {
  private taskId: string;

  constructor(taskId: string) {
    this.taskId = taskId;
  }

  /**
   * Store or update summary for a task
   * Creates/updates a single CodebaseUnderstanding record linked to the task
   */
  async storeSummary(
    repoFullName: string,
    repoUrl: string,
    summaryContent: any,
    userId: string
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
        // Create new
        codebaseUnderstanding = await db.codebaseUnderstanding.create({
          data: {
            repoFullName,
            repoUrl,
            content: summaryContent,
            userId,
          },
        });

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
