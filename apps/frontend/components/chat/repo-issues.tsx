"use client";

import { Button } from "@/components/ui/button";
import { useGitHubIssues } from "@/hooks/use-github-issues";
import { useGitHubStatus } from "@/hooks/use-github-status";
import type { FilteredRepository as Repository } from "@/lib/github/types";
import {
  ChevronDown,
  ChevronUp,
  Circle,
  CircleCheck,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useState } from "react";

export function RepoIssues({ repository }: { repository: Repository }) {
  const [isIssuesExpanded, setIsIssuesExpanded] = useState(false);

  const { data: githubStatus } = useGitHubStatus();

  const {
    data: issues = [],
    isLoading: isLoadingIssues,
    error: issuesError,
  } = useGitHubIssues({
    repoFullName: repository.full_name,
  });

  if (!githubStatus?.isAppInstalled) {
    return null;
  }

  return (
    <div className="mt-4 w-full max-w-lg">
      <div className="bg-card/50 border-border rounded-lg border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-foreground text-sm font-medium">
            Issues in {repository.full_name}
          </h3>
          {isLoadingIssues && (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          )}
        </div>

        {issuesError ? (
          <div className="text-muted-foreground py-2 text-sm">
            Failed to load issues
          </div>
        ) : isLoadingIssues ? (
          <div className="text-muted-foreground py-2 text-sm">
            Loading issues...
          </div>
        ) : issues.length === 0 ? (
          <div className="text-muted-foreground py-2 text-sm">
            No issues found in this repository
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {(isIssuesExpanded ? issues : issues.slice(0, 5)).map((issue) => (
                <div
                  key={issue.id}
                  className="hover:bg-accent/50 flex items-start gap-3 rounded-md p-2 transition-colors"
                >
                  {issue.state === "open" ? (
                    <Circle className="mt-0.5 size-4 flex-shrink-0 text-green-500" />
                  ) : (
                    <CircleCheck className="mt-0.5 size-4 flex-shrink-0 text-purple-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-foreground line-clamp-2 text-sm font-medium">
                        {issue.title}
                      </h4>
                      <a
                        href={issue.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground flex-shrink-0 transition-colors"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    </div>
                    <div className="text-muted-foreground mt-1 text-xs">
                      {issue.user?.login} •{" "}
                      {new Date(issue.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {issues.length > 5 && (
              <div className="mt-3 flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsIssuesExpanded(!isIssuesExpanded)}
                  className="text-muted-foreground hover:text-foreground h-8 text-xs"
                >
                  {isIssuesExpanded ? (
                    <>
                      <ChevronUp className="mr-1 size-3.5" />
                      Show less
                    </>
                  ) : (
                    <>
                      <ChevronDown className="mr-1 size-3.5" />
                      Show {issues.length - 5} more
                    </>
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
