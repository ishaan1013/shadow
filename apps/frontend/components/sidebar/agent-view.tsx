"use client";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useTask } from "@/hooks/use-task";
import { cn } from "@/lib/utils";
import {
  CircleDashed,
  FileDiff,
  Folder,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  ListTodo,
  RefreshCcw,
  Square,
  SquareCheck,
  SquareX,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { statusColorsConfig } from "./status";
import { FileExplorer } from "@/components/agent-environment/file-explorer";
import { FileNode } from "@repo/types";
import { useAgentEnvironment } from "@/components/agent-environment/agent-environment-context";
import { Button } from "@/components/ui/button";
import { fetchIndexApi } from "@/lib/actions/index-repo";
import Link from "next/link";
import { Badge } from "../ui/badge";

const todoStatusConfig = {
  PENDING: { icon: Square, className: "text-muted-foreground" },
  IN_PROGRESS: { icon: CircleDashed, className: "" },
  COMPLETED: { icon: SquareCheck, className: "" },
  CANCELLED: { icon: SquareX, className: "text-red-400" },
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
  const { updateSelectedFilePath, expandRightPanel } = useAgentEnvironment();

  const [isIndexing, setIsIndexing] = useState(false);

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
      expandRightPanel();
    },
    [expandRightPanel, updateSelectedFilePath]
  );

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent className="flex flex-col gap-0.5">
          <SidebarMenuItem>
            <Button
              variant="ghost"
              className="hover:bg-sidebar-accent px-2! w-full justify-start font-normal"
              asChild
            >
              <Link href={`${task.repoUrl}`} target="_blank">
                <Folder className="size-4 shrink-0" />
                <span className="truncate">{task.repoFullName}</span>
              </Link>
            </Button>
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

          {/* View PR button - only show if PR exists */}
          {task.pullRequestNumber && (
            <SidebarMenuItem>
              <Button
                variant="ghost"
                className="hover:bg-sidebar-accent px-2! w-full justify-start font-normal"
                asChild
              >
                <Link
                  href={`${task.repoUrl}/pull/${task.pullRequestNumber}`}
                  target="_blank"
                >
                  <GitPullRequest className="size-4 shrink-0" />
                  <span className="truncate">View PR #{task.pullRequestNumber}</span>
                </Link>
              </Button>
            </SidebarMenuItem>
          )}

          <SidebarMenuItem>
            <Button
              variant="ghost"
              className="hover:bg-sidebar-accent px-2! w-full justify-start font-normal"
              asChild
            >
              <Link
                href={`${task.repoUrl}/tree/${task.shadowBranch}`}
                target="_blank"
              >
                <GitBranch className="size-4 shrink-0" />
                <span className="truncate">{task.shadowBranch}</span>
              </Link>
            </Button>
          </SidebarMenuItem>

          {/* Task total diff */}
          {diffStats.totalFiles > 0 && (
            <SidebarMenuItem>
              <div className="flex h-8 items-center gap-2 px-2 text-sm">
                <FileDiff className="size-4" />
                <div className="flex items-center gap-1">
                  <span className="text-green-400">+{diffStats.additions}</span>
                  <span className="text-red-400">-{diffStats.deletions}</span>
                </div>
              </div>
            </SidebarMenuItem>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenuItem>
            <Button
              variant="ghost"
              className="hover:bg-sidebar-accent px-2! w-full justify-start font-normal"
              onClick={async () => {
                setIsIndexing(true);
                try {
                  await fetchIndexApi({
                    repoFullName: task.repoFullName,
                    taskId: task.id,
                    clearNamespace: true,
                  });
                } finally {
                  setIsIndexing(false);
                }
              }}
            >
              <RefreshCcw className="size-4 shrink-0" />
              <span>{isIndexing ? "Indexing..." : "Index Repo"}</span>
            </Button>
          </SidebarMenuItem>
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
            <Badge
              variant="secondary"
              className="bg-sidebar-accent border-sidebar-border text-muted-foreground rounded-full border px-1.5 py-0 text-[11px]"
            >
              {diffStats.totalFiles}
            </Badge>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <FileExplorer
              files={modifiedFileTree}
              showDiffOperation={true}
              fileChanges={fileChanges}
              defaultExpanded={true}
              onFileSelect={handleFileSelect}
            />
          </SidebarGroupContent>
        </SidebarGroup>
      )}
    </>
  );
}
