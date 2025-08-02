import { getUser } from "@/lib/auth/get-user";
import { getGitHubIssues } from "@/lib/github/github-api";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const user = await getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const repoFullName = searchParams.get("repo");

    if (!repoFullName) {
      return NextResponse.json(
        { error: "Repository full name is required" },
        { status: 400 }
      );
    }

    const issues = await getGitHubIssues(repoFullName, user.id);
    return NextResponse.json(issues);
  } catch (error) {
    console.error("Error fetching issues:", error);

    if (
      error instanceof Error &&
      (error.message === "GitHub account not connected" ||
        error.message === "GitHub App not installed" ||
        error.message === "Unauthorized")
    ) {
      const statusCode = error.message === "Unauthorized" ? 401 : 400;
      return NextResponse.json(
        { error: error.message },
        { status: statusCode }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
