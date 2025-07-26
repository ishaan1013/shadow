import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    // Forward to backend server
    const backendUrl = process.env.BACKEND_URL || "http://localhost:4000";
    const response = await fetch(`${backendUrl}/api/tasks/${taskId}/diff-stats`);

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch diff stats" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching diff stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch diff stats" },
      { status: 500 }
    );
  }
}