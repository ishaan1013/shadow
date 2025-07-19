import { cn } from "@/lib/utils";
import { useState } from "react";

interface CollapsibleToolProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function CollapsibleTool({
  icon,
  title,
  children,
  className,
}: CollapsibleToolProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center cursor-pointer gap-2 w-full text-left transition-colors text-muted-foreground hover:text-foreground text-[13px] [&_svg:not([class*='size-'])]:size-3.5"
      >
        {icon}
        <span>{title}</span>
        {/* {isExpanded ? (
          <ChevronDown className="size-3 ml-auto" />
        ) : (
          <ChevronRight className="size-3 ml-auto" />
        )} */}
      </button>

      {isExpanded && <div className="pl-6 flex flex-col gap-2">{children}</div>}
    </div>
  );
}
