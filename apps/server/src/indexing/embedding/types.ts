export interface EmbeddingResult {
    embeddings: Float32Array[];
    dim: number;
}


export type ChunkNode = {
    code?: string;
    embedding?: Float32Array;
    meta?: { [k: string]: unknown };
};

type EmbeddingProvider = "jina-api" | "local-transformers" | "cheap-hash";

// === CONSTANTS === //
export const EMBEDDING_MODEL = "jinaai/jina-embeddings-v2-base-code";

interface EmbedTextsOptions {
  model: string;
  quantized: boolean;
  normalized: boolean;
  embedding_type: "float" | "binary" | "base64";
  batchSize: number; 
  apiKey?: string;
  endpoint: string;
}

interface EmbedViaProviderOptions extends EmbedTextsOptions {
  provider: EmbeddingProvider;
}

export const defaultEmbedTextsOptions: EmbedViaProviderOptions = {
    provider: "cheap-hash",
    model: EMBEDDING_MODEL,
    quantized: true,
    normalized: true,
    embedding_type: "float",
    batchSize: 32,
    apiKey: process.env.JINA_API_KEY,
    endpoint: "https://api.jina.ai/v1/embeddings",
};


export type { EmbedTextsOptions, EmbeddingProvider, EmbedViaProviderOptions };