"use client";

import { Button } from "@/components/ui/button";
import { Loader2, X } from "lucide-react";
import Image from "next/image";
import { authClient } from "@/lib/auth/auth-client";
import { useAuthSession } from "../session-provider";
import { useModal } from "@/components/layout/modal-context";

export function UserSettings() {
  const { session, isLoading: isLoadingSession } = useAuthSession();
  const { closeSettingsModal } = useModal();

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

  return (
    <div className="space-y-6">
      {isLoadingSession ? (
        <div className="text-muted-foreground flex items-center gap-1">
          Loading user info... <Loader2 className="size-3.5 animate-spin" />
        </div>
      ) : !session?.user ? (
        <div className="flex items-center gap-1.5 text-red-400">
          Failed to load user info <X className="size-3.5" />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            {session.user.image && (
              <Image
                src={session.user.image}
                alt={session.user.name || "User"}
                className="rounded-full"
                width={48}
                height={48}
              />
            )}
            <div className="flex flex-col">
              <span className="font-medium">{session.user.name}</span>
              <span className="text-muted-foreground text-sm">
                {session.user.email}
              </span>
            </div>
          </div>

          <div className="flex w-full pt-2">
            <Button
              variant="destructive"
              onClick={() => {
                handleSignOut();
                closeSettingsModal();
              }}
            >
              Sign Out
            </Button>
          </div>
        </>
      )}
    </div>
  );
}