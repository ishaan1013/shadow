import dotenv from "dotenv";
import { z } from "zod";
import {
  sharedConfigSchema,
  sharedValidationRules,
  createSharedConfig,
} from "./shared";

// Only load .env.production if environment variables aren't already set
if (!process.env.VM_IMAGE_REGISTRY) {
  dotenv.config({ path: "../../.env.production" });
}

/**
 * Production environment configuration schema
 * Focused on Firecracker VM deployment with comprehensive validation
 *
 * This configuration enables secure, isolated execution of user code through:
 * - Firecracker microVMs for hardware-level isolation
 * - Kubernetes orchestration on bare metal nodes
 * - Comprehensive monitoring and resource management
 */
const prodConfigSchema = sharedConfigSchema.extend({
  // === EXECUTION MODE ===
  // Controls how agent code executes - 'firecracker' for VM isolation, 'local' for direct execution
  AGENT_MODE: z.enum(["local", "firecracker"]).default("firecracker"),

  // === FIRECRACKER VM CORE CONFIGURATION ===
  // Enable Firecracker microVM execution (hardware-isolated containers)
  FIRECRACKER_ENABLED: z.boolean().default(true),
  // Docker registry containing VM images with pre-installed tools (Node.js, Python, etc.)
  VM_IMAGE_REGISTRY: z
    .string()
    .min(1, "VM_IMAGE_REGISTRY is required in production"),
  // Image tag/version to pull (e.g., 'v1.2.3', 'latest')
  VM_IMAGE_TAG: z.string().default("latest"),
  // Path to custom Firecracker kernel (optional, uses image default if not specified)
  FIRECRACKER_KERNEL_PATH: z.string().optional(),
  // Number of vCPUs allocated per VM (1-16 cores)
  VM_CPU_COUNT: z.coerce.number().min(1).max(16).default(1),
  // Memory allocated per VM in megabytes (512MB - 16GB)
  VM_MEMORY_SIZE_MB: z.coerce.number().min(512).max(16384).default(512),

  // === VM IMAGE BUILD CONFIGURATION ===
  // These control how VM images are built during deployment
  // Ubuntu base image version for VM filesystem
  UBUNTU_VERSION: z.string().default("22.04"),
  // Node.js version installed in VM for JavaScript execution
  NODE_VERSION: z.string().default("20"),
  // Python version installed in VM for Python execution
  PYTHON_VERSION: z.string().default("3.11"),
  // Linux kernel version for Firecracker VMs
  KERNEL_VERSION: z.string().default("5.15.0-91-generic"),
  // VM disk image size (how much storage each VM gets)
  VM_IMAGE_SIZE: z.string().default("2G"),
  // Compression for root filesystem (reduces image size)
  ROOTFS_COMPRESSION: z.string().default("gzip"),
  // Compression for kernel image (reduces boot time)
  KERNEL_COMPRESSION: z.string().default("gzip"),

  // === KUBERNETES CLUSTER CONFIGURATION ===
  // Namespace where Firecracker pods are deployed
  KUBERNETES_NAMESPACE: z.string().default("shadow"),
  // Kubernetes API server hostname (auto-detected if not specified)
  KUBERNETES_SERVICE_HOST: z.string().optional(),
  // Kubernetes API server port (auto-detected if not specified)
  KUBERNETES_SERVICE_PORT: z.string().optional(),
  // Service account token for pod creation and management
  K8S_SERVICE_ACCOUNT_TOKEN: z
    .string()
    .min(1, "K8S_SERVICE_ACCOUNT_TOKEN is required in production"),

  // === KUBERNETES POD CONFIGURATION ===
  // Node selector to target bare metal instances with KVM support
  FIRECRACKER_NODE_SELECTOR: z.string().default("firecracker=true"),
  // Path to KVM device on host nodes (required for VM execution)
  KVM_DEVICE_PATH: z.string().default("/dev/kvm"),
  // Pod restart policy (Never = single-use pods, OnFailure = retry on crashes)
  POD_RESTART_POLICY: z.string().default("Never"),
  // Service account for pod security and RBAC permissions
  POD_SERVICE_ACCOUNT: z.string().default("shadow-firecracker-vm-sa"),
  // Runtime class for Firecracker container execution
  RUNTIME_CLASS: z.string().default("firecracker"),
  // Enable privileged containers (required for VM creation)
  PRIVILEGED_CONTAINERS: z.boolean().default(true),
  // Linux capabilities needed for VM management
  REQUIRED_CAPABILITIES: z.string().default("SYS_ADMIN,NET_ADMIN"),

  // === STORAGE CONFIGURATION ===
  // AWS EFS volume ID for persistent workspace storage (optional)
  EFS_VOLUME_ID: z.string().optional(),
  // Storage class for workspace persistence (gp3 = general purpose SSD)
  WORKSPACE_STORAGE_CLASS: z.string().default("gp3"),
  // Storage class for VM ephemeral storage (fast-nvme = high IOPS)
  VM_STORAGE_CLASS: z.string().default("fast-nvme"),

  // === NETWORK CONFIGURATION ===
  // Kubernetes cluster DNS suffix for service discovery
  CLUSTER_DNS_SUFFIX: z.string().default("cluster.local"),
  // Network policy name for VM traffic isolation
  VM_NETWORK_POLICY: z.string().default("shadow-vm-isolation"),

  // === VM SECURITY SETTINGS ===
  // User ID for Firecracker jailer (isolates VM process)
  JAILER_UID: z.coerce.number().default(1000),
  // Group ID for Firecracker jailer
  JAILER_GID: z.coerce.number().default(1000),
  // Base directory for chroot jail (VM filesystem isolation)
  CHROOT_BASE_DIR: z.string().default("/srv/jailer"),
  // Maximum file size limit per VM (128MB = prevents disk abuse)
  VM_FILE_SIZE_LIMIT: z.coerce.number().default(134217728), // 128MB
  // Maximum open file descriptors per VM (prevents resource exhaustion)
  VM_OPEN_FILES_LIMIT: z.coerce.number().default(1024),
  // Maximum processes per VM (prevents fork bombs)
  VM_PROCESS_LIMIT: z.coerce.number().default(100),

  // === MONITORING & LOGGING ===
  // Application log level (debug/info/warn/error)
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // Enable VM console output logging (for debugging VM issues)
  ENABLE_VM_LOGGING: z.boolean().default(true),
  // Enable console output to stdout (for development visibility)
  ENABLE_CONSOLE_LOGGING: z.boolean().default(true),
  // Interval between health checks in milliseconds
  HEALTH_CHECK_INTERVAL: z.coerce.number().default(30000),
  // Timeout for VM health check responses
  VM_HEALTH_CHECK_TIMEOUT: z.coerce.number().default(5000),

  // === PERFORMANCE TUNING ===
  // Maximum time to wait for VM boot completion (2 minutes)
  VM_BOOT_TIMEOUT: z.coerce.number().default(120000), // 2 minutes
  // Timeout for sidecar service to become ready (1 minute)
  SIDECAR_READY_TIMEOUT: z.coerce.number().default(60000), // 1 minute
  // Timeout for git repository cloning (5 minutes for large repos)
  REPOSITORY_CLONE_TIMEOUT: z.coerce.number().default(300000), // 5 minutes
  // Maximum number of VMs running simultaneously (cost control)
  MAX_CONCURRENT_VMS: z.coerce.number().default(10),
  // Maximum VM lifetime in hours (prevents runaway VMs)
  MAX_VM_UPTIME_HOURS: z.coerce.number().default(24),
  // Interval between VM cleanup cycles (removes stopped VMs)
  VM_CLEANUP_INTERVAL: z.coerce.number().default(3600000), // 1 hour
  // Terminal output buffer size (lines of output to keep)
  TERMINAL_BUFFER_SIZE: z.coerce.number().default(10000),
  // Memory allocated for terminal buffering per VM
  TERMINAL_BUFFER_MEMORY_MB: z.coerce.number().default(50),
  // Interval to flush terminal buffers to storage
  TERMINAL_FLUSH_INTERVAL: z.coerce.number().default(60000),

  // === AWS CONFIGURATION ===
  // AWS region for EKS cluster and supporting services
  AWS_REGION: z.string().default("us-east-1"),
  // EC2 instance types for Kubernetes nodes (metal instances support KVM)
  EC2_INSTANCE_TYPES: z.string().default("c5n.metal,c5.metal,m5.metal"),

  // === CONTAINER REGISTRY CONFIGURATION ===
  // When to pull VM images (Always = latest security updates)
  IMAGE_PULL_POLICY: z.string().default("Always"),
  // Kubernetes secret for private registry authentication
  IMAGE_PULL_SECRETS: z.string().default("ecr-registry-secret"),

  // === ERROR HANDLING & RESILIENCE ===
  // Timeout for individual VM operations (create, start, stop)
  VM_OPERATION_TIMEOUT: z.coerce.number().default(30000),
  // Timeout for VM console command execution
  VM_CONSOLE_TIMEOUT: z.coerce.number().default(10000),
  // Maximum retry attempts for failed VM operations
  VM_MAX_RETRIES: z.coerce.number().default(3),
  // Delay between retry attempts (exponential backoff)
  VM_RETRY_DELAY: z.coerce.number().default(1000),
  // Circuit breaker: failures before stopping VM creation
  VM_CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().default(5),
  // Circuit breaker: cooldown period before retrying
  VM_CIRCUIT_BREAKER_TIMEOUT: z.coerce.number().default(60000),
  // Automatically restart VMs that crash unexpectedly
  AUTO_RESTART_FAILED_VMS: z.boolean().default(true),
  // Maximum attempts to restart a failed VM before giving up
  MAX_VM_RESTART_ATTEMPTS: z.coerce.number().default(3),

  // === VM RESOURCE LIMITS ===
  // Kubernetes CPU limit per VM (1000m = 1 CPU core)
  VM_CPU_LIMIT: z
    .string()
    .regex(/^\d+(m|)$/, "VM_CPU_LIMIT must be valid CPU format (e.g., 1000m)")
    .default("500m"),
  // Kubernetes memory limit per VM (2Gi = 2 gigabytes)
  VM_MEMORY_LIMIT: z
    .string()
    .regex(
      /^\d+(Mi|Gi)$/,
      "VM_MEMORY_LIMIT must be valid memory format (e.g., 2Gi)"
    )
    .default("1Gi"),
  // Kubernetes storage limit per VM (10Gi = 10 gigabytes)
  VM_STORAGE_LIMIT: z
    .string()
    .regex(
      /^\d+(Mi|Gi)$/,
      "VM_STORAGE_LIMIT must be valid storage format (e.g., 10Gi)"
    )
    .default("10Gi"),

  // === FALLBACK CONFIGURATION ===
  // Local workspace directory (used if AGENT_MODE falls back to 'local')
  WORKSPACE_DIR: z.string().default("/var/lib/shadow/workspaces"),
});

