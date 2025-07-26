import type { Message, CodebaseSearchToolResult } from "@repo/types";
import { Folder, Search } from "lucide-react";
import { CollapsibleTool, ToolType } from "./collapsible-tool";
import { getToolResult } from "@repo/types";

export function CodebaseSearchTool({ message }: { message: Message }) {
  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args, status } = toolMeta;
  const query = args.query as string;
  const targetDirectories = (args.target_directories as string[]) || [];

  const result = getToolResult(
    toolMeta,
    "codebase_search"
  ) as CodebaseSearchToolResult | null;
  const displayContent =
    result?.results?.map((r) => r.content).join("\n\n---\n\n") ||
    result?.message ||
    "No results found";

  return (
    <CollapsibleTool
      icon={<Search />}
      type={ToolType.CODEBASE_SEARCH}
      title={`"${query}"`}
    >
      {targetDirectories.length > 0 && (
        <div className="flex items-center gap-1">
          <Folder className="text-muted-foreground size-3" />
          <div className="text-muted-foreground text-xs">
            in{" "}
            {targetDirectories.map((dir) => (
              <code
                key={dir}
                className="mx-0.5 rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-800/50"
              >
                {dir}
              </code>
            ))}
          </div>
        </div>
      )}

      {result && status === "COMPLETED" && (
        <div>
          <div className="text-muted-foreground mb-1 text-xs">Results:</div>
          <div className="max-h-40 overflow-y-auto rounded-md border bg-gray-50 p-3 text-xs dark:bg-gray-900/50">
            <div className="text-muted-foreground whitespace-pre-wrap">
              {displayContent.substring(0, 800)}
              {displayContent.length > 800 && "\n\n... (truncated)"}
            </div>
          </div>
        </div>
      )}
    </CollapsibleTool>
  );
}
