"use client";

import { useState, useEffect } from "react";
import type { FilteredRepository as Repository } from "@/lib/github/types";

const STORAGE_KEY = "github-selection";

interface GitHubSelection {
  repo: Repository | null;
  branch: string | null;
}

export function useGitHubSelection() {
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: GitHubSelection = JSON.parse(stored);
        setSelectedRepo(parsed.repo);
        setSelectedBranch(parsed.branch);
      }
    } catch (error) {
      console.error("Failed to load GitHub selection from localStorage:", error);
    }
  }, []);

  // Save to localStorage whenever values change
  useEffect(() => {
    try {
      const selection: GitHubSelection = {
        repo: selectedRepo,
        branch: selectedBranch,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
    } catch (error) {
      console.error("Failed to save GitHub selection to localStorage:", error);
    }
  }, [selectedRepo, selectedBranch]);

  const setRepoAndBranch = (repo: Repository, branch: string) => {
    setSelectedRepo(repo);
    setSelectedBranch(branch);
  };

  const clearSelection = () => {
    setSelectedRepo(null);
    setSelectedBranch(null);
  };

  return {
    selectedRepo,
    selectedBranch,
    setSelectedRepo,
    setSelectedBranch,
    setRepoAndBranch,
    clearSelection,
  };
}