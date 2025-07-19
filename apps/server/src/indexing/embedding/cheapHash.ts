import { EmbeddingResult } from "./types";

// ---- Cheap hash fallback --- //
export async function cheapHashEmbedding(texts: string[], dim: number = 256): Promise<EmbeddingResult> {
    const embeddings: Float32Array[] = [];
    for (const text of texts) {
      const buf = Buffer.from(text, 'utf8');
      const vec = new Float32Array(dim);
      
      for (let i = 0; i < buf.length; i++) {
        const byteValue = (buf[i] ?? 0) % dim;
        vec[byteValue] = (vec[byteValue] ?? 0) + 1;
      }
      
      // L2 normalize
      const norm = Math.sqrt(
        vec.reduce((sum, value) => sum + value * value, 0)
      ) || 1;
      embeddings.push(vec.map(value => value / norm) as Float32Array);
    }
    return { embeddings, dim };
  }