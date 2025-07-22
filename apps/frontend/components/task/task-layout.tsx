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

import { saveLayoutCookie } from "@/lib/actions/save-sidebar-cookie";
import { cn } from "@/lib/utils";
import { AppWindowMac } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ImperativePanelGroupHandle,
  ImperativePanelHandle,
} from "react-resizable-panels";
import { StickToBottom, type StickToBottomContext } from "use-stick-to-bottom";
import { AgentEnvironment } from "../agent-environment";
import { TaskPageContent } from "./task-content";

export function TaskPageLayout({
  initialLayout,
  taskTitle,
}: {
  initialLayout?: number[];
  taskTitle: string | null;
}) {
  const { open } = useSidebar();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(taskTitle || "");
  const inputRef = useRef<HTMLInputElement>(null);

  const stickToBottomContextRef = useRef<StickToBottomContext>(null);

  /* 
  Resizable panel state
  */

  const rightPanelRef = useRef<ImperativePanelHandle>(null);
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
      resizablePanelGroupRef.current?.setLayout([40, 60]);
    } else {
      panel.collapse();
    }
  }, [rightPanelRef]);

  useEffect(() => {
    console.log("rightPanelRef", rightPanelRef.current);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "j" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        handleToggleRightPanel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleToggleRightPanel]);

  const handleTitleClick = () => {
    setIsEditing(true);
    setEditValue(taskTitle || "");
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      console.log("New task name:", editValue);
      setIsEditing(false);
    } else if (e.key === "Escape") {
      setIsEditing(false);
      setEditValue(taskTitle || "");
    }
  };

  const handleInputBlur = () => {
    setIsEditing(false);
    setEditValue(taskTitle || "");
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
          <div className="bg-background sticky top-0 z-10 flex w-full items-center justify-between p-3">
            <div className="flex items-center gap-1">
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
              {isEditing ? (
                <input
                  ref={inputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  onBlur={handleInputBlur}
                  className="focus:ring-ring/10 focus:border-border flex h-7 max-w-48 items-center rounded-md border border-transparent bg-transparent px-2 focus:ring-2 focus:outline-none"
                />
              ) : (
                <div
                  className="hover:border-border flex h-7 max-w-48 cursor-text items-center rounded-md border border-transparent px-2"
                  onClick={handleTitleClick}
                >
                  <span className="truncate">{taskTitle}</span>
                </div>
              )}
            </div>

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
                Toggle Agent Environment
              </TooltipContent>
            </Tooltip>
          </div>
          <TaskPageContent />
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
