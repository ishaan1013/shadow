import { getUser } from "@/lib/auth/get-user";
import { getCodebases } from "@/lib/db-operations/get-codebases";
import { NextRequest, NextResponse } from "next/server";

export async function GET(_request: NextRequest) {
  try {
    const user = await getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const codebases = await getCodebases(user.id);

    return NextResponse.json({ codebases });
  } catch (error) {
    console.error("Error fetching codebases:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}