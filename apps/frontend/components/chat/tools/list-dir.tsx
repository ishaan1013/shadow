import type { Message } from "@repo/types";
import { FolderOpen } from "lucide-react";
import { CollapsibleTool } from "./collapsible-tool";

export function ListDirTool({ message }: { message: Message }) {
  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args, status, result } = toolMeta;
  const path = args.relative_workspace_path as string;

  return (
    <CollapsibleTool
      icon={<FolderOpen />}
      title={`List directory: ${path || "./"}`}
    >
      {result && status === "COMPLETED" && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">Contents:</div>
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
