import { cn } from "@/lib/utils";
import type { Message, ToolStatusType } from "@repo/types";
import { CheckIcon, Loader, Terminal, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { CollapsibleTool } from "./collapsible-tool";

interface TerminalOutputProps {
  output: string;
  isRunning: boolean;
  error?: string;
}

function TerminalOutput({ output, isRunning, error }: TerminalOutputProps) {
  const terminalRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when output changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [output, error]);

  const displayText =
    error || output || (isRunning ? "Executing command..." : "No output");

  return (
    <div
      ref={terminalRef}
      className={cn(
        "relative bg-black/90 rounded-md p-3 font-mono text-xs max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent",
        error && "border border-red-500/20"
      )}
    >
      <div className="text-gray-300 whitespace-pre-wrap">
        {error && <div className="text-red-400 mb-2">Error: {error}</div>}
        {displayText.split("\n").map((line, i) => (
          <div key={i} className="min-h-[1rem]">
            {line || "\u00A0"}
          </div>
        ))}
        {isRunning && (
          <div className="inline-flex items-center gap-1 text-blue-400 animate-pulse">
            <div className="w-2 h-3 bg-blue-400 animate-pulse" />
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ToolStatusType }) {
  const config = {
    RUNNING: {
      icon: Loader,
      className: "text-blue-500 bg-blue-500/10 border-blue-500/20",
      text: "Running",
    },
    COMPLETED: {
      icon: CheckIcon,
      className: "text-green-500 bg-green-500/10 border-green-500/20",
      text: "Success",
    },
    FAILED: {
      icon: X,
      className: "text-red-500 bg-red-500/10 border-red-500/20",
      text: "Error",
    },
  };

  const { icon: Icon, className, text } = config[status];

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border",
        className
      )}
    >
      <Icon className="size-3" />
      {text}
    </div>
  );
}

export function RunTerminalCmdTool({ message }: { message: Message }) {
  const toolMeta = message.metadata?.tool;
  if (!toolMeta) return null;

  const { args, status, result, error } = toolMeta;
  const command = args.command as string;
  const isBackground = args.is_background as boolean;

  return (
    <CollapsibleTool
      icon={<Terminal />}
      title={`Terminal Command${isBackground ? " (Background)" : ""}`}
    >
      <div className="flex items-center gap-2">
        <StatusBadge status={status} />
      </div>

      {/* Command display */}
      <div className="bg-gray-100 dark:bg-gray-800/50 rounded-md p-3 border">
        <div className="text-xs text-muted-foreground mb-1">Command:</div>
        <code className="text-sm font-mono text-foreground break-all">
          {command}
        </code>
      </div>

      {/* Terminal output */}
      {(result || error || status === "RUNNING") && (
        <div>
          <div className="text-xs text-muted-foreground mb-2">Output:</div>
          <TerminalOutput
            output={result || ""}
            isRunning={status === "RUNNING"}
            error={error}
          />
        </div>
      )}
    </CollapsibleTool>
  );
}
