import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { Toaster } from "sonner";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href="/fonts/DepartureMono-Regular.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} overscroll-none antialiased`}
      >
        <ThemeProvider
          attribute="class"
          forcedTheme="dark"
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
