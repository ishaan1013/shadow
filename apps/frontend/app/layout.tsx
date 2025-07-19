import { SessionProvider } from "@/components/auth/session-provider";
import { QueryClientProvider } from "@/components/layout/query-client-provider";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { SidebarComponent } from "@/components/sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { getUser } from "@/lib/auth/get-user";
import { getTasks } from "@/lib/db-operations/get-tasks";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
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
  title: "Shadow",
  description:
    "A remote, autonomous coding agent for complex and long-running tasks.",
  icons: {
    icon: [
      {
        url: "/shadow-black.svg",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/shadow.svg",
        media: "(prefers-color-scheme: dark)",
      },
    ],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value === "true";

  const user = await getUser();
  const initialTasks = user ? await getTasks(user.id) : [];

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
              {/* SidebarProvider also provides a TooltipProvider inside */}
              <SidebarProvider defaultOpen={defaultOpen}>
                <SidebarComponent initialTasks={initialTasks} />
                {children}
                <Toaster />
              </SidebarProvider>
            </SessionProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </body>
    </html>
  );
}
