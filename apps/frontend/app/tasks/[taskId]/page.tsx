import { TaskPageLayout } from "@/components/task/task-layout";
import { getTask } from "@/lib/db-operations/get-task";
import { getTaskMessages } from "@/lib/db-operations/get-task-messages";
import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from "@tanstack/react-query";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

export default async function TaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const task = await getTask(taskId);

  if (!task) {
    notFound();
  }

  const queryClient = new QueryClient();

  const getInitialLayout = async () => {
    const cookieStore = await cookies();
    const taskLayoutCookie = cookieStore.get("resizable-task-layout");

    let initialLayout: number[] | undefined;
    if (taskLayoutCookie?.value) {
      try {
        initialLayout = JSON.parse(taskLayoutCookie.value);
      } catch {
        // Invalid JSON, ignore
      }
    }

    return initialLayout;
  };

  const [initialLayout] = await Promise.all([
    getInitialLayout(),
    queryClient.prefetchQuery({
      queryKey: ["task-messages", taskId],
      queryFn: () => getTaskMessages(taskId),
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TaskPageLayout initialLayout={initialLayout} task={task} />
    </HydrationBoundary>
  );
}
