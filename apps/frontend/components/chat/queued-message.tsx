import { ListEnd, X } from "lucide-react";
import { Button } from "../ui/button";
import { useParams } from "next/navigation";
import { useQueuedMessage } from "@/hooks/use-queued-message";
import { useTaskSocket } from "@/hooks/socket";
import { useQueryClient } from "@tanstack/react-query";

export function QueuedMessage() {
  const { taskId } = useParams<{ taskId: string }>();

  const queryClient = useQueryClient();
  const { clearQueuedMessage } = useTaskSocket(taskId);
  const { data: queuedMessage } = useQueuedMessage(taskId);

  if (!queuedMessage) return null;

  return (
    <div className="bg-card border-border absolute -top-12 left-0 flex w-full items-center justify-between gap-2 rounded-lg border py-1.5 pl-3 pr-1.5 text-sm">
      <div className="flex items-center gap-1.5 overflow-hidden">
        <ListEnd className="size-4" />
        <span className="select-none">Queued</span>
        <span className="text-muted-foreground truncate">{queuedMessage}</span>
      </div>
      <Button
        variant="ghost"
        size="iconXs"
        className="text-muted-foreground hover:text-foreground hover:bg-sidebar-border p-0"
        onClick={() => {
          queryClient.setQueryData(["queued-message", taskId], null);
          clearQueuedMessage();
        }}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
