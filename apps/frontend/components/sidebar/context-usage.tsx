"use client";

import { Activity } from "lucide-react";
import { useTask } from "@/hooks/use-task";

interface ContextUsageProps {
  taskId: string;
}

export function ContextUsage({ taskId }: ContextUsageProps) {
  const { task, isLoading: loading, error } = useTask(taskId);

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-2 text-sm">
        <Activity className="size-4 animate-pulse" />
        <span>Loading...</span>
      </div>
    );
  }

  if (error || !task) {
    return null;
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  return (
    <div className="text-muted-foreground flex items-center gap-2 p-2 text-sm">
      <Activity className="size-4" />
      <span>Total tokens: {formatNumber(task.totalTokens)}</span>
    </div>
  );
}
