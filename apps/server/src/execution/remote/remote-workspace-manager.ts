import { WorkspaceManager } from "../interfaces/workspace-manager";
import { ToolExecutor } from "../interfaces/tool-executor";
import {
  WorkspaceInfo,
  WorkspaceStatus,
  HealthStatus,
  TaskConfig,
} from "../interfaces/types";
import config from "../../config";
import { prisma } from "@repo/db";
import { GitManager } from "../../services/git-manager";
import { getGitHubAccessToken } from "../../utils/github-account";
import { SidecarClient } from "./sidecar-client";

/**
 * RemoteWorkspaceManager manages Kubernetes pods for remote agent execution
 * Each task gets its own pod with a sidecar API for tool operations
 */
export class RemoteWorkspaceManager implements WorkspaceManager {
  private k8sApiUrl: string;
  private namespace: string;
  private token: string;
  private timeout: number;

  constructor(options: {
    k8sApiUrl?: string;
    namespace?: string;
    token?: string;
    timeout?: number;
  } = {}) {
    this.k8sApiUrl = options.k8sApiUrl || this.getK8sApiUrl();
    this.namespace = options.namespace || config.kubernetesNamespace || "shadow";
    this.token = options.token || this.getServiceAccountToken();
    this.timeout = options.timeout || 60000; // 60 second timeout for K8s operations
  }

  /**
   * Get SidecarClient instance for a specific task
   */
  private getSidecarClient(taskId: string): SidecarClient {
    return new SidecarClient({
      taskId,
      namespace: this.namespace,
      port: config.sidecarPort || 8080,
      timeout: 30000, // 30 second timeout for sidecar operations
      maxRetries: 3,
      retryDelay: 1000,
    });
  }

  /**
   * Get Kubernetes API server URL from environment
   */
  private getK8sApiUrl(): string {
    // When running in-cluster, this is typically available
    return config.kubernetesServiceHost && config.kubernetesServicePort
      ? `https://${config.kubernetesServiceHost}:${config.kubernetesServicePort}`
      : "https://kubernetes.default.svc";
  }

  /**
   * Get service account token for K8s API authentication
   */
  private getServiceAccountToken(): string {
    // In a real implementation, read from mounted service account token
    return config.k8sServiceAccountToken || "mock-token";
  }

