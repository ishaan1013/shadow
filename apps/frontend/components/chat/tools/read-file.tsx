import type { Message } from "@repo/types";
import { Eye } from "lucide-react";
import { useAgentEnvironment } from "@/components/agent-environment/agent-environment-context";
import { ToolTypes } from "@repo/types";
import { ToolComponent } from "./collapsible-tool";

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
    <ToolComponent
      icon={<Eye />}
      type={ToolTypes.READ_FILE}
      title={filePath}
      suffix={lineRange}
      onClick={() => {
        updateSelectedFilePath(filePath);
        expandRightPanel();
      }}
    />
  );
}
