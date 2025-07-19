import { EmbeddingResult, EmbedTextsOptions, defaultEmbedTextsOptions } from "./types";
import { logger } from "../logger";

// ---- Remote Jina API provider --- //
export async function embedViaJinaAPI(
    texts: string[],
    options: EmbedTextsOptions = defaultEmbedTextsOptions
  ): Promise<EmbeddingResult> {
    const { model, normalized, embedding_type, batchSize, apiKey, endpoint } = options;
    if (!apiKey) throw new Error("JINA_API_KEY not set; required for provider=jina-api");

    const out: Float32Array[] = new Array(texts.length);
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const body = {
        model,
        input: batch,
        normalized,
        embedding_type,
      };
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const tx = await resp.text();
        throw new Error(`Jina API error ${resp.status}: ${tx}`);
      }
      const json = (await resp.json()) as {
        data: Array<{
          embedding: number[];
          index: number;
          object: string;
        }>;
        model: string;
        usage: Record<string, number>;
      };
      // Response: {data:[{embedding:[...],index:n,object:'embedding'}],model:'...',usage:{...}}
      for (const item of json.data) {
        out[i + item.index] = Float32Array.from(item.embedding);
      }
    }
    
    if (out.length === 0 || out[0] === undefined) {
      logger.error("No embeddings returned from Jina API");
      return { embeddings: [], dim: 0 };
    } else {
      const dim = out[0].length;
      return { embeddings: out, dim };
    }
  }