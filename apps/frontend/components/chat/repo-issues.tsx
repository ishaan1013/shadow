"use client";

import { Button } from "@/components/ui/button";
import { useGitHubIssues } from "@/hooks/use-github-issues";
import type { GitHubIssue } from "@repo/types";
import type { FilteredRepository as Repository } from "@/lib/github/types";
import { ArrowRight, Circle, Minus, Plus, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { GithubIssueIcon } from "../graphics/github/github-issue-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { cn, formatTimeAgo } from "@/lib/utils";
import "./repo-issues.css";

export function RepoIssues({
  repository,
  isPending,
  handleSubmit,
}: {
  repository: Repository;
  isPending: boolean;
  handleSubmit: (issue: GitHubIssue) => void;
}) {
  const [isIssuesExpanded, setIsIssuesExpanded] = useState(false);

  const {
    data: issues = [],
    isLoading: isLoadingIssues,
    refetch: refetchIssues,
  } = useGitHubIssues({
    repoFullName: repository.full_name,
  });

  if (isLoadingIssues || issues.length === 0) return null;

  return (
    <IssuesContent
      issues={issues}
      isIssuesExpanded={isIssuesExpanded}
      toggleIssuesExpanded={() => setIsIssuesExpanded((prev) => !prev)}
      handleRefresh={refetchIssues}
      handleSubmit={handleSubmit}
      isPending={isPending}
    />
  );
}

function IssuesContent({
  issues,
  isIssuesExpanded,
  toggleIssuesExpanded,
  handleRefresh,
  handleSubmit,
  isPending,
}: {
  issues: GitHubIssue[];
  isIssuesExpanded: boolean;
  toggleIssuesExpanded: () => void;
  handleRefresh: () => void;
  handleSubmit: (issue: GitHubIssue) => void;
  isPending: boolean;
}) {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setHasMounted(true);
    }, 1100);

    return () => clearTimeout(timeout);
  }, []);

  return (
    <div className="group/issues mt-8 flex w-full flex-col gap-3 overflow-hidden pb-8">
      <div
        className={cn(
          "flex items-center justify-between pl-3 pr-2.5",
          hasMounted ? "" : "animate-issue-in"
        )}
        style={{ "--issue-index": 0 } as React.CSSProperties}
      >
        <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <GithubIssueIcon className="size-3.5 flex-shrink-0 text-green-400" />
          GitHub Issues
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="iconXs"
              onClick={handleRefresh}
              className="text-muted-foreground hover:text-foreground invisible opacity-0 transition-all group-hover/issues:visible group-hover/issues:opacity-100"
            >
              {<RotateCw className="size-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Refresh Issues</p>
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="relative z-0 flex flex-col gap-1 overflow-hidden">
        {isIssuesExpanded && (
          <div className="from-background via-background/70 pointer-events-none absolute bottom-[calc(2.25rem-1px)] left-0 z-10 h-8 w-full  bg-gradient-to-t to-transparent" />
        )}

        <div
          className={cn(
            "github-issues-container flex flex-col gap-0.5 overflow-y-auto",
            isIssuesExpanded && "pb-3"
          )}
        >
          {(isIssuesExpanded ? issues : issues.slice(0, 5)).map(
            (issue, index) => (
              <Button
                variant="ghost"
                key={issue.id}
                onClick={() => handleSubmit(issue)}
                disabled={isPending}
                className={cn(
                  "group/issue-button relative z-0 w-full max-w-full justify-between overflow-hidden font-normal",
                  hasMounted ? "" : "animate-issue-in"
                )}
                style={{ "--issue-index": index + 1 } as React.CSSProperties}
              >
                <div className="flex flex-1 items-center gap-2 overflow-hidden">
                  <div className="text-foreground truncate">{issue.title}</div>

                  <Circle className="fill-muted-foreground size-1 opacity-50" />

                  <span className="text-muted-foreground">
                    {issue.user?.login && issue.user.login.length > 20
                      ? issue.user.login.substring(0, 17) + "..."
                      : issue.user?.login}
                  </span>
                </div>
                <div className="text-foreground bg-background group-hover/issue-button:bg-secondary absolute right-3 top-1/2 z-10 hidden -translate-x-2 -translate-y-1/2 items-center gap-1 pl-2 opacity-0 transition-all group-hover/issue-button:translate-x-0 group-hover/issue-button:opacity-100 sm:flex">
                  Run Task
                  <ArrowRight className="size-3.5" />
                </div>
                <div className="text-muted-foreground translate-x-0 opacity-100 transition-all sm:group-hover/issue-button:translate-x-2 sm:group-hover/issue-button:opacity-0">
                  {formatTimeAgo(issue.updated_at)}
                </div>
              </Button>
            )
          )}
        </div>
        {issues.length > 5 && (
          <Button
            variant="ghost"
            onClick={() => toggleIssuesExpanded()}
            className={cn(
              "text-muted-foreground hover:text-foreground animate-issue-in w-full max-w-full justify-start font-normal",
              hasMounted ? "" : "animate-issue-in"
            )}
            style={
              {
                "--issue-index": Math.min(issues.length, 5) + 1,
              } as React.CSSProperties
            }
          >
            {isIssuesExpanded ? (
              <>
                <Minus className="size-3.5" />
                Show less
              </>
            ) : (
              <>
                <Plus className="size-3.5" />
                Show {issues.length - 5} more
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
