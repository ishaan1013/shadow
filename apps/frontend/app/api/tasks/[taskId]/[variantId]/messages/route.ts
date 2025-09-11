import { getTaskMessages } from "@/lib/db-operations/get-task-messages";
import { verifyTaskOwnership } from "@/lib/auth/verify-task-ownership";
import { NextRequest, NextResponse } from "next/server";

// Variant-aware proxy route to align with backend
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string; variantId: string }> }
) {
  try {
    const { taskId } = await params;

    const { error } = await verifyTaskOwnership(taskId);
    if (error) return error;

    // For now, reuse DB helper that returns task-wide messages.
    // Backend variant-scoped messages are proxied here when available.
    const messages = await getTaskMessages(taskId);

    return NextResponse.json(messages);
  } catch (error) {
    console.error("Error fetching variant messages:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

