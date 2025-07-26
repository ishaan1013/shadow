import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const configSchema = z
  .object({
    API_PORT: z.coerce.number().default(4000),
    SOCKET_PORT: z.coerce.number().default(4001),
    CLIENT_URL: z.string().default("http://localhost:3000"),
    API_URL: z.string().default("http://localhost:4000"),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    EXA_API_KEY: z.string().optional(),
    GITHUB_CLIENT_ID: z.string(),
    GITHUB_CLIENT_SECRET: z.string(),
    WORKSPACE_DIR: z.string().default("/workspace"),
    MAX_REPO_SIZE_MB: z.coerce.number().default(500),
    PINECONE_API_KEY: z.string().optional(),
    PINECONE_INDEX_NAME: z.string().default("shadow"),
    EMBEDDING_MODEL: z.string().default("llama-text-embed-v2"),
    USE_SEMANTIC_SEARCH: z.union([
      z.boolean(),
      z.string().transform(val => val === 'true')
    ]).default(false),
    DEBUG: z
      .string()
      .optional()
      .transform((val) => val === "true"),

    // Dual-mode execution configuration
    AGENT_MODE: z.enum(["local", "remote", "mock"]).default("local"),

    // Remote mode configuration (optional, only needed when AGENT_MODE=remote)
    KUBERNETES_NAMESPACE: z.string().optional(),
    KUBERNETES_SERVICE_HOST: z.string().optional(),
    KUBERNETES_SERVICE_PORT: z.string().optional(),
    K8S_SERVICE_ACCOUNT_TOKEN: z.string().optional(),
    SIDECAR_IMAGE: z.string().optional(),
    SIDECAR_PORT: z.coerce.number().optional(),
    SIDECAR_HEALTH_PATH: z.string().default("/health"),

    // Remote storage configuration
    EFS_VOLUME_ID: z.string().optional(),

    // Resource limits for remote mode
    REMOTE_CPU_LIMIT: z.string().default("1000m"),
    REMOTE_MEMORY_LIMIT: z.string().default("2Gi"),
    REMOTE_STORAGE_LIMIT: z.string().default("10Gi"),
  })
  .refine((data) => data.ANTHROPIC_API_KEY || data.OPENAI_API_KEY, {
    message:
      "At least one API key (ANTHROPIC_API_KEY or OPENAI_API_KEY) must be provided",
    path: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
  });

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.format());
  process.exit(1);
}

const config = {
  apiPort: parsed.data.API_PORT,
  socketPort: parsed.data.SOCKET_PORT,
  clientUrl: parsed.data.CLIENT_URL,
  apiUrl: parsed.data.API_URL,
  nodeEnv: parsed.data.NODE_ENV,
  anthropicApiKey: parsed.data.ANTHROPIC_API_KEY,
  openaiApiKey: parsed.data.OPENAI_API_KEY,
  exaApiKey: parsed.data.EXA_API_KEY,
  githubClientId: parsed.data.GITHUB_CLIENT_ID,
  githubClientSecret: parsed.data.GITHUB_CLIENT_SECRET,
  workspaceDir: parsed.data.WORKSPACE_DIR,
  maxRepoSizeMB: parsed.data.MAX_REPO_SIZE_MB,
  pineconeApiKey: parsed.data.PINECONE_API_KEY,
  pineconeIndexName: parsed.data.PINECONE_INDEX_NAME,
  embeddingModel: parsed.data.EMBEDDING_MODEL,
  useSemanticSearch: parsed.data.USE_SEMANTIC_SEARCH,
  debug: parsed.data.DEBUG,

  // Dual-mode execution
  agentMode: parsed.data.AGENT_MODE,

  // Remote mode configuration
  kubernetesNamespace: parsed.data.KUBERNETES_NAMESPACE,
  kubernetesServiceHost: parsed.data.KUBERNETES_SERVICE_HOST,
  kubernetesServicePort: parsed.data.KUBERNETES_SERVICE_PORT,
  k8sServiceAccountToken: parsed.data.K8S_SERVICE_ACCOUNT_TOKEN,
  sidecarImage: parsed.data.SIDECAR_IMAGE,
  sidecarPort: parsed.data.SIDECAR_PORT,
  sidecarHealthPath: parsed.data.SIDECAR_HEALTH_PATH,

  // Remote storage
  efsVolumeId: parsed.data.EFS_VOLUME_ID,

  // Remote resource limits
  remoteCpuLimit: parsed.data.REMOTE_CPU_LIMIT,
  remoteMemoryLimit: parsed.data.REMOTE_MEMORY_LIMIT,
  remoteStorageLimit: parsed.data.REMOTE_STORAGE_LIMIT,
};

export default config;
