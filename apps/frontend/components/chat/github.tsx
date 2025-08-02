"use client";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useGitHubBranches } from "@/hooks/use-github-branches";
import { useGitHubRepositories } from "@/hooks/use-github-repositories";
import { useGitHubStatus } from "@/hooks/use-github-status";
import { saveGitSelectorCookie } from "@/lib/actions/git-selector-cookie";
import { cn, formatTimeAgo } from "@/lib/utils";
import {
  ArrowLeft,
  ChevronDown,
  Folder,
  GitBranch,
  Loader2,
  Search,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { FilteredRepository as Repository } from "@/lib/github/types";
import Image from "next/image";
import Link from "next/link";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { GithubLogo } from "../graphics/github/github-logo";

export function GithubConnection({
  isOpen,
  setIsOpen,
  selectedRepo,
  selectedBranch,
  setSelectedRepo,
  setSelectedBranch,
}: {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  selectedRepo: Repository | null;
  selectedBranch: { name: string; commitSha: string } | null;
  setSelectedRepo: (repo: Repository | null) => void;
  setSelectedBranch: (
    branch: { name: string; commitSha: string } | null
  ) => void;
}) {
  const [repoSearch, setRepoSearch] = useState("");
  const [branchSearch, setBranchSearch] = useState("");
  const [collapsedOrgs, setCollapsedOrgs] = useState<Set<string>>(new Set());

  const {
    data: githubStatus,
    isLoading: isLoadingStatus,
    error: statusError,
  } = useGitHubStatus();

  const {
    data: groupedRepos = { groups: [] },
    isLoading: isLoadingRepos,
    error: reposError,
  } = useGitHubRepositories(isOpen && !!githubStatus?.isAppInstalled);

  const {
    data: branches = [],
    isLoading: isLoadingBranches,
    error: branchesError,
  } = useGitHubBranches(
    selectedRepo?.full_name || null,
    !!selectedRepo && !!githubStatus?.isAppInstalled
  );

  if (statusError) {
    console.error("GitHub status error:", statusError);
  }

  if (reposError) {
    console.error("GitHub repositories error:", reposError);
    // Only show toast for unexpected errors, not auth errors
    if (!(reposError instanceof Error && reposError.message.includes("401"))) {
      toast.error("Failed to fetch repositories", {
        description:
          reposError instanceof Error ? reposError.message : "Unknown error",
      });
    }
  }

  if (branchesError) {
    console.error("GitHub branches error:", branchesError);
    // Only show toast for unexpected errors, not auth errors
    if (
      !(branchesError instanceof Error && branchesError.message.includes("401"))
    ) {
      toast.error("Failed to fetch branches", {
        description:
          branchesError instanceof Error
            ? branchesError.message
            : "Unknown error",
      });
    }
  }

  const filteredGroups = groupedRepos.groups
    .map((group) => ({
      ...group,
      repositories: group.repositories.filter(
        (repo) =>
          repo.name.toLowerCase().includes(repoSearch.toLowerCase()) ||
          repo.full_name.toLowerCase().includes(repoSearch.toLowerCase())
      ),
    }))
    .filter((group) => group.repositories.length > 0);

  const filteredBranches = branches.filter((branch) =>
    branch.name.toLowerCase().includes(branchSearch.toLowerCase())
  );

  const toggleOrgCollapse = (orgName: string) => {
    const newCollapsed = new Set(collapsedOrgs);
    if (newCollapsed.has(orgName)) {
      newCollapsed.delete(orgName);
    } else {
      newCollapsed.add(orgName);
    }
    setCollapsedOrgs(newCollapsed);
  };

  const handleRepoSelect = (repo: Repository) => {
    setSelectedRepo(repo);
    setBranchSearch("");
    // Don't save to cookie yet, wait for branch selection
  };

  const handleBranchSelect = async (branchName: string, commitSha: string) => {
    const branchData = { name: branchName, commitSha };
    setSelectedBranch(branchData);
    setIsOpen(false);

    // Save both repo and branch to cookie
    if (selectedRepo) {
      try {
        await saveGitSelectorCookie({
          repo: selectedRepo,
          branch: branchData,
        });
      } catch (error) {
        console.error("Failed to save git selector state:", error);
      }
    }
  };

  const handleBackToRepos = () => {
    setSelectedRepo(null);
    setSelectedBranch(null);
    setRepoSearch("");
  };

  const truncateBranchName = (branchName: string, maxLength: number = 20) => {
    if (branchName.length <= maxLength) {
      return branchName;
    }

    // For very short limits, just use ellipsis
    if (maxLength <= 6) {
      return branchName.substring(0, maxLength - 3) + "...";
    }

    // Try to keep meaningful parts of the branch name
    // Common patterns: feature/branch-name, fix/issue-123, main, develop
    const parts = branchName.split("/");

    if (parts.length > 1) {
      const prefix = parts[0] || "";
      const suffix = parts.slice(1).join("/");

      // If prefix + suffix + separator is still too long
      if (prefix.length + suffix.length + 1 > maxLength) {
        const availableForSuffix = maxLength - prefix.length - 4; // 4 for "/..."
        if (availableForSuffix > 0) {
          return `${prefix}/${suffix.substring(0, availableForSuffix)}...`;
        }
      }
    }

    // Fallback: truncate from the end
    return branchName.substring(0, maxLength - 3) + "...";
  };

  const getButtonText = () => {
    if (selectedRepo && selectedBranch) {
      // Calculate available space for branch name
      // Estimate: repo name takes priority, branch gets remaining space
      const repoNameLength = selectedRepo.full_name.length;
      const maxBranchLength = Math.max(15, 40 - Math.min(repoNameLength, 25));

      return (
        <>
          <Folder className="size-4" />
          <span>{selectedRepo.full_name}</span>
          <GitBranch className="size-4" />
          <span title={selectedBranch.name}>
            {truncateBranchName(selectedBranch.name, maxBranchLength)}
          </span>
        </>
      );
    }

    if (githubStatus && !githubStatus.isAppInstalled) {
      return "Connect GitHub";
    }

    if (statusError || !githubStatus) {
      return "Connect GitHub";
    }

    return "Select Repository";
  };

  const renderConnectGitHub = (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <Image
          src="/github.svg"
          alt="GitHub"
          className="size-4"
          width={16}
          height={16}
        />
        <div className="font-medium">Connect Github</div>
      </div>
      {statusError ? (
        <div className="text-destructive mb-4 text-sm">
          Unable to check GitHub connection. Try again or contact us to report.
        </div>
      ) : (
        <div className="text-muted-foreground mb-4 text-sm">
          For full access, install Shadow into your organization. If you&apos;re
          seeing this and already installed, hit &apos;Save&apos; in Github.
        </div>
      )}

      {githubStatus?.installationUrl && (
        <Button
          onClick={() => {
            window.open(githubStatus.installationUrl, "_blank");
            setIsOpen(false);
          }}
          className="w-full"
        >
          Install GitHub App
        </Button>
      )}
    </div>
  );

  const renderRepos = (
    <div>
      <div className="relative border-b">
        <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 transform" />
        <input
          placeholder="Search repositories..."
          value={repoSearch}
          autoFocus
          onChange={(e) => setRepoSearch(e.target.value)}
          className="h-9 w-full pl-8 pr-3 text-sm focus:outline-none"
        />
      </div>

      <div className="flex h-64 flex-col gap-2 overflow-y-auto py-2 pb-6">
        {isLoadingRepos ? (
          <div className="text-muted-foreground mt-1 flex h-7 items-center justify-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin" />
            <span className="text-[13px]">Loading repositories...</span>
          </div>
        ) : (
          filteredGroups.map((group) => (
            <Collapsible
              key={group.name}
              open={!collapsedOrgs.has(group.name)}
              onOpenChange={() => toggleOrgCollapse(group.name)}
            >
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground !px-4.5 h-6 w-full gap-2 text-[13px] font-normal hover:bg-transparent"
                >
                  <Folder className="size-3.5" />
                  {group.name}

                  <ChevronDown
                    className={cn(
                      "ml-auto transition-transform",
                      collapsedOrgs.has(group.name) ? "-rotate-90" : "rotate-0"
                    )}
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="flex flex-col gap-1 px-2 py-1">
                {group.repositories.map((repo) => (
                  <Button
                    key={repo.id}
                    variant="ghost"
                    size="sm"
                    className="hover:bg-accent w-full justify-between text-sm font-normal"
                    onClick={() => handleRepoSelect(repo)}
                  >
                    <span className="truncate">{repo.name}</span>
                    <span className="text-muted-foreground">
                      {repo.pushed_at ? formatTimeAgo(repo.pushed_at) : ""}
                    </span>
                  </Button>
                ))}
              </CollapsibleContent>
            </Collapsible>
          ))
        )}
      </div>
      <ManageGithubButton
        link={`https://github.com/settings/installations/${githubStatus?.installationId}`}
      />
    </div>
  );

  const renderBranches = (
    <div>
      <button
        className="hover:bg-sidebar-accent flex h-9 w-full cursor-pointer items-center gap-2 border-b px-2.5 text-sm transition-colors"
        onClick={handleBackToRepos}
      >
        <ArrowLeft className="size-3.5" />
        <span className="truncate">{selectedRepo?.full_name}</span>
      </button>

      <div className="relative border-b">
        <Search className="text-muted-foreground absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 transform" />
        <input
          placeholder="Search branches..."
          value={branchSearch}
          autoFocus
          onChange={(e) => setBranchSearch(e.target.value)}
          className="h-9 w-full pl-8 pr-3 text-sm focus:outline-none"
        />
      </div>

      <div className="flex h-64 flex-col gap-1 overflow-y-auto p-2 pb-6">
        {isLoadingBranches ? (
          <div className="text-muted-foreground mt-1 flex h-7 items-center justify-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin" />
            <span className="text-[13px]">Loading branches...</span>
          </div>
        ) : (
          filteredBranches.map((branch) => (
            <Button
              key={branch.name}
              variant="ghost"
              size="sm"
              className="hover:bg-accent w-full justify-start text-sm font-normal"
              onClick={() => handleBranchSelect(branch.name, branch.commit.sha)}
            >
              <span className="truncate">{branch.name}</span>
            </Button>
          ))
        )}
      </div>

      <ManageGithubButton
        link={`https://github.com/settings/installations/${githubStatus?.installationId}`}
      />
    </div>
  );

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:bg-accent font-normal"
            >
              {getButtonText()}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        {!isOpen && (
          <TooltipContent side="top" align="end" shortcut="⌘/">
            GitHub Selector
          </TooltipContent>
        )}
      </Tooltip>

      <PopoverContent
        className="w-80 overflow-hidden p-0"
        align="end"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {isLoadingStatus ? (
          <div className="text-muted-foreground flex h-20 items-center justify-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-sm">Checking GitHub status...</span>
          </div>
        ) : statusError || !githubStatus || !githubStatus.isAppInstalled ? (
          renderConnectGitHub
        ) : selectedRepo ? (
          renderBranches
        ) : (
          renderRepos
        )}
      </PopoverContent>
    </Popover>
  );
}

function ManageGithubButton({ link }: { link: string }) {
  return (
    <div className="relative h-9 w-full">
      <div className="from-card via-card/70 pointer-events-none absolute -top-6 h-6 w-full bg-gradient-to-t to-transparent" />
      <Link
        href={link}
        target="_blank"
        className="hover:bg-sidebar-accent flex size-full cursor-pointer items-center gap-2 border-t px-2.5 text-sm transition-colors"
      >
        <GithubLogo className="size-4" />
        <span>Manage Github</span>
      </Link>
    </div>
  );
}
