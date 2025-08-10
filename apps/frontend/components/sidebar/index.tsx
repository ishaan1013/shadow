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
import { SidebarCodebaseView } from "./codebase-view";
import { useCodebases } from "@/hooks/use-codebases";
import { SidebarCodebase } from "@/lib/db-operations/get-codebases";
import { SidebarCodebasesListView } from "./codebases-list-view";
import { Info } from "lucide-react";

export type SidebarView =
  | "tasks"
  | "agent"
  | "codebases"
  | "codebase-understanding";

const sidebarViewLabels = {
  tasks: { label: "Tasks", tooltip: null },
  agent: { label: "Agent Environment", tooltip: null },
  codebases: {
    label: "Codebases",
    tooltip:
      "Codebase understanding wikis generated on task creation for improved LLM context",
  },
  "codebase-understanding": {
    label: "Codebase Understanding",
    tooltip: null,
  },
};

export function SidebarViews({
  initialTasks,
  initialCodebases,
  currentTaskId = null,
  currentCodebaseId = null,
}: {
  initialTasks: Task[];
  initialCodebases: SidebarCodebase[];
  // Page-specific ID fields
  currentTaskId?: string | null;
  currentCodebaseId?: string | null;
}) {
  const {
    data: tasks,
    isLoading: isLoadingTasks,
    error: tasksError,
  } = useTasks(initialTasks);

  const {
    data: codebases,
    isLoading: isLoadingCodebases,
    error: codebasesError,
  } = useCodebases(initialCodebases);

  const [sidebarView, setSidebarView] = useState<SidebarView>(
    currentTaskId
      ? "agent"
      : currentCodebaseId
        ? "codebase-understanding"
        : "tasks"
  );

  // Initial render trick to avoid hydration issues on navigation
  const isInitialRender = useRef(true);
  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      return;
    }
    console.log("currentTaskId", currentTaskId);
    console.log("currentCodebaseId", currentCodebaseId);

    if (currentTaskId) {
      setSidebarView("agent");
    } else if (currentCodebaseId) {
      setSidebarView("codebase-understanding");
    } else {
      if (sidebarView === "agent") {
        setSidebarView("tasks");
      }
    }
  }, [currentTaskId, currentCodebaseId]);

  return (
    <div className="flex">
      <SidebarNavigation
        currentTaskId={currentTaskId}
        currentCodebaseId={currentCodebaseId}
        sidebarView={sidebarView}
        setSidebarView={setSidebarView}
      />
      <Sidebar>
        <SidebarContent>
          <SidebarGroup className="flex h-7 flex-row items-center justify-between">
            <div className="flex select-none items-center gap-1.5 overflow-hidden">
              <div className="truncate font-medium">
                {sidebarViewLabels[sidebarView].label}
              </div>
              {sidebarViewLabels[sidebarView].tooltip && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="text-muted-foreground size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent
                    lighter
                    sideOffset={8}
                    side="bottom"
                    className="h-auto max-w-52"
                  >
                    {sidebarViewLabels[sidebarView].tooltip}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <SidebarTrigger className="hover:bg-sidebar-accent" />
              </TooltipTrigger>
              <TooltipContent lighter side="right" shortcut="⌘B">
                Toggle Sidebar
              </TooltipContent>
            </Tooltip>
          </SidebarGroup>
          <div className="mt-6 flex flex-col gap-4">
            {currentTaskId && sidebarView === "agent" ? (
              <SidebarAgentView taskId={currentTaskId} />
            ) : sidebarView === "codebase-understanding" ? (
              <SidebarCodebaseView codebaseId={currentCodebaseId ?? ""} />
            ) : sidebarView === "codebases" ? (
              <SidebarCodebasesListView
                codebases={codebases}
                loading={isLoadingCodebases}
                error={codebasesError}
              />
            ) : (
              <SidebarTasksView
                tasks={tasks}
                loading={isLoadingTasks}
                error={tasksError}
              />
            )}
          </div>
        </SidebarContent>
      </Sidebar>
    </div>
  );
}
