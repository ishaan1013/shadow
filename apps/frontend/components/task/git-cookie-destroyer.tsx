"use client";

import { deleteGitSelectorCookie } from "@/lib/actions/git-selector-cookie";
import { useEffect } from "react";

export const GitCookieDestroyer = ({
  shouldDeleteGitCookie,
}: {
  shouldDeleteGitCookie: boolean;
}) => {
  useEffect(() => {
    if (shouldDeleteGitCookie) {
      deleteGitSelectorCookie();
    }
  }, [shouldDeleteGitCookie]);

  return null;
};
