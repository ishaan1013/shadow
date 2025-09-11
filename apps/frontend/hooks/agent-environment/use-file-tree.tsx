import { useQuery } from "@tanstack/react-query";
import { FileNode } from "@repo/types";

export interface FileTreeResponse {
  success: boolean;
  tree: FileNode[];
  error?: string;
}

export function useFileTree(taskId: string, variantId?: string | null) {
  return useQuery({
    queryKey: ["file-tree", taskId, variantId],
    queryFn: async (): Promise<FileTreeResponse> => {
      const params = new URLSearchParams();
      if (variantId) params.set("variantId", variantId);
      const url = params.toString()
        ? `/api/tasks/${taskId}/files/tree?${params}`
        : `/api/tasks/${taskId}/files/tree`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error("Failed to fetch codebase tree");
      }
      return res.json();
    },
    enabled: !!taskId && !!variantId,
  });
}
