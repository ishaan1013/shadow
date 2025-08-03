import { TaskConfig } from "../interfaces/types";
import config from "../../config";
import * as k8s from "@kubernetes/client-node";

export class RemoteVMRunner {
  private namespace: string;
  private k8sConfig: k8s.KubeConfig;
  private coreV1Api: k8s.CoreV1Api;

  constructor(
    options: {
      k8sApiUrl?: string;
      namespace?: string;
      token?: string;
      timeout?: number;
    } = {}
  ) {
    this.namespace = options.namespace || config.kubernetesNamespace;

    // Initialize Kubernetes client
    this.k8sConfig = new k8s.KubeConfig();
    this.k8sConfig.loadFromDefault();
    this.coreV1Api = this.k8sConfig.makeApiClient(k8s.CoreV1Api);
  }

  /**
   * Create kata-qemu VM pod specification
   * Kata QEMU handles VM lifecycle automatically - no manual VM management needed
   */
  createRemoteVMPodSpec(
    taskConfig: TaskConfig,
    githubToken: string
  ): k8s.V1Pod {
    // Use GitHub Container Registry sidecar image built by CI
    const sidecarImage = config.vmImageRegistry
      ? `${config.vmImageRegistry}/shadow-sidecar:${config.vmImageTag || "latest"}`
      : "ghcr.io/ishaan1013/shadow/shadow-sidecar:latest";

    return {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name: `shadow-vm-${taskConfig.id.toLowerCase().replaceAll("_", "-")}`,
        namespace: this.namespace,
        labels: {
          app: "shadow-remote",
          component: "vm",
          "task-id": taskConfig.id,
          "user-id": taskConfig.userId,
        },
        annotations: {
          "shadow.io/task-id": taskConfig.id,
          "shadow.io/repo-url": taskConfig.repoUrl,
          "shadow.io/base-branch": taskConfig.baseBranch,
          "shadow.io/shadow-branch": taskConfig.shadowBranch,
          "shadow.io/vm-type": "kata-qemu",
        },
      },
      spec: {
        serviceAccountName: "shadow-firecracker-vm-sa",
        runtimeClassName: "kata-qemu",
        nodeSelector: {
          remote: "true", // Updated to match current infrastructure
        },
        tolerations: [
          {
            key: "firecracker.shadow.ai/dedicated",
            operator: "Equal",
            value: "true",
            effect: "NoSchedule",
          },
        ],
        restartPolicy: "Never",
        imagePullSecrets: [
          {
            name: "ghcr-secret",
          },
        ],
        initContainers: [
          {
            name: "workspace-init",
            image: "alpine/git:latest",
            env: [
              {
                name: "REPO_URL",
                value: taskConfig.repoUrl,
              },
              {
                name: "BASE_BRANCH",
                value: taskConfig.baseBranch,
              },
              {
                name: "GITHUB_TOKEN",
                value: githubToken,
              },
            ],
            command: ["/bin/sh", "-c"],
            args: [
              `
              echo "Cloning repository \${REPO_URL} (branch: \${BASE_BRANCH})"
              
              # Clone repository to workspace
              cd /workspace
              git clone --depth 1 --branch "\${BASE_BRANCH}" "https://\${GITHUB_TOKEN}@\${REPO_URL#https://}" .
              
              echo "Repository cloned successfully"
              ls -la /workspace
              `,
            ],
            volumeMounts: [
              {
                name: "workspace",
                mountPath: "/workspace",
              },
            ],
          },
        ],
        containers: [
          {
            name: "sidecar",
            image: sidecarImage,
            env: [
              {
                name: "TASK_ID",
                value: taskConfig.id,
              },
              {
                name: "REPO_URL",
                value: taskConfig.repoUrl,
              },
              {
                name: "BASE_BRANCH",
                value: taskConfig.baseBranch,
              },
              {
                name: "SHADOW_BRANCH",
                value: taskConfig.shadowBranch,
              },
              {
                name: "GITHUB_TOKEN",
                value: githubToken,
              },
              {
                name: "USER_ID",
                value: taskConfig.userId,
              },
              {
                name: "NODE_ENV",
                value: "production",
              },
              {
                name: "PORT",
                value: "8080",
              },
              {
                name: "WORKSPACE_DIR",
                value: "/workspace",
              },
              // TODO: Add SHADOW_SERVER_URL for filesystem watching
            ],
            resources: {
              requests: {
                memory: config.vmMemoryLimit,
                cpu: config.vmCpuLimit,
              },
              limits: {
                memory: config.vmMemoryLimit,
                cpu: config.vmCpuLimit,
              },
            },
            ports: [
              {
                name: "sidecar-api",
                containerPort: 8080,
                protocol: "TCP",
              },
            ],
            readinessProbe: {
              httpGet: {
                path: "/health",
                port: 8080,
              },
              initialDelaySeconds: 10,
              periodSeconds: 5,
              timeoutSeconds: 3,
              failureThreshold: 3,
            },
            livenessProbe: {
              httpGet: {
                path: "/health",
                port: 8080,
              },
              initialDelaySeconds: 30,
              periodSeconds: 10,
              timeoutSeconds: 5,
              failureThreshold: 3,
            },
            volumeMounts: [
              {
                name: "workspace",
                mountPath: "/workspace",
              },
            ],
          },
        ],
        volumes: [
          {
            name: "workspace",
            emptyDir: {},
          },
        ],
      },
    };
  }

  async createVMPod(
    taskConfig: TaskConfig,
    githubToken: string
  ): Promise<k8s.V1Pod> {
    const podSpec = this.createRemoteVMPodSpec(taskConfig, githubToken);

    try {
      const response = await this.coreV1Api.createNamespacedPod({
        namespace: this.namespace,
        body: podSpec,
      });

      return response;
    } catch (error) {
      console.error(`[REMOTE_VM_RUNNER] Failed to create VM pod:`, error);
      throw new Error(
        `Failed to create remote VM pod: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  async deleteVMPod(taskId: string): Promise<void> {
    const podName = `shadow-vm-${taskId.toLowerCase().replaceAll("_", "-")}`;

    try {
      await this.coreV1Api.deleteNamespacedPod({
        name: podName,
        namespace: this.namespace,
      });

      console.log(`[REMOTE_VM_RUNNER] Deleted VM pod: ${podName}`);
    } catch (error) {
      console.error(
        `[REMOTE_VM_RUNNER] Failed to delete VM pod ${podName}:`,
        error
      );
      throw new Error(
        `Failed to delete remote VM pod: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  async getVMPodStatus(taskId: string): Promise<k8s.V1Pod> {
    const podName = `shadow-vm-${taskId.toLowerCase().replaceAll("_", "-")}`;

    try {
      const pod = await this.coreV1Api.readNamespacedPod({
        name: podName,
        namespace: this.namespace,
      });

      return pod;
    } catch (error) {
      console.error(
        `[REMOTE_VM_RUNNER] Failed to get VM pod status for ${podName}:`,
        error
      );
      throw new Error(
        `Failed to get remote VM pod status: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  async waitForVMReady(
    taskId: string,
    maxWaitTime: number = 300000
  ): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 5000; // 5 seconds
    const podName = `shadow-vm-${taskId.toLowerCase().replaceAll("_", "-")}`;

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const pod = await this.coreV1Api.readNamespacedPod({
          name: podName,
          namespace: this.namespace,
        });

        const phase = pod.status?.phase;
        const conditions = pod.status?.conditions || [];
        const readyCondition = conditions.find(
          (c: k8s.V1PodCondition) => c.type === "Ready"
        );

        if (phase === "Running" && readyCondition?.status === "True") {
          console.log(`[REMOTE_VM_RUNNER] VM pod ${podName} is ready`);
          return;
        }

        if (phase === "Failed") {
          throw new Error(`VM pod ${podName} failed to start`);
        }

        console.log(
          `[REMOTE_VM_RUNNER] Waiting for VM pod ${podName} to be ready... (${phase})`
        );
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      } catch (error) {
        if (Date.now() - startTime >= maxWaitTime) {
          throw new Error(`Timeout waiting for VM pod ${podName} to be ready`);
        }
        throw error;
      }
    }

    throw new Error(
      `Timeout waiting for VM pod ${podName} to be ready after ${maxWaitTime}ms`
    );
  }
}
