import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    // Check authentication
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Forward request to backend
    const baseUrl =
      process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:4000";
    const requestHeaders = await headers();
    const cookieHeader = requestHeaders.get("cookie");

    const response = await fetch(
      `${baseUrl}/api/tasks/${taskId}/pull-request`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cookieHeader && { Cookie: cookieHeader }),
        },
        body: JSON.stringify({
          userId: session.user.id,
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
