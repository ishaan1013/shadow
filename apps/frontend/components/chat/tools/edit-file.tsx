import type { Message } from "@repo/types";
import { Edit3 } from "lucide-react";
import { CollapsibleTool } from "./collapsible-tool";

export function EditFileTool({ message }: { message: Message }) {
  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args, status, changes } = toolMeta;
  const filePath = changes?.filePath || (args.target_file as string);
  const instructions = args.instructions as string;
  const linesAdded = changes?.linesAdded || 0;
  const linesRemoved = changes?.linesRemoved || 0;

  const changeSummary =
    status === "COMPLETED" && (linesAdded > 0 || linesRemoved > 0)
      ? ` (+${linesAdded} -${linesRemoved})`
      : "";

  return (
    <CollapsibleTool
      icon={<Edit3 />}
      title={`Edited ${filePath}${changeSummary}`}
    >
      {instructions && (
        <div className="text-xs text-muted-foreground">{instructions}</div>
      )}
    </CollapsibleTool>
  );
}
