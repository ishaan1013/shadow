import type { Message } from "@repo/types";
import { FileSearch } from "lucide-react";
import { CollapsibleTool } from "./collapsible-tool";

export function FileSearchTool({ message }: { message: Message }) {
  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args, status, result } = toolMeta;
  const query = args.query as string;

  return (
    <CollapsibleTool icon={<FileSearch />} title={`File search: "${query}"`}>
      {result && status === "COMPLETED" && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">Found files:</div>
          <div className="bg-gray-50 dark:bg-gray-900/50 border rounded-md p-3 max-h-32 overflow-y-auto text-xs font-mono">
            <div className="text-muted-foreground whitespace-pre-wrap">
              {result}
            </div>
          </div>
        </div>
      )}
    </CollapsibleTool>
  );
}
