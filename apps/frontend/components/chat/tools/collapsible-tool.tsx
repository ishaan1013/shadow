import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ToolTypes, TOOL_PREFIXES } from "@repo/types";
import { ChevronRight, CornerDownRight, Expand } from "lucide-react";
import { useState } from "react";

export function ToolComponent({
  icon,
  type,
  title,
  changes,
  prefix,
  suffix,
  collapsible = false,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  type: ToolTypes | "error";
  title: string;
  suffix?: string;
  prefix?: string;
  changes?: {
    linesAdded: number;
    linesRemoved: number;
  };
  className?: string;
  collapsible?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      <ToolWrapper
        collapsible={collapsible}
        onClick={onClick}
        isExpanded={isExpanded}
        toggleExpanded={() => setIsExpanded(!isExpanded)}
      >
        {icon}
        <div className="flex w-[calc(100%-1.5rem)] items-center gap-1">
          {type !== "error" && (
            <div className="whitespace-nowrap opacity-70">
              {prefix || TOOL_PREFIXES[type]}
            </div>
          )}
          <div
            className={cn("truncate", type === "error" && "text-destructive")}
          >
            {title}
          </div>
          {changes && (
            <div className="flex items-center gap-1">
              <span className="text-green-400">+{changes.linesAdded}</span>
              <span className="text-red-400">-{changes.linesRemoved}</span>
            </div>
          )}
          {suffix && (
            <div className="whitespace-nowrap opacity-70">{suffix}</div>
          )}
        </div>
      </ToolWrapper>
      {isExpanded && (
        <div className="flex w-full items-start overflow-hidden">
          <div className="h-4.5 flex w-6 shrink-0 items-center justify-end">
            <CornerDownRight className="size-3" />
          </div>
          <div className="flex grow flex-col gap-2 overflow-hidden pl-2 text-[13px]">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

const ToolWrapper = ({
  children,
  collapsible,
  className,
  onClick,
  toggleExpanded,
  isExpanded,
}: {
  children: React.ReactNode;
  collapsible: boolean;
  className?: string;
  onClick?: () => void;
  isExpanded: boolean;
  toggleExpanded: () => void;
}) => {
  if (collapsible || onClick) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className={cn(
          "text-muted-foreground hover:text-foreground group/tool w-full justify-between gap-2 overflow-hidden text-[13px] font-normal [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:shrink-0 [&_svg]:opacity-70",
          className
        )}
        // If an onClick is passed in, do that instead of toggling the expanded state
        onClick={onClick ? onClick : toggleExpanded}
      >
        <div className="flex grow items-center gap-2 overflow-hidden">
          {children}
        </div>
        {collapsible ? (
          <ChevronRight
            className={cn(
              "opacity-0! group-hover/tool:opacity-100! text-muted-foreground size-3.5 shrink-0 rotate-0 transition-all",
              isExpanded && "rotate-90"
            )}
          />
        ) : (
          <Expand className="opacity-0! group-hover/tool:opacity-100! text-muted-foreground size-3.5 shrink-0 transition-all" />
        )}
      </Button>
    );
  }
  return (
    <div
      className={cn(
        "text-muted-foreground flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[13px] [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:shrink-0 [&_svg]:opacity-70",
        className
      )}
    >
      {children}
    </div>
  );
};
