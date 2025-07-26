import { TaskPageLayout } from "@/components/task/task-layout";
import { getInitialLayoutCookie } from "@/lib/actions/get-initial-layout-cookie";

export default async function TaskPage() {
  const initialLayout = await getInitialLayoutCookie();

  return <TaskPageLayout initialLayout={initialLayout} />;
}