/**
 * Production-specific validation rules
 */
const prodValidationRules = (data: z.infer<typeof prodConfigSchema>) => {
  const errors: string[] = [];

  // If firecracker mode is enabled, ensure required fields are present
  if (data.AGENT_MODE === "firecracker" && data.FIRECRACKER_ENABLED) {
    if (!data.VM_IMAGE_REGISTRY) {
      errors.push("VM_IMAGE_REGISTRY is required when using firecracker mode");
    }
    if (!data.K8S_SERVICE_ACCOUNT_TOKEN) {
      errors.push(
        "K8S_SERVICE_ACCOUNT_TOKEN is required when using firecracker mode"
      );
    }
  }

  // Validate VM resource consistency
  const memoryMB = data.VM_MEMORY_SIZE_MB;
  const memoryLimit = data.VM_MEMORY_LIMIT;
  if (memoryLimit.includes("Gi")) {
    const limitGB = parseInt(memoryLimit.replace("Gi", ""));
    if (memoryMB > limitGB * 1024) {
      errors.push(
        `VM_MEMORY_SIZE_MB (${memoryMB}) cannot exceed VM_MEMORY_LIMIT (${memoryLimit})`
      );
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      error: {
        message: "Production configuration validation failed",
        details: errors,
      },
    };
  }

  return { success: true };
};

