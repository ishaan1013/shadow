import type { Message } from "@repo/types";
import { Replace } from "lucide-react";
import { CollapsibleTool } from "./collapsible-tool";

export function SearchReplaceTool({ message }: { message: Message }) {
  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args, status } = toolMeta;
  const filePath = args.file_path as string;
  const oldString = args.old_string as string;
  const newString = args.new_string as string;

  return (
    <CollapsibleTool icon={<Replace />} title={`Replace in ${filePath}`}>
      {status !== "RUNNING" && (
        <div className="space-y-2">
          <div>
            <div className="text-xs text-muted-foreground mb-1">From:</div>
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/20 rounded-md p-2 max-h-20 overflow-y-auto text-xs font-mono">
              <div className="text-red-700 dark:text-red-300 whitespace-pre-wrap">
                {oldString.substring(0, 200)}
                {oldString.length > 200 && "... (truncated)"}
              </div>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">To:</div>
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-500/20 rounded-md p-2 max-h-20 overflow-y-auto text-xs font-mono">
              <div className="text-green-700 dark:text-green-300 whitespace-pre-wrap">
                {newString.substring(0, 200)}
                {newString.length > 200 && "... (truncated)"}
              </div>
            </div>
          </div>
        </div>
      )}
    </CollapsibleTool>
  );
}
