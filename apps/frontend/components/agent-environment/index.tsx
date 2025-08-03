"use client";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useState, memo } from "react";
import { Editor } from "./editor";
import { FileExplorer } from "./file-explorer";
import { Button } from "../ui/button";
import { AlertTriangle, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { useCodebaseTree } from "@/hooks/use-codebase-tree";
import { useAgentEnvironment } from "./agent-environment-context";
import { LogoHover } from "../graphics/logo/logo-hover";
import { LeftPanelIcon } from "../graphics/icons/left-panel-icon";
import { LeftPanelOpenIcon } from "../graphics/icons/left-panel-open-icon";
import { BottomPanelOpenIcon } from "../graphics/icons/bottom-panel-open-icon";
import { BottomPanelIcon } from "../graphics/icons/bottom-panel-icon";

const Terminal = dynamic(() => import("./terminal"), { ssr: false });

function AgentEnvironment() {
  const [isExplorerCollapsed, setIsExplorerCollapsed] = useState(false);
  const [isTerminalCollapsed, setIsTerminalCollapsed] = useState(false);

  const params = useParams<{ taskId?: string }>();
  const taskId = params?.taskId;

  // Use context for file selection state
  const {
    selectedFilePath,
    selectedFileWithContent,
    updateSelectedFilePath,
    isLoadingContent,
    contentError,
    triggerTerminalResize,
  } = useAgentEnvironment();

  // Use the new hooks for data fetching
  const treeQuery = useCodebaseTree(taskId || "");

  // Derive UI state from query results
  const workspaceStatus = treeQuery.isLoading
    ? "loading"
    : treeQuery.isError
      ? "error"
      : treeQuery.data?.status === "initializing"
        ? "initializing"
        : "ready";

  const loadingMessage =
    treeQuery.data?.message ||
    (treeQuery.isError
      ? treeQuery.error?.message || "Failed to load workspace"
      : null);

  // Loading state UI
  if (workspaceStatus === "loading" || workspaceStatus === "initializing") {
    return (
      <div className="bg-background flex size-full max-h-svh select-none flex-col items-center justify-center gap-4 p-4 text-center">
        <div className="font-departureMono flex items-center gap-4 text-xl font-medium tracking-tighter">
          <LogoHover forceAnimate />
          {workspaceStatus === "initializing"
            ? "Initializing Shadow Realm"
            : "Loading Shadow Realm"}
        </div>
        {loadingMessage && (
          <p className="text-muted-foreground max-w-md">{loadingMessage}</p>
        )}
      </div>
    );
  }

  // Error state UI
  if (workspaceStatus === "error") {
    return (
      <div className="bg-background flex size-full max-h-svh select-none flex-col items-center justify-center gap-4 p-4 text-center">
        <div className="font-departureMono flex items-center gap-4 text-xl font-medium tracking-tighter">
          <AlertTriangle className="text-destructive size-5 shrink-0" />
          Failed to Load Workspace
        </div>
        {loadingMessage && (
          <p className="text-muted-foreground max-w-md">{loadingMessage}</p>
        )}
        <Button
          size="lg"
          onClick={() => window.location.reload()}
          variant="secondary"
          className="border-sidebar-border hover:border-sidebar-border"
        >
          Try Again
        </Button>
      </div>
    );
  }

  // Ready state - normal UI
  return (
    <div className="flex size-full max-h-svh flex-col overflow-hidden">
      <div className="border-border bg-card h-13 flex items-center justify-between border-b px-2">
        <div className="font-departureMono tracking-tight">Shadow Realm</div>
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
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-sidebar-accent size-7 cursor-pointer"
                onClick={() => setIsTerminalCollapsed((prev) => !prev)}
              >
                <X className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end">
              Close Shadow Realm
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="flex w-full grow">
        <FileExplorer
          files={treeQuery.data?.tree || []}
          onFileSelect={(file) => updateSelectedFilePath(file.path)}
          selectedFilePath={selectedFilePath}
          isCollapsed={isExplorerCollapsed}
          onToggleCollapse={() => setIsExplorerCollapsed(!isExplorerCollapsed)}
          autoExpandToSelectedPath={true}
        />
        <div className="flex-1 overflow-hidden">
          <ResizablePanelGroup
            direction="vertical"
            className="h-full"
            onLayout={triggerTerminalResize}
          >
            <ResizablePanel minSize={20} defaultSize={75}>
              <Editor
                selectedFilePath={selectedFilePath}
                selectedFileContent={selectedFileWithContent?.content || ""}
                isLoadingContent={isLoadingContent}
                contentError={contentError}
              />
            </ResizablePanel>
            {!isTerminalCollapsed && (
              <>
                <ResizableHandle className="bg-sidebar-border" />
                <ResizablePanel minSize={20} defaultSize={25}>
                  <div className="bg-background flex h-full flex-col">
                    <Terminal />
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

export const MemoizedAgentEnvironment = memo(AgentEnvironment);
