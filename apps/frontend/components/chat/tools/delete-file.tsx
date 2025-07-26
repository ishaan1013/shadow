import type { Message } from "@repo/types";
import { Trash2 } from "lucide-react";
import { ToolTrigger, ToolType } from "./collapsible-tool";

export function DeleteFileTool({ message }: { message: Message }) {
  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args } = toolMeta;
  const filePath = args.target_file as string;

  return (
    <div className="text-muted-foreground hover:text-foreground flex w-full text-left text-[13px] transition-colors">
      <ToolTrigger
        icon={<Trash2 className="text-destructive" />}
        type={ToolType.DELETE_FILE}
        title={filePath}
      />
    </div>
  );
}
