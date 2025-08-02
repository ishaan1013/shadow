"use client";

import { ContextUsageStats } from "@repo/types";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { 
  Activity,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ContextUsageProps {
  taskId: string;
  model?: string;
}

export function ContextUsage({ 
  taskId, 
  model = "gpt-4o" 
}: ContextUsageProps) {

  const { data: stats, isLoading: loading, error } = useQuery({
    queryKey: ["context-usage", taskId, model],
    queryFn: async (): Promise<ContextUsageStats> => {
      const response = await fetch(`/api/context/usage/${taskId}?model=${model}`);
      if (!response.ok) {
        throw new Error(`Context stats unavailable: ${response.statusText}`);
      }
      return response.json();
    },
    staleTime: 30000, // Consider data stale after 30 seconds
    retry: 1, // Only retry once on failure
  });

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
        <Activity className="size-4 animate-pulse" />
        <span>Loading context stats...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-2 text-sm text-red-400">
        <Activity className="size-4" />
        <span>Failed to load context</span>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  const getUsageBadgeVariant = (percentage: number) => {
    if (percentage >= 80) return "destructive";
    if (percentage >= 60) return "secondary";
    return "default"; // Generally as long as our usage is under 60% this behaviour won't be triggered
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  return (
    <div className="space-y-3 p-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Context Usage</span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge 
              variant={getUsageBadgeVariant(stats.usagePercentage)} 
              className="text-xs"
            >
              {stats.usagePercentage}%
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="left">
            <div className="text-xs">
              {formatNumber(stats.totalTokens)} / {formatNumber(stats.tokenLimit)} tokens
            </div>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1">
        <Progress 
          value={Math.min(stats.usagePercentage, 100)} 
          className="h-2"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{formatNumber(stats.totalTokens)} tokens</span>
          <span>{formatNumber(stats.tokenLimit)} limit</span>
        </div>
      </div>
    </div>
  );
}