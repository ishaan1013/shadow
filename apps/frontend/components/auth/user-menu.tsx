"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth/auth-client";
import { LogOut, User } from "lucide-react";
import { useAuthSession } from "./session-provider";
import Image from "next/image";

export function UserMenu() {
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
    return (
      <div className="bg-sidebar-accent size-7 animate-pulse rounded-full" />
    );
  }

  if (!session?.user) {
    return <div className="size-7" />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="bg-sidebar-accent size-7 cursor-pointer rounded-full transition-opacity hover:opacity-80">
          {session.user.image ? (
            <Image
              src={session.user.image}
              alt={session.user.name || "User"}
              className="size-7 rounded-full"
              width={28}
              height={28}
              priority
            />
          ) : (
            <User className="size-4" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="bg-sidebar-accent border-sidebar-border rounded-lg p-1"
      >
        <div className="flex items-center justify-start gap-2 p-1">
          <div className="flex flex-col">
            {session.user.name && (
              <p className="text-sm font-medium">{session.user.name}</p>
            )}
            <p className="text-muted-foreground w-[200px] truncate pb-px text-[13px]">
              {session.user.email}
            </p>
          </div>
        </div>
        <DropdownMenuSeparator className="bg-sidebar-border" />
        <DropdownMenuItem
          onClick={handleSignOut}
          className="hover:bg-sidebar-border! text-destructive hover:text-destructive! cursor-pointer transition-colors"
        >
          <LogOut className="text-destructive size-3.5" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
