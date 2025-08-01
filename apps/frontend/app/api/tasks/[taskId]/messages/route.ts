import { getTaskMessages } from "@/lib/db-operations/get-task-messages";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const { messages, mostRecentMessageModel } = await getTaskMessages(taskId);

    return NextResponse.json({ messages, mostRecentMessageModel });
  } catch (error) {
    console.error("Error fetching messages:", error);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}
