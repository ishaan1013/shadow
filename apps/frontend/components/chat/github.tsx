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
import { useGitHubSelection } from "@/hooks/use-github-selection";
import { useGitHubStatus } from "@/hooks/use-github-status";
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

export function GithubConnection({
  onSelect,
}: {
  onSelect?: (repoUrl: string, branch: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"repos" | "branches">("repos");
  const { selectedRepo, selectedBranch, setRepoAndBranch } = useGitHubSelection();
  const [repoSearch, setRepoSearch] = useState("");
  const [branchSearch, setBranchSearch] = useState("");
  const [collapsedOrgs, setCollapsedOrgs] = useState<Set<string>>(new Set());

  // Query for GitHub status
  const {
    data: githubStatus,
    isLoading: isLoadingStatus,
    error: statusError,
  } = useGitHubStatus(isOpen);

  const {
    data: groupedRepos = { groups: [] },
    isLoading: isLoadingRepos,
    error: reposError,
  } = useGitHubRepositories(isOpen && !!githubStatus?.isAppInstalled);

  // Query for branches
  const {
    data: branches = [],
    isLoading: isLoadingBranches,
    error: branchesError,
  } = useGitHubBranches(
    selectedRepo?.full_name || null,
    !!selectedRepo && mode === "branches" && !!githubStatus?.isAppInstalled
  );

  // Handle errors with toast notifications, but don't break UI
  if (statusError) {
    console.error("GitHub status error:", statusError);
    // Don't show toast for status errors - these are handled by the UI states
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
    setRepoAndBranch(repo, selectedBranch || "");
    setMode("branches");
    setBranchSearch("");
  };

  const handleBranchSelect = (branchName: string) => {
    if (selectedRepo) {
      setRepoAndBranch(selectedRepo, branchName);
      setIsOpen(false);

      // Notify parent component of the selection
      onSelect?.(selectedRepo.full_name, branchName);
    }
  };

  const handleBackToRepos = () => {
    setMode("repos");
    setRepoSearch("");
  };

  const getButtonText = () => {
    if (selectedRepo && selectedBranch) {
      return (
        <>
          <Folder className="size-4" />
          <span>{selectedRepo.full_name}</span>
          <GitBranch className="size-4" />
          <span>{selectedBranch}</span>
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
    <div className="p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <img
          src="/github.svg"
          alt="GitHub"
          className="size-4"
          width={16}
          height={16}
        />
        <div className="font-medium">Connect Github</div>
      </div>
      <div className="text-sm text-muted-foreground mb-4">
        {statusError
          ? "Unable to check GitHub connection. Try again or report an issue."
          : "For required access, install the Shadow GitHub App to your organization."}
      </div>

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
        <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 size-3.5 text-muted-foreground" />
        <input
          placeholder="Search repositories..."
          value={repoSearch}
          autoFocus
          onChange={(e) => setRepoSearch(e.target.value)}
          className="pl-7 pr-3 h-9 text-sm focus:outline-none w-full"
        />
      </div>

      <div className="h-64 overflow-y-auto flex flex-col gap-2 py-2">
        {isLoadingRepos ? (
          <div className="flex items-center justify-center h-7 mt-1 gap-1.5 text-muted-foreground">
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
                  className="w-full !px-4.5 text-[13px] font-normal text-muted-foreground hover:bg-transparent gap-2"
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
              <CollapsibleContent className="flex flex-col gap-1 py-1 px-2">
                {group.repositories.map((repo) => (
                  <Button
                    key={repo.id}
                    variant="ghost"
                    size="sm"
                    className="w-full justify-between text-sm font-normal hover:bg-accent"
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
    </div>
  );

  const renderBranches = (
    <div>
      <button
        className="flex cursor-pointer items-center w-full text-sm gap-2 px-2 h-9 border-b hover:bg-sidebar-accent transition-colors"
        onClick={handleBackToRepos}
      >
        <ArrowLeft className="size-3.5" />
        <span className="truncate">{selectedRepo?.full_name}</span>
      </button>

      <div className="relative border-b">
        <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 size-3.5 text-muted-foreground" />
        <input
          placeholder="Search branches..."
          value={branchSearch}
          autoFocus
          onChange={(e) => setBranchSearch(e.target.value)}
          className="pl-7 pr-3 h-9 text-sm focus:outline-none w-full"
        />
      </div>

      <div className="h-64 overflow-y-auto flex flex-col gap-1 p-2">
        {isLoadingBranches ? (
          <div className="flex items-center justify-center h-7 mt-1 gap-1.5 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            <span className="text-[13px]">Loading branches...</span>
          </div>
        ) : (
          filteredBranches.map((branch) => (
            <Button
              key={branch.name}
              variant="ghost"
              size="sm"
              className="w-full justify-start text-sm font-normal hover:bg-accent"
              onClick={() => handleBranchSelect(branch.name)}
            >
              <span className="truncate">{branch.name}</span>
            </Button>
          ))
        )}
      </div>
    </div>
  );

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:bg-accent font-normal"
        >
          {getButtonText()}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        {isLoadingStatus ? (
          <div className="flex items-center justify-center h-20 gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-sm">Checking GitHub status...</span>
          </div>
        ) : statusError || !githubStatus || !githubStatus.isAppInstalled ? (
          renderConnectGitHub
        ) : mode === "repos" ? (
          renderRepos
        ) : (
          renderBranches
        )}
      </PopoverContent>
    </Popover>
  );
}
