import { z } from "zod";

/**
 * Shared configuration schema used by both development and production environments
 * Contains common variables needed regardless of deployment target
 */
export const sharedConfigSchema = z.object({
  // Server configuration
  API_PORT: z.coerce.number().default(4000),
  CLIENT_URL: z.string().default("http://localhost:3000"),
  API_URL: z.string().default("http://localhost:4000"),

  // Environment
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DEBUG: z
    .string()
    .optional()
    .transform((val) => val === "true"),

  // LLM API Keys
  EXA_API_KEY: z.string().optional(),

  // GitHub integration (required for all environments)
  GITHUB_CLIENT_ID: z.string(),
  GITHUB_CLIENT_SECRET: z.string(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),

  // Repository limits
  MAX_REPO_SIZE_MB: z.coerce.number().default(500),

  // Vector database (optional for all environments)
  PINECONE_API_KEY: z.string().optional(),
  PINECONE_INDEX_NAME: z.string().default("shadow"),
  EMBEDDING_MODEL: z.string().default("llama-text-embed-v2"),
  // DeepWiki model and concurrency settings
  CONCURRENCY: z.coerce.number().default(4),
  MODEL: z.string().default("gpt-4o"),
  MODEL_MINI: z.string().default("gpt-4o-mini"),
  USE_PINECONE: z
    .union([z.boolean(), z.string().transform((val) => val === "true")])
    .default(false),
});

/**
 * Create config object from parsed shared data
 */
export const createSharedConfig = (
  data: z.infer<typeof sharedConfigSchema>
) => ({
  // Server
  apiPort: data.API_PORT,
  clientUrl: data.CLIENT_URL,
  apiUrl: data.API_URL,
  nodeEnv: data.NODE_ENV,
  debug: data.DEBUG,

  // LLM APIs
  exaApiKey: data.EXA_API_KEY,

  // GitHub
  githubClientId: data.GITHUB_CLIENT_ID,
  githubClientSecret: data.GITHUB_CLIENT_SECRET,
  githubWebhookSecret: data.GITHUB_WEBHOOK_SECRET,

  // Repository
  maxRepoSizeMB: data.MAX_REPO_SIZE_MB,

  // Vector DB
  pineconeApiKey: data.PINECONE_API_KEY,
  pineconeIndexName: data.PINECONE_INDEX_NAME,
  embeddingModel: data.EMBEDDING_MODEL,
  // DeepWiki settings
  concurrency: data.CONCURRENCY,
  model: data.MODEL,
  modelMini: data.MODEL_MINI,
  usePinecone: data.USE_PINECONE,
});

export type SharedConfig = ReturnType<typeof createSharedConfig>;
