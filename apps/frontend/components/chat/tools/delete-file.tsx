import type { Message } from "@repo/types";
import { Trash2 } from "lucide-react";
import { ToolTypes } from "@repo/types";
import { ToolComponent } from "./collapsible-tool";

export function DeleteFileTool({ message }: { message: Message }) {
  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args } = toolMeta;
  const filePath = args.target_file as string;

  return (
    <ToolComponent
      icon={<Trash2 className="text-destructive" />}
      type={ToolTypes.DELETE_FILE}
      title={filePath}
    />
  );
}
