import type { Message, SemanticSearchToolResult } from "@repo/types";
import { File, Folder, ScanSearch } from "lucide-react";
import { ToolTypes } from "@repo/types";
import { ToolComponent } from "./collapsible-tool";

export function SemanticSearchTool({ message }: { message: Message }) {
  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args, status, result } = toolMeta;
  const query = args.query as string;
  const targetDirectories = args.targetDirectories as string[] | undefined;

  let parsedResult: SemanticSearchToolResult | null = null;
  try {
    parsedResult = typeof result === "string" ? JSON.parse(result) : result;
  } catch {
    // If parsing fails, we'll show the raw result
  }

  return (
    <ToolComponent
      icon={<ScanSearch />}
      type={ToolTypes.SEMANTIC_SEARCH}
      title={`"${query}"`}
      collapsible
    >
      {targetDirectories && targetDirectories.length > 0 && (
        <div className="mb-2 flex items-center gap-1">
          <Folder className="text-muted-foreground size-3" />
          <div className="text-muted-foreground text-xs">
            in{" "}
            {targetDirectories.map((dir: string) => (
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

      {result &&
        status === "COMPLETED" &&
        (parsedResult ? (
          parsedResult.success ? (
            <div className="flex flex-col gap-0.5">
              {parsedResult.results.map((item) => (
                <div key={item.id} className="flex items-center gap-2 py-px">
                  <File className="size-4" />
                  <span className="truncate">
                    {item.filePath}{" "}
                    {item.lineStart > 0 && (
                      <span>
                        ({item.lineStart}-{item.lineEnd})
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {(item.relevance * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
              {parsedResult.results.length === 0 && <div>No results found</div>}
            </div>
          ) : (
            <div className="text-destructive">
              {parsedResult.message || "Error searching codebase"}
            </div>
          )
        ) : (
          <div className="text-destructive">Failed to parse search results</div>
        ))}
    </ToolComponent>
  );
}
