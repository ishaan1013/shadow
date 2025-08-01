import type { Message } from "@repo/types";

// Tool-specific components
import { SemanticSearchTool } from "./semantic-search";
import { DeleteFileTool } from "./delete-file";
import { EditFileTool } from "./edit-file";
import { FileSearchTool } from "./file-search";
import { GrepSearchTool } from "./grep-search";
import { ListDirTool } from "./list-dir";
import { ReadFileTool } from "./read-file";
import { RunTerminalCmdTool } from "./run-terminal-cmd";
import { SearchReplaceTool } from "./search-replace";
import { TodoWriteTool } from "./todo-write";
import { WebSearchTool } from "./web-search";

// Export ToolType enum
export { ToolType } from "@repo/types";

// Tool component registry
const TOOL_COMPONENTS = {
  todo_write: TodoWriteTool,
  semantic_search: SemanticSearchTool,
  read_file: ReadFileTool,
  run_terminal_cmd: RunTerminalCmdTool,
  list_dir: ListDirTool,
  grep_search: GrepSearchTool,
  edit_file: EditFileTool,
  search_replace: SearchReplaceTool,
  file_search: FileSearchTool,
  delete_file: DeleteFileTool,
  web_search: WebSearchTool,
} as const;

export type ToolName = keyof typeof TOOL_COMPONENTS;

// function StatusIcon({
//   status,
//   tool,
// }: {
//   status: ToolStatusType;
//   tool: string;
// }) {
//   switch (status) {
//     case "RUNNING":
//       return <Loader className="size-3.5 text-blue-500 animate-spin" />;
//     case "COMPLETED":
//       return <CheckIcon className="size-3.5 text-green-400 opacity-60" />;
//     case "FAILED":
//       return <X className="size-3.5 text-red-400" />;
//     default:
//       return <div>Status: {status}</div>;
//   }
// }

export function ToolMessage({ message }: { message: Message }) {
  if (!message.metadata?.tool) {
    return <div className="text-muted-foreground">{message.content}</div>;
  }

  // const { status } = message.metadata.tool;
  const toolMeta = message.metadata?.tool;
  if (!toolMeta) {
    return <span className="text-muted-foreground">{message.content}</span>;
  }

  const ToolComponent = TOOL_COMPONENTS[toolMeta.name as ToolName];
  
  if (!ToolComponent) {
    return (
      <div className="text-muted-foreground">
        <span className="opacity-60">Unknown tool:</span> {toolMeta.name}
      </div>
    );
  }

  // Todo: pass in status
  return <ToolComponent message={message} />;
}

// Export all tool components for potential individual use
export {
  SemanticSearchTool,
  DeleteFileTool,
  EditFileTool,
  FileSearchTool,
  GrepSearchTool,
  ListDirTool,
  ReadFileTool,
  RunTerminalCmdTool,
  SearchReplaceTool,
  TodoWriteTool,
  WebSearchTool,
};
