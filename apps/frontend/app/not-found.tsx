import Link from "next/link";
import { SidebarViews } from "@/components/sidebar";
import { getUser } from "@/lib/auth/get-user";
import { getTasks } from "@/lib/db-operations/get-tasks";
import { LogoHover } from "@/components/graphics/logo/logo-hover";
import { getCodebases } from "@/lib/db-operations/get-codebases";
import { Button } from "@/components/ui/button";

export default async function NotFound() {
  const user = await getUser();
  const initialTasks = user ? await getTasks(user.id) : [];
  const initialCodebases = user ? await getCodebases(user.id) : [];

  return (
    <>
      <SidebarViews
        initialTasks={initialTasks}
        initialCodebases={initialCodebases}
      />

      {/* Fallback content */}
      <div className="flex grow flex-col items-center justify-center gap-6 p-6">
        <div className="font-departureMono flex items-center gap-4 text-3xl font-medium tracking-tighter">
          <LogoHover size="lg" />
          Page Not Found
        </div>
        <Button variant="secondary" size="lg" asChild>
          <Link href="/">Go To Home</Link>
        </Button>
      </div>
    </>
  );
}
