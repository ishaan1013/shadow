import { defaultEmbedTextsOptions, EmbeddingResult, EmbedViaProviderOptions, ChunkNode } from "./types";
import { embedViaJinaAPI } from "./jinaAPI";
import { embedViaLocalTransformers } from "./localTransformer";
import { cheapHashEmbedding } from "./cheapHash";

// ==== Main dispatcher ==== //
export async function embedTexts(
    texts: string[],
    options: Partial<EmbedViaProviderOptions> = {}
  ): Promise<EmbeddingResult> {
    const opts = { ...defaultEmbedTextsOptions, ...options };
    if (!texts.length) {
      return { embeddings: [], dim: 0 };
    }
    switch (opts.provider) {
      case "jina-api":
        return await embedViaJinaAPI(texts, opts);
      case "local-transformers":
        return await embedViaLocalTransformers(texts, opts);
      case "cheap-hash":
      default: {  
        const dim = 256;
        return cheapHashEmbedding(texts, dim);
      }
    }
  }
  
// ==== Graph wiring helper ==== //
export async function embedGraphChunks(
    chunks: ChunkNode[],
    options: Partial<EmbedViaProviderOptions> = {}
): Promise<number> {
    const opts = { ...defaultEmbedTextsOptions, ...options };
    // gather codes
    const texts = chunks.map((ch) => ch.code || "");
    const { embeddings, dim } = await embedTexts(texts, opts);
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (chunk) {
            chunk.embedding = embeddings[i];
            // record dim in meta for persistence
            if (chunk.meta) {
                chunk.meta.embedding_dim = dim;
            } else {
                chunk.meta = { embedding_dim: dim };
            }
        }
    }
    return dim;
}