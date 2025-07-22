import { db } from "@repo/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    const fileChanges = await db.fileChange.findMany({
      where: { taskId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        filePath: true,
        operation: true,
        oldContent: true,
        newContent: true,
        diffPatch: true,
        additions: true,
        deletions: true,
        createdAt: true,
      },
    });

    // Convert to JSON serializable format
    const serializedFileChanges = fileChanges.map((change) => ({
      ...change,
      createdAt: change.createdAt.toISOString(),
    }));

    return NextResponse.json(serializedFileChanges);
  } catch (error) {
    console.error("Failed to fetch file changes:", error);
    return NextResponse.json(
      { error: "Failed to fetch file changes" },
      { status: 500 }
    );
  }
}
