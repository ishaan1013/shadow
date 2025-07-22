import { db } from "@repo/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    const todos = await db.todo.findMany({
      where: { taskId },
      orderBy: { sequence: "asc" },
      select: {
        id: true,
        content: true,
        status: true,
        sequence: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Convert to JSON serializable format
    const serializedTodos = todos.map((todo) => ({
      ...todo,
      createdAt: todo.createdAt.toISOString(),
      updatedAt: todo.updatedAt.toISOString(),
    }));

    return NextResponse.json(serializedTodos);
  } catch (error) {
    console.error("Failed to fetch todos:", error);
    return NextResponse.json(
      { error: "Failed to fetch todos" },
      { status: 500 }
    );
  }
}
