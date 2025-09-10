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
import { RemoteToolExecutor } from "./remote/remote-tool-executor";
import { RemoteWorkspaceManager } from "./remote/remote-workspace-manager";
import { RemoteVMRunner } from "./remote/remote-vm-runner";
import { LocalGitService } from "./local/local-git-service";
import { RemoteGitService } from "./remote/remote-git-service";
import { GitService } from "./interfaces/git-service";
import { GitManager } from "../services/git-manager";
import { prisma } from "@repo/db";
import path from "path";

/**
 * Create a tool executor based on the configured agent mode
 * For remote mode, uses dynamic pod discovery to find actual running VMs
 */
export async function createToolExecutor(
  taskId: string,
  workspacePath?: string,
  mode?: AgentMode
): Promise<ToolExecutor> {
  const agentMode = mode || config.agentMode;

  if (agentMode === "local") {
    return new LocalToolExecutor(taskId, workspacePath);
  }

  // For remote mode, use dynamic pod discovery to find the actual running VM
  try {
    const vmRunner = new RemoteVMRunner();
    const pod = await vmRunner.getVMPodStatus(taskId);
    const podIP = pod.status?.podIP;

    if (!podIP) {
      throw new Error(
        `Pod IP not available for task ${taskId}. Pod may not be running.`
      );
    }

    // Use direct pod IP connectivity (same approach as working file operations)
    const sidecarUrl = `http://${podIP}:8080`;
    return new RemoteToolExecutor(taskId, sidecarUrl);
  } catch (error) {
    console.error(
      `[CREATE_TOOL_EXECUTOR] Failed to find pod for task ${taskId}:`,
      error
    );

    // Check if this is a pod not found error (404)
    const isNotFound =
      error instanceof Error &&
      (error.message.includes("404") ||
        error.message.includes("not found") ||
        error.message.includes("NotFound"));

    if (isNotFound) {
      throw new Error(
        `Remote workspace for task ${taskId} is not available. This usually means the workspace was cleaned up due to inactivity. Please try your request again to automatically reconnect.`
      );
    }

    throw new Error(
      `Cannot create remote tool executor for task ${taskId}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Create a workspace manager based on the configured agent mode
 */
export function createWorkspaceManager(mode?: AgentMode): WorkspaceManager {
  const agentMode = mode || config.agentMode;

  switch (agentMode) {
    case "local":
      return new LocalWorkspaceManager();

    case "remote":
      return new RemoteWorkspaceManager();

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
 * Deterministically compute the local workspace path for a given id (taskId or variantId)
 * Path format: <workspaceDir>/tasks/<id>
 */
export function getLocalWorkspacePathForId(pathId: string): string {
  if (pathId.includes("/")) {
    pathId = pathId.split("/").pop()!;
  }
  return path.join(config.workspaceDir, "tasks", pathId);
}

/**
 * Create a git service based on the configured agent mode
 * Provides unified git operations interface for both local and remote execution
 * Now variant-first: takes variantId and derives workspace info from the variant
 */
export async function createGitService(variantId: string): Promise<GitService> {
  const agentMode = getAgentMode();

  // Get variant info (includes taskId for remote mode and workspacePath for local mode)
  const variant = await prisma.variant.findUnique({
    where: { id: variantId },
    select: {
      workspacePath: true,
      taskId: true,
    },
  });

  if (!variant) {
    throw new Error(`Variant ${variantId} not found`);
  }

  if (agentMode === "remote") {
    // For remote mode, use the tool executor to wrap git operations (needs taskId for VM pod discovery)
    const toolExecutor = await createToolExecutor(variant.taskId);
    return new RemoteGitService(toolExecutor as RemoteToolExecutor);
  } else {
    // For local mode, use variant's workspace path
    if (!variant.workspacePath) {
      throw new Error(`Variant ${variantId} has no workspace path`);
    }

    const gitManager = new GitManager(variant.workspacePath);
    return new LocalGitService(gitManager);
  }
}

/**
 * Check if the current mode is remote
 */
export function isRemoteMode(): boolean {
  return config.agentMode === "remote";
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
  return config.agentMode === "remote";
}

// Re-export types and interfaces for convenience
export type { ToolExecutor, WorkspaceManager, GitService };
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
