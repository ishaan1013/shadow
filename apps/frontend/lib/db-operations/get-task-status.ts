import { db, InitStatus, TaskStatus } from "@repo/db";

export type TaskStatusData = {
  status: TaskStatus;
  initStatus: InitStatus;
  initializationError: string | null;
};

export async function getTaskStatus(taskId: string): Promise<TaskStatusData> {
  const data = await db.task.findUnique({
    where: { id: taskId },
    select: {
      status: true,
      initStatus: true,
      initializationError: true,
    },
  });

  if (!data) {
    throw new Error("Task not found");
  }

  return {
    status: data.status,
    initStatus: data.initStatus,
    initializationError: data.initializationError,
  };
}
