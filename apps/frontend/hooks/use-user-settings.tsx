import {
  useQuery,
  useMutation,
  useQueryClient,
  UseQueryResult,
  UseMutationResult,
} from "@tanstack/react-query";

// Local UserSettings interface to avoid Prisma type issues
interface UserSettings {
  id: string;
  userId: string;
  autoPullRequest: boolean;
  enableShadowWiki: boolean;
  memoriesEnabled: boolean;
  selectedModels: string[];
  miniModel?: string | null;
  enableIndexing: boolean;
  rules?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type UpdateUserSettingsParams = {
  autoPullRequest?: boolean;
  memoriesEnabled?: boolean;
  enableShadowWiki?: boolean;
  selectedModels?: string[];
  miniModel?: string | null;
  enableIndexing?: boolean;
  rules?: string | null;
};

interface UserSettingsResponse {
  success: boolean;
  settings: UserSettings;
  error?: string;
}

async function fetchUserSettings(): Promise<UserSettings> {
  const response = await fetch("/api/user-settings");

  if (!response.ok) {
    throw new Error(`Failed to fetch user settings: ${response.status}`);
  }

  const data: UserSettingsResponse = await response.json();

  if (!data.success) {
    throw new Error(data.error || "Failed to fetch user settings");
  }

  return data.settings;
}

async function updateUserSettingsAPI(settings: {
  autoPullRequest?: boolean;
  memoriesEnabled?: boolean;
  enableShadowWiki?: boolean;
  selectedModels?: string[];
  miniModel?: string | null;
  enableIndexing?: boolean;
  rules?: string | null;
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

export function useUserSettings(): UseQueryResult<UserSettings, Error> {
  return useQuery({
    queryKey: ["user-settings"],
    queryFn: fetchUserSettings,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

export function useUpdateUserSettings(): UseMutationResult<
  UserSettings,
  Error,
  UpdateUserSettingsParams
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateUserSettingsAPI,
    onMutate: async (newSettings) => {
      await queryClient.cancelQueries({ queryKey: ["user-settings"] });

      const previousSettings = queryClient.getQueryData<UserSettings>([
        "user-settings",
      ]);

      if (previousSettings) {
        queryClient.setQueryData<UserSettings>(["user-settings"], {
          ...previousSettings,
          ...newSettings,
        });
      }

      return { previousSettings };
    },
    onError: (_err, _newSettings, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(["user-settings"], context.previousSettings);
      }
      console.error("Failed to update user settings:", _err);
    },
    onSuccess: (updatedSettings) => {
      queryClient.setQueryData(["user-settings"], updatedSettings);
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["user-settings"] });
    },
  });
}
