import { db, CodebaseUnderstanding } from "@repo/db";

export type SidebarCodebase = Omit<CodebaseUnderstanding, "content"> & {
  tasks: { id: string }[];
};

export async function getCodebases(userId: string): Promise<SidebarCodebase[]> {
  let initialCodebases: SidebarCodebase[] = [];
  try {
    initialCodebases = await db.codebaseUnderstanding.findMany({
      where: {
        userId,
      },
      select: {
        id: true,
        repoFullName: true,
        repoUrl: true,
        createdAt: true,
        updatedAt: true,
        userId: true,
        tasks: {
          select: {
            id: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
  } catch (err) {
    console.error("Failed to fetch initial codebases", err);
  }

  return initialCodebases;
}