import type { Message } from "@repo/types";
import { Filter, Hash } from "lucide-react";
import { CollapsibleTool } from "./collapsible-tool";

export function GrepSearchTool({ message }: { message: Message }) {
  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args, status, result } = toolMeta;
  const query = args.query as string;
  const includePattern = args.include_pattern as string;
  const excludePattern = args.exclude_pattern as string;
  const caseSensitive = args.case_sensitive as boolean;

  const title = `Regex search: ${query}${caseSensitive ? " (case sensitive)" : ""}`;

  return (
    <CollapsibleTool icon={<Hash />} title={title}>
      {(includePattern || excludePattern) && (
        <div className="flex items-center gap-1">
          <Filter className="size-3 text-muted-foreground" />
          <div className="text-xs text-muted-foreground">
            {includePattern && (
              <span>
                include:{" "}
                <code className="bg-gray-100 dark:bg-gray-800/50 px-1 py-0.5 rounded">
                  {includePattern}
                </code>
              </span>
            )}
            {includePattern && excludePattern && <span>, </span>}
            {excludePattern && (
              <span>
                exclude:{" "}
                <code className="bg-gray-100 dark:bg-gray-800/50 px-1 py-0.5 rounded">
                  {excludePattern}
                </code>
              </span>
            )}
          </div>
        </div>
      )}

      {result && status === "COMPLETED" && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">Matches:</div>
          <div className="bg-gray-50 dark:bg-gray-900/50 border rounded-md p-3 max-h-40 overflow-y-auto text-xs font-mono">
            <div className="text-muted-foreground whitespace-pre-wrap">
              {result.substring(0, 1000)}
              {result.length > 1000 && "\n\n... (truncated)"}
            </div>
          </div>
        </div>
      )}
    </CollapsibleTool>
  );
}
