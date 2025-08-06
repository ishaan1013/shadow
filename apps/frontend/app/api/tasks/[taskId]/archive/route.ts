import { archiveTask } from "@/lib/db-operations/archive-task";
import { verifyTaskOwnership } from "@/lib/auth/verify-task-ownership";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    const { error, user: _user } = await verifyTaskOwnership(taskId);
    if (error) return error;

    const result = await archiveTask(taskId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to archive task" },
        { status: 500 }
      );
    }

    return NextResponse.json({ task: result.task });
  } catch (error) {
    console.error("Error archiving task:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}