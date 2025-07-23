import { cn } from "@/lib/utils";
import { TaskStatus } from "@repo/db";
import { LayoutGrid, Play, Plus } from "lucide-react";
import Link from "next/link";
import { SidebarView } from ".";
import { SettingsDialog } from "../auth/settings-dialog";
import { UserMenu } from "../auth/user-menu";
import { Button } from "../ui/button";
import { useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { statusColorsConfig } from "./status";

export function SidebarNavigation({
  sidebarView,
  setSidebarView,
  doesCurrentTaskExist,
  currentTaskStatus,
}: {
  sidebarView: SidebarView;
  setSidebarView: (view: SidebarView) => void;
  doesCurrentTaskExist: boolean;
  currentTaskStatus: TaskStatus | null;
}) {
  const { open, toggleSidebar } = useSidebar();

  // Get status color from config, default to blue if no current task
  const statusColor = currentTaskStatus
    ? statusColorsConfig[currentTaskStatus].bg
    : "";

  const agentViewTrigger = (
    <div className="relative z-0 h-7">
      <div className="bg-card pointer-events-none absolute -top-1.5 -right-1.5 z-10 rounded-full p-1">
        <div className={cn("relative size-2 rounded-full", statusColor)}>
          <div
            className={cn(
              "absolute -top-px -left-px size-2.5 animate-ping rounded-full opacity-25",
              statusColor
            )}
          />
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="iconSm"
            variant="ghost"
            className={cn(
              "border",
              sidebarView === "agent" && open
                ? "text-foreground bg-sidebar-accent border-sidebar-border hover:bg-sidebar-border"
                : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent border-transparent"
            )}
            onClick={() => {
              setSidebarView("agent");
              if (!open) {
                toggleSidebar();
              }
            }}
          >
            <Play />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Agent View</TooltipContent>
      </Tooltip>
    </div>
  );

  return (
    <div className="bg-card flex h-svh flex-col justify-between border-r p-3">
      <div className="flex flex-col gap-7">
        <Link
          href="/"
          className="flex size-7 items-center justify-center"
          aria-label="Home"
        >
          <img src="/shadow.svg" alt="Logo" width={22} height={22} />
        </Link>
        <div className="flex flex-col gap-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="iconSm" asChild>
                <Link href="/">
                  <Plus />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">New Task</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="iconSm"
                variant="ghost"
                className={cn(
                  "border",
                  sidebarView === "tasks" && open
                    ? "text-foreground bg-sidebar-accent border-sidebar-border hover:bg-sidebar-border"
                    : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent border-transparent"
                )}
                onClick={() => {
                  setSidebarView("tasks");
                  if (!open) {
                    toggleSidebar();
                  }
                }}
              >
                <LayoutGrid />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Tasks View</TooltipContent>
          </Tooltip>

          {doesCurrentTaskExist ? (
            <>
              <div className="bg-border h-px w-full" />
              {agentViewTrigger}
            </>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <SettingsDialog />
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
        </Tooltip>
        <UserMenu />
      </div>
    </div>
  );
}
