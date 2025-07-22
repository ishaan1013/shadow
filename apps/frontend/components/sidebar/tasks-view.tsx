import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Task } from "@repo/db";
import { ChevronDown, Folder, GitBranch } from "lucide-react";
import { statusColorsConfig, statusOrder } from ".";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";

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
      const repoName = task.repoUrl.split("/").slice(-2).join("/"); // Extract owner/repo from URL

      if (!groups[task.repoUrl]) {
        groups[task.repoUrl] = {
          repoName,
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
          <SidebarGroupLabel className="text-red-500">
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
                    const StatusIcon = statusColorsConfig[task.status].icon;
                    return (
                      <SidebarMenuItem key={task.id}>
                        <SidebarMenuButton
                          className="flex h-auto flex-col items-start gap-0"
                          asChild
                        >
                          <a href={`/tasks/${task.id}`}>
                            <div className="flex w-full items-center gap-1.5">
                              <div className="line-clamp-1 flex-1">
                                {task.title ||
                                  task.description ||
                                  "Untitled Task"}
                              </div>
                            </div>
                            <div className="text-muted-foreground flex items-center gap-1 text-xs">
                              <StatusIcon
                                className={`!size-3 ${statusColorsConfig[task.status].className}`}
                              />
                              <span className="text-xs capitalize">
                                {task.status.toLowerCase().replace("_", " ")}
                              </span>
                              <GitBranch className="size-3" /> {task.branch}
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
