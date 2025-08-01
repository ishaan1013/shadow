import PineconeHandler from "../embedding/pineconeService";
import {
  DeepWikiSearchRequest,
  DeepWikiSearchResponse,
} from "./deepwiki-types";

// DeepWiki retrieval with access to custom metadata fields
export async function retrieveDeepWikiSummaries(
  request: DeepWikiSearchRequest
): Promise<DeepWikiSearchResponse[]> {
  const pinecone = new PineconeHandler("shadow");

  // Access raw Pinecone response to get custom metadata fields
  const response = await (pinecone as any).client
    .namespace(request.namespace)
    .searchRecords({
      query: {
        topK: request.topK || 10,
        inputs: { text: request.query },
      },
    });

  const hits = response.result?.hits || [];

  // Transform Pinecone { id, score, metadata } to DeepWikiSearchResponse
  return hits.map((hit: any) => ({
    _id: hit.id,
    _score: hit.score || 0,
    fields: {
      code: hit.metadata?.code || "",
      path: hit.metadata?.path || "",
      name: hit.metadata?.name || "",
      lang: hit.metadata?.lang || "",
      line_start: hit.metadata?.line_start || 0,
      line_end: hit.metadata?.line_end || 0,
      kind: hit.metadata?.kind || "FILE",
      symbols: hit.metadata?.symbols,
      dependencies: hit.metadata?.dependencies,
      tokenUsage: hit.metadata?.tokenUsage,
      summaryType: hit.metadata?.summaryType,
      complexity: hit.metadata?.complexity,
      repoPath: hit.metadata?.repoPath,
      lastUpdated: hit.metadata?.lastUpdated,
    },
  })) as DeepWikiSearchResponse[];
}
