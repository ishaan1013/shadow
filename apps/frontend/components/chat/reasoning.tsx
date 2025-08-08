import { ToolTypes, type ReasoningPart } from "@repo/types";
import { ChevronDown } from "lucide-react";
import { ToolComponent } from "./tools/tool";

export function ReasoningComponent({
  part,
  isLoading = false,
  forceOpen = false,
}: {
  part: ReasoningPart;
  isLoading?: boolean;
  forceOpen?: boolean;
}) {
  return (
    <ToolComponent
      icon={<ChevronDown />}
      collapsible
      forceOpen={forceOpen}
      isLoading={isLoading}
      type={ToolTypes.REASONING}
    >
      <div className="text-muted-foreground whitespace-pre-wrap pb-1 text-sm">
        {part.text && part.text.trim().length > 0
          ? part.text
          : isLoading
            ? "Reasoning…"
            : "Reasoning completed"}
      </div>
    </ToolComponent>
  );
}

export function RedactedReasoningComponent() {
  return (
    <ToolComponent collapsible type={ToolTypes.REDACTED_REASONING}>
      <div className="text-muted-foreground whitespace-pre-wrap pb-1 text-sm">
        Reasoning content has been redacted by Anthropic.
      </div>
    </ToolComponent>
  );
}
