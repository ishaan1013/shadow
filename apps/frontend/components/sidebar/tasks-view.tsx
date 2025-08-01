import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Task } from "@repo/db";
import { ChevronDown, Folder, GitBranch, Search, X, List } from "lucide-react";
import { truncateBranchName } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { statusColorsConfig, statusOrder, getDisplayStatus } from "./status";
import { getStatusText } from "@repo/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";
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
  const [searchQuery, setSearchQuery] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("repo");

  // Debounced search handler
  const debouncedSearch = useDebounceCallback((query: string) => {
    setSearchQuery(query);
  }, 300);

  // Filter tasks based on search query
  const filteredTasks = tasks.filter((task) => {
    if (!searchQuery.trim()) return true;
    
    const query = searchQuery.toLowerCase().trim();
    return (
      task.title.toLowerCase().includes(query) ||
      task.repoFullName.toLowerCase().includes(query) ||
      task.baseBranch.toLowerCase().includes(query) ||
      (task.shadowBranch && task.shadowBranch.toLowerCase().includes(query)) ||
      task.status.toLowerCase().includes(query)
    );
  });

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

    // Sort tasks within each repo group by status priority, then by updated date
    Object.values(groupedTasks).forEach((group) => {
      group.tasks.sort((a, b) => {
        const statusDiff = statusOrder[a.status] - statusOrder[b.status];
        if (statusDiff !== 0) return statusDiff;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
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

    // Sort tasks within each status group by updated date (most recent first)
    Object.values(groupedByStatus).forEach((group) => {
      group.tasks.sort((a, b) => {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
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
          className="flex h-auto flex-col items-start gap-0"
          asChild
        >
          <a href={`/tasks/${task.id}`}>
            <div className="flex w-full items-center gap-1.5">
              <div className="line-clamp-1 flex-1">
                {task.title}
              </div>
            </div>
            <div className="text-muted-foreground flex items-center gap-1 text-xs">
              <StatusIcon
                className={`!size-3 shrink-0 ${statusColorsConfig[displayStatus].className}`}
              />
              <span className="text-xs capitalize">
                {getStatusText(task).startsWith("Failed")
                  ? "Failed"
                  : getStatusText(task)}
              </span>
              <GitBranch className="size-3" />
              {truncateBranchName(task.shadowBranch, 20)}
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
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tasks..."
              className="h-8 pl-8 pr-8"
              onChange={(e) => debouncedSearch(e.target.value)}
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 p-0"
                onClick={() => {
                  setSearchQuery("");
                  // Also clear the input field
                  const input = document.querySelector('input[placeholder="Search tasks..."]') as HTMLInputElement;
                  if (input) input.value = "";
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>

          {/* Group By Toggle */}
          <div className="flex items-center gap-1">
            <Button
              variant={groupBy === "repo" ? "default" : "ghost"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setGroupBy("repo")}
            >
              <Folder className="mr-1 h-3 w-3" />
              Repo
            </Button>
            <Button
              variant={groupBy === "status" ? "default" : "ghost"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setGroupBy("status")}
            >
              <List className="mr-1 h-3 w-3" />
              Status
            </Button>
          </div>
        </div>
      </SidebarGroup>

      {/* Loading State */}
      {loading && (
        <SidebarGroup>
          <SidebarGroupLabel>Loading tasks...</SidebarGroupLabel>
        </SidebarGroup>
      )}

      {/* Error State */}
      {error && (
        <SidebarGroup>
          <SidebarGroupLabel className="text-red-400">
            Error: {error instanceof Error ? error.message : String(error)}
          </SidebarGroupLabel>
        </SidebarGroup>
      )}

      {/* Results Count */}
      {!loading && !error && searchQuery && (
        <SidebarGroup>
          <SidebarGroupLabel className="text-muted-foreground text-xs">
            {filteredTasks.length} result{filteredTasks.length !== 1 ? 's' : ''}
          </SidebarGroupLabel>
        </SidebarGroup>
      )}

      {/* Tasks grouped by repository */}
      {!loading &&
        !error &&
        groupBy === "repo" &&
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
        ))}

      {/* Tasks grouped by status */}
      {!loading &&
        !error &&
        groupBy === "status" &&
        Object.entries(groupedByStatus)
          .sort(([a], [b]) => statusOrder[a as keyof typeof statusOrder] - statusOrder[b as keyof typeof statusOrder])
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
                        {status.toLowerCase().replace(/_/g, ' ')}
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
          })}

      {/* Empty state */}
      {!loading && !error && filteredTasks.length === 0 && !searchQuery && (
        <SidebarGroup>
          <SidebarGroupLabel className="text-muted-foreground hover:text-muted-foreground px-0">
            No active tasks.
          </SidebarGroupLabel>
        </SidebarGroup>
      )}

      {/* No search results */}
      {!loading && !error && filteredTasks.length === 0 && searchQuery && (
        <SidebarGroup>
          <SidebarGroupLabel className="text-muted-foreground hover:text-muted-foreground px-0">
            No tasks match &quot;{searchQuery}&quot;.
          </SidebarGroupLabel>
        </SidebarGroup>
      )}
    </>
  );
}
