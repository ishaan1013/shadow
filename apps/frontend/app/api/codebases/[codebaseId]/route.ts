import { getCodebase } from "@/lib/db-operations/get-codebase";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ codebaseId: string }> }
) {
  try {
    const { codebaseId } = await params;
    const codebase = await getCodebase(codebaseId);

    if (!codebase) {
      return NextResponse.json({ error: "Codebase not found" }, { status: 404 });
    }

    return NextResponse.json({ codebase });
  } catch (error) {
    console.error("Error fetching codebase:", error);
    return NextResponse.json(
      { error: "Failed to fetch codebase" },
      { status: 500 }
    );
  }
}