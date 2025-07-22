import { FileChange } from "@repo/db";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export interface DiffStats {
  additions: number;
  deletions: number;
  totalFiles: number;
}

export interface FileChangesData {
  fileChanges: FileChange[];
  diffStats: DiffStats;
}

export function useFileChanges(
  taskId: string,
  initialData?: FileChange[]
): FileChangesData {
  const query = useQuery({
    queryKey: ["file-changes", taskId],
    queryFn: async (): Promise<FileChange[]> => {
      const res = await fetch(`/api/tasks/${taskId}/file-changes`);
      if (!res.ok) {
        if (res.status === 404) return [];
        throw new Error("Failed to fetch file changes");
      }
      return res.json() as Promise<FileChange[]>;
    },
    enabled: !!taskId,
    refetchOnReconnect: true,
    initialData,
  });

  const fileChanges = query.data || [];

  // Compute diff stats efficiently with useMemo
  // Only count the latest change per file (like GitHub PR diffs)
  const diffStats = useMemo((): DiffStats => {
    // Group by file path and keep only the most recent change per file
    const latestChangePerFile = new Map<string, FileChange>();

    fileChanges.forEach((change) => {
      const existing = latestChangePerFile.get(change.filePath);
      if (
        !existing ||
        new Date(change.createdAt) > new Date(existing.createdAt)
      ) {
        latestChangePerFile.set(change.filePath, change);
      }
    });

    // Calculate diff stats from latest changes only
    return Array.from(latestChangePerFile.values()).reduce(
      (acc, change) => ({
        additions: acc.additions + change.additions,
        deletions: acc.deletions + change.deletions,
        totalFiles: acc.totalFiles,
      }),
      { additions: 0, deletions: 0, totalFiles: latestChangePerFile.size }
    );
  }, [fileChanges]);

  return {
    fileChanges,
    diffStats,
  };
}
