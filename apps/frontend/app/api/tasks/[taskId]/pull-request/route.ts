import { verifyTaskOwnership } from "@/lib/auth/verify-task-ownership";
import { makeBackendRequest } from "@/lib/make-backend-request";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    const { error, user: user } = await verifyTaskOwnership(taskId);
    if (error) return error;

    const { variantId } = await request.json().catch(() => ({ variantId: undefined }));

    // Forward request to backend
    const requestHeaders = await headers();
    const cookieHeader = requestHeaders.get("cookie");

    const response = await makeBackendRequest(
      `/api/tasks/${taskId}/pull-request`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cookieHeader && { Cookie: cookieHeader }),
        },
        body: JSON.stringify({
          userId: user.id,
          ...(variantId ? { variantId } : {}),
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Backend PR creation failed for task ${taskId}:`,
        errorText
      );

      return NextResponse.json(
        {
          success: false,
          error: "Failed to create pull request",
        },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error(`Error creating PR for task:`, error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}
