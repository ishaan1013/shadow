import { SidebarViews } from "@/components/sidebar";
import { getUser } from "@/lib/auth/get-user";
import { getTasks } from "@/lib/db-operations/get-tasks";

export default async function HomeLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getUser();
  const initialTasks = user ? await getTasks(user.id) : [];

  return (
    <>
      <SidebarViews initialTasks={initialTasks} />
      {children}
    </>
  );
}
