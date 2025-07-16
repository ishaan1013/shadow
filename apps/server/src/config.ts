import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const configSchema = z.object({
  API_PORT: z.coerce.number().default(4000),
  SOCKET_PORT: z.coerce.number().default(4001),
  CLIENT_URL: z.string().default("http://localhost:3000"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  
  // AI Provider API Keys
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  
  // At least one AI provider must be configured
}).refine(
  (data) => 
    data.ANTHROPIC_API_KEY || 
    data.OPENAI_API_KEY || 
    data.GOOGLE_API_KEY || 
    data.GROQ_API_KEY,
  {
    message: "At least one AI provider API key must be configured",
    path: ["ANTHROPIC_API_KEY"],
  }
);

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", z.treeifyError(parsed.error));
  process.exit(1);
}

const config = {
  apiPort: parsed.data.API_PORT,
  socketPort: parsed.data.SOCKET_PORT,
  clientUrl: parsed.data.CLIENT_URL,
  nodeEnv: parsed.data.NODE_ENV,
  
  // AI Provider Keys
  anthropicApiKey: parsed.data.ANTHROPIC_API_KEY,
  openaiApiKey: parsed.data.OPENAI_API_KEY,
  googleApiKey: parsed.data.GOOGLE_API_KEY,
  groqApiKey: parsed.data.GROQ_API_KEY,
};

export default config;
