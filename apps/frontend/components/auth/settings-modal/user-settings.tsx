"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, X } from "lucide-react";
import Image from "next/image";
import { authClient } from "@/lib/auth/auth-client";
import { useAuthSession } from "../session-provider";
import { useModal } from "@/components/layout/modal-context";
import {
  useUserSettings,
  useUpdateUserSettings,
} from "@/hooks/use-user-settings";

export function UserSettings() {
  const { session, isLoading: isLoadingSession } = useAuthSession();
  const { closeSettingsModal } = useModal();
  const { data: userSettings, isLoading: isLoadingSettings } =
    useUserSettings();
  const updateUserSettings = useUpdateUserSettings();

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

  const handleAutoPRToggle = (checked: boolean) => {
    updateUserSettings.mutate({ autoPullRequest: checked });
  };

  return (
    <div className="flex w-full flex-col gap-6">
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
          <div className="flex flex-col items-start justify-start gap-3 sm:flex-row sm:items-center sm:justify-between">
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

          {/* User Settings Section */}
          <div className="flex w-full flex-col gap-4 border-t pt-4">
            <div className="flex items-center justify-between">
              <label htmlFor="auto-pr" className="flex flex-col gap-0">
                <div className="text-sm font-normal">
                  Auto-create Pull Requests
                </div>
                <div className="text-muted-foreground text-[11px]">
                  Automatically create draft pull requests when tasks complete
                </div>
              </label>
              <Checkbox
                id="auto-pr"
                checked={userSettings?.autoPullRequest ?? false}
                onCheckedChange={handleAutoPRToggle}
                disabled={isLoadingSettings || updateUserSettings.isPending}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
