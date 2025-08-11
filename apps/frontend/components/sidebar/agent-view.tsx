"use client";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useTask } from "@/hooks/tasks/use-task";
import { cn } from "@/lib/utils";
import {
  CircleDashed,
  FileDiff,
  Folder,
  FolderGit2,
  GitBranch,
  BookOpen,
  ListTodo,
  RefreshCcw,
  Square,
  SquareCheck,
  SquareX,
} from "lucide-react";
import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { statusColorsConfig } from "./status";
import { FileExplorer } from "@/components/agent-environment/file-explorer";
import { FileNode } from "@repo/types";
import { useAgentEnvironment } from "@/components/agent-environment/agent-environment-context";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Badge } from "../ui/badge";
import { Card } from "../ui/card";
import { GithubLogo } from "../graphics/github/github-logo";
import { useCreatePR } from "@/hooks/chat/use-create-pr";
import { useTaskSocketContext } from "@/contexts/task-socket-context";
import { Loader2 } from "lucide-react";
import { useIndexingStatus } from "@/hooks/use-indexing-status";
import { useQueryClient } from "@tanstack/react-query";
import { fetchIndexApi } from "@/lib/actions/index-repo";
import { useUserSettings } from "@/hooks/use-user-settings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const todoStatusConfig = {
  PENDING: { icon: Square, className: "text-muted-foreground" },
  IN_PROGRESS: { icon: CircleDashed, className: "" },
  COMPLETED: { icon: SquareCheck, className: "" },
  CANCELLED: { icon: SquareX, className: "text-destructive" },
};

// Intermediate tree node structure for building the tree
interface TreeNode {
  name: string;
  type: "file" | "folder";
  path: string;
  children?: Record<string, TreeNode>;
}
type FileTree = Record<string, TreeNode>;

