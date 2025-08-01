import { NextResponse, NextRequest } from "next/server";
import { db } from "@repo/db";
import { getUser } from "@/lib/auth/get-user";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;

  try {
    // Check authentication
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // Get task and verify ownership
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: { userId: true }
    });

    if (!task) {
      return NextResponse.json({ success: false, error: "Task not found" }, { status: 404 });
    }

    // Verify task ownership
    if (task.userId !== user.id) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    // Proxy request to backend server
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    const response = await fetch(`${backendUrl}/api/tasks/${taskId}/files/tree`);

    if (!response.ok) {
      console.error("[BACKEND_FILE_TREE_ERROR]", response.status, response.statusText);
      return NextResponse.json({
        success: false,
        error: "Failed to fetch file tree from backend"
      }, { status: 500 });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error("[FILE_TREE_PROXY_ERROR]", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
}