import { SessionProvider } from "@/components/auth/session-provider";
import { UserMenu } from "@/components/auth/user-menu";
import { QueryClientProvider } from "@/components/layout/query-client-provider";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { SidebarComponent } from "@/components/sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Task } from "@repo/db";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Shadow - Autonomous Coding Platform",
  description: "Transform natural language instructions into production-ready code with AI agents. Watch live code streaming, terminal execution, and real-time collaboration.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value === "true";

  // Fetch tasks server-side
  let initialTasks: Task[] = [];
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/tasks`,
      {
        headers: { Cookie: cookieStore.toString() },
        cache: "no-store",
      }
    );
    if (res.ok) {
      const data = await res.json();
      initialTasks = data.tasks || [];
    }
  } catch (err) {
    console.error("Failed to fetch initial tasks", err);
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} overscroll-none antialiased`}
      >
        <QueryClientProvider>
          <ThemeProvider
            attribute="class"
            forcedTheme="dark"
            disableTransitionOnChange
          >
            <SessionProvider>
              <SidebarProvider defaultOpen={defaultOpen}>
                <Suspense fallback={<div>Loading sidebar...</div>}>
                  <SidebarComponent initialTasks={initialTasks} />
                </Suspense>
                <div className="flex size-full min-h-svh flex-col relative">
                  <div className="flex w-full items-center justify-between p-3 sticky top-0">
                    <SidebarTrigger />
                    <UserMenu />
                  </div>
                  {children}
                </div>
                <Toaster />
              </SidebarProvider>
            </SessionProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </body>
    </html>
  );
}
