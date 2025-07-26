import { cn } from "@/lib/utils";
import { useState } from "react";

export enum ToolType {
  EDIT_FILE = "edit_file",
  READ_FILE = "read_file",
  SEARCH_REPLACE = "search_replace",
  CODEBASE_SEARCH = "codebase_search",
  SEMANTIC_SEARCH = "semantic_search",
  GREP_SEARCH = "grep_search",
  FILE_SEARCH = "file_search",
  LIST_DIR = "list_dir",
  DELETE_FILE = "delete_file",
  WEB_SEARCH = "web_search",
  TODO_WRITE = "todo_write",
  RUN_TERMINAL_CMD = "run_terminal_cmd",
}

const TOOL_PREFIXES: Record<ToolType, string> = {
  [ToolType.EDIT_FILE]: "Edited",
  [ToolType.READ_FILE]: "Read",
  [ToolType.SEARCH_REPLACE]: "Replaced in",
  [ToolType.CODEBASE_SEARCH]: "Searched codebase",
  [ToolType.SEMANTIC_SEARCH]: "Semantic search",
  [ToolType.GREP_SEARCH]: "Grepped",
  [ToolType.FILE_SEARCH]: "Searched files",
  [ToolType.LIST_DIR]: "Listed",
  [ToolType.DELETE_FILE]: "Deleted",
  [ToolType.WEB_SEARCH]: "Searched web",
  [ToolType.TODO_WRITE]: "Updated todo list",
  [ToolType.RUN_TERMINAL_CMD]: "Ran",
};

type ToolTriggerProps = {
  icon: React.ReactNode;
  type: ToolType;
  title: string;
  suffix?: string;
  prefix?: string;
  changes?: {
    linesAdded: number;
    linesRemoved: number;
  };
  className?: string;
};

type CollapsibleToolProps = ToolTriggerProps & {
  children: React.ReactNode;
  triggerClassName?: string;
};

export function ToolTrigger({
  icon,
  type,
  title,
  suffix,
  prefix,
  changes,
  className,
}: ToolTriggerProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:shrink-0 [&_svg]:opacity-70",
        className
      )}
    >
      {icon}
      <div className="flex w-[calc(100%-1.5rem)] items-center gap-1">
        <div className="opacity-70">{prefix || TOOL_PREFIXES[type]}</div>
        <div className="truncate">{title}</div>
        {changes && (
          <div className="flex items-center gap-1">
            <span className="text-green-400">+{changes.linesAdded}</span>
            <span className="text-red-400">-{changes.linesRemoved}</span>
          </div>
        )}
        {suffix && <div className="whitespace-nowrap opacity-70">{suffix}</div>}
      </div>
    </div>
  );
}

export function CollapsibleTool({
  icon,
  type,
  title,
  changes,
  children,
  className,
  triggerClassName,
  prefix,
  suffix,
}: CollapsibleToolProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <button
      onClick={() => setIsExpanded(!isExpanded)}
      className={cn(
        "text-muted-foreground hover:text-foreground hover:bg-secondary flex w-full cursor-pointer flex-col gap-2 rounded-md px-3 py-1.5 text-left text-[13px] transition-colors",
        className
      )}
    >
      <ToolTrigger
        icon={icon}
        type={type}
        title={title}
        suffix={suffix}
        prefix={prefix}
        changes={changes}
        className={triggerClassName}
      />
      {isExpanded && <div className="flex flex-col gap-2 pl-6">{children}</div>}
    </button>
  );
}
