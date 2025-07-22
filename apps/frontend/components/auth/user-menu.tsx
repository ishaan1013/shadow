"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth/auth-client";
import { LogOut, Settings, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuthSession } from "./session-provider";

export function UserMenu() {
  const router = useRouter();
  const { session, isLoading } = useAuthSession();

  const handleSignOut = async () => {
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            window.location.href = "/auth";
          },
        },
      });
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  if (isLoading) {
    return <div className="bg-muted size-8 rounded-full animate-pulse" />;
  }

  if (!session?.user) {
    return <div className="size-8" />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-start font-normal hover:bg-sidebar-accent h-10"
        >
          {session.user.image ? (
            <img
              src={session.user.image}
              alt={session.user.name || "User"}
              className="size-7 rounded-full"
            />
          ) : (
            <User className="size-4" />
          )}
          <span>{session.user.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        sideOffset={8}
        className="w-[var(--radix-dropdown-menu-trigger-width)] bg-sidebar-accent border-sidebar-border"
      >
        <div className="flex items-center justify-start gap-2 p-2">
          <div className="flex flex-col space-y-1 leading-none">
            {session.user.name && (
              <p className="font-medium text-sm">{session.user.name}</p>
            )}
            <p className="w-[200px] truncate text-[13px] pb-px text-muted-foreground">
              {session.user.email}
            </p>
          </div>
        </div>
        <DropdownMenuSeparator className="bg-sidebar-border" />
        <DropdownMenuItem
          onClick={() => {
            router.push("/settings");
          }}
          className="hover:bg-sidebar-border! transition-colors cursor-pointer"
        >
          <Settings className="size-3.5" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleSignOut}
          className="hover:bg-sidebar-border! transition-colors cursor-pointer"
        >
          <LogOut className="size-3.5" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
