"use client";

import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { saveLayoutCookie } from "@/lib/actions/save-sidebar-cookie";
import { cn } from "@/lib/utils";
import { AppWindowMac } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import type {
  ImperativePanelGroupHandle,
  ImperativePanelHandle,
} from "react-resizable-panels";
import { AgentEnvironment } from "../agent-environment";

export function TaskLayoutContent({
  children,
  initialLayout,
}: {
  children: React.ReactNode;
  initialLayout?: number[];
}) {
  const rightPanelRef = useRef<ImperativePanelHandle>(null);
  const resizablePanelGroupRef = useRef<ImperativePanelGroupHandle>(null);
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

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

  // Add keyboard shortcut for toggling agent environment
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

  // Calculate initial sizes based on saved layout or defaults
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

  return (
    <ResizablePanelGroup
      ref={resizablePanelGroupRef}
      direction="horizontal"
      className="min-h-svh"
      onLayout={handleLayout}
    >
      <ResizablePanel minSize={30} defaultSize={leftSize}>
        <div className="flex size-full overflow-y-auto max-h-svh flex-col relative">
          <div className="flex w-full items-center justify-between p-3 sticky top-0 bg-background z-10">
            <Tooltip>
              <TooltipTrigger asChild>
                <SidebarTrigger />
              </TooltipTrigger>
              <TooltipContent side="right" shortcut="⌘B">
                Toggle Sidebar
              </TooltipContent>
            </Tooltip>

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
          {children}
        </div>
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
