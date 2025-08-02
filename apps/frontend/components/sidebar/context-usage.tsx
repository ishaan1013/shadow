"use client";

import { ContextUsageStats } from "@repo/types";
import { useState, useEffect } from "react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { 
  Activity,
  TrendingDown
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ContextUsageProps {
  taskId: string;
  model?: string;
  refreshInterval?: number;
}

export function ContextUsage({ 
  taskId, 
  model = "gpt-4o",
  refreshInterval = 10000 
}: ContextUsageProps) {
  const [stats, setStats] = useState<ContextUsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      const response = await fetch(`/api/context/usage/${taskId}?model=${model}`);
      if (!response.ok) {
        console.warn(`Context stats unavailable: ${response.statusText}`);
        return;
      }
      const data: ContextUsageStats = await response.json();
      setStats(data);
      setError(null);
    } catch (err) {
      console.error("Error fetching context stats:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchStats();

    // Set up interval for periodic updates
    const interval = setInterval(fetchStats, refreshInterval);

    return () => clearInterval(interval);
  }, [taskId, model, refreshInterval]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
        <Activity className="size-4 animate-pulse" />
        <span>Loading context stats...</span>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="flex items-center gap-2 p-2 text-sm text-red-400">
        <Activity className="size-4" />
        <span>Failed to load context</span>
      </div>
    );
  }

  const getUsageColor = (percentage: number) => {
    if (percentage >= 80) return "text-red-400";
    if (percentage >= 60) return "text-yellow-400";
    return "text-green-400";
  };

  const getUsageBadgeVariant = (percentage: number) => {
    if (percentage >= 80) return "destructive";
    if (percentage >= 60) return "secondary";
    return "default";
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

      {/* Compression Stats */}
      {stats.currentCompressionStats && (
        <div className="space-y-2 p-2 rounded bg-sidebar-accent/30 border border-sidebar-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingDown className="size-3 text-green-400" />
              <span className="text-xs font-medium text-green-400">Context Compressed</span>
            </div>
            <Badge variant="secondary" className="text-xs">
              -{formatNumber(stats.currentCompressionStats.compressionSavings)} tokens
            </Badge>
          </div>
          
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex flex-col gap-1 text-center">
                  <span className="text-muted-foreground">Original</span>
                  <span className="font-mono text-foreground">
                    {formatNumber(stats.currentCompressionStats.uncompressedTokens)}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <span>Tokens without compression</span>
              </TooltipContent>
            </Tooltip>
            
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex flex-col gap-1 text-center">
                  <span className="text-muted-foreground">Compressed</span>
                  <span className="font-mono text-green-400">
                    {formatNumber(stats.currentCompressionStats.compressedTokens)}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <span>Tokens after compression</span>
              </TooltipContent>
            </Tooltip>
          </div>
          
          <div className="text-xs text-center text-muted-foreground">
            {((stats.currentCompressionStats.compressionSavings / stats.currentCompressionStats.uncompressedTokens) * 100).toFixed(1)}% reduction
          </div>
        </div>
      )}

      {/* Compression Status */}
      {stats.compressionActive && (
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <Zap className="size-3 text-blue-400" />
            <span className="text-blue-400">Compression active</span>
            <Badge variant="outline" className="text-xs">
              {stats.compressedMessages}/{stats.totalMessages}
            </Badge>
          </div>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showDetails ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </button>
        </div>
      )}

      {/* Expandable Details */}
      {showDetails && (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 p-1.5 rounded bg-sidebar-accent/50">
                  <FileText className="size-3 text-muted-foreground" />
                  <span className="font-mono">{stats.totalMessages}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <span>Total messages in conversation</span>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 p-1.5 rounded bg-sidebar-accent/50">
                  <Gauge className="size-3 text-muted-foreground" />
                  <span className="font-mono">{formatNumber(stats.compressionThreshold)}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <span>Compression threshold ({Math.round((stats.compressionThreshold / stats.tokenLimit) * 100)}% of limit)</span>
              </TooltipContent>
            </Tooltip>
          </div>

        </>
      )}
    </div>
  );
}