"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTasks } from "@/hooks/use-tasks";
import { Task } from "@repo/db";
import { useEffect, useRef, useState } from "react";
import { SidebarAgentView } from "./agent-view";
import { SidebarNavigation } from "./navigation";
import { SidebarTasksView } from "./tasks-view";

export type SidebarView = "tasks" | "agent";

export function SidebarViews({
  initialTasks,
  currentTaskId = null,
}: {
  initialTasks: Task[];
  currentTaskId?: string | null;
}) {
  const { data: tasks, isLoading: loading, error } = useTasks(initialTasks);

  const [sidebarView, setSidebarView] = useState<SidebarView>(
    currentTaskId ? "agent" : "tasks"
  );

  // Initial render trick to avoid hydration issues on navigation
  const isInitialRender = useRef(true);

  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      return;
    }
    if (currentTaskId) {
      setSidebarView("agent");
    } else {
      setSidebarView("tasks");
    }
  }, [currentTaskId]);

  return (
    <div className="flex">
      <SidebarNavigation
        currentTaskId={currentTaskId}
        sidebarView={sidebarView}
        setSidebarView={setSidebarView}
      />
      <Sidebar>
        <SidebarContent>
          <SidebarGroup className="flex h-7 flex-row items-center justify-between">
            <div className="font-medium">
              {sidebarView === "tasks" ? "Tasks" : "Agent Environment"}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <SidebarTrigger className="hover:bg-sidebar-accent" />
              </TooltipTrigger>
              <TooltipContent side="right" shortcut="⌘B">
                Toggle Sidebar
              </TooltipContent>
            </Tooltip>
          </SidebarGroup>
          <div className="mt-6 flex flex-col gap-4">
            {currentTaskId && sidebarView === "agent" ? (
              <SidebarAgentView taskId={currentTaskId} />
            ) : (
              <SidebarTasksView tasks={tasks} loading={loading} error={error} />
            )}
          </div>
        </SidebarContent>
      </Sidebar>
    </div>
  );
}
