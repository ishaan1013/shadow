import { UserSettings } from "@repo/db";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface UserSettingsResponse {
  success: boolean;
  settings: UserSettings;
  error?: string;
}

async function fetchUserSettings(): Promise<UserSettings> {
  const response = await fetch("/api/user-settings");
  const data: UserSettingsResponse = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || "Failed to fetch user settings");
  }

  return data.settings;
}

async function updateUserSettingsAPI(settings: {
  autoPullRequest: boolean;
}): Promise<UserSettings> {
  const response = await fetch("/api/user-settings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
  });

  const data: UserSettingsResponse = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || "Failed to update user settings");
  }

  return data.settings;
}

export function useUserSettings() {
  return useQuery({
    queryKey: ["user-settings"],
    queryFn: fetchUserSettings,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

export function useUpdateUserSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateUserSettingsAPI,
    onSuccess: (updatedSettings) => {
      // Update the cache with the new settings
      queryClient.setQueryData(["user-settings"], updatedSettings);
    },
    onError: (error) => {
      console.error("Failed to update user settings:", error);
    },
  });
}
