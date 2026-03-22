import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Task, TaskStatus } from "@repo/db";
import {
  ChevronDown,
  Folder,
  GitBranch,
  Search,
  X,
  Archive,
  Plus,
  Minus,
  ListFilter,
  Copy,
  Trash,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { statusColorsConfig, statusOrder, getDisplayStatus } from "./status";
import { getStatusText } from "@repo/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useRef, useState } from "react";
import { useDebounceCallback } from "@/lib/debounce";
import { useArchiveTask } from "@/hooks/tasks/use-archive-task";
import { useDeleteTask } from "@/hooks/tasks/use-delete-task";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { GithubLogo } from "@/components/graphics/github/github-logo";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

type TaskGroup = {
  repoName: string;
  tasks: Task[];
};

type GroupedTasks = {
  [repoUrl: string]: TaskGroup;
};

type GroupedByStatus = {
  [status: string]: {
    tasks: Task[];
  };
};

type GroupBy = "repo" | "status";
type SortBy = "newest" | "oldest" | "alphabetical";

const HIDDEN_STATUSES: TaskStatus[] = ["ARCHIVED", "FAILED"];

const FILTERABLE_STATUSES: TaskStatus[] = [
  "RUNNING",
  "COMPLETED",
  "INITIALIZING",
  "STOPPED",
  "FAILED",
  "ARCHIVED",
];

export function SidebarTasksView({
  tasks,
  loading,
  error,
}: {
  tasks: Task[];
  loading: boolean;
  error: Error | null;
}) {
  const searchFormRef = useRef<HTMLFormElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("repo");
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const [statusFilters, setStatusFilters] = useState<Set<TaskStatus>>(
    new Set()
  );
  const archiveTask = useArchiveTask();
  const deleteTask = useDeleteTask();
  const { copyToClipboard } = useCopyToClipboard();

  const compareTasks = (a: Task, b: Task) => {
    switch (sortBy) {
      case "oldest":
        return (
          new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
        );
      case "alphabetical":
        return a.title.localeCompare(b.title);
      case "newest":
      default:
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
    }
  };

  const toggleStatusFilter = (status: TaskStatus) => {
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  };

  const hasActiveFilters = statusFilters.size > 0;

  // Debounced search handler
  const debouncedSearch = useDebounceCallback((query: string) => {
    setSearchQuery(query);
  }, 300);

  // Handler for archiving tasks
  const handleArchiveTask = (taskId: string) => {
    archiveTask.mutate(taskId);
  };

  // Handler for deleting tasks
  const handleDeleteTask = (taskId: string) => {
    deleteTask.mutate(taskId);
  };

  // Handler for copying branch name
  const handleCopyBranchName = async (shadowBranch: string) => {
    const success = await copyToClipboard(shadowBranch);
    if (success) {
      toast.success("Branch name copied to clipboard");
    } else {
      toast.error("Failed to copy branch name");
    }
  };

  // Handler for copying task ID
  const handleCopyTaskId = async (taskId: string) => {
    const success = await copyToClipboard(taskId);
    if (success) {
      toast.success("Task ID copied to clipboard");
    } else {
      toast.error("Failed to copy task ID");
    }
  };

  // Handler for opening in GitHub
  const handleOpenInGithub = (repoUrl: string) => {
    window.open(repoUrl, "_blank");
  };

  // Filter tasks based on search query and status filters
  const filteredTasks = tasks
    .filter((task) => {
      // Apply status filters
      if (hasActiveFilters && !statusFilters.has(task.status as TaskStatus)) {
        return false;
      }

      if (!searchQuery.trim()) return true;

      const query = searchQuery.toLowerCase().trim();
      return (
        task.title.toLowerCase().includes(query) ||
        task.repoFullName.toLowerCase().includes(query) ||
        (task.shadowBranch &&
          task.shadowBranch.toLowerCase().includes(query)) ||
        task.status.toLowerCase().includes(query)
      );
    })
    .sort(compareTasks);

  // Group filtered tasks based on the selected grouping method
  const groupedTasks: GroupedTasks = {};
  const groupedByStatus: GroupedByStatus = {};

  if (groupBy === "repo") {
    // Group by repository
    filteredTasks.forEach((task) => {
      if (!groupedTasks[task.repoUrl]) {
        groupedTasks[task.repoUrl] = {
          repoName: task.repoFullName,
          tasks: [],
        };
      }
      groupedTasks[task.repoUrl]?.tasks.push(task);
    });

    // Sort tasks within each repo group by status priority, then by sort preference
    Object.values(groupedTasks).forEach((group) => {
      group.tasks.sort((a, b) => {
        const statusDiff = statusOrder[a.status] - statusOrder[b.status];
        if (statusDiff !== 0) return statusDiff;
        return compareTasks(a, b);
      });
    });
  } else {
    // Group by status
    filteredTasks.forEach((task) => {
      const status = task.status;
      if (!groupedByStatus[status]) {
        groupedByStatus[status] = {
          tasks: [],
        };
      }
      groupedByStatus[status]?.tasks.push(task);
    });

    // Sort tasks within each status group by sort preference
    Object.values(groupedByStatus).forEach((group) => {
      group.tasks.sort(compareTasks);
    });
  }

  // Helper function to render task item
  const renderTaskItem = (task: Task) => {
    const displayStatus = getDisplayStatus(task);
    const StatusIcon = statusColorsConfig[displayStatus].icon;
    return (
      <SidebarMenuItem key={task.id}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <SidebarMenuButton
              className="flex h-auto flex-col items-start gap-0 overflow-hidden"
              asChild
            >
              <a href={`/tasks/${task.id}`} className="w-full overflow-hidden">
                <div className="flex w-full items-center gap-1.5">
                  <div className="line-clamp-1 flex-1">{task.title}</div>
                </div>
                <div className="text-muted-foreground flex max-w-full items-center gap-1 overflow-hidden text-xs">
                  {groupBy === "repo" ? (
                    <>
                      <StatusIcon
                        className={`!size-3 shrink-0 ${statusColorsConfig[displayStatus].className}`}
                      />
                      <span className="mr-0.5 whitespace-nowrap text-xs capitalize">
                        {getStatusText(task).startsWith("Failed")
                          ? "Failed"
                          : getStatusText(task)}
                      </span>
                    </>
                  ) : (
                    <>
                      <Folder className="size-3 shrink-0" />
                      <span
                        className="mr-0.5 whitespace-nowrap"
                        title={task.repoFullName}
                      >
                        {task.repoFullName && task.repoFullName.length > 20
                          ? `${task.repoFullName.slice(0, 20)}...`
                          : task.repoFullName}
                      </span>
                    </>
                  )}
                  <GitBranch className="size-3 shrink-0" />
                  <span className="truncate" title={task.shadowBranch}>
                    {task.shadowBranch}
                  </span>
                </div>
              </a>
            </SidebarMenuButton>
          </ContextMenuTrigger>
          <ContextMenuContent className="bg-sidebar-accent border-sidebar-border">
            <ContextMenuItem
              onClick={() => handleOpenInGithub(task.repoUrl)}
              className="text-muted-foreground hover:text-foreground hover:bg-sidebar-border! h-7"
            >
              <GithubLogo className="size-3.5 text-inherit" />
              <span className="text-[13px]">Open in GitHub</span>
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => handleCopyBranchName(task.shadowBranch)}
              className="text-muted-foreground hover:text-foreground hover:bg-sidebar-border! h-7"
            >
              <GitBranch className="size-3.5 text-inherit" />
              <span className="text-[13px]">Copy Branch Name</span>
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => handleCopyTaskId(task.id)}
              className="text-muted-foreground hover:text-foreground hover:bg-sidebar-border! h-7"
            >
              <Copy className="size-3.5 text-inherit" />
              <span className="text-[13px]">Copy Task ID</span>
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => handleArchiveTask(task.id)}
              disabled={archiveTask.isPending}
              className="text-muted-foreground hover:text-foreground hover:bg-sidebar-border! h-7"
            >
              <Archive className="size-3.5 text-inherit" />
              <span className="text-[13px]">Archive Task</span>
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => handleDeleteTask(task.id)}
              disabled={deleteTask.isPending}
              className="text-destructive hover:text-destructive! hover:bg-sidebar-border! h-7"
            >
              <Trash className="size-3.5 text-inherit" />
              <span className="text-[13px]">Delete Task</span>
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </SidebarMenuItem>
    );
  };

  return (
    <>
      {/* Search and Group By Controls */}
      <SidebarGroup>
        <div className="flex gap-2">
          {/* Search Input */}
          <form ref={searchFormRef} className="relative flex-1">
            <Search className="text-muted-foreground absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
            <Input
              placeholder="Search tasks..."
              className="h-8 px-7"
              onChange={(e) => debouncedSearch(e.target.value)}
            />
            {searchQuery && (
              <Button
                type="button"
                variant="ghost"
                size="iconXs"
                className="text-muted-foreground hover:text-foreground absolute right-1 top-1/2 -translate-y-1/2 rounded p-0"
                onClick={() => {
                  setSearchQuery("");
                  searchFormRef.current?.reset();
                }}
              >
                <X className="size-3.5" />
                <span className="sr-only">Clear search</span>
              </Button>
            )}
          </form>

          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="text-muted-foreground hover:text-foreground relative"
                  >
                    <ListFilter className="size-3.5" />
                    {hasActiveFilters && (
                      <span className="bg-primary absolute -right-0.5 -top-0.5 size-1.5 rounded-full" />
                    )}
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="top" align="end" lighter>
                Filter & Sort
              </TooltipContent>
            </Tooltip>
            <PopoverContent
              align="end"
              className="bg-sidebar-accent border-sidebar-border flex w-48 select-none flex-col gap-3 p-2"
            >
              <div className="flex items-center gap-2 pl-0.5">
                <span className="text-muted-foreground flex-1 text-[13px]">
                  Group By
                </span>
                <Select
                  value={groupBy}
                  onValueChange={(value) => setGroupBy(value as GroupBy)}
                >
                  <SelectTrigger
                    data-size="sm"
                    className="bg-sidebar-accent border-sidebar-border text-muted-foreground hover:text-foreground"
                  >
                    <SelectValue className="text-[13px]" />
                  </SelectTrigger>
                  <SelectContent
                    align="end"
                    className="bg-sidebar-accent border-sidebar-border"
                  >
                    <SelectItem
                      data-size="sm"
                      value="repo"
                      className="hover:bg-sidebar-border!"
                    >
                      Repo
                    </SelectItem>
                    <SelectItem
                      data-size="sm"
                      value="status"
                      className="hover:bg-sidebar-border!"
                    >
                      Status
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2 pl-0.5">
                <span className="text-muted-foreground flex-1 text-[13px]">
                  Sort By
                </span>
                <Select
                  value={sortBy}
                  onValueChange={(value) => setSortBy(value as SortBy)}
                >
                  <SelectTrigger
                    data-size="sm"
                    className="bg-sidebar-accent border-sidebar-border text-muted-foreground hover:text-foreground"
                  >
                    <SelectValue className="text-[13px]" />
                  </SelectTrigger>
                  <SelectContent
                    align="end"
                    className="bg-sidebar-accent border-sidebar-border"
                  >
                    <SelectItem
                      data-size="sm"
                      value="newest"
                      className="hover:bg-sidebar-border!"
                    >
                      Newest
                    </SelectItem>
                    <SelectItem
                      data-size="sm"
                      value="oldest"
                      className="hover:bg-sidebar-border!"
                    >
                      Oldest
                    </SelectItem>
                    <SelectItem
                      data-size="sm"
                      value="alphabetical"
                      className="hover:bg-sidebar-border!"
                    >
                      A–Z
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="border-sidebar-border border-t pt-2">
                <div className="flex items-center justify-between pl-0.5 pb-1.5">
                  <span className="text-muted-foreground text-[13px]">
                    Status
                  </span>
                  {hasActiveFilters && (
                    <Button
                      variant="ghost"
                      size="iconXs"
                      className="text-muted-foreground hover:text-foreground h-5 w-5"
                      onClick={() => setStatusFilters(new Set())}
                    >
                      <X className="size-3" />
                    </Button>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  {FILTERABLE_STATUSES.map((status) => {
                    const config =
                      statusColorsConfig[
                        status as keyof typeof statusColorsConfig
                      ];
                    const StatusIcon = config.icon;
                    return (
                      <label
                        key={status}
                        className="hover:bg-sidebar-border flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1"
                      >
                        <Checkbox
                          checked={statusFilters.has(status)}
                          onCheckedChange={() => toggleStatusFilter(status)}
                          className="size-3.5"
                        />
                        <StatusIcon
                          className={`!size-3 ${config.className}`}
                        />
                        <span className="text-muted-foreground text-[13px] capitalize">
                          {status.toLowerCase().replaceAll("_", " ")}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Don't group by if search is active */}
          {/* {!searchQuery && (
            <div className="bg-sidebar-accent grid grid-cols-2 items-center gap-1 rounded-lg p-0.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setGroupBy("repo")}
                className={cn(
                  groupBy === "repo"
                    ? "bg-sidebar border-sidebar-border"
                    : "text-muted-foreground hover:text-foreground border-transparent hover:bg-transparent",
                  "border font-normal"
                )}
              >
                <Folder className="mr-0.5 size-3.5" />
                Repo
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setGroupBy("status")}
                className={cn(
                  groupBy === "status"
                    ? "bg-sidebar border-sidebar-border"
                    : "text-muted-foreground hover:text-foreground border-transparent hover:bg-transparent",
                  "border font-normal"
                )}
              >
                <List className="mr-0.5 size-3.5" />
                Status
              </Button>
            </div>
          )} */}
        </div>
      </SidebarGroup>

      {/* Loading State */}
      {loading && (
        <SidebarGroup>
          <SidebarGroupLabel className="text-muted-foreground hover:text-muted-foreground">
            Loading tasks...
          </SidebarGroupLabel>
        </SidebarGroup>
      )}

      {/* Error State */}
      {error && (
        <SidebarGroup>
          <SidebarGroupLabel className="text-destructive hover:text-destructive">
            Error: {error instanceof Error ? error.message : String(error)}
          </SidebarGroupLabel>
        </SidebarGroup>
      )}

      {/* Tasks grouped by repository */}
      {!loading && !error && filteredTasks.length > 0 ? (
        searchQuery ? (
          <SidebarGroup>
            <SidebarGroupContent>
              {filteredTasks.map((task) => renderTaskItem(task))}
            </SidebarGroupContent>
          </SidebarGroup>
        ) : groupBy === "repo" ? (
          Object.entries(groupedTasks).map(([repoUrl, group]) => (
            <RepoGroup
              key={repoUrl}
              repoUrl={repoUrl}
              group={group}
              renderTaskItem={renderTaskItem}
            />
          ))
        ) : groupBy === "status" ? (
          Object.entries(groupedByStatus)
            .sort(
              ([a], [b]) =>
                statusOrder[a as keyof typeof statusOrder] -
                statusOrder[b as keyof typeof statusOrder]
            )
            .map(([status, group]) => {
              const displayStatus = getDisplayStatus({ status } as Task);
              const StatusIcon = statusColorsConfig[displayStatus].icon;
              return (
                <Collapsible
                  key={status}
                  defaultOpen={true}
                  className="group/collapsible"
                >
                  <SidebarGroup>
                    <SidebarGroupLabel asChild>
                      <CollapsibleTrigger>
                        <StatusIcon
                          className={`mr-1.5 !size-3.5 ${statusColorsConfig[displayStatus].className} ${displayStatus === "INITIALIZING" ? "animation-duration-[5s] size-4 animate-spin" : ""}`}
                        />
                        <span className="capitalize">
                          {status.toLowerCase().replaceAll("_", " ")}
                        </span>
                        <ChevronDown className="ml-auto -rotate-90 opacity-70 transition-transform group-data-[state=open]/collapsible:rotate-0" />
                      </CollapsibleTrigger>
                    </SidebarGroupLabel>
                    <CollapsibleContent>
                      <SidebarGroupContent>
                        {group.tasks.map(renderTaskItem)}
                      </SidebarGroupContent>
                    </CollapsibleContent>
                  </SidebarGroup>
                </Collapsible>
              );
            })
        ) : null
      ) : null}

      {filteredTasks.length === 0 ? (
        searchQuery ? (
          <SidebarGroup>
            <SidebarGroupLabel className="text-muted-foreground hover:text-muted-foreground">
              No tasks match &quot;{searchQuery}&quot;.
            </SidebarGroupLabel>
          </SidebarGroup>
        ) : (
          <SidebarGroup>
            <SidebarGroupLabel className="text-muted-foreground hover:text-muted-foreground">
              No active tasks.
            </SidebarGroupLabel>
          </SidebarGroup>
        )
      ) : null}
    </>
  );
}

function RepoGroup({
  repoUrl,
  group,
  renderTaskItem,
}: {
  repoUrl: string;
  group: TaskGroup;
  renderTaskItem: (task: Task) => React.ReactNode;
}) {
  const displayTasks = group.tasks.filter(
    (task) => !HIDDEN_STATUSES.includes(task.status as TaskStatus)
  );
  const numHiddenTasks = group.tasks.length - displayTasks.length;

  const [isArchivedTasksOpen, setIsArchivedTasksOpen] = useState(false);

  return (
    <Collapsible key={repoUrl} defaultOpen={true} className="group/collapsible">
      <SidebarGroup>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger>
            <Folder className="mr-1.5 !size-3.5" />
            {group.repoName}
            <ChevronDown className="ml-auto -rotate-90 opacity-70 transition-transform group-data-[state=open]/collapsible:rotate-0" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>
            {isArchivedTasksOpen
              ? group.tasks.map(renderTaskItem)
              : displayTasks.map(renderTaskItem)}
          </SidebarGroupContent>
          {numHiddenTasks > 0 && (
            <SidebarMenuItem>
              <SidebarMenuButton
                className="text-muted-foreground flex h-7 cursor-pointer items-center gap-1.5 py-0 text-[13px]"
                onClick={() => setIsArchivedTasksOpen((prev) => !prev)}
              >
                {isArchivedTasksOpen ? (
                  <Minus className="!size-3" />
                ) : (
                  <Plus className="!size-3" />
                )}
                <div className="line-clamp-1 flex-1">
                  {numHiddenTasks} Hidden Task
                  {numHiddenTasks > 1 ? "s" : ""}
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
