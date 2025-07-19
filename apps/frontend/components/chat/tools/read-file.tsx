import type { Message } from "@repo/types";
import { Eye } from "lucide-react";
import { CollapsibleTool } from "./collapsible-tool";

export function ReadFileTool({ message }: { message: Message }) {
  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args, status, result } = toolMeta;
  const filePath = args.target_file as string;
  const startLine = args.start_line_one_indexed as number;
  const endLine = args.end_line_one_indexed_inclusive as number;
  const readEntireFile = args.should_read_entire_file as boolean;

  const lineRange = readEntireFile
    ? "entire file"
    : startLine && endLine
      ? `lines ${startLine}-${endLine}`
      : "partial read";

  return (
    <CollapsibleTool icon={<Eye />} title={`Read ${filePath} (${lineRange})`}>
      {result && status === "COMPLETED" && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">Preview:</div>
          <div className="bg-gray-50 dark:bg-gray-900/50 border rounded-md p-3 max-h-32 overflow-y-auto text-xs font-mono">
            <div className="text-muted-foreground whitespace-pre-wrap">
              {result.substring(0, 500)}
              {result.length > 500 && "\n\n... (truncated)"}
            </div>
          </div>
        </div>
      )}
    </CollapsibleTool>
  );
}
