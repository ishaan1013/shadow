import type { Message } from "@repo/types";
import { Replace } from "lucide-react";
import { useAgentEnvironment } from "@/components/agent-environment/agent-environment-context";
import { getToolResult } from "@repo/types";
import { ToolType } from "@repo/types";
import { ToolComponent } from "./collapsible-tool";

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
    <ToolComponent
      icon={<Replace />}
      type={ToolType.SEARCH_REPLACE}
      title={filePath}
      changes={changes}
      onClick={() => {
        updateSelectedFilePath(filePath);
        expandRightPanel();
      }}
    />
  );
}
