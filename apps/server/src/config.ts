import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const configSchema = z
  .object({
    API_PORT: z.coerce.number().default(4000),
    SOCKET_PORT: z.coerce.number().default(4001),
    CLIENT_URL: z.string().default("http://localhost:3000"),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    WORKSPACE_DIR: z.string().default("/workspace"),
    MAX_REPO_SIZE_MB: z.coerce.number().default(500),
    PINECONE_API_KEY: z.string().optional(),
    PINECONE_INDEX_NAME: z.string().default("shadow"),
    EMBEDDING_MODEL: z.string().default("llama-text-embed-v2"),
    DEBUG: z
      .string()
      .optional()
      .transform((val) => val === "true"),
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
  nodeEnv: parsed.data.NODE_ENV,
  anthropicApiKey: parsed.data.ANTHROPIC_API_KEY,
  openaiApiKey: parsed.data.OPENAI_API_KEY,
  workspaceDir: parsed.data.WORKSPACE_DIR,
  maxRepoSizeMB: parsed.data.MAX_REPO_SIZE_MB,
  pineconeApiKey: parsed.data.PINECONE_API_KEY,
  pineconeIndexName: parsed.data.PINECONE_INDEX_NAME,
  embeddingModel: parsed.data.EMBEDDING_MODEL,
  debug: parsed.data.DEBUG,
};

export default config;
