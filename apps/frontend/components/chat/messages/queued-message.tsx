import { ListEnd, X, GitBranchPlus } from "lucide-react";
import { Button } from "../../ui/button";
import { useParams } from "next/navigation";
import { useQueuedAction } from "@/hooks/chat/use-queued-action";
import { useTaskSocketContext } from "@/contexts/task-socket-context";
import { useQueryClient } from "@tanstack/react-query";

export function QueuedAction() {
  const { taskId } = useParams<{ taskId: string }>();

  const queryClient = useQueryClient();
  const { clearQueuedAction, currentVariantId } = useTaskSocketContext();
  const { data: queuedAction } = useQueuedAction(taskId, currentVariantId || "");

  if (!queuedAction) return null;

  const isStackedPR = queuedAction.type === "stacked-pr";
  const IconComponent = isStackedPR ? GitBranchPlus : ListEnd;
  const label = isStackedPR ? "Queued Branch" : "Queued Message";

  return (
    <div className="bg-card border-border animate-in fade-in absolute -top-12 left-0 flex w-full items-center justify-between gap-2 rounded-lg border py-1.5 pl-3 pr-1.5 text-sm duration-150">
      <div className="flex items-center gap-1.5 overflow-hidden">
        <IconComponent className="size-4" />
        <span className="select-none whitespace-nowrap">{label}</span>
        <span className="text-muted-foreground truncate">
          {queuedAction.message}
        </span>
      </div>
      <Button
        variant="ghost"
        size="iconXs"
        className="text-muted-foreground hover:text-foreground hover:bg-sidebar-border p-0"
        onClick={() => {
          if (currentVariantId) {
            queryClient.setQueryData(["queued-action", taskId, currentVariantId], null);
          }
          clearQueuedAction();
        }}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
