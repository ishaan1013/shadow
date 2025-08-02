import type { Message } from "@repo/types";
import { Terminal } from "lucide-react";
import { useAgentEnvironment } from "@/components/agent-environment/agent-environment-context";
import { getToolResult } from "@repo/types";
import { ToolTypes } from "@repo/types";
import { ToolComponent } from "./collapsible-tool";

export function RunTerminalCmdTool({ message }: { message: Message }) {
  const { expandRightPanel } = useAgentEnvironment();

  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args, status: _status } = toolMeta;
  const command = args.command as string;
  const isBackground = args.is_background as boolean;

  // Use typed tool result accessor
  const result = getToolResult(toolMeta, "run_terminal_cmd");
  const _output = result?.stdout || result?.stderr || "";
  const _error = result?.error;

  const suffix = isBackground ? " (Background)" : undefined;

  return (
    <ToolComponent
      icon={<Terminal />}
      type={ToolTypes.RUN_TERMINAL_CMD}
      title={command}
      suffix={suffix}
      onClick={() => expandRightPanel()}
    />
  );
}
