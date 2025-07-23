import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useFileChanges } from "@/hooks/use-file-changes";
import { useTask } from "@/hooks/use-task";
import { useTodos } from "@/hooks/use-todos";
import { cn } from "@/lib/utils";
import { FileChange, Task, Todo } from "@repo/db";
import {
  CircleDashed,
  File,
  FileDiff,
  Folder,
  FolderGit2,
  FolderOpen,
  GitBranch,
  ListTodo,
  Square,
  SquareCheck,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { statusColorsConfig } from "./status";

// Todo status config - aligned with main status colors
const todoStatusConfig = {
  PENDING: { icon: Square, className: "text-neutral-500" },
  IN_PROGRESS: { icon: CircleDashed, className: "text-blue-400" },
  COMPLETED: { icon: SquareCheck, className: "text-green-400" },
  CANCELLED: { icon: XCircle, className: "text-red-400" },
};

// Create file tree structure from file paths
function createFileTree(filePaths: string[]) {
  const tree: any = {};

  filePaths.forEach((filePath) => {
    const parts = filePath.split("/");
    let current = tree;

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
  const convertToArray = (obj: any): any[] => {
    return Object.values(obj)
      .sort((a: any, b: any) => {
        if (a.type !== b.type) {
          return a.type === "folder" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      })
      .map((item: any) => ({
        ...item,
        children: item.children ? convertToArray(item.children) : undefined,
      }));
  };

  return convertToArray(tree);
}

// FileNode component to handle individual file/folder nodes
function FileNode({
  node,
  depth = 0,
  fileChanges,
}: {
  node: any;
  depth?: number;
  fileChanges: any[];
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const fileChange = fileChanges.find(
    (change) => change.filePath === node.path
  );
  const operation = fileChange?.operation;

  const getOperationColor = (op: string) => {
    switch (op) {
      case "CREATE":
        return "text-green-400";
      case "UPDATE":
        return "text-blue-400";
      case "DELETE":
        return "text-red-400";
      default:
        return "text-neutral-500";
    }
  };

  const getOperationLetter = (op: string) => {
    switch (op) {
      case "CREATE":
        return "A";
      case "UPDATE":
        return "M";
      case "DELETE":
        return "D";
      case "RENAME":
        return "R";
      case "MOVE":
        return "M";
      default:
        return "?";
    }
  };

  return (
    <div key={node.path}>
      <SidebarMenuItem>
        <SidebarMenuButton
          className="justify-between"
          onClick={() => node.type === "folder" && setIsExpanded(!isExpanded)}
        >
          <div
            className="flex w-full items-center gap-1.5"
            style={{ paddingLeft: `${depth * 8}px` }}
          >
            {node.type === "folder" ? (
              isExpanded ? (
                <FolderOpen className="size-4" />
              ) : (
                <Folder className="size-4" />
              )
            ) : (
              <File className="size-4" />
            )}
            <div className="line-clamp-1 flex-1">{node.name}</div>
          </div>
          {node.type === "file" && operation && (
            <span
              className={cn(
                "text-xs font-medium",
                getOperationColor(operation)
              )}
            >
              {getOperationLetter(operation)}
            </span>
          )}
        </SidebarMenuButton>
      </SidebarMenuItem>
      {node.type === "folder" && isExpanded && node.children && (
        <div>
          {node.children.map((child: any) => (
            <FileNode
              key={child.path}
              node={child}
              depth={depth + 1}
              fileChanges={fileChanges}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function SidebarAgentView({
  taskId,
  currentTask: {
    taskData: initialTaskData,
    todos: initialTodos,
    fileChanges: initialFileChanges,
  },
}: {
  taskId: string;
  currentTask: {
    taskData: Task;
    todos: Todo[];
    fileChanges: FileChange[];
  };
}) {
  const { data: currentTask } = useTask(taskId, initialTaskData);
  const { data: todos = [] } = useTodos(taskId, initialTodos);
  const { fileChanges, diffStats } = useFileChanges(taskId, initialFileChanges);

  // Create file tree from file changes
  const modifiedFileTree = useMemo(() => {
    const filePaths = fileChanges.map((change) => change.filePath);
    return createFileTree(filePaths);
  }, [fileChanges]);

  if (!currentTask) {
    return (
      <SidebarGroup>
        <SidebarGroupLabel>Loading task...</SidebarGroupLabel>
      </SidebarGroup>
    );
  }

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          {/* Live task status */}
          <SidebarMenuItem>
            <div className="flex h-8 items-center gap-2 px-2 text-sm">
              {(() => {
                const StatusIcon =
                  statusColorsConfig[
                    currentTask.status as keyof typeof statusColorsConfig
                  ]?.icon || CircleDashed;
                const statusClass =
                  statusColorsConfig[
                    currentTask.status as keyof typeof statusColorsConfig
                  ]?.className || "text-gray-500";
                return (
                  <>
                    <StatusIcon className={cn("size-4", statusClass)} />
                    <span className="capitalize">
                      {currentTask.status.toLowerCase().replace("_", " ")}
                    </span>
                  </>
                );
              })()}
            </div>
          </SidebarMenuItem>

          {/* Task branch name */}
          <SidebarMenuItem>
            <div className="flex h-8 items-center gap-2 px-2 text-sm">
              <GitBranch className="size-4" />
              <span>{currentTask.branch}</span>
            </div>
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

      {/* Task List (Todos) */}
      {todos.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel className="hover:text-muted-foreground">
            <ListTodo className="mr-1.5 !size-3.5" />
            Task List
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {todos.map((todo) => {
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
                      "flex h-8 items-center gap-2 px-2 text-sm",
                      todo.status === "COMPLETED" &&
                        "text-muted-foreground line-through"
                    )}
                  >
                    <TodoIcon className={cn("size-4", iconClass)} />
                    <span className="line-clamp-1 flex-1">{todo.content}</span>
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
          <SidebarGroupLabel className="hover:text-muted-foreground">
            <FolderGit2 className="mr-1.5 !size-3.5" />
            Modified Files ({diffStats.totalFiles})
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {modifiedFileTree.map((node) => (
              <FileNode key={node.path} node={node} fileChanges={fileChanges} />
            ))}
          </SidebarGroupContent>
        </SidebarGroup>
      )}
    </>
  );
}
