import type { Message } from "@repo/types";
import { Edit3 } from "lucide-react";
import { useAgentEnvironment } from "@/components/agent-environment/agent-environment-context";
import { getToolResult } from "@repo/types";
import { ToolType } from "@repo/types";
import { ToolComponent } from "./collapsible-tool";

export function EditFileTool({ message }: { message: Message }) {
  const { updateSelectedFilePath, expandRightPanel } = useAgentEnvironment();

  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args, status } = toolMeta;
  const filePath = args.target_file as string;
  const result = getToolResult(toolMeta, "edit_file");
  const linesAdded = result?.linesAdded || 0;
  const linesRemoved = result?.linesRemoved || 0;

  const changes =
    status === "COMPLETED" && (linesAdded > 0 || linesRemoved > 0)
      ? { linesAdded, linesRemoved }
      : undefined;

  return (
    <ToolComponent
      icon={<Edit3 />}
      type={ToolType.EDIT_FILE}
      title={filePath}
      changes={changes}
      onClick={() => {
        updateSelectedFilePath(filePath);
        expandRightPanel();
      }}
    />
  );
}
