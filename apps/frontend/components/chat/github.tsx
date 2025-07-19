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
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
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

interface Repository {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
    type: string;
  };
  pushed_at: string | null;
}

interface Branch {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected?: boolean;
  protection?: {
    required_status_checks?: {
      enforcement_level: string;
      contexts: string[];
    };
  };
  protection_url?: string;
}

interface GroupedRepos {
  groups: {
    name: string;
    type: "user" | "organization";
    repositories: Repository[];
  }[];
}

export function GithubConnection({
  onSelect,
}: {
  onSelect?: (repoUrl: string, branch: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"repos" | "branches">("repos");
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [repoSearch, setRepoSearch] = useState("");
  const [branchSearch, setBranchSearch] = useState("");
  const [collapsedOrgs, setCollapsedOrgs] = useState<Set<string>>(new Set());

  const {
    data: groupedRepos = { groups: [] },
    isLoading: isLoadingRepos,
    error: reposError,
  } = useQuery({
    queryKey: ["github", "repositories"],
    queryFn: async (): Promise<GroupedRepos> => {
      const response = await fetch("/api/github/repositories");
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    },
    enabled: isOpen, // Only fetch when popover is open
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Query for branches
  const {
    data: branches = [],
    isLoading: isLoadingBranches,
    error: branchesError,
  } = useQuery({
    queryKey: ["github", "branches", selectedRepo?.full_name],
    queryFn: async (): Promise<Branch[]> => {
      if (!selectedRepo) return [];

      const response = await fetch(
        `/api/github/branches?repo=${selectedRepo.full_name}`
      );
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();

      // Sort branches: main/master first, then by last updated
      return data.sort((a: Branch, b: Branch) => {
        const isMainA = a.name === "main" || a.name === "master";
        const isMainB = b.name === "main" || b.name === "master";

        if (isMainA && !isMainB) return -1;
        if (!isMainA && isMainB) return 1;

        return a.name.localeCompare(b.name);
      });
    },
    enabled: !!selectedRepo && mode === "branches",
    staleTime: 2 * 60 * 1000,
  });

  if (reposError) {
    toast.error("Failed to fetch repositories", {
      description:
        reposError instanceof Error ? reposError.message : "Unknown error",
    });
  }

  if (branchesError) {
    toast.error("Failed to fetch branches", {
      description:
        branchesError instanceof Error
          ? branchesError.message
          : "Unknown error",
    });
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
    setMode("branches");
    setBranchSearch("");
  };

  const handleBranchSelect = (branchName: string) => {
    setSelectedBranch(branchName);
    setIsOpen(false);

    // Notify parent component of the selection
    if (selectedRepo && onSelect) {
      onSelect(selectedRepo.full_name, branchName);
    }
  };

  const handleBackToRepos = () => {
    setMode("repos");
    setSelectedRepo(null);
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
    return "Select Repository";
  };

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
                      {repo.pushed_at}
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
        {mode === "repos" ? renderRepos : renderBranches}
      </PopoverContent>
    </Popover>
  );
}
