import { NextResponse, NextRequest } from "next/server";
import { verifyTaskOwnership } from "@/lib/auth/verify-task-ownership";
import { makeBackendRequest } from "@/lib/make-backend-request";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  try {
    const { error, user: _user } = await verifyTaskOwnership(taskId);
    if (error) return error;

    // Proxy request to backend server
    const { searchParams } = new URL(req.url);
    const variantId = searchParams.get("variantId");
    const url = variantId
      ? `/api/tasks/${taskId}/files/tree?variantId=${encodeURIComponent(variantId)}`
      : `/api/tasks/${taskId}/files/tree`;
    const response = await makeBackendRequest(url);

    if (!response.ok) {
      console.error(
        "[BACKEND_FILE_TREE_ERROR]",
        response.status,
        response.statusText
      );
      return NextResponse.json(
        {
          success: false,
          error: "Failed to fetch file tree from backend",
        },
        { status: 500 }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error("[FILE_TREE_PROXY_ERROR]", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
