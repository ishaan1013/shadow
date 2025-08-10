import { getTaskWithDetails } from "@/lib/db-operations/get-task-with-details";
import { deleteTask } from "@/lib/db-operations/delete-task";
import { verifyTaskOwnership } from "@/lib/auth/verify-task-ownership";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    const { error, user: _user } = await verifyTaskOwnership(taskId);
    if (error) return error;

    const { task, todos, fileChanges, diffStats } =
      await getTaskWithDetails(taskId);

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ task, todos, fileChanges, diffStats });
  } catch (error) {
    console.error("Error fetching task:", error);
    return NextResponse.json(
      { error: "Failed to fetch task" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    const { error, user: _user } = await verifyTaskOwnership(taskId);
    if (error) return error;

    const result = await deleteTask(taskId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to delete task" },
        { status: 500 }
      );
    }

    return NextResponse.json({ task: result.task });
  } catch (error) {
    console.error("Error deleting task:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
