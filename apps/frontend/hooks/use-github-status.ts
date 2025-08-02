import { fetchGitHubStatus } from "@/lib/github/fetch";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

export function useGitHubStatus() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  const query = useQuery({
    queryKey: ["github", "status"],
    queryFn: fetchGitHubStatus,
    throwOnError: false, // Don't throw on error - let component handle error states
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: (failureCount, error) => {
      // Don't retry on auth errors - the status endpoint should handle these gracefully
      if (error instanceof Error && error.message.includes("401")) {
        return false;
      }
      // Retry other errors up to 2 times
      return failureCount < 2;
    },
  });

  // Check for installation success in URL params and refresh if needed
  useEffect(() => {
    if (searchParams.get("github_app_installed") === "true") {
      // Clear the URL parameter
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete("github_app_installed");
      window.history.replaceState({}, "", newUrl.toString());

      // Refresh the status
      queryClient.invalidateQueries({ queryKey: ["github", "status"] });
      queryClient.invalidateQueries({ queryKey: ["github", "repositories"] });
    }
  }, [searchParams, queryClient]);

  const refreshStatus = () => {
    queryClient.invalidateQueries({ queryKey: ["github", "status"] });
    queryClient.invalidateQueries({ queryKey: ["github", "repositories"] });
  };

  return {
    ...query,
    refreshStatus,
  };
}
