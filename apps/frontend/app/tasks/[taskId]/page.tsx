import { TaskPageWrapper } from "@/components/task/task-wrapper";
import { getInitialLayoutCookie } from "@/lib/actions/get-initial-layout-cookie";

export default async function TaskPage() {
  const initialLayout = await getInitialLayoutCookie();

  return <TaskPageWrapper initialLayout={initialLayout} />;
}