function createFileTree(filePaths: string[]): FileNode[] {
  const tree: FileTree = {};

  filePaths.forEach((filePath) => {
    const parts = filePath.split("/");
    let current: FileTree = tree;

    parts.forEach((part, index) => {
      if (!current[part]) {
        current[part] = {
          name: part,
          type: index === parts.length - 1 ? "file" : "folder",
          path: parts.slice(0, index + 1).join("/"),
          children: index === parts.length - 1 ? undefined : {},
        };
      }
      if (current[part].children) {
        current = current[part].children;
      }
    });
  });

  // Convert to array and sort (folders first, then files)
  const convertToArray = (obj: FileTree): FileNode[] => {
    return Object.values(obj)
      .sort((a: TreeNode, b: TreeNode) => {
        if (a.type !== b.type) {
          return a.type === "folder" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      })
      .map(
        (item: TreeNode): FileNode => ({
          name: item.name,
          type: item.type,
          path: item.path,
          children: item.children ? convertToArray(item.children) : undefined,
        })
      );
  };

  return convertToArray(tree);
}

export function SidebarAgentView({ taskId }: { taskId: string }) {
  const { task, todos, fileChanges, diffStats } = useTask(taskId);
  const { updateSelectedFilePath, openAgentEnvironment, openShadowWiki } =
    useAgentEnvironment();
  const { isStreaming, autoPRStatus } = useTaskSocketContext();
  const createPRMutation = useCreatePR();
  const queryClient = useQueryClient();

  // Use indexing status hook for unified status tracking
  const { data: indexingStatus } = useIndexingStatus(task?.repoFullName || "");
  const { data: userSettings } = useUserSettings();

  const completedTodos = useMemo(
    () => todos.filter((todo) => todo.status === "COMPLETED").length,
    [todos]
  );

  // Create file tree from file changes
  const modifiedFileTree = useMemo(() => {
    const filePaths = fileChanges.map((change) => change.filePath);
    return createFileTree(filePaths);
  }, [fileChanges]);

  if (!task) {
    return (
      <SidebarGroup>
        <SidebarGroupLabel>Loading task...</SidebarGroupLabel>
      </SidebarGroup>
    );
  }

  const handleFileSelect = useCallback(
    (file: FileNode) => {
      updateSelectedFilePath(file.path);
      openAgentEnvironment();
    },
    [openAgentEnvironment, updateSelectedFilePath]
  );

  const handleCreatePR = useCallback(async () => {
    if (!task?.id) return;
    try {
      await createPRMutation.mutateAsync(task.id);
    } catch (error) {
      console.error("Failed to create PR:", error);
    }
  }, [task?.id, createPRMutation]);

  const handleIndexRepo = useCallback(async () => {
    if (!task?.repoFullName || !task?.id) return;

    // Optimistic update - immediately show "indexing" state
    queryClient.setQueryData(["indexing-status", task.repoFullName], {
      status: "indexing",
      lastIndexedAt: null,
      lastCommitSha: null,
    });

    try {
      fetchIndexApi({
        repoFullName: task.repoFullName,
        taskId: task.id,
        clearNamespace: true,
      }).catch((error) => {
        queryClient.invalidateQueries({
          queryKey: ["indexing-status", task.repoFullName],
        });
        console.error("Indexing failed:", error);
      });
    } catch (error) {
      queryClient.invalidateQueries({
        queryKey: ["indexing-status", task.repoFullName],
      });
      console.error("Failed to start indexing:", error);
    }
  }, [task?.repoFullName, task?.id, queryClient]);

  // Determine if we should show create PR button
  const showCreatePR = !task?.pullRequestNumber && fileChanges.length > 0;
  const isAutoPRInProgress = autoPRStatus?.status === "in-progress";
  const isCreatePRDisabled =
    isStreaming || createPRMutation.isPending || isAutoPRInProgress;

  // Indexing button state logic
  const isIndexing = indexingStatus?.status === "indexing";
  const isIndexingDisabled = isIndexing;

  const getIndexingButtonText = () => {
    if (isIndexing) return "Indexing...";
    if (indexingStatus?.status === "completed") return "Re-Index Repo";
    if (indexingStatus?.status === "failed") return "Retry Indexing";
    return "Index Repo";
  };

  // Context menu state for branch name
  const [branchContextMenu, setBranchContextMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
  } | null>(null);
  const ctxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleWindowClick(e: MouseEvent) {
      // Close if clicking outside the context menu
      if (!ctxRef.current) return;
      const el = ctxRef.current;
      if (e.target && el && !el.contains(e.target as Node)) {
        setBranchContextMenu(null);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setBranchContextMenu(null);
    }
    window.addEventListener("click", handleWindowClick);
    window.addEventListener("contextmenu", handleWindowClick);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("click", handleWindowClick);
      window.removeEventListener("contextmenu", handleWindowClick);
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const onBranchContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // Show our custom menu near cursor
    setBranchContextMenu({ open: true, x: e.clientX, y: e.clientY });
  }, []);

  const copyBranchName = useCallback(async () => {
    try {
      if (task?.shadowBranch) {
        await navigator.clipboard.writeText(task.shadowBranch);
      }
    } catch (err) {
      console.error("Failed to copy branch name:", err);
    } finally {
      setBranchContextMenu(null);
    }
  }, [task?.shadowBranch]);

  return (
    <>
      {/* PR buttons - show create or view based on state */}
      {(task.pullRequestNumber || showCreatePR) &&
        task.status !== "ARCHIVED" && (
          <SidebarGroup>
            <SidebarGroupContent className="flex flex-col gap-0.5">
              <SidebarMenuItem>
                {task.pullRequestNumber ? (
                  // View PR button when PR exists
                  <Button
                    variant="secondary"
                    className="bg-sidebar-accent hover:bg-sidebar-accent/80 border-sidebar-border px-2! w-full"
                    asChild
                  >
                    <Link
                      href={`${task.repoUrl}/pull/${task.pullRequestNumber}`}
                      target="_blank"
                    >
                      <GithubLogo className="size-4 shrink-0" />
                      <div className="flex gap-1 overflow-hidden">
                        <span className="truncate">View Pull Request</span>
                        <span className="text-muted-foreground">
                          #{task.pullRequestNumber}
                        </span>
                      </div>
                    </Link>
                  </Button>
                ) : (
                  // Create PR button when file changes exist and no PR
                  <Button
                    variant="secondary"
                    className="bg-sidebar-accent hover:bg-sidebar-accent/80 border-sidebar-border px-2! w-full"
                    onClick={handleCreatePR}
                    disabled={isCreatePRDisabled}
                  >
                    {createPRMutation.isPending || isAutoPRInProgress ? (
                      <Loader2 className="size-4 shrink-0 animate-spin" />
                    ) : (
                      <GithubLogo className="size-4 shrink-0" />
                    )}
                    <span className="truncate">
                      {createPRMutation.isPending
                        ? "Creating..."
                        : isAutoPRInProgress
                          ? "Auto-Creating..."
                          : "Create Pull Request"}
                    </span>
                  </Button>
                )}
              </SidebarMenuItem>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

      <SidebarGroup>
        <SidebarGroupContent className="flex flex-col gap-0.5">
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="hover:bg-sidebar-accent px-2! w-full justify-start font-normal"
                >
                  <Folder className="size-4 shrink-0" />
                  <span className="truncate">{task.repoFullName}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="bg-sidebar-accent border-sidebar-border w-[var(--radix-dropdown-menu-trigger-width)]"
              >
                <DropdownMenuItem asChild>
                  <Link
                    href={`${task.repoUrl}`}
                    target="_blank"
                    className="hover:bg-sidebar-border!"
                  >
                    <GithubLogo className="text-foreground size-4 shrink-0" />
                    <span>Open in GitHub</span>
                  </Link>
                </DropdownMenuItem>
                {task.codebaseUnderstandingId && (
                  <DropdownMenuItem
                    className="hover:bg-sidebar-border!"
                    onClick={() => openShadowWiki()}
                  >
                    <BookOpen className="text-foreground size-4 shrink-0" />
                    <span>Shadow Wiki</span>
                  </DropdownMenuItem>
                )}
                {userSettings?.enableIndexing && (
                  <>
                    <DropdownMenuSeparator className="bg-sidebar-border" />
                    <DropdownMenuItem
                      onClick={handleIndexRepo}
                      disabled={isIndexingDisabled}
                      className="hover:bg-sidebar-border!"
                    >
                      <RefreshCcw
                        className={`text-foreground size-4 shrink-0 ${isIndexing ? "animate-spin" : ""}`}
                      />
                      <span>{getIndexingButtonText()}</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <Button
              variant="ghost"
              className="hover:bg-sidebar-accent px-2! w-full justify-start font-normal"
              asChild
              onContextMenu={onBranchContextMenu}
            >
              <Link
                href={`${task.repoUrl}/tree/${task.shadowBranch}`}
                target="_blank"
                // prevent default browser context menu when right-clicking the link
                onContextMenu={(e) => e.preventDefault()}
              >
                <GitBranch className="size-4 shrink-0" />
                <span className="truncate">{task.shadowBranch}</span>
              </Link>
            </Button>
          </SidebarMenuItem>
        </SidebarGroupContent>
      </SidebarGroup>

      {/* Custom context menu for branch name */}
      {branchContextMenu?.open && (
        <div
          ref={ctxRef}
          style={{ left: branchContextMenu.x, top: branchContextMenu.y }}
          className="fixed z-50 rounded-md border border-sidebar-border bg-sidebar-accent shadow-md"
        >
          <div
            role="menu"
            aria-label="Branch options"
            className="p-1"
          >
            <button
              onClick={copyBranchName}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-sidebar-border"
            >
              <GitBranch className="size-4 shrink-0 text-foreground" />
              <span>Copy branch name</span>
            </button>
          </div>
        </div>
      )}

      <div className="px-3">
        <div className="bg-border h-px w-full" />
      </div>

      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenuItem>
            <div className="flex h-8 items-center gap-2 px-2 text-sm">
              {(() => {
                const StatusIcon =
                  statusColorsConfig[
                    task.status as keyof typeof statusColorsConfig
                  ]?.icon || CircleDashed;
                const statusClass =
                  statusColorsConfig[
                    task.status as keyof typeof statusColorsConfig
                  ]?.className || "text-muted-foreground";
                return (
                  <>
                    <StatusIcon className={cn("size-4", statusClass)} />
                    <span className="capitalize">
                      {task.status.toLowerCase().replace("_", " ")}
                    </span>
                  </>
                );
              })()}
            </div>
          </SidebarMenuItem>

          {/* Error message for failed tasks */}
          {task.status === "FAILED" && (
            <SidebarMenuItem className="mt-2">
              <ExpandableErrorCard
                errorMessage={task.errorMessage || "Unknown error"}
              />
            </SidebarMenuItem>
          )}

          {/* Task total diff */}
          {(diffStats.additions > 0 || diffStats.deletions > 0) && (
            <SidebarMenuItem>
              <div className="flex h-8 items-center gap-2 px-2 text-sm">
                <FileDiff className="size-4" />
                <div className="flex items-center gap-1">
                  <span className="text-green-400">+{diffStats.additions}</span>
                  <span className="text-destructive">
                    -{diffStats.deletions}
                  </span>
                </div>
              </div>
            </SidebarMenuItem>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      {/* Task List (Todos) */}
      {todos.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel className="hover:text-muted-foreground select-none gap-1.5">
            <ListTodo className="!size-3.5" />
            Task List
            <Badge
              variant="secondary"
              className="bg-sidebar-accent border-sidebar-border text-muted-foreground rounded-full border px-1.5 py-0 text-[11px]"
            >
              {completedTodos}/{todos.length}
            </Badge>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {todos
              .sort((a, b) => a.sequence - b.sequence)
              .map((todo) => {
                const TodoIcon =
                  todoStatusConfig[todo.status as keyof typeof todoStatusConfig]
                    .icon;
                const iconClass =
                  todoStatusConfig[todo.status as keyof typeof todoStatusConfig]
                    .className;
                return (
                  <SidebarMenuItem key={todo.id}>
                    <div
                      className={cn(
                        "flex min-h-8 items-start gap-2 p-2 pb-0 text-sm",
                        todo.status === "COMPLETED" &&
                          "text-muted-foreground line-through"
                      )}
                    >
                      <TodoIcon className={cn("size-4", iconClass)} />
                      <span className="line-clamp-2 flex-1 leading-4">
                        {todo.content}
                      </span>
                    </div>
                  </SidebarMenuItem>
                );
              })}
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      {/* Modified Files - Only show if file changes exist */}
      {fileChanges.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel className="hover:text-muted-foreground select-none gap-1.5">
            <FolderGit2 className="!size-3.5" />
            Modified Files{" "}
            {diffStats.totalFiles > 0 && (
              <Badge
                variant="secondary"
                className="bg-sidebar-accent border-sidebar-border text-muted-foreground rounded-full border px-1.5 py-0 text-[11px]"
              >
                {diffStats.totalFiles}
              </Badge>
            )}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <FileExplorer
              isAgentEnvironment={false}
              files={modifiedFileTree}
              fileChangeOperations={fileChanges.map((fileChange) => ({
                filePath: fileChange.filePath,
                operation: fileChange.operation,
              }))}
              defaultFolderExpansion={true}
              onFileSelect={handleFileSelect}
            />
          </SidebarGroupContent>
        </SidebarGroup>
      )}
    </>
  );
}

function ExpandableErrorCard({ errorMessage }: { errorMessage: string }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <Card
      onClick={() => setIsExpanded(!isExpanded)}
      className="border-destructive/10 bg-destructive/5 max-h-96 cursor-pointer overflow-y-auto rounded-lg p-2"
    >
      <p
        className={cn(
          "text-destructive text-sm",
          isExpanded ? "line-clamp-none" : "line-clamp-4"
        )}
      >
        {errorMessage}
      </p>
    </Card>
  );
}
