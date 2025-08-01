import dotenv from "dotenv";
import { z } from "zod";
import { sharedConfigSchema, sharedValidationRules, createSharedConfig } from "./shared";

dotenv.config();

/**
 * Development environment configuration schema
 * Focused on local development with minimal complexity
 */
const devConfigSchema = sharedConfigSchema.extend({
  // Development execution mode (defaults to local)
  AGENT_MODE: z.enum(["local", "remote"]).default("local"),
  
  // Local development workspace
  WORKSPACE_DIR: z.string().default("/workspace"),
  
  // Optional remote VM testing (for local VM testing)
  FIRECRACKER_ENABLED: z.boolean().default(false),
  VM_IMAGE_REGISTRY: z.string().optional(),
  VM_IMAGE_TAG: z.string().default("latest"),
  VM_CPU_COUNT: z.coerce.number().default(1),
  VM_MEMORY_SIZE_MB: z.coerce.number().default(1024),
  
  // Optional Kubernetes testing
  KUBERNETES_NAMESPACE: z.string().default("shadow"),
  K8S_SERVICE_ACCOUNT_TOKEN: z.string().optional(),
  
  // Basic VM resource limits for testing
  VM_CPU_LIMIT: z.string().default("1000m"),
  VM_MEMORY_LIMIT: z.string().default("2Gi"),
  VM_STORAGE_LIMIT: z.string().default("10Gi"),

  // Health monitoring configuration for development
  HEALTH_CHECK_INTERVAL: z.coerce.number().default(60000), // 1 minute (longer for dev)
  VM_HEALTH_CHECK_TIMEOUT: z.coerce.number().default(10000), // 10 seconds
  MAX_CONCURRENT_VMS: z.coerce.number().default(3), // Lower limit for dev
  MAX_VM_UPTIME_HOURS: z.coerce.number().default(4), // Shorter uptime for dev
});

/**
 * Parse and validate development configuration
 */
const parsed = devConfigSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid development environment variables:", parsed.error.format());
  process.exit(1);
}

// Apply shared validation rules
const sharedValidation = sharedValidationRules(parsed.data);
if (!sharedValidation.success) {
  console.error("Development config validation failed:", sharedValidation.error);
  process.exit(1);
}

/**
 * Development configuration object
 * Combines shared config with development-specific settings
 */
const devConfig = {
  ...createSharedConfig(parsed.data),
  
  // Execution mode
  agentMode: parsed.data.AGENT_MODE,
  
  // Local development
  workspaceDir: parsed.data.WORKSPACE_DIR,
  
  // Optional remote VM testing
  firecrackerEnabled: parsed.data.FIRECRACKER_ENABLED,
  vmImageRegistry: parsed.data.VM_IMAGE_REGISTRY,
  vmImageTag: parsed.data.VM_IMAGE_TAG,
  vmCpuCount: parsed.data.VM_CPU_COUNT,
  vmMemorySizeMB: parsed.data.VM_MEMORY_SIZE_MB,
  
  // Optional Kubernetes testing
  kubernetesNamespace: parsed.data.KUBERNETES_NAMESPACE,
  k8sServiceAccountToken: parsed.data.K8S_SERVICE_ACCOUNT_TOKEN,
  
  // VM resource limits
  vmCpuLimit: parsed.data.VM_CPU_LIMIT,
  vmMemoryLimit: parsed.data.VM_MEMORY_LIMIT,
  vmStorageLimit: parsed.data.VM_STORAGE_LIMIT,

  // Health monitoring configuration
  healthCheckInterval: parsed.data.HEALTH_CHECK_INTERVAL,
  vmHealthCheckTimeout: parsed.data.VM_HEALTH_CHECK_TIMEOUT,
  maxConcurrentVms: parsed.data.MAX_CONCURRENT_VMS,
  maxVmUptimeHours: parsed.data.MAX_VM_UPTIME_HOURS,
  
  // Development-specific defaults
  firecrackerKernelPath: undefined, // Not needed for dev
  kubernetesServiceHost: undefined, // Not needed for dev
  kubernetesServicePort: undefined, // Not needed for dev
  efsVolumeId: undefined, // Not needed for dev
};

export default devConfig;
export type DevConfig = typeof devConfig;