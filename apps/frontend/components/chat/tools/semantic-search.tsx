import type { Message } from "@repo/types";
import { Folder, Search } from "lucide-react";
import { CollapsibleTool, ToolType } from "./collapsible-tool";

export function SemanticSearchTool({ message }: { message: Message }) {
  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args, status, result } = toolMeta;
  const query = args.query as string;

  return (
    <CollapsibleTool
      icon={<Search />}
      type={ToolType.SEMANTIC_SEARCH}
      title={`"${query}"`}
    >
      {args.targetDirectories?.length > 0 && (
        <div className="flex items-center gap-1">
          <Folder className="text-muted-foreground size-3" />
          <div className="text-muted-foreground text-xs">
            in{" "}
            {args.targetDirectories.map((dir: string) => (
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
              {(() => {
                const resultStr =
                  typeof result === "string" ? result : JSON.stringify(result);
                return (
                  <>
                    {resultStr.substring(0, 800)}
                    {resultStr.length > 800 && "\n\n... (truncated)"}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </CollapsibleTool>
  );
}
