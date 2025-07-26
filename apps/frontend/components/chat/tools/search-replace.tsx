import type { Message } from "@repo/types";
import { Replace } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentEnvironment } from "@/components/agent-environment/agent-environment-context";
import { getToolResult } from "@repo/types";
import { ToolTrigger, ToolType } from "./collapsible-tool";

export function SearchReplaceTool({ message }: { message: Message }) {
  const { updateSelectedFilePath, expandRightPanel } = useAgentEnvironment();

  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args, status } = toolMeta;
  const filePath = args.file_path as string;
  // const oldString = args.old_string as string;
  // const newString = args.new_string as string;

  const result = getToolResult(toolMeta, "search_replace");
  const linesAdded = result?.linesAdded || 0;
  const linesRemoved = result?.linesRemoved || 0;

  const changes =
    status === "COMPLETED" && (linesAdded > 0 || linesRemoved > 0)
      ? { linesAdded, linesRemoved }
      : undefined;

  return (
    <button
      onClick={() => {
        updateSelectedFilePath(filePath);
        expandRightPanel();
      }}
      className={cn(
        "text-muted-foreground hover:text-foreground hover:bg-secondary flex w-full cursor-pointer flex-col gap-2 rounded-md px-3 py-1.5 text-left text-[13px] transition-colors"
      )}
    >
      <ToolTrigger
        icon={<Replace />}
        type={ToolType.SEARCH_REPLACE}
        title={filePath}
        changes={changes}
      />
      {/* {status !== "RUNNING" && (
        <div className="space-y-2 pl-6">
          <div>
            <div className="text-muted-foreground mb-1 text-xs">From:</div>
            <div className="max-h-20 overflow-y-auto rounded-md border border-red-200 bg-red-50 p-2 font-mono text-xs dark:border-red-500/20 dark:bg-red-900/20">
              <div className="whitespace-pre-wrap text-red-700 dark:text-red-300">
                {oldString.substring(0, 200)}
                {oldString.length > 200 && "... (truncated)"}
              </div>
            </div>
          </div>
          <div>
            <div className="text-muted-foreground mb-1 text-xs">To:</div>
            <div className="max-h-20 overflow-y-auto rounded-md border border-green-200 bg-green-50 p-2 font-mono text-xs dark:border-green-500/20 dark:bg-green-900/20">
              <div className="whitespace-pre-wrap text-green-700 dark:text-green-300">
                {newString.substring(0, 200)}
                {newString.length > 200 && "... (truncated)"}
              </div>
            </div>
          </div>
        </div>
      )} */}
    </button>
  );
}
