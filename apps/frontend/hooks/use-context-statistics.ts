"use client";

import { useQuery } from "@tanstack/react-query";
import { ContextStatistics } from "@/components/sidebar/context-progress";

export function useContextStatistics(taskId: string | undefined) {
  return useQuery({
    queryKey: ["context-statistics", taskId],
    queryFn: () => null as ContextStatistics | null,
    enabled: !!taskId,
    staleTime: Infinity, // Context statistics are updated via WebSocket, don't refetch
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}