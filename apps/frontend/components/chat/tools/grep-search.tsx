import type { Message, GrepResult } from "@repo/types";
import { Filter, File, Search } from "lucide-react";
import { ToolTypes } from "@repo/types";
import { ToolComponent } from "./collapsible-tool";
import { getToolResult } from "@repo/types";

export function GrepSearchTool({ message }: { message: Message }) {
  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args, status } = toolMeta;
  const query = args.query as string;
  const includePattern = args.include_pattern as string;
  const excludePattern = args.exclude_pattern as string;
  const caseSensitive = args.case_sensitive as boolean;

  const result = getToolResult(toolMeta, "grep_search") as GrepResult | null;
  const title = `${query}${caseSensitive ? " (case sensitive)" : ""}`;

  return (
    <ToolComponent
      icon={<Search />}
      type={ToolTypes.GREP_SEARCH}
      title={title}
      collapsible
    >
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
          <div className="text-muted-foreground mb-1 text-xs">
            {result.message}
          </div>

          {result.detailedMatches && result.detailedMatches.length > 0 ? (
            <div className="flex flex-col gap-2">
              {result.detailedMatches.map((match, index) => (
                <div
                  key={index}
                  className="flex flex-col gap-1 border-b border-gray-200 py-1 last:border-b-0 dark:border-gray-700"
                >
                  <div className="flex items-center gap-2">
                    <File className="size-4 text-blue-500" />
                    <div className="flex flex-col">
                      <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-gray-800">
                        {match.file}:{match.lineNumber}
                      </code>
                    </div>
                  </div>
                  <pre className="ml-6 whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs dark:bg-gray-900/50">
                    {match.content}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            result.matches &&
            result.matches.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-md border bg-gray-50 p-3 font-mono text-xs dark:bg-gray-900/50">
                <div className="text-muted-foreground whitespace-pre-wrap">
                  {result.matches.join("\n").substring(0, 1000)}
                  {result.matches.join("\n").length > 1000 &&
                    "\n\n... (truncated)"}
                </div>
              </div>
            )
          )}

          {result.matchCount === 0 && (
            <div className="text-muted-foreground text-xs">
              No matches found
            </div>
          )}
        </div>
      )}
    </ToolComponent>
  );
}