/**
 * Parse and validate production configuration
 */
const parsed = prodConfigSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "Invalid production environment variables:",
    parsed.error.format()
  );
  process.exit(1);
}

// Apply shared validation rules
const sharedValidation = sharedValidationRules(parsed.data);
if (!sharedValidation.success) {
  console.error(
    "Production config shared validation failed:",
    sharedValidation.error
  );
  process.exit(1);
}

// Apply production-specific validation rules
const prodValidation = prodValidationRules(parsed.data);
if (!prodValidation.success) {
  console.error("Production config validation failed:", prodValidation.error);
  process.exit(1);
}

/**
 * Production configuration object
 * Combines shared config with production-specific Firecracker settings
 */
const prodConfig = {
  ...createSharedConfig(parsed.data),

  // Execution mode
  agentMode: parsed.data.AGENT_MODE,

  // Production workspace
  workspaceDir: parsed.data.WORKSPACE_DIR,

  // Firecracker VM configuration
  firecrackerEnabled: parsed.data.FIRECRACKER_ENABLED,
  vmImageRegistry: parsed.data.VM_IMAGE_REGISTRY,
  vmImageTag: parsed.data.VM_IMAGE_TAG,
  firecrackerKernelPath: parsed.data.FIRECRACKER_KERNEL_PATH,
  vmCpuCount: parsed.data.VM_CPU_COUNT,
  vmMemorySizeMB: parsed.data.VM_MEMORY_SIZE_MB,

  // VM Image Build Configuration
  ubuntuVersion: parsed.data.UBUNTU_VERSION,
  nodeVersion: parsed.data.NODE_VERSION,
  pythonVersion: parsed.data.PYTHON_VERSION,
  kernelVersion: parsed.data.KERNEL_VERSION,
  vmImageSize: parsed.data.VM_IMAGE_SIZE,
  rootfsCompression: parsed.data.ROOTFS_COMPRESSION,
  kernelCompression: parsed.data.KERNEL_COMPRESSION,

  // Kubernetes configuration
  kubernetesNamespace: parsed.data.KUBERNETES_NAMESPACE,
  kubernetesServiceHost: parsed.data.KUBERNETES_SERVICE_HOST,
  kubernetesServicePort: parsed.data.KUBERNETES_SERVICE_PORT,
  k8sServiceAccountToken: parsed.data.K8S_SERVICE_ACCOUNT_TOKEN,

  // Kubernetes Pod Configuration
  firecrackerNodeSelector: parsed.data.FIRECRACKER_NODE_SELECTOR,
  kvmDevicePath: parsed.data.KVM_DEVICE_PATH,
  podRestartPolicy: parsed.data.POD_RESTART_POLICY,
  podServiceAccount: parsed.data.POD_SERVICE_ACCOUNT,
  runtimeClass: parsed.data.RUNTIME_CLASS,
  privilegedContainers: parsed.data.PRIVILEGED_CONTAINERS,
  requiredCapabilities: parsed.data.REQUIRED_CAPABILITIES,

  // Storage
  efsVolumeId: parsed.data.EFS_VOLUME_ID,
  workspaceStorageClass: parsed.data.WORKSPACE_STORAGE_CLASS,
  vmStorageClass: parsed.data.VM_STORAGE_CLASS,

  // Network configuration
  clusterDnsSuffix: parsed.data.CLUSTER_DNS_SUFFIX,
  vmNetworkPolicy: parsed.data.VM_NETWORK_POLICY,

  // VM Security settings
  jailerUid: parsed.data.JAILER_UID,
  jailerGid: parsed.data.JAILER_GID,
  chrootBaseDir: parsed.data.CHROOT_BASE_DIR,
  vmFileSizeLimit: parsed.data.VM_FILE_SIZE_LIMIT,
  vmOpenFilesLimit: parsed.data.VM_OPEN_FILES_LIMIT,
  vmProcessLimit: parsed.data.VM_PROCESS_LIMIT,

  // Monitoring & Logging
  logLevel: parsed.data.LOG_LEVEL,
  enableVmLogging: parsed.data.ENABLE_VM_LOGGING,
  enableConsoleLogging: parsed.data.ENABLE_CONSOLE_LOGGING,
  healthCheckInterval: parsed.data.HEALTH_CHECK_INTERVAL,
  vmHealthCheckTimeout: parsed.data.VM_HEALTH_CHECK_TIMEOUT,

  // Performance Tuning
  vmBootTimeout: parsed.data.VM_BOOT_TIMEOUT,
  sidecarReadyTimeout: parsed.data.SIDECAR_READY_TIMEOUT,
  repositoryCloneTimeout: parsed.data.REPOSITORY_CLONE_TIMEOUT,
  maxConcurrentVms: parsed.data.MAX_CONCURRENT_VMS,
  maxVmUptimeHours: parsed.data.MAX_VM_UPTIME_HOURS,
  vmCleanupInterval: parsed.data.VM_CLEANUP_INTERVAL,
  terminalBufferSize: parsed.data.TERMINAL_BUFFER_SIZE,
  terminalBufferMemoryMB: parsed.data.TERMINAL_BUFFER_MEMORY_MB,
  terminalFlushInterval: parsed.data.TERMINAL_FLUSH_INTERVAL,

  // AWS configuration
  awsRegion: parsed.data.AWS_REGION,
  ec2InstanceTypes: parsed.data.EC2_INSTANCE_TYPES,

  // Container registry configuration
  imagePullPolicy: parsed.data.IMAGE_PULL_POLICY,
  imagePullSecrets: parsed.data.IMAGE_PULL_SECRETS,

  // Error Handling & Resilience
  vmOperationTimeout: parsed.data.VM_OPERATION_TIMEOUT,
  vmConsoleTimeout: parsed.data.VM_CONSOLE_TIMEOUT,
  vmMaxRetries: parsed.data.VM_MAX_RETRIES,
  vmRetryDelay: parsed.data.VM_RETRY_DELAY,
  vmCircuitBreakerThreshold: parsed.data.VM_CIRCUIT_BREAKER_THRESHOLD,
  vmCircuitBreakerTimeout: parsed.data.VM_CIRCUIT_BREAKER_TIMEOUT,
  autoRestartFailedVms: parsed.data.AUTO_RESTART_FAILED_VMS,
  maxVmRestartAttempts: parsed.data.MAX_VM_RESTART_ATTEMPTS,

  // VM resource limits
  vmCpuLimit: parsed.data.VM_CPU_LIMIT,
  vmMemoryLimit: parsed.data.VM_MEMORY_LIMIT,
  vmStorageLimit: parsed.data.VM_STORAGE_LIMIT,
};

export default prodConfig;
export type ProdConfig = typeof prodConfig;
