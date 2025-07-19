import { getUser } from "@/lib/auth/get-user";
import { getTasks } from "@/lib/db-operations/get-tasks";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  GitBranch,
  Pause,
  Play,
  XCircle,
  Folder,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Task } from "@repo/db";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";

// Reuse the same status ordering & config as the sidebar for consistency
const statusOrder = {
  RUNNING: 0,
  PAUSED: 1,
  PENDING: 2,
  INITIALIZING: 3,
  COMPLETED: 4,
  FAILED: 5,
  CANCELLED: 6,
};

const statusConfig = {
  PENDING: { icon: Clock, className: "text-yellow-500" },
  INITIALIZING: { icon: CircleDashed, className: "text-blue-500" },
  RUNNING: { icon: Play, className: "text-green-500" },
  PAUSED: { icon: Pause, className: "text-orange-500" },
  COMPLETED: { icon: CheckCircle2, className: "text-green-600" },
  FAILED: { icon: XCircle, className: "text-red-500" },
  CANCELLED: { icon: AlertTriangle, className: "text-gray-500" },
} as const;

interface GroupedTasks {
  [repoUrl: string]: {
    repoName: string;
    tasks: Task[];
  };
}

export default async function AllTasksPage() {
  const user = await getUser();
  if (!user) {
    redirect("/auth");
  }

  const tasks = await getTasks(user.id);

  // Group tasks by repository
  const groupedTasks: GroupedTasks = tasks.reduce(
    (groups: GroupedTasks, task: Task) => {
      const repoName = task.repoUrl.split("/").slice(-2).join("/");
      if (!groups[task.repoUrl]) {
        groups[task.repoUrl] = { repoName, tasks: [] };
      }
      groups[task.repoUrl]?.tasks.push(task);
      return groups;
    },
    {} as GroupedTasks
  );

  // Sort tasks within each group by status and then by date
  Object.values(groupedTasks).forEach((group) => {
    group.tasks.sort((a, b) => {
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 md:px-8 py-8 flex flex-col gap-8">
      <header className="flex items-center gap-2">
        <Folder className="size-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">All Tasks</h1>
      </header>

      {tasks.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No tasks yet. Create a new task from the home page.
        </p>
      ) : (
        <div className="flex flex-col gap-10">
          {Object.entries(groupedTasks).map(([repoUrl, group]) => (
            <section key={repoUrl}>
              <h2 className="text-lg font-medium flex items-center gap-2 text-muted-foreground mb-4">
                <Folder className="size-4" />
                {group.repoName}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.tasks.map((task) => {
                  const StatusIcon = statusConfig[task.status].icon;
                  return (
                    <Link
                      key={task.id}
                      href={`/tasks/${task.id}`}
                      className="focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-4 rounded-xl block"
                    >
                      <Card className="h-full hover:border-sidebar-border transition-colors flex flex-col">
                        <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">
                            <StatusIcon
                              className={cn(
                                "size-4 shrink-0",
                                statusConfig[task.status].className
                              )}
                            />
                            <span className="truncate">
                              {task.title ||
                                task.description?.slice(0, 50) ||
                                "Untitled Task"}
                            </span>
                          </CardTitle>
                          <CardDescription className="flex items-center gap-1.5 text-xs pt-1">
                            <GitBranch className="size-3" />
                            {task.branch}
                          </CardDescription>
                        </CardHeader>
                        {task.description && (
                          <CardContent className="flex-grow">
                            <p className="text-sm line-clamp-3 whitespace-pre-wrap text-muted-foreground">
                              {task.description}
                            </p>
                          </CardContent>
                        )}
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
} 