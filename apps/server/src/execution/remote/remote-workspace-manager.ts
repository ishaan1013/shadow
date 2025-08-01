import { WorkspaceManager } from "../interfaces/workspace-manager";
import { ToolExecutor } from "../interfaces/tool-executor";
import {
  WorkspaceInfo,
  WorkspaceStatus,
  HealthStatus,
  TaskConfig,
} from "../interfaces/types";
import config from "../../config";
import { getGitHubAccessToken } from "../../utils/github-account";
import { RemoteToolExecutor } from "./remote-tool-executor";
import { RemoteVMRunner } from "./remote-vm-runner";

/**
 * RemoteWorkspaceManager manages remote VMs for isolated agent execution
 * Each task gets its own VM with hardware-level isolation
 */
export class RemoteWorkspaceManager implements WorkspaceManager {
  private vmRunner: RemoteVMRunner;

  constructor(
    options: {
      k8sApiUrl?: string;
      namespace?: string;
      token?: string;
      timeout?: number;
    } = {}
  ) {
    this.vmRunner = new RemoteVMRunner(options);
  }

  /**
   * Prepare a workspace for a task by creating a remote VM
   */
  async prepareWorkspace(taskConfig: TaskConfig): Promise<WorkspaceInfo> {
    try {
      console.log(
        `[REMOTE_WM] Preparing remote VM workspace for task ${taskConfig.id}`
      );

      // Get GitHub access token for the user
      const githubToken = await getGitHubAccessToken(taskConfig.userId);
      if (!githubToken) {
        throw new Error(
          `No GitHub access token found for user ${taskConfig.userId}`
        );
      }

      // Create the remote VM pod using the VM runner
      const createdPod = await this.vmRunner.createVMPod(
        taskConfig,
        githubToken
      );
      console.log(
        `[REMOTE_WM] Created remote VM pod: ${createdPod.metadata?.name}`
      );

      // Wait for VM to be ready (this includes VM boot time and sidecar startup)
      await this.vmRunner.waitForVMReady(taskConfig.id);

      // Get the pod details to extract networking information
      const podDetails = await this.vmRunner.getVMPodStatus(taskConfig.id);
      const podIP = podDetails.status?.podIP;
      const workspacePath = `/workspace`; // Standard workspace path in VM

      console.log(
        `[REMOTE_WM] Remote VM workspace ready at ${podIP}:8080`
      );
      console.log(
        `[REMOTE_WM] VM is running with true hardware isolation`
      );

      return {
        success: true,
        workspacePath,
        podName: createdPod.metadata?.name,
        podNamespace: createdPod.metadata?.namespace,
        serviceName: `http://${podIP}:8080`,
      };
    } catch (error) {
      console.error(
        `[REMOTE_WM] Failed to prepare remote VM workspace:`,
        error
      );
      return {
        success: false,
        workspacePath: "",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async cleanupWorkspace(
    taskId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      console.log(
        `[REMOTE_WM] Cleaning up remote VM workspace for task ${taskId}`
      );

      // Delete the VM pod using the VM runner
      await this.vmRunner.deleteVMPod(taskId);

      console.log(
        `[REMOTE_WM] Deleted remote VM pod: shadow-vm-${taskId.toLowerCase().replaceAll("_", "-")}`
      );

      return {
        success: true,
        message: `Remote VM workspace cleaned up successfully for task ${taskId}`,
      };
    } catch (error) {
      console.error(
        `[REMOTE_WM] Failed to cleanup remote VM workspace:`,
        error
      );
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async getWorkspaceStatus(taskId: string): Promise<WorkspaceStatus> {
    try {
      const pod = await this.vmRunner.getVMPodStatus(taskId);

      const phase = pod.status?.phase;
      const conditions = pod.status?.conditions || [];
      const readyCondition = conditions.find((c) => c.type === "Ready");

      return {
        exists: true,
        path: "/workspace",
        isReady: phase === "Running" && readyCondition?.status === "True",
      };
    } catch (error) {
      return {
        exists: false,
        path: "",
        isReady: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get the workspace path for a task (standard VM path)
   */
  getWorkspacePath(_taskId: string): string {
    return "/workspace";
  }

  async workspaceExists(taskId: string): Promise<boolean> {
    try {
      await this.vmRunner.getVMPodStatus(taskId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get workspace size (not applicable for VMs, return fixed value)
   */
  async getWorkspaceSize(_taskId: string): Promise<number> {
    // For VMs, return the configured storage limit in bytes
    const limitStr = config.vmStorageLimit; // e.g., "10Gi"
    const match = limitStr.match(/^(\d+)([KMGT]i?)$/);
    if (!match) return 10 * 1024 * 1024 * 1024; // Default 10GB

    const value = parseInt(match[1]!);
    const unit = match[2]!;

    const multipliers: Record<string, number> = {
      K: 1024,
      Ki: 1024,
      M: 1024 * 1024,
      Mi: 1024 * 1024,
      G: 1024 * 1024 * 1024,
      Gi: 1024 * 1024 * 1024,
      T: 1024 * 1024 * 1024 * 1024,
      Ti: 1024 * 1024 * 1024 * 1024,
    };

    return value * (multipliers[unit] || 1);
  }

  async getExecutor(taskId: string): Promise<ToolExecutor> {
    // Get pod IP for direct connectivity
    const pod = await this.vmRunner.getVMPodStatus(taskId);
    const podIP = pod.status?.podIP;

    if (!podIP) {
      throw new Error(`Pod IP not available for task ${taskId}`);
    }

    // Use direct pod IP connectivity
    const sidecarUrl = `http://${podIP}:8080`;
    console.log(`[REMOTE_WM] Using direct pod IP: ${sidecarUrl}`);
    return new RemoteToolExecutor(taskId, sidecarUrl);
  }


  async healthCheck(taskId: string): Promise<HealthStatus> {
    try {
      const status = await this.getWorkspaceStatus(taskId);

      if (!status.exists) {
        return {
          healthy: false,
          message: `VM workspace does not exist for task ${taskId}`,
        };
      }

      if (!status.isReady) {
        return {
          healthy: false,
          message: `VM workspace is not ready for task ${taskId}`,
        };
      }

      // Try to get the executor and test connectivity
      const executor = await this.getExecutor(taskId);
      if (executor.isRemote()) {
        // For remote executors, we could add a ping test here
        return {
          healthy: true,
          message: `VM workspace is healthy for task ${taskId}`,
        };
      }

      return {
        healthy: true,
        message: `VM workspace is healthy for task ${taskId}`,
      };
    } catch (error) {
      return {
        healthy: false,
        message: `Health check failed for task ${taskId}: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  isRemote(): boolean {
    return true;
  }
}
