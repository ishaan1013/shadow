import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function truncateBranchName(branchName: string, maxLength: number = 20): string {
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
}

export function formatTimeAgo(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return `${diffSeconds}s`;
  if (diffMinutes < 60) return `${diffMinutes}m`;
  if (diffHours < 24) return `${diffHours}h`;
  return `${diffDays}d`;
}