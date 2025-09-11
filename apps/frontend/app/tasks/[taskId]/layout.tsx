import { SidebarViews } from "@/components/sidebar";
import { AgentEnvironmentProvider } from "@/components/agent-environment/agent-environment-context";
import { TaskSocketProvider } from "@/contexts/task-socket-context";
import { getApiKeys, getModels } from "@/lib/actions/api-keys";
import { getUser } from "@/lib/auth/get-user";
import { getTaskMessages } from "@/lib/db-operations/get-task-messages";
import { getTaskWithDetails } from "@/lib/db-operations/get-task-with-details";
import { getTasks } from "@/lib/db-operations/get-tasks";
import { getTaskVariants } from "@/lib/db-operations/get-task-variants";
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";
import { notFound } from "next/navigation";

export default async function TaskLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ taskId: string }>;
}>) {
  const { taskId } = await params;

  const user = await getUser();

  const [initialTasks, { task, todos, fileChanges, diffStats }, taskMessages, variants] =
    await Promise.all([
      user ? getTasks(user.id) : [],
      getTaskWithDetails(taskId),
      getTaskMessages(taskId),
      getTaskVariants(taskId),
    ]);

  if (!task) {
    notFound();
  }

  const queryClient = new QueryClient();

  const prefetchPromises = [
    queryClient.prefetchQuery({
      queryKey: ["task", taskId],
      queryFn: () => ({
        task,
        todos,
        fileChanges,
        diffStats,
      }),
    }),
    queryClient.prefetchQuery({
      queryKey: ["task-messages", taskId],
      queryFn: () => taskMessages,
    }),
    queryClient.prefetchQuery({
      queryKey: ["task-title", taskId],
      queryFn: () => task.title,
    }),
    queryClient.prefetchQuery({
      queryKey: ["task-status", taskId],
      queryFn: () => ({
        status: task.status,
        initStatus: task.initStatus,
        initializationError: task.initializationError,
      }),
    }),
    queryClient.prefetchQuery({
      queryKey: ["api-keys"],
      queryFn: getApiKeys,
    }),
    queryClient
      .prefetchQuery({
        queryKey: ["models"],
        queryFn: getModels,
      })
      .catch(() => {
        // Could not prefetch models
      }),
  ];

  await Promise.allSettled(prefetchPromises);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TaskSocketProvider taskId={taskId} variants={variants}>
        <AgentEnvironmentProvider taskId={taskId}>
          <SidebarViews initialTasks={initialTasks} currentTaskId={task.id} />
          {children}
        </AgentEnvironmentProvider>
      </TaskSocketProvider>
    </HydrationBoundary>
  );
}
