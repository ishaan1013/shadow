import type { Message } from "@repo/types";
import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentEnvironment } from "@/components/agent-environment/agent-environment-context";
import { ToolTrigger, ToolType } from "./collapsible-tool";

export function ReadFileTool({ message }: { message: Message }) {
  const { updateSelectedFilePath, expandRightPanel } = useAgentEnvironment();

  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args } = toolMeta;
  const filePath = args.target_file as string;
  const startLine = args.start_line_one_indexed as number;
  const endLine = args.end_line_one_indexed_inclusive as number;

  const lineRange =
    startLine && endLine ? `${startLine}-${endLine}` : undefined;

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
        icon={<Eye />}
        type={ToolType.READ_FILE}
        title={filePath}
        suffix={lineRange}
      />
    </button>
  );
}
