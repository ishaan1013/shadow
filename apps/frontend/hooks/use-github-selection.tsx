"use client";

import { useState, useEffect } from "react";
import type { FilteredRepository as Repository } from "@/lib/github/types";

const COOKIE_NAME = "github-selection";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

interface GitHubSelection {
  repo: Repository | null;
  branch: string | null;
}

// Helper function to get a cookie by name
function getCookie(name: string): string | undefined {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return parts.pop()?.split(";").shift();
  }
  return undefined;
}

// Helper function to set a cookie
function setCookie(name: string, value: string, maxAge: number) {
  document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export function useGitHubSelection() {
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load from cookie on mount
  useEffect(() => {
    try {
      const stored = getCookie(COOKIE_NAME);
      if (stored) {
        const parsed: GitHubSelection = JSON.parse(decodeURIComponent(stored));
        setSelectedRepo(parsed.repo);
        setSelectedBranch(parsed.branch);
      }
      setIsInitialized(true);
    } catch (error) {
      console.error("Failed to load GitHub selection from cookie:", error);
      setIsInitialized(true);
    }
  }, []);

  // Save to cookie whenever values change, but only after initialization
  useEffect(() => {
    if (!isInitialized) return;
    
    try {
      const selection: GitHubSelection = {
        repo: selectedRepo,
        branch: selectedBranch,
      };
      
      const currentValue = getCookie(COOKIE_NAME);
      const newValue = encodeURIComponent(JSON.stringify(selection));
      
      // Only update if the value has changed
      if (currentValue !== newValue) {
        setCookie(COOKIE_NAME, newValue, COOKIE_MAX_AGE);
      }
    } catch (error) {
      console.error("Failed to save GitHub selection to cookie:", error);
    }
  }, [selectedRepo, selectedBranch, isInitialized]);

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