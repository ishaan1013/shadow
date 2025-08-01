import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Task } from "@repo/db";
import { ChevronDown, Folder, GitBranch, Search, X, List } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { statusColorsConfig, statusOrder, getDisplayStatus } from "./status";
import { getStatusText } from "@repo/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useRef, useState } from "react";
import { useDebounceCallback } from "@/lib/debounce";

type GroupedTasks = {
  [repoUrl: string]: {
    repoName: string;
    tasks: Task[];
  };
};

type GroupedByStatus = {
  [status: string]: {
    tasks: Task[];
  };
};

type GroupBy = "repo" | "status";

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

  // Debounced search handler
  const debouncedSearch = useDebounceCallback((query: string) => {
    setSearchQuery(query);
  }, 300);

  // Filter tasks based on search query
  const filteredTasks = tasks
    .filter((task) => {
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
    // Sort by updated date (most recent first)
    .sort((a, b) => {
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

  // Group filtered tasks based on the selected grouping method
  const groupedTasks: GroupedTasks = {};
  const groupedByStatus: GroupedByStatus = {};

  if (groupBy === "repo") {
    // Group by repository
    tasks.forEach((task) => {
      if (!groupedTasks[task.repoUrl]) {
        groupedTasks[task.repoUrl] = {
          repoName: task.repoFullName,
          tasks: [],
        };
      }
      groupedTasks[task.repoUrl]?.tasks.push(task);
    });

    // Sort tasks within each repo group by status priority, then by updated date
    Object.values(groupedTasks).forEach((group) => {
      group.tasks.sort((a, b) => {
        const statusDiff = statusOrder[a.status] - statusOrder[b.status];
        if (statusDiff !== 0) return statusDiff;
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      });
    });
  } else {
    // Group by status
    tasks.forEach((task) => {
      const status = task.status;
      if (!groupedByStatus[status]) {
        groupedByStatus[status] = {
          tasks: [],
        };
      }
      groupedByStatus[status]?.tasks.push(task);
    });

    // Sort tasks within each status group by updated date (most recent first)
    Object.values(groupedByStatus).forEach((group) => {
      group.tasks.sort((a, b) => {
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      });
    });
  }

  // Helper function to render task item
  const renderTaskItem = (task: Task) => {
    const displayStatus = getDisplayStatus(task);
    const StatusIcon = statusColorsConfig[displayStatus].icon;
    return (
      <SidebarMenuItem key={task.id}>
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
                  <span className="mr-0.5 text-xs capitalize">
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
      </SidebarMenuItem>
    );
  };

  return (
    <>
      {/* Search and Group By Controls */}
      <SidebarGroup>
        <div className="space-y-2">
          {/* Search Input */}
          <form ref={searchFormRef} className="relative">
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

          {/* Don't group by if search is active */}
          {!searchQuery && (
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
          )}
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
          <SidebarGroupLabel className="text-red-400 hover:text-red-400">
            Error: {error instanceof Error ? error.message : String(error)}
          </SidebarGroupLabel>
        </SidebarGroup>
      )}

      {/* Tasks grouped by repository */}
      {!loading && !error ? (
        searchQuery && filteredTasks.length > 0 ? (
          <SidebarGroup>
            <SidebarGroupContent>
              {filteredTasks.map((task) => renderTaskItem(task))}
            </SidebarGroupContent>
          </SidebarGroup>
        ) : groupBy === "repo" ? (
          Object.entries(groupedTasks).map(([repoUrl, group]) => (
            <Collapsible
              key={repoUrl}
              defaultOpen={true}
              className="group/collapsible"
            >
              <SidebarGroup>
                <SidebarGroupLabel asChild>
                  <CollapsibleTrigger>
                    <Folder className="mr-1.5 !size-3.5" />
                    {group.repoName}
                    <ChevronDown className="ml-auto -rotate-90 transition-transform group-data-[state=open]/collapsible:rotate-0" />
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    {group.tasks.map(renderTaskItem)}
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
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
                          className={`mr-1.5 !size-3.5 ${statusColorsConfig[displayStatus].className}`}
                        />
                        <span className="capitalize">
                          {status.toLowerCase().replaceAll("_", " ")}
                        </span>
                        <ChevronDown className="ml-auto -rotate-90 transition-transform group-data-[state=open]/collapsible:rotate-0" />
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
