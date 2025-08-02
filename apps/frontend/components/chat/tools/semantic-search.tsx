import type { Message, SemanticSearchToolResult } from "@repo/types";
import { Code, File, Folder, ScanSearch } from "lucide-react";
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

      {result && status === "COMPLETED" && (
        <div>
          {parsedResult ? (
            parsedResult.success ? (
              <div className="flex flex-col gap-2">
                <div className="text-muted-foreground text-xs">
                  {parsedResult.message}
                </div>
                {parsedResult.results.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col gap-2 border-b border-gray-200 py-2 last:border-b-0 dark:border-gray-700"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <File className="size-4 text-blue-500" />
                      <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs dark:bg-gray-800">
                        {item.filePath}
                      </code>
                      {item.lineStart > 0 && (
                        <span className="text-muted-foreground text-xs">
                          lines {item.lineStart}-{item.lineEnd}
                        </span>
                      )}
                      {item.language && (
                        <span className="text-muted-foreground rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-800">
                          {item.language}
                        </span>
                      )}
                      {item.kind && (
                        <span className="text-muted-foreground rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
                          {item.kind}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Code className="size-4" />
                      <span className="text-muted-foreground text-xs">
                        Relevance: {(item.relevance * 100).toFixed(0)}%
                      </span>
                    </div>
                    <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs dark:bg-gray-900/50">
                      {item.content.length > 400
                        ? `${item.content.substring(0, 400)}...`
                        : item.content}
                    </pre>
                  </div>
                ))}
                {parsedResult.results.length === 0 && (
                  <div className="text-muted-foreground text-xs">
                    No results found
                  </div>
                )}
              </div>
            ) : (
              <div className="text-destructive text-xs">
                {parsedResult.message || "Error searching codebase"}
              </div>
            )
          ) : (
            <div className="text-muted-foreground text-xs">
              Failed to parse search results
            </div>
          )}
        </div>
      )}
    </ToolComponent>
  );
}
