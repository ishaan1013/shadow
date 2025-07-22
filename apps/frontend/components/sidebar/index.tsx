"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useTasks } from "@/hooks/use-tasks";
import { FileChange, Task, Todo } from "@repo/db";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Pause,
  Play,
  XCircle,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { UserMenu } from "../auth/user-menu";
import { SidebarAgentView } from "./agent-view";
import { SidebarTasksView } from "./tasks-view";

export const statusOrder = {
  RUNNING: 0,
  PAUSED: 1,
  PENDING: 2,
  QUEUED: 3,
  INITIALIZING: 4,
  COMPLETED: 5,
  FAILED: 6,
  CANCELLED: 7,
};

// Status icons and colors
export const statusColorsConfig = {
  PENDING: { icon: Clock, className: "text-yellow-500" },
  QUEUED: { icon: Clock, className: "text-yellow-400" },
  INITIALIZING: { icon: CircleDashed, className: "text-blue-500" },
  RUNNING: { icon: Play, className: "text-green-500" },
  PAUSED: { icon: Pause, className: "text-orange-500" },
  COMPLETED: { icon: CheckCircle2, className: "text-green-600" },
  FAILED: { icon: XCircle, className: "text-red-500" },
  CANCELLED: { icon: AlertTriangle, className: "text-gray-500" },
};

export function SidebarComponent({
  initialTasks,
  currentTask,
}: {
  initialTasks: Task[];
  currentTask: {
    taskData: Task;
    todos: Todo[];
    fileChanges: FileChange[];
  } | null;
}) {
  const { data: tasks, isLoading: loading, error } = useTasks(initialTasks);

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <Link
            href="/"
            className="flex size-9 items-center justify-center"
            aria-label="Home"
          >
            <Image src="/shadow.svg" alt="Logo" width={22} height={22} />
          </Link>
        </SidebarGroup>
        <div className="flex flex-col gap-4 mt-6">
          {currentTask ? (
            <SidebarAgentView
              taskId={currentTask.taskData.id}
              currentTask={currentTask}
            />
          ) : (
            <SidebarTasksView tasks={tasks} loading={loading} error={error} />
          )}
        </div>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <UserMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
