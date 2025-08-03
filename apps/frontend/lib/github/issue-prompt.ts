import type { GitHubIssue } from "@repo/types";

export function generateIssuePrompt(issue: GitHubIssue): string {
  return `Analyze and resolve this **Issue: ${issue.title}**
${issue.body ? `\n**Description:**\n${issue.body}\n` : ""}
${issue.labels?.length > 0 ? `**Labels:** ${issue.labels.map((l) => l.name).join(", ")}\n` : ""}Follow this systematic approach:
1. **Understand**: Review the issue description and code references above
2. **Investigate**: Search codebase, identify root cause and scope of changes needed
3. **Implement**: Write clean, maintainable code that fixes the issue while following the project's existing patterns and conventions  
4. **Validate**: Create or update tests to verify the fix, ensure no regressions, and confirm the solution addresses the original problem

Deliver a complete solution with appropriate tests, documentation updates if needed, and clear commit messages explaining the changes.`;
}
