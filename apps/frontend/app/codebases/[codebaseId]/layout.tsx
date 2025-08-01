import { SidebarViews } from "@/components/sidebar";
import { getUser } from "@/lib/auth/get-user";
import { getTasks } from "@/lib/db-operations/get-tasks";
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";
import { notFound } from "next/navigation";
import { getCodebases } from "@/lib/db-operations/get-codebases";
import { getCodebase } from "@/lib/db-operations/get-codebase";

export default async function CodebaseLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ codebaseId: string }>;
}>) {
  const { codebaseId } = await params;
  const user = await getUser();
  const [initialTasks, initialCodebases, codebase] = await Promise.all([
    user ? getTasks(user.id) : [],
    user ? getCodebases(user.id) : [],
    getCodebase(codebaseId),
  ]);

  if (!codebase) {
    notFound();
  }

  const queryClient = new QueryClient();

  await queryClient.prefetchQuery({
    queryKey: ["codebase", codebaseId],
    queryFn: () => codebase,
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SidebarViews
        initialTasks={initialTasks}
        initialCodebases={initialCodebases}
        currentCodebaseId={codebaseId}
      />
      {children}
    </HydrationBoundary>
  );
}
