"use client";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useState, memo, useCallback } from "react";
import { Editor } from "./editor";
import { FileExplorer } from "./file-explorer";
import { Button } from "../ui/button";
import { AlertTriangle, TerminalSquare, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { useFileTree } from "@/hooks/agent-environment/use-file-tree";
import { useAgentEnvironment } from "./agent-environment-context";
import { LogoHover } from "../graphics/logo/logo-hover";
import { LeftPanelIcon } from "../graphics/icons/left-panel-icon";
import { LeftPanelOpenIcon } from "../graphics/icons/left-panel-open-icon";
import { BottomPanelOpenIcon } from "../graphics/icons/bottom-panel-open-icon";
import { BottomPanelIcon } from "../graphics/icons/bottom-panel-icon";
import { Close as SheetPrimitiveClose } from "@radix-ui/react-dialog";
import { useTaskStatus } from "@/hooks/tasks/use-task-status";
import { SheetTitle } from "../ui/sheet";
import { useTaskSocketContext } from "@/contexts/task-socket-context";

const Terminal = dynamic(() => import("./terminal"), { ssr: false });

function AgentEnvironment({
  isSheetOverlay = false,
}: {
  isSheetOverlay?: boolean;
}) {
  const [isExplorerCollapsed, setIsExplorerCollapsed] = useState(false);
  const [isTerminalCollapsed, setIsTerminalCollapsed] = useState(true);

  const { taskId } = useParams<{ taskId: string }>();

  // Use context for file selection state
  const {
    rightPanelRef,
    selectedFilePath,
    selectedFileWithContent,
    updateSelectedFilePath,
    isLoadingContent,
    contentError,
    triggerTerminalResize,
    shouldUseSheet,
  } = useAgentEnvironment();

  const { currentVariantId } = useTaskSocketContext();
  const { data: treeData, error: treeError } = useFileTree(taskId, currentVariantId);
  const { data } = useTaskStatus(taskId);
  const { status, initStatus } = data || {};
  const isLoading = status === "INITIALIZING";
  const isWorkspaceInactive = initStatus === "INACTIVE";

  const handleClose = useCallback(() => {
    if (rightPanelRef.current) {
      const panel = rightPanelRef.current;
      panel.collapse();
    }
  }, [rightPanelRef]);

  // Loading state UI
  if (isLoading) {
    return (
      <EmptyStateWrapper onClose={handleClose} isSheetOverlay={isSheetOverlay}>
        <div className="font-departureMono flex items-center gap-4 text-xl font-medium tracking-tighter">
          <LogoHover forceAnimate />
          Initializing Shadow Realm...
        </div>
      </EmptyStateWrapper>
    );
  }

  if (isWorkspaceInactive) {
    return (
      <EmptyStateWrapper onClose={handleClose} isSheetOverlay={isSheetOverlay}>
        <div className="font-departureMono flex items-center gap-4 text-xl font-medium tracking-tighter">
          <LogoHover />
          Workspace Inactive.
        </div>
      </EmptyStateWrapper>
    );
  }

  // Error state UI
  if (treeError) {
    return (
      <EmptyStateWrapper onClose={handleClose} isSheetOverlay={isSheetOverlay}>
        <div className="font-departureMono flex items-center gap-4 text-xl font-medium tracking-tighter">
          <AlertTriangle className="text-destructive size-5 shrink-0" />
          Failed to Load Workspace
        </div>
        <Button
          size="lg"
          onClick={() => window.location.reload()}
          variant="secondary"
          className="border-sidebar-border hover:border-sidebar-border"
        >
          Try Again
        </Button>
      </EmptyStateWrapper>
    );
  }

  // Ready state - normal UI
  return (
    <div className="flex size-full h-svh flex-col overflow-hidden">
      <div className="border-border bg-card h-13 flex shrink-0 items-center justify-between border-b px-2">
        {shouldUseSheet ? (
          <SheetTitle className="font-departureMono font-normal tracking-tight">
            Shadow Realm
          </SheetTitle>
        ) : (
          <div className="font-departureMono font-normal tracking-tight">
            Shadow Realm
          </div>
        )}
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-sidebar-accent size-7 cursor-pointer"
                onClick={() => setIsExplorerCollapsed((prev) => !prev)}
              >
                {isExplorerCollapsed ? (
                  <LeftPanelIcon className="size-4" />
                ) : (
                  <LeftPanelOpenIcon className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end">
              {isExplorerCollapsed ? "Open" : "Close"} File Explorer
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-sidebar-accent size-7 cursor-pointer"
                onClick={() => setIsTerminalCollapsed((prev) => !prev)}
              >
                {isTerminalCollapsed ? (
                  <BottomPanelIcon className="size-4" />
                ) : (
                  <BottomPanelOpenIcon className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end">
              {isTerminalCollapsed ? "Open" : "Close"} Terminal
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              {isSheetOverlay ? (
                <SheetPrimitiveClose asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hover:bg-sidebar-accent size-7 cursor-pointer"
                    onClick={handleClose}
                  >
                    <X className="size-4" />
                  </Button>
                </SheetPrimitiveClose>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="hover:bg-sidebar-accent size-7 cursor-pointer"
                  onClick={handleClose}
                >
                  <X className="size-4" />
                </Button>
              )}
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end">
              Close Shadow Realm
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="@container/agent-environment flex w-full grow overflow-hidden">
        <FileExplorer
          isAgentEnvironment={true}
          files={treeData?.tree || []}
          onFileSelect={(file) => updateSelectedFilePath(file.path)}
          selectedFilePath={selectedFilePath}
          isCollapsed={isExplorerCollapsed}
          onToggleCollapse={() => setIsExplorerCollapsed(!isExplorerCollapsed)}
        />
        <div className="flex-1 overflow-hidden">
          <ResizablePanelGroup
            direction="vertical"
            className="h-full"
            onLayout={triggerTerminalResize}
          >
            <ResizablePanel minSize={30} defaultSize={100}>
              <Editor
                selectedFilePath={selectedFilePath}
                selectedFileContent={selectedFileWithContent?.content || ""}
                isLoadingContent={isLoadingContent}
                contentError={contentError}
              />
            </ResizablePanel>
            {isTerminalCollapsed ? (
              <button
                onClick={() => setIsTerminalCollapsed(false)}
                className="text-muted-foreground hover:text-foreground hover:bg-card hover:border-t-sidebar-border flex h-9 w-full cursor-n-resize items-center justify-start gap-2 border-t px-2 text-sm transition-all"
              >
                <TerminalSquare className="size-4 opacity-70" />
                Terminal
              </button>
            ) : (
              <>
                <ResizableHandle className="bg-sidebar-border" />
                <ResizablePanel minSize={20} defaultSize={0}>
                  <div className="bg-background flex h-full flex-col">
                    <Terminal
                      handleCollapse={() => setIsTerminalCollapsed(true)}
                    />
                  </div>
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>
      </div>
    </div>
  );
}

function EmptyStateWrapper({
  children,
  onClose,
  isSheetOverlay,
}: {
  children: React.ReactNode;
  onClose: () => void;
  isSheetOverlay: boolean;
}) {
  return (
    <div className="relative flex size-full max-h-svh select-none flex-col items-center justify-center gap-4 p-4 text-center">
      <Tooltip>
        <TooltipTrigger asChild>
          {isSheetOverlay ? (
            <SheetPrimitiveClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-sidebar-accent absolute right-2 top-2 size-7 cursor-pointer"
                onClick={onClose}
              >
                <X className="size-4" />
              </Button>
            </SheetPrimitiveClose>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="hover:bg-sidebar-accent absolute right-2 top-2 size-7 cursor-pointer"
              onClick={onClose}
            >
              <X className="size-4" />
            </Button>
          )}
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          Close Shadow Realm
        </TooltipContent>
      </Tooltip>
      {children}
    </div>
  );
}

export const MemoizedAgentEnvironment = memo(AgentEnvironment);
