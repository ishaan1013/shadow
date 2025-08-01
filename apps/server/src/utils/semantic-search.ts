import { retrieveCodeChunks } from "@/indexing/codebase-retrieval";
import { getNamespaceFromRepo, isValidRepo } from "@/indexing/utils/repository";
import { CodebaseSearchResponse } from "@/indexing/codebase-types";
import { SemanticSearchToolResult } from "@repo/types";

export interface SemanticSearchParams {
  query: string;
  repo: string;
  topK?: number;
  fields?: string[];
}

export interface SemanticSearchResponse {
  hits: CodebaseSearchResponse[];
}

export async function performSemanticSearch(
  params: SemanticSearchParams
): Promise<SemanticSearchToolResult> {
  const { query, repo, topK = 15 } = params;

  let namespaceToUse = repo;
  if (isValidRepo(repo)) {
    namespaceToUse = getNamespaceFromRepo(repo);
  }

  try {
    const hits = await retrieveCodeChunks({
      query,
      namespace: namespaceToUse,
      topK,
    });

    const parsedData: SemanticSearchToolResult = {
      success: !!hits,
      results: hits.map((hit: CodebaseSearchResponse, i: number) => ({
        id: i + 1,
        content: hit?.fields?.code || "",
        relevance: typeof hit?._score === "number" ? hit._score : 0.8,
        filePath: hit?.fields?.path || "",
        lineStart: hit?.fields?.line_start || 0,
        lineEnd: hit?.fields?.line_end || 0,
        language: hit?.fields?.lang || "",
        kind: hit?.fields?.kind || "",
      })),
      query,
      searchTerms: query.split(/\s+/),
      message: hits?.length
        ? `Found ${hits.length} relevant code snippets for "${query}"`
        : `No relevant code found for "${query}"`,
    };

    console.log("semanticSearch output", parsedData);
    return parsedData;
  } catch (error) {
    console.error("[SEMANTIC_SEARCH_ERROR]", error);
    return {
      success: false,
      results: [],
      query,
      searchTerms: query.split(/\s+/),
      message: `Semantic search failed for "${query}"`,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
