import { EmbeddingResult, EmbedTextsOptions, EMBEDDING_MODEL, defaultEmbedTextsOptions } from "./types";
import { logger } from "../logger";

// ---- Local Transformers.js provider --- //
let _localPipeline: any = null;


async function getLocalPipeline(
  model: string = EMBEDDING_MODEL,
  { quantized = true }: { quantized?: boolean } = {}
): Promise<any> {
  if (_localPipeline) return _localPipeline;
  // dynamic import because @xenova/transformers is ESM
  const { pipeline } = await import("@xenova/transformers");
  _localPipeline = await pipeline("feature-extraction", model, {
    quantized,
  });
  return _localPipeline;
}

/**
 * Run local model; apply mean pooling & L2 norm (recommended in model card).
 */
export async function embedViaLocalTransformers(
  texts: string[], options: Partial<EmbedTextsOptions> = {}
): Promise<EmbeddingResult> {
  const opts = { ...defaultEmbedTextsOptions, ...options };
  const { model, quantized, batchSize } = opts;
  
  const extractor = await getLocalPipeline(model, { quantized });
  const out: Float32Array[] = new Array(texts.length);
  // run in small batches; pipeline can accept array input
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    // {pooling:'mean'} supported per model card example; returns Tensor objects
    const embeddings = await extractor(batch, {
      pooling: "mean",
      normalize: true,
    });
    // embeddings: array of Tensor objects {data:Float32Array,...}
    for (let j = 0; j < batch.length; j++) {
      out[i + j] = embeddings[j].data; // already Float32Array
    }
  }
  if (out.length === 0 || out[0] === undefined) {
    logger.error("No embeddings returned from local transformers");
    return { embeddings: [], dim: 0 };
  } else {
    const dim = out[0].length;
    return { embeddings: out, dim };
  }
}