"use client";

import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsAtTop } from "@/hooks/use-is-at-top";
import { saveLayoutCookie } from "@/lib/actions/save-sidebar-cookie";
import { cn } from "@/lib/utils";
import { AppWindowMac } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import { StickToBottom, type StickToBottomContext } from "use-stick-to-bottom";
import { AgentEnvironment } from "../agent-environment";
import { TaskPageContent } from "./task-content";
import { useTask } from "@/hooks/use-task";
import { useParams } from "next/navigation";
import { useAgentEnvironment } from "../agent-environment/agent-environment-context";

export function TaskPageLayout({
  initialLayout,
}: {
  initialLayout: number[] | null;
}) {
  const { taskId } = useParams<{ taskId: string }>();
  const { open } = useSidebar();
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { task } = useTask(taskId);
  const [editValue, setEditValue] = useState(task?.title || "");

  const stickToBottomContextRef = useRef<StickToBottomContext>(null);
  const { isAtTop } = useIsAtTop(0, stickToBottomContextRef.current?.scrollRef);

  useEffect(() => {
    if (task) {
      setEditValue(task.title);
    }
  }, [task]);

  /* 
  Resizable panel state
  */

  const { rightPanelRef, lastPanelSizeRef } = useAgentEnvironment();
  const resizablePanelGroupRef = useRef<ImperativePanelGroupHandle>(null);
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  const handleLayout = useCallback((layout: number[]) => {
    // Clear existing timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Set new timeout for debounced save
    debounceTimeoutRef.current = setTimeout(() => {
      saveLayoutCookie("taskLayout", layout);
    }, 100);
  }, []);

  const getInitialSizes = () => {
    if (initialLayout && initialLayout.length >= 2) {
      return {
        leftSize: initialLayout[0],
        rightSize: initialLayout[1],
      };
    }
    return {
      leftSize: 100,
      rightSize: 0,
    };
  };

  const { leftSize, rightSize } = getInitialSizes();

  /* 
  Keyboard shortcuts
  */

  const handleToggleRightPanel = useCallback(() => {
    const panel = rightPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
      if (!lastPanelSizeRef.current) {
        panel.resize(40);
      }
    } else {
      lastPanelSizeRef.current = rightPanelRef.current?.getSize() ?? null;
      panel.collapse();
    }
  }, [rightPanelRef]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "j" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        handleToggleRightPanel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleToggleRightPanel]);

  const titleRef = useRef<HTMLDivElement>(null);

  const handleTitleClick = () => {
    setIsEditing(true);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      console.log("New task name:", editValue);
      setIsEditing(false);
    } else if (e.key === "Escape") {
      setIsEditing(false);
      setEditValue(task?.title || "");
    }
  };

  const handleInputBlur = () => {
    setIsEditing(false);
    setEditValue(task?.title || "");
  };

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  return (
    <ResizablePanelGroup
      ref={resizablePanelGroupRef}
      direction="horizontal"
      className="min-h-svh"
      onLayout={handleLayout}
    >
      <ResizablePanel minSize={30} defaultSize={leftSize}>
        <StickToBottom
          className="relative flex size-full max-h-svh flex-col overflow-y-auto"
          resize="smooth"
          initial="smooth"
          contextRef={stickToBottomContextRef}
        >
          <div className="bg-background sticky top-0 z-10 flex w-full items-center justify-between">
            <div className="flex grow items-center gap-1 overflow-hidden p-3 pr-0">
              {!open && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SidebarTrigger />
                  </TooltipTrigger>
                  <TooltipContent side="right" shortcut="⌘B">
                    {open ? "Close Sidebar" : "Open Sidebar"}
                  </TooltipContent>
                </Tooltip>
              )}
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleInputKeyDown}
                onBlur={handleInputBlur}
                style={{ width: titleRef.current?.clientWidth }}
                className={cn(
                  "focus:ring-ring/10 focus:border-border h-7 w-full items-center rounded-md border border-transparent bg-transparent px-2 focus:outline-none focus:ring-2",
                  isEditing ? "flex" : "hidden"
                )}
              />
              <div
                className={cn(
                  "hover:border-border flex h-7 cursor-text items-center truncate rounded-md border border-transparent px-2",
                  isEditing ? "pointer-events-none opacity-0" : "opacity-100"
                )}
                onClick={handleTitleClick}
                ref={titleRef}
              >
                <span className="truncate">{task?.title}</span>
              </div>
            </div>

            <div className="p-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("size-7 cursor-pointer")}
                    onClick={handleToggleRightPanel}
                  >
                    <AppWindowMac className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" shortcut="⌘J">
                  Toggle Shadow Realm
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          <TaskPageContent isAtTop={isAtTop} />
        </StickToBottom>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel
        minSize={30}
        collapsible
        collapsedSize={0}
        defaultSize={rightSize}
        ref={rightPanelRef}
      >
        <AgentEnvironment />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
