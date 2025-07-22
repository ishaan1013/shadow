import { getUser } from "@/lib/auth/get-user";
import { getGitHubAccount } from "@/lib/db-operations/get-github-account";
import { prisma } from "@repo/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const user = await getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const installationId = searchParams.get("installation_id");
    const setupAction = searchParams.get("setup_action");

    if (!installationId) {
      return NextResponse.json(
        { error: "Installation ID is required" },
        { status: 400 }
      );
    }

    const account = await getGitHubAccount(user.id);

    if (!account) {
      return NextResponse.json(
        { error: "GitHub account not found" },
        { status: 400 }
      );
    }

    await prisma.account.update({
      where: {
        id: account.id,
      },
      data: {
        githubInstallationId: installationId,
        githubAppConnected:
          setupAction === "install" || setupAction === "update",
      },
    });

    // Redirect to the frontend with success message
    return NextResponse.redirect(
      new URL("/?github_app_installed=true", request.url)
    );
  } catch (error) {
    console.error("Error handling GitHub App installation:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
