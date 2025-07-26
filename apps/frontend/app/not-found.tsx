import Link from "next/link";
import { SidebarViews } from "@/components/sidebar";
import { getUser } from "@/lib/auth/get-user";
import { getTasks } from "@/lib/db-operations/get-tasks";
import { LogoHover } from "@/components/logo/logo-hover";

export default async function NotFound() {
  const user = await getUser();
  const initialTasks = user ? await getTasks(user.id) : [];

  return (
    <>
      {/* Render the sidebar */}
      <SidebarViews initialTasks={initialTasks} />

      {/* Fallback content */}
      <div className="flex grow flex-col items-center justify-center gap-6 p-6">
        <div className="flex items-center gap-4">
          <LogoHover size="lg" forceAnimate />
          <h2 className="font-departureMono text-4xl font-bold">Not Found</h2>
        </div>
        <p className="font-departureMono text-lg">
          We couldn't find the page you were looking for.
        </p>
        <Link
          href="/"
          className="font-departureMono text-lg text-blue-500/50 transition-colors hover:text-blue-500"
        >
          Return Home
        </Link>
      </div>
    </>
  );
}
