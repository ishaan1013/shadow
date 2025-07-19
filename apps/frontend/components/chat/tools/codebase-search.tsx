import type { Message } from "@repo/types";
import { Folder, Search } from "lucide-react";
import { CollapsibleTool } from "./collapsible-tool";

export function CodebaseSearchTool({ message }: { message: Message }) {
  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args, status, result } = toolMeta;
  const query = args.query as string;
  const targetDirectories = (args.target_directories as string[]) || [];

  return (
    <CollapsibleTool icon={<Search />} title={`Semantic search: "${query}"`}>
      {targetDirectories.length > 0 && (
        <div className="flex items-center gap-1">
          <Folder className="size-3 text-muted-foreground" />
          <div className="text-xs text-muted-foreground">
            in{" "}
            {targetDirectories.map((dir) => (
              <code
                key={dir}
                className="bg-gray-100 dark:bg-gray-800/50 px-1 py-0.5 rounded mx-0.5"
              >
                {dir}
              </code>
            ))}
          </div>
        </div>
      )}

      {result && status === "COMPLETED" && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">Results:</div>
          <div className="bg-gray-50 dark:bg-gray-900/50 border rounded-md p-3 max-h-40 overflow-y-auto text-xs">
            <div className="text-muted-foreground whitespace-pre-wrap">
              {result.substring(0, 800)}
              {result.length > 800 && "\n\n... (truncated)"}
            </div>
          </div>
        </div>
      )}
    </CollapsibleTool>
  );
}
