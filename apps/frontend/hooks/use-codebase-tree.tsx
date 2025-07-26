import { useQuery } from "@tanstack/react-query";
import { FileNode } from "@repo/types";

export interface CodebaseTreeResponse {
  success: boolean;
  tree: FileNode[];
  status: "ready" | "initializing";
  message?: string;
  error?: string;
}

export function useCodebaseTree(taskId: string) {
  return useQuery({
    queryKey: ["codebase-tree", taskId],
    queryFn: async (): Promise<CodebaseTreeResponse> => {
      const res = await fetch(`/api/tasks/${taskId}/files/tree`);
      if (!res.ok) {
        throw new Error("Failed to fetch codebase tree");
      }
      return res.json();
    },
    enabled: !!taskId,
    refetchInterval: (query) => {
      // Refetch every 3 seconds if workspace is still initializing
      return query.state.data?.status === "initializing" ? 3000 : false;
    },
  });
}
