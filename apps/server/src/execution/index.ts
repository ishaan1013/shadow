/**
 * Factory functions for creating execution layer components
 * This is the main entry point for the abstraction layer
 */

import config from "../config";
import { AgentMode } from "@repo/types";
import { ToolExecutor } from "./interfaces/tool-executor";
import { WorkspaceManager } from "./interfaces/workspace-manager";
import { LocalToolExecutor } from "./local/local-tool-executor";
import { LocalWorkspaceManager } from "./local/local-workspace-manager";
import { FirecrackerToolExecutor } from "./firecracker/firecracker-tool-executor";
import { FirecrackerWorkspaceManager } from "./firecracker/firecracker-workspace-manager";

/**
 * Create a tool executor based on the configured agent mode
 */
export function createToolExecutor(
  taskId: string,
  workspacePath?: string,
  mode?: AgentMode
): ToolExecutor {
  const agentMode = mode || config.agentMode;

  if (agentMode === "local") {
    return new LocalToolExecutor(taskId, workspacePath);
  }

  // For Firecracker mode, workspacePath should be the sidecar URL
  // This will be provided by the FirecrackerWorkspaceManager
  const sidecarUrl = workspacePath || `http://shadow-vm-${taskId.toLowerCase()}.${config.kubernetesNamespace}.svc.cluster.local:8080`;
  return new FirecrackerToolExecutor(taskId, sidecarUrl);
}

/**
 * Create a workspace manager based on the configured agent mode
 */
export function createWorkspaceManager(mode?: AgentMode): WorkspaceManager {
  const agentMode = mode || config.agentMode;

  switch (agentMode) {
    case "local":
      return new LocalWorkspaceManager();

    case "firecracker":
      return new FirecrackerWorkspaceManager();

    default:
      throw new Error(`Unsupported agent mode: ${agentMode}`);
  }
}

/**
 * Get the current agent mode from configuration
 */
export function getAgentMode(): AgentMode {
  return config.agentMode;
}

/**
 * Check if the current mode is Firecracker
 */
export function isFirecrackerMode(): boolean {
  return config.agentMode === "firecracker";
}

/**
 * Check if the current mode is local
 */
export function isLocalMode(): boolean {
  return config.agentMode === "local";
}

/**
 * Check if the current mode requires VM infrastructure
 */
export function isVMMode(): boolean {
  return config.agentMode === "firecracker";
}

// Re-export types and interfaces for convenience
export type { ToolExecutor, WorkspaceManager };
export type {
  AgentMode,
  FileResult,
  WriteResult,
  DeleteResult,
  DirectoryListing,
  FileSearchResult,
  GrepResult,
  SemanticSearchToolResult,
} from "@repo/types";
export type {
  CommandResult,
  WorkspaceInfo,
  WorkspaceStatus,
  HealthStatus,
} from "./interfaces/types";