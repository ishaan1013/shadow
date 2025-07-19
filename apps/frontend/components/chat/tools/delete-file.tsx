import type { Message } from "@repo/types";
import { Trash2 } from "lucide-react";

export function DeleteFileTool({ message }: { message: Message }) {
  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args } = toolMeta;
  const filePath = args.target_file as string;

  return (
    <div className="flex items-center gap-2 w-full text-left transition-colors text-muted-foreground hover:text-foreground text-[13px] [&_svg:not([class*='size-'])]:size-3.5">
      <Trash2 className="text-destructive" />
      <span>Delete {filePath}</span>
    </div>
  );
}
