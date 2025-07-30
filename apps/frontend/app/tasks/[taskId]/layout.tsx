import { SidebarViews } from "@/components/sidebar";
import { AgentEnvironmentProvider } from "@/components/agent-environment/agent-environment-context";
import { getModels } from "@/lib/actions/get-models";
import { getApiKeys } from "@/lib/actions/api-keys";
import { getUser } from "@/lib/auth/get-user";
import { getTaskMessages } from "@/lib/db-operations/get-task-messages";
import { getTaskWithDetails } from "@/lib/db-operations/get-task-with-details";
import { getTasks } from "@/lib/db-operations/get-tasks";
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";
import { notFound } from "next/navigation";
import { getCodebases } from "@/lib/db-operations/get-codebases";

export default async function TaskLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ taskId: string }>;
}>) {
  const { taskId } = await params;
  const user = await getUser();
  const [
    initialTasks,
    initialCodebases,
    { task, todos, fileChanges, diffStats },
    taskMessages,
    models,
  ] = await Promise.all([
    user ? getTasks(user.id) : [],
    user ? getCodebases(user.id) : [],
    getTaskWithDetails(taskId),
    getTaskMessages(taskId),
    getModels(),
  ]);

  if (!task) {
    notFound();
  }

  const queryClient = new QueryClient();

  await Promise.all([
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
      queryKey: ["models"],
      queryFn: () => models,
    }),
    queryClient.prefetchQuery({
      queryKey: ["task-title", taskId],
      queryFn: () => task.title,
    }),
    queryClient.prefetchQuery({
      queryKey: ["api-keys"],
      queryFn: getApiKeys,
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AgentEnvironmentProvider taskId={taskId}>
        <SidebarViews
          initialTasks={initialTasks}
          initialCodebases={initialCodebases}
          currentTaskId={task.id}
        />
        {children}
      </AgentEnvironmentProvider>
    </HydrationBoundary>
  );
}
