import { CodebaseUnderstanding } from "@repo/db";
import {
  CodebaseSummary,
  ShallowWikiContentSchema,
  type TreeNode,
} from "@repo/types";

export function parseCodebaseSummaries(
  codebase: CodebaseUnderstanding
): CodebaseSummary[] {
  console.log("Fetching summaries for codebase:", codebase.id);
  const codebaseContent = codebase.content;

  try {
    // Validate and parse the content using Zod
    const parseResult = ShallowWikiContentSchema.safeParse(codebaseContent);

    if (!parseResult.success) {
      console.warn("Failed to parse codebase content:", parseResult.error);
      return [];
    }

    const content = parseResult.data;
    const summaries: CodebaseSummary[] = [];

    // Add root summary if it exists
    if (content.rootSummary) {
      summaries.push({
        id: "root_overview",
        type: "repo_summary",
        fileName: "root_overview",
        filePath: "root_overview",
        language: "markdown",
        content: content.rootSummary,
      });
    }

    // Add file summaries from fileCache
    Object.entries(content.fileCache).forEach(([filePath, content]) => {
      if (content.trim().length > 0) {
        const fileName = filePath.split("/").pop() || filePath;
        const fileExtension = fileName.split(".").pop() || "";

        summaries.push({
          id: filePath.replace(/[^a-zA-Z0-9]/g, "_"),
          type: "file_summary",
          fileName,
          filePath,
          language: fileExtension,
          content: content,
        });
      }
    });

    // Add directory summaries from structure
    Object.values(content.structure.nodes).forEach((node: TreeNode) => {
      if (node.summary && node.id !== "root" && node.children.length > 0) {
        summaries.push({
          id: node.id,
          type: "directory_summary",
          fileName: node.name,
          filePath: node.relPath || node.name,
          language: "markdown",
          content: node.summary,
        });
      }
    });

    console.log("Total parsed summaries:", summaries.length);
    return summaries;
  } catch (e) {
    console.error("Error parsing codebase content", e);
    return [];
  }
}
