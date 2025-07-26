import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const configSchema = z.object({
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  WORKSPACE_DIR: z.string().default("/workspace"),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  MAX_FILE_SIZE_MB: z.coerce.number().default(50),
  COMMAND_TIMEOUT_MS: z.coerce.number().default(30000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  CORS_ORIGIN: z.string().default("*"),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.format());
  process.exit(1);
}

export const config = {
  port: parsed.data.PORT,
  nodeEnv: parsed.data.NODE_ENV,
  workspaceDir: parsed.data.WORKSPACE_DIR,
  logLevel: parsed.data.LOG_LEVEL,
  maxFileSizeMB: parsed.data.MAX_FILE_SIZE_MB,
  commandTimeoutMs: parsed.data.COMMAND_TIMEOUT_MS,
  rateLimitWindowMs: parsed.data.RATE_LIMIT_WINDOW_MS,
  rateLimitMaxRequests: parsed.data.RATE_LIMIT_MAX_REQUESTS,
  corsOrigin: parsed.data.CORS_ORIGIN,
  isDevelopment: parsed.data.NODE_ENV === "development",
  isProduction: parsed.data.NODE_ENV === "production",
};

export default config;