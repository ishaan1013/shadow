import type { Message } from "@repo/types";
import { Filter, Hash } from "lucide-react";
import { CollapsibleTool, ToolType } from "./collapsible-tool";
import { getToolResult } from "@repo/types";

export function GrepSearchTool({ message }: { message: Message }) {
  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args, status } = toolMeta;
  const query = args.query as string;
  const includePattern = args.include_pattern as string;
  const excludePattern = args.exclude_pattern as string;
  const caseSensitive = args.case_sensitive as boolean;

  const result = getToolResult(toolMeta, "grep_search");
  const matches = result?.matches?.join("\n") || "";

  const title = `${query}${caseSensitive ? " (case sensitive)" : ""}`;

  return (
    <CollapsibleTool icon={<Hash />} type={ToolType.GREP_SEARCH} title={title}>
      {(includePattern || excludePattern) && (
        <div className="flex items-center gap-1">
          <Filter className="text-muted-foreground size-3" />
          <div className="text-muted-foreground text-xs">
            {includePattern && (
              <span>
                include:{" "}
                <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-800/50">
                  {includePattern}
                </code>
              </span>
            )}
            {includePattern && excludePattern && <span>, </span>}
            {excludePattern && (
              <span>
                exclude:{" "}
                <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-gray-800/50">
                  {excludePattern}
                </code>
              </span>
            )}
          </div>
        </div>
      )}

      {result && status === "COMPLETED" && (
        <div>
          <div className="text-muted-foreground mb-1 text-xs">Matches:</div>
          <div className="max-h-40 overflow-y-auto rounded-md border bg-gray-50 p-3 font-mono text-xs dark:bg-gray-900/50">
            <div className="text-muted-foreground whitespace-pre-wrap">
              {matches.substring(0, 1000)}
              {matches.length > 1000 && "\n\n... (truncated)"}
            </div>
          </div>
        </div>
      )}
    </CollapsibleTool>
  );
}