  /**
   * Make authenticated request to Kubernetes API
   */
  private async makeK8sRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.k8sApiUrl}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Authorization": `Bearer ${this.token}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
        signal: controller.signal,
        // Skip TLS verification in dev (in prod, proper certs should be configured)
        ...(config.nodeEnv === "development" && {
          // Note: fetch doesn't support rejectUnauthorized, this would need node-fetch or similar
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Kubernetes API error ${response.status}: ${response.statusText}. ${errorText}`
        );
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new Error(`Kubernetes API request timeout after ${this.timeout}ms`);
        }
        throw error;
      }
      throw new Error("Unknown Kubernetes API error");
    }
  }

  async prepareWorkspace(taskConfig: TaskConfig): Promise<WorkspaceInfo> {
    const { id: taskId, repoUrl, baseBranch, shadowBranch, userId } = taskConfig;

    try {
      console.log(`[REMOTE_WORKSPACE] Preparing workspace for task ${taskId}`);

      await this.createWorkspacePVC(taskId);
      await this.ensureSharedCachePVC();
      const podSpec = this.createAgentPodSpec(taskId, repoUrl, baseBranch, shadowBranch, userId);
      const pod = await this.makeK8sRequest<any>(`/api/v1/namespaces/${this.namespace}/pods`, {
        method: "POST",
        body: JSON.stringify(podSpec),
      });

      console.log(`[REMOTE_WORKSPACE] Created pod ${pod.metadata.name} for task ${taskId}`);

      await this.waitForPodReady(taskId);
      const service = await this.createPodService(taskId);

      console.log(`[REMOTE_WORKSPACE] Created service ${service.metadata.name} for task ${taskId}`);

      // Step 1: Clone repository to pod workspace
      const sidecarClient = this.getSidecarClient(taskId);
      try {
        const githubToken = await getGitHubAccessToken(userId);
        if (!githubToken) {
          throw new Error("No valid GitHub access token found for user");
        }

        const cloneResponse = await sidecarClient.cloneRepository(repoUrl, baseBranch, githubToken);

        if (!cloneResponse.success) {
          throw new Error(`Repository clone failed: ${cloneResponse.message}`);
        }

        console.log(`[REMOTE_WORKSPACE] Repository cloned successfully for task ${taskId}`);
      } catch (error) {
        console.error(`[REMOTE_WORKSPACE] Failed to clone repository for task ${taskId}:`, error);
        return {
          success: false,
          workspacePath: "",
          error: `Repository clone failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
      }

      // Step 2: Set up git configuration and shadow branch
      try {
        await this.setupGitBranchTracking(taskId, baseBranch, shadowBranch, userId);
      } catch (error) {
        console.error(`[REMOTE_WORKSPACE] Failed to setup git for task ${taskId}:`, error);
        return {
          success: false,
          workspacePath: "",
          error: `Git setup failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
      }

      return {
        success: true,
        workspacePath: "/workspace", // Standard path inside the pod
        podName: pod.metadata.name,
        podNamespace: this.namespace,
        serviceName: service.metadata.name,
        cloneResult: {
          repoUrl,
          baseBranch,
          success: true,
        },
      };
    } catch (error) {
      console.error(`[REMOTE_WORKSPACE] Failed to prepare workspace for task ${taskId}:`, error);

      return {
        success: false,
        workspacePath: "",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async getWorkspaceStatus(taskId: string): Promise<WorkspaceStatus> {
    try {
      const podName = `shadow-agent-${taskId}`;

      const pod = await this.makeK8sRequest<any>(
        `/api/v1/namespaces/${this.namespace}/pods/${podName}`
      );

      const isReady = pod.status?.phase === "Running" &&
        pod.status?.conditions?.some((c: any) => c.type === "Ready" && c.status === "True");

      return {
        exists: true,
        path: "/workspace",
        isReady,
        sizeBytes: undefined,
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

  async cleanupWorkspace(taskId: string): Promise<{ success: boolean; message: string }> {
    try {
      console.log(`[REMOTE_WORKSPACE] Cleaning up workspace for task ${taskId}`);

      const podName = `shadow-agent-${taskId}`;
      const serviceName = `shadow-agent-${taskId}`;

      // Step 1: Commit any final changes before destroying the pod
      try {
        await this.commitFinalChanges(taskId);
      } catch (error) {
        console.warn(`[REMOTE_WORKSPACE] Failed to commit final changes for task ${taskId}:`, error);
      }

      // Step 2: Delete the service first
      try {
        await this.makeK8sRequest(`/api/v1/namespaces/${this.namespace}/services/${serviceName}`, {
          method: "DELETE",
        });
        console.log(`[REMOTE_WORKSPACE] Deleted service ${serviceName}`);
      } catch (error) {
        console.warn(`[REMOTE_WORKSPACE] Failed to delete service ${serviceName}:`, error);
      }

      // Step 3: Delete the pod
      try {
        await this.makeK8sRequest(`/api/v1/namespaces/${this.namespace}/pods/${podName}`, {
          method: "DELETE",
        });
        console.log(`[REMOTE_WORKSPACE] Deleted pod ${podName}`);
      } catch (error) {
        console.warn(`[REMOTE_WORKSPACE] Failed to delete pod ${podName}:`, error);
      }

      // Step 4: Delete workspace PVC if using EFS
      await this.cleanupWorkspacePVC(taskId);

      return {
        success: true,
        message: `Cleaned up workspace for task ${taskId}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to cleanup workspace for task ${taskId}: ${error instanceof Error ? error.message : "Unknown error"
          }`,
      };
    }
  }

  /**
   * Commit any final changes before pod termination
   */
  private async commitFinalChanges(taskId: string): Promise<void> {
    try {
      const sidecarClient = this.getSidecarClient(taskId);

      // Check if there are any uncommitted changes
      const statusResponse = await sidecarClient.getGitStatus();

      if (!statusResponse.success || !statusResponse.hasChanges) {
        console.log(`[REMOTE_WORKSPACE] No final changes to commit for task ${taskId}`);
        return;
      }

      // Get user information for the commit
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: { user: true },
      });

      if (!task || !task.user) {
        console.warn(`[REMOTE_WORKSPACE] Cannot find user for final commit of task ${taskId}`);
        return;
      }

      // Get diff from sidecar to generate commit message on server side
      const diffResponse = await sidecarClient.getGitDiff();

      let commitMessage = "Final commit before task completion";
      if (diffResponse.success && diffResponse.diff) {
        // Generate commit message using server-side GitManager (which has AI integration)
        const tempGitManager = new GitManager("", taskId);
        commitMessage = await tempGitManager.generateCommitMessage(diffResponse.diff);
      }

      // Commit the final changes
      const commitResponse = await sidecarClient.commitChanges(
        {
          name: task.user.name,
          email: task.user.email,
        },
        {
          name: "Shadow",
          email: "noreply@shadow.ai",
        },
        commitMessage
      );

      if (!commitResponse.success) {
        throw new Error(`Final commit failed: ${commitResponse.message}`);
      }

      const pushResponse = await sidecarClient.pushBranch(task.shadowBranch!, false);

      if (!pushResponse.success) {
        console.warn(`[REMOTE_WORKSPACE] Failed to push final commit for task ${taskId}: ${pushResponse.message}`);
      }

      console.log(`[REMOTE_WORKSPACE] Final changes committed and pushed for task ${taskId}`);
    } catch (error) {
      console.error(`[REMOTE_WORKSPACE] Error in final commit for task ${taskId}:`, error);
      throw error;
    }
  }

  async healthCheck(taskId: string): Promise<HealthStatus> {
    try {
      const status = await this.getWorkspaceStatus(taskId);

      if (!status.exists) {
        return {
          healthy: false,
          message: `Pod for task ${taskId} does not exist`,
        };
      }

      if (!status.isReady) {
        return {
          healthy: false,
          message: `Pod for task ${taskId} is not ready`,
        };
      }

      // Try to ping the sidecar API using SidecarClient
      const sidecarClient = this.getSidecarClient(taskId);

      try {
        const healthResponse = await sidecarClient.healthCheck();

        if (healthResponse.healthy) {
          return {
            healthy: true,
            message: `Workspace for task ${taskId} is healthy`,
            details: {
              podReady: true,
              sidecarResponding: true,
            },
          };
        } else {
          return {
            healthy: false,
            message: `Sidecar API not healthy for task ${taskId}: ${healthResponse.message}`,
            details: {
              podReady: true,
              sidecarResponding: false,
            },
          };
        }
      } catch {
        return {
          healthy: false,
          message: `Cannot reach sidecar API for task ${taskId}`,
          details: {
            podReady: true,
            sidecarResponding: false,
          },
        };
      }
    } catch (error) {
      return {
        healthy: false,
        message: `Health check failed for task ${taskId}: ${error instanceof Error ? error.message : "Unknown error"
          }`,
      };
    }
  }

  /**
   * Setup git operations in remote pod via sidecar APIs
   * This mirrors the local mode git setup workflow
   */
  private async setupGitBranchTracking(
    taskId: string,
    baseBranch: string,
    shadowBranch: string,
    userId: string
  ): Promise<void> {
    try {
      console.log(`[REMOTE_WORKSPACE] Setting up git for task ${taskId} via sidecar APIs`);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      });

      if (!user) {
        throw new Error(`User not found: ${userId}`);
      }

      const sidecarClient = this.getSidecarClient(taskId);

      // Step 1: Configure git user in the pod
      const configResponse = await sidecarClient.configureGitUser(user.name, user.email);

      if (!configResponse.success) {
        throw new Error(`Failed to configure git user: ${configResponse.message}`);
      }

      // Step 2: Create shadow branch
      const branchResponse = await sidecarClient.createShadowBranch(baseBranch, shadowBranch);

      if (!branchResponse.success) {
        throw new Error(`Failed to create shadow branch: ${branchResponse.message}`);
      }

      // Step 3: Update task in database with actual base commit SHA
      await prisma.task.update({
        where: { id: taskId },
        data: {
          baseCommitSha: branchResponse.baseCommitSha || "unknown",
        },
      });

      console.log(`[REMOTE_WORKSPACE] Git setup complete for task ${taskId}:`, {
        baseBranch,
        shadowBranch,
        baseCommitSha: branchResponse.baseCommitSha,
      });
    } catch (error) {
      console.error(`[REMOTE_WORKSPACE] Failed to setup git for task ${taskId}:`, error);
      throw error;
    }
  }


  /**
   * Create Kubernetes pod specification for the agent
   */
  private createAgentPodSpec(
    taskId: string,
    repoUrl: string,
    baseBranch: string,
    shadowBranch: string,
    userId: string
  ): any {
    const podName = `shadow-agent-${taskId}`;
    const imageName = config.sidecarImage || "shadow-sidecar:latest";

    return {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name: podName,
        namespace: this.namespace,
        labels: {
          app: "shadow-agent",
          taskId,
          userId,
        },
        annotations: {
          "shadow.ai/repo-url": repoUrl,
          "shadow.ai/branch": baseBranch,
          "shadow.ai/created-at": new Date().toISOString(),
        },
      },
      spec: {
        restartPolicy: "Never", // Task pods should not restart
        containers: [
          {
            name: "agent",
            image: imageName,
            ports: [
              {
                containerPort: config.sidecarPort || 8080,
                name: "api",
              },
            ],
            env: [
              {
                name: "TASK_ID",
                value: taskId,
              },
              {
                name: "REPO_URL",
                value: repoUrl,
              },
              {
                name: "BASE_BRANCH",
                value: baseBranch,
              },
              {
                name: "SHADOW_BRANCH",
                value: shadowBranch,
              },
              {
                name: "USER_ID",
                value: userId,
              },
              {
                name: "WORKSPACE_PATH",
                value: "/workspace",
              },
            ],
            volumeMounts: this.createVolumeMounts(),
            resources: {
              requests: {
                cpu: "250m",
                memory: "512Mi",
              },
              limits: {
                cpu: config.remoteCpuLimit || "1000m",
                memory: config.remoteMemoryLimit || "2Gi",
              },
            },
            readinessProbe: {
              httpGet: {
                path: config.sidecarHealthPath || "/health",
                port: config.sidecarPort || 8080,
              },
              initialDelaySeconds: 10,
              periodSeconds: 5,
              timeoutSeconds: 3,
            },
            livenessProbe: {
              httpGet: {
                path: config.sidecarHealthPath || "/health",
                port: config.sidecarPort || 8080,
              },
              initialDelaySeconds: 30,
              periodSeconds: 10,
              timeoutSeconds: 5,
            },
          },
        ],
        volumes: this.createWorkspaceVolumes(taskId),
        // Security context
        securityContext: {
          runAsNonRoot: true,
          runAsUser: 1000,
          fsGroup: 1000,
        },
      },
    };
  }

  /**
   * Create volume mounts for the container
   */
  private createVolumeMounts(): any[] {
    const efsVolumeId = config.efsVolumeId;

    const mounts = [
      {
        name: "workspace",
        mountPath: "/workspace",
      },
    ];

    // Add shared cache mount if using EFS
    if (efsVolumeId) {
      mounts.push({
        name: "shared-cache",
        mountPath: "/shared-cache",
      });
    }

    return mounts;
  }

  /**
   * Create workspace volumes based on configuration
   * Uses EFS for persistence if configured, otherwise emptyDir
   */
  private createWorkspaceVolumes(taskId: string): any[] {
    const efsVolumeId = config.efsVolumeId;

    if (efsVolumeId) {
      // Use EFS persistent storage
      return [
        {
          name: "workspace",
          persistentVolumeClaim: {
            claimName: `shadow-workspace-${taskId}`,
          },
        },
        {
          name: "shared-cache",
          persistentVolumeClaim: {
            claimName: "shadow-shared-cache",
          },
        },
      ];
    } else {
      // Fallback to emptyDir (current behavior)
      return [
        {
          name: "workspace",
          emptyDir: {
            sizeLimit: "10Gi", // 10GB limit for workspace
          },
        },
      ];
    }
  }

  /**
   * Create EFS PersistentVolumeClaim for workspace if using persistent storage
   */
  private async createWorkspacePVC(taskId: string): Promise<void> {
    const efsVolumeId = config.efsVolumeId;
    if (!efsVolumeId) {
      return; // Skip if not using EFS
    }

    const pvcName = `shadow-workspace-${taskId}`;

    const pvcSpec = {
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: {
        name: pvcName,
        namespace: this.namespace,
        labels: {
          app: "shadow-agent",
          taskId,
        },
        annotations: {
          "shadow.ai/task-id": taskId,
          "shadow.ai/created-at": new Date().toISOString(),
        },
      },
      spec: {
        accessModes: ["ReadWriteMany"], // EFS supports multiple readers/writers
        storageClassName: "efs-sc", // EFS storage class
        resources: {
          requests: {
            storage: config.remoteStorageLimit || "10Gi",
          },
        },
      },
    };

    try {
      await this.makeK8sRequest<any>(`/api/v1/namespaces/${this.namespace}/persistentvolumeclaims`, {
        method: "POST",
        body: JSON.stringify(pvcSpec),
      });

      console.log(`[REMOTE_WORKSPACE] Created EFS PVC ${pvcName} for task ${taskId}`);
    } catch (error) {
      console.error(`[REMOTE_WORKSPACE] Failed to create PVC ${pvcName}:`, error);
      throw error;
    }
  }

  /**
   * Create shared cache PVC if it doesn't exist
   */
  private async ensureSharedCachePVC(): Promise<void> {
    const efsVolumeId = config.efsVolumeId;
    if (!efsVolumeId) {
      return; // Skip if not using EFS
    }

    const pvcName = "shadow-shared-cache";

    try {
      // Check if shared cache PVC already exists
      await this.makeK8sRequest<any>(`/api/v1/namespaces/${this.namespace}/persistentvolumeclaims/${pvcName}`);
      console.log(`[REMOTE_WORKSPACE] Shared cache PVC ${pvcName} already exists`);
      return;
    } catch (_error) {
      // PVC doesn't exist, create it
    }

    const pvcSpec = {
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: {
        name: pvcName,
        namespace: this.namespace,
        labels: {
          app: "shadow-shared-cache",
          component: "cache",
        },
        annotations: {
          "shadow.ai/purpose": "shared-build-cache",
          "shadow.ai/created-at": new Date().toISOString(),
        },
      },
      spec: {
        accessModes: ["ReadWriteMany"], // Shared across multiple pods
        storageClassName: "efs-sc",
        resources: {
          requests: {
            storage: "50Gi", // Larger shared cache
          },
        },
      },
    };

    try {
      await this.makeK8sRequest<any>(`/api/v1/namespaces/${this.namespace}/persistentvolumeclaims`, {
        method: "POST",
        body: JSON.stringify(pvcSpec),
      });

      console.log(`[REMOTE_WORKSPACE] Created shared cache PVC ${pvcName}`);
    } catch (error) {
      console.error(`[REMOTE_WORKSPACE] Failed to create shared cache PVC:`, error);
      // Don't throw - shared cache is optional
    }
  }

  /**
   * Delete workspace PVC on cleanup
   */
  private async cleanupWorkspacePVC(taskId: string): Promise<void> {
    const efsVolumeId = config.efsVolumeId;
    if (!efsVolumeId) {
      return;
    }

    const pvcName = `shadow-workspace-${taskId}`;

    try {
      await this.makeK8sRequest(`/api/v1/namespaces/${this.namespace}/persistentvolumeclaims/${pvcName}`, {
        method: "DELETE",
      });
      console.log(`[REMOTE_WORKSPACE] Deleted workspace PVC ${pvcName}`);
    } catch (error) {
      console.warn(`[REMOTE_WORKSPACE] Failed to delete workspace PVC ${pvcName}:`, error);
    }
  }

  /**
   * Create Kubernetes service for pod communication
   */
  private async createPodService(taskId: string): Promise<any> {
    const serviceName = `shadow-agent-${taskId}`;

    const serviceSpec = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: serviceName,
        namespace: this.namespace,
        labels: {
          app: "shadow-agent",
          taskId,
        },
      },
      spec: {
        selector: {
          app: "shadow-agent",
          taskId,
        },
        ports: [
          {
            port: config.sidecarPort || 8080,
            targetPort: config.sidecarPort || 8080,
            name: "api",
          },
        ],
        type: "ClusterIP", // Internal service only
      },
    };

    return await this.makeK8sRequest<any>(`/api/v1/namespaces/${this.namespace}/services`, {
      method: "POST",
      body: JSON.stringify(serviceSpec),
    });
  }

  /**
   * Wait for pod to be ready with timeout
   */
  private async waitForPodReady(taskId: string, timeoutMs: number = 120000): Promise<void> {
    const podName = `shadow-agent-${taskId}`;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const pod = await this.makeK8sRequest<any>(
          `/api/v1/namespaces/${this.namespace}/pods/${podName}`
        );

        const isReady = pod.status?.phase === "Running" &&
          pod.status?.conditions?.some((c: any) => c.type === "Ready" && c.status === "True");

        if (isReady) {
          console.log(`[REMOTE_WORKSPACE] Pod ${podName} is ready`);
          return;
        }

        if (pod.status?.phase === "Failed") {
          throw new Error(`Pod ${podName} failed to start: ${pod.status.message}`);
        }

        // Wait 2 seconds before checking again
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        if (Date.now() - startTime >= timeoutMs) {
          throw new Error(`Timeout waiting for pod ${podName} to be ready: ${error}`);
        }
        // Continue waiting on transient errors
      }
    }

    throw new Error(`Timeout waiting for pod ${podName} to be ready after ${timeoutMs}ms`);
  }

  /**
   * List all agent pods for debugging
   */
  async listAgentPods(): Promise<any[]> {
    try {
      const response = await this.makeK8sRequest<any>(
        `/api/v1/namespaces/${this.namespace}/pods?labelSelector=app=shadow-agent`
      );
      return response.items || [];
    } catch (error) {
      console.error("[REMOTE_WORKSPACE] Failed to list agent pods:", error);
      return [];
    }
  }

  /**
   * Get pod logs for debugging
   */
  async getPodLogs(taskId: string, tailLines: number = 100): Promise<string> {
    try {
      const podName = `shadow-agent-${taskId}`;
      const response = await this.makeK8sRequest<string>(
        `/api/v1/namespaces/${this.namespace}/pods/${podName}/log?tailLines=${tailLines}`
      );
      return response;
    } catch (error) {
      return `Failed to get logs: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  }

  // Required WorkspaceManager interface methods

  getWorkspacePath(_taskId: string): string {
    // For remote workspaces, the path is always inside the pod
    return "/workspace";
  }

  async workspaceExists(taskId: string): Promise<boolean> {
    const status = await this.getWorkspaceStatus(taskId);
    return status.exists;
  }

  async getWorkspaceSize(taskId: string): Promise<number> {
    // K8s doesn't provide easy disk usage, would need to call sidecar API
    // For now, return 0 as placeholder
    try {
      const sidecarClient = this.getSidecarClient(taskId);

      // This would be a custom endpoint in the sidecar to get disk usage
      const response = await fetch(`${sidecarClient.getSidecarUrl()}/workspace/size`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = await response.json();
        return data.sizeBytes || 0;
      }
    } catch (error) {
      console.warn(`[REMOTE_WORKSPACE] Failed to get workspace size for ${taskId}:`, error);
    }

    return 0;
  }

  async getExecutor(taskId: string): Promise<ToolExecutor> {
    // Import here to avoid circular dependency
    const { RemoteToolExecutor } = await import("./remote-tool-executor.js");
    return new RemoteToolExecutor(taskId, this.getWorkspacePath(taskId));
  }

  isRemote(): boolean {
    return true;
  }
}