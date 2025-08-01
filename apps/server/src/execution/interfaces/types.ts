/**
 * Shared types for the execution abstraction layer
 * These types define the contracts between local and remote execution modes
 */

import { CommandResult as BaseCommandResult } from "@repo/types";
import { CommandSecurityLevel } from "@repo/command-security";

// Extend the base CommandResult with server-specific security level type
export interface CommandResult extends BaseCommandResult {
  securityLevel?: CommandSecurityLevel;
}

// Workspace management types
export interface TaskConfig {
  id: string;
  repoFullName: string;
  repoUrl: string;
  baseBranch: string;
  shadowBranch: string;
  userId: string;
}

export interface WorkspaceInfo {
  success: boolean;
  workspacePath: string;
  cloneResult?: unknown;
  error?: string;
  // Remote mode specific fields
  podName?: string;
  podNamespace?: string;
  serviceName?: string;
}

export interface WorkspaceStatus {
  exists: boolean;
  path: string;
  sizeBytes?: number;
  isReady: boolean;
  error?: string;
}

export interface HealthStatus {
  healthy: boolean;
  message: string;
  details?: Record<string, unknown>;
}