import { cn } from "@/lib/utils";
import { ToolType, TOOL_PREFIXES } from "@repo/types";
import { useState } from "react";

export function ToolComponent({
  icon,
  type,
  title,
  changes,
  className,
  prefix,
  suffix,
  collapsible = false,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  type: ToolType | "error";
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
    <ToolWrapper
      onClick={onClick}
      toggleExpanded={() => setIsExpanded(!isExpanded)}
      className={className}
      collapsible={collapsible}
    >
      <div
        className={cn(
          "flex items-center gap-2 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:shrink-0 [&_svg]:opacity-70",
          className
        )}
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
      </div>
      {isExpanded && <div className="flex flex-col gap-2 pl-6">{children}</div>}
    </ToolWrapper>
  );
}

const ToolWrapper = ({
  children,
  collapsible,
  className,
  onClick,
  toggleExpanded,
}: {
  children: React.ReactNode;
  collapsible: boolean;
  className?: string;
  onClick?: () => void;
  toggleExpanded: () => void;
}) => {
  if (collapsible || onClick) {
    return (
      <button
        className={cn(
          "text-muted-foreground hover:text-foreground hover:bg-secondary flex w-full cursor-pointer flex-col gap-2 rounded-md px-3 py-1.5 text-left text-[13px] transition-colors",
          className
        )}
        // If an onClick is passed in, do that instead of toggling the expanded state
        onClick={onClick ? onClick : toggleExpanded}
      >
        {children}
      </button>
    );
  }
  return (
    <div
      className={cn(
        "text-muted-foreground flex w-full flex-col gap-2 rounded-md px-3 py-1.5 text-left text-[13px]",
        className
      )}
    >
      {children}
    </div>
  );
};
