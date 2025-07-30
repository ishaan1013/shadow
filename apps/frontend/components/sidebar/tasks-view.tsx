import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Task } from "@repo/db";
import { ChevronDown, Folder, GitBranch } from "lucide-react";
import { truncateBranchName } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { statusColorsConfig, statusOrder, getDisplayStatus } from "./status";
import { getStatusText } from "@repo/types";

type GroupedTasks = {
  [repoUrl: string]: {
    repoName: string;
    tasks: Task[];
  };
};

export function SidebarTasksView({
  tasks,
  loading,
  error,
}: {
  tasks: Task[];
  loading: boolean;
  error: Error | null;
}) {
  // Group tasks by repository and sort within each group
  const groupedTasks: GroupedTasks = tasks.reduce(
    (groups: GroupedTasks, task: Task) => {
      if (!groups[task.repoUrl]) {
        groups[task.repoUrl] = {
          repoName: task.repoFullName,
          tasks: [],
        };
      }

      groups[task.repoUrl]?.tasks.push(task);
      return groups;
    },
    {} as GroupedTasks
  );

  // Sort tasks within each group by status priority, then by updated date
  Object.values(groupedTasks).forEach((group) => {
    group.tasks.sort((a, b) => {
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  });

  return (
    <>
      {loading && (
        <SidebarGroup>
          <SidebarGroupLabel>Loading tasks...</SidebarGroupLabel>
        </SidebarGroup>
      )}

      {error && (
        <SidebarGroup>
          <SidebarGroupLabel className="text-red-400">
            Error: {error instanceof Error ? error.message : String(error)}
          </SidebarGroupLabel>
        </SidebarGroup>
      )}

      {!loading &&
        !error &&
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
                  {group.tasks.map((task) => {
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
                                {/* Simplify failed status text in this view */}
                                {getStatusText(task).startsWith("Failed")
                                  ? "Failed"
                                  : getStatusText(task)}
                              </span>
                              <GitBranch className="size-3" />{" "}
                              {truncateBranchName(task.shadowBranch, 20)}
                            </div>
                          </a>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ))}

      {!loading && !error && Object.keys(groupedTasks).length === 0 && (
        <SidebarGroup>
          <SidebarGroupLabel className="text-muted-foreground hover:text-muted-foreground px-0">
            No active tasks.
          </SidebarGroupLabel>
        </SidebarGroup>
      )}
    </>
  );
}
