/**
 * Embedding providers for CodeGraph.
 *
 * Providers:
 *   - 'jina-api'           -> Remote Jina Embedding API (recommended for quick start)
 *   - 'local-transformers' -> @xenova/transformers ONNX inference (offline)
 *   - 'cheap-hash'         -> deterministic fallback (no ML)
 *
 * Default provider = 'cheap-hash' (backward compat) unless overridden by indexer options.
 *
 * Jina v2 Base Code model details:
 *   * 161M param JinaBERT variant w/ ALiBi extrapolation to 8K tokens.
 *   * Trained on GitHub code + ~150M code QA/docstring pairs across ~30 PLs.
 *   * Use MEAN pooling over token embeddings; L2-normalize for cosine sim.
 */

import PineconeHandler from "./embedding/pineconeService";
import { GraphNode } from "./graph";
import { logger } from "./logger";
import { getNamespaceFromRepo } from "./utils/repository";
import { PineconeBatchRecord } from "./types";

// Wrapper used to embed and upsert to Pinecone
async function embedAndUpsertToPinecone(
  nodes: GraphNode[],
  repo: string,
  clearNamespace: boolean
): Promise<number> {
  // Input: GraphNode[], repo: string, clearNamespace: boolean
  // Upserts the records to Pinecone as PineconeBatchRecord[]
  // Output: num_uploaded_records?
  const pinecone = new PineconeHandler();
  const namespace = getNamespaceFromRepo(repo);

  if (clearNamespace) {
    console.log("Clearing namespace", namespace);
    await pinecone.clearNamespace(namespace);
  }

  // Chunk by line ranges and upload
  const recordChunks: GraphNode[][] = await pinecone.chunkRecords(nodes); // Input: GraphNode[], Output: GraphNode[][]

  let totalUploaded = 0;
  for (const recordChunk of recordChunks) {
    // Convert each chunk to Pinecone format
    const batchRecords: PineconeBatchRecord[] = recordChunk.map((chunk) => ({
      id: chunk.id,
      metadata: {
        code: chunk.code || "",
        path: chunk.path,
        name: chunk.name,
        lang: chunk.lang,
        line_start: chunk.loc?.startLine || 0,
        line_end: chunk.loc?.endLine || 0,
        kind: chunk.kind,
      },
    })); // Input: GraphNode[], Output: PineconeBatchRecord[]

    const uploaded = await pinecone.upsertAutoEmbed(batchRecords, namespace); // Input: PineconeBatchRecord[], Output: num_uploaded_records?
    totalUploaded += uploaded;
  }

  logger.info(`Embedded and uploaded ${totalUploaded} chunks to Pinecone`);
  return totalUploaded;
}

export { embedAndUpsertToPinecone };
