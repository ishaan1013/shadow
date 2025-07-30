import { useStickToBottomContext } from "use-stick-to-bottom";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { cn } from "@/lib/utils";
import { ArrowDown } from "lucide-react";

export function ScrollToBottom() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  return (
    <Tooltip disableHoverableContent={isAtBottom}>
      <TooltipTrigger asChild>
        <button
          disabled={isAtBottom}
          className={cn(
            "bg-background border-border hover:bg-accent text-muted-foreground hover:text-foreground sticky z-20 rounded-full border p-1.5 transition-all",
            isAtBottom
              ? "translate-y-2 opacity-0"
              : "translate-y-0 cursor-pointer opacity-100",
            "bottom-38"
          )}
          onClick={() => scrollToBottom()}
        >
          <ArrowDown className="size-4" />
        </button>
      </TooltipTrigger>
      {!isAtBottom && <TooltipContent>Scroll to Bottom</TooltipContent>}
    </Tooltip>
  );
}
