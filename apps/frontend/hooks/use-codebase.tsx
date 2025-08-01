import { useQuery } from "@tanstack/react-query";
import { CodebaseWithSummaries } from "@repo/types";

export function useCodebase(codebaseId: string) {
  return useQuery({
    queryKey: ["codebase", codebaseId],
    queryFn: async (): Promise<CodebaseWithSummaries> => {
      const res = await fetch(`/api/codebases/${codebaseId}`);
      if (!res.ok) throw new Error("Failed to fetch codebase");
      const data = await res.json();
      return data.codebase;
    },
    enabled: !!codebaseId,
  });
}
