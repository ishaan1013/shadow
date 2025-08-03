import { fetchGitHubIssues } from "@/lib/github/fetch";
import { useQuery } from "@tanstack/react-query";

export function useGitHubIssues({
  repoFullName,
}: {
  repoFullName: string | null;
}) {
  return useQuery({
    queryKey: ["github", "issues", repoFullName],
    queryFn: () => {
      if (!repoFullName) {
        throw new Error("Repository full name is required");
      }
      return fetchGitHubIssues(repoFullName);
    },
    throwOnError: false,
    enabled: !!repoFullName,
    staleTime: 2 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes("401")) {
        return false;
      }
      if (error instanceof Error && error.message.includes("403")) {
        return false;
      }

      if (
        error instanceof Error &&
        error.message.includes("Repository full name is required")
      ) {
        return false;
      }
      return failureCount < 2;
    },
  });
}
