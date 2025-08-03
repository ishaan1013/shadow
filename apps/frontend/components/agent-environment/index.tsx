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
import { AlertTriangle, ChevronDown, ChevronUp, PanelLeft } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { useCodebaseTree } from "@/hooks/use-codebase-tree";
import { useAgentEnvironment } from "./agent-environment-context";
import { LogoHover } from "../graphics/logo/logo-hover";

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
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hover:bg-sidebar-accent size-7 cursor-pointer"
                onClick={() => setIsExplorerCollapsed((prev) => !prev)}
              >
                <PanelLeft className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end">
              {isExplorerCollapsed ? "Open" : "Close"} File Explorer
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
            {isTerminalCollapsed ? (
              <div
                onClick={() => setIsTerminalCollapsed(false)}
                className="border-border bg-card flex cursor-pointer select-none items-center justify-between border-t p-1 pl-2"
              >
                <div className="text-sm">Terminal</div>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      className="hover:bg-sidebar-accent"
                    >
                      <ChevronUp className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="end" sideOffset={8}>
                    Open Terminal
                  </TooltipContent>
                </Tooltip>
              </div>
            ) : (
              <>
                <ResizableHandle className="bg-sidebar-border" />
                <ResizablePanel minSize={20} defaultSize={25}>
                  <div className="bg-sidebar flex h-full flex-col">
                    <div
                      onClick={() => setIsTerminalCollapsed(true)}
                      className="border-border flex cursor-pointer select-none items-center justify-between border-b p-1 pl-2"
                    >
                      <div className="text-sm">Terminal</div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="iconSm"
                            className="hover:bg-sidebar-accent"
                          >
                            <ChevronDown className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="end" sideOffset={8}>
                          Close Terminal
                        </TooltipContent>
                      </Tooltip>
                    </div>
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
