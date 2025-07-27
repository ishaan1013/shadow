"use client";

import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AlertTriangle, Activity } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { StreamChunk } from "@repo/types";

export type ContextStatistics = NonNullable<StreamChunk['contextStatistics']>;

interface ContextProgressProps {
  statistics: ContextStatistics | null;
  className?: string;
}

export function ContextProgress({ statistics, className }: ContextProgressProps) {
  if (!statistics) {
    return null;
  }

  const {
    currentTokens,
    maxTokens,
    percentage,
    messageCount,
    needsCompaction,
    modelName,
  } = statistics;

  // Color scheme based on usage percentage
  const getProgressColor = (percent: number) => {
    if (percent < 50) return "bg-green-500";
    if (percent < 75) return "bg-yellow-500";
    if (percent < 90) return "bg-orange-500";
    return "bg-red-500";
  };

  const getProgressVariant = (percent: number) => {
    if (percent < 50) return "default";
    if (percent < 75) return "secondary";
    return "destructive";
  };

  // Format numbers with K/M suffixes
  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(1)}M`;
    }
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}K`;
    }
    return tokens.toString();
  };

  return (
    <div className={cn("flex flex-col gap-2 p-2", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Activity className="size-3.5" />
          <span className="text-xs font-medium">Context Usage</span>
          {needsCompaction && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertTriangle className="size-3 text-orange-500" />
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>Context approaching limit</p>
                <p className="text-xs text-muted-foreground">
                  Messages may be compacted
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <Badge
          variant={getProgressVariant(percentage)}
          className="text-[10px] px-1.5 py-0"
        >
          {percentage.toFixed(0)}%
        </Badge>
      </div>

      <div className="space-y-1">
        <Progress
          value={percentage}
          className="h-1.5"
          indicatorClassName={getProgressColor(percentage)}
        />
        
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{formatTokens(currentTokens)} tokens</span>
          <span>{formatTokens(maxTokens)} max</span>
        </div>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground cursor-help">
            <span>{modelName}</span>
            <span>{messageCount} messages</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1">
            <p className="font-medium">{modelName}</p>
            <p>Using {currentTokens.toLocaleString()} of {maxTokens.toLocaleString()} tokens</p>
            <p>{messageCount} messages in conversation</p>
            {needsCompaction && (
              <p className="text-orange-400">
                Approaching context limit - messages may be automatically compacted
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}