import { GraphNodeKind } from "../graph";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface DeepWikiSearchResponse {
  _id: string;
  _score: number;
  fields: {
    code: string;
    path: string;
    name: string;
    lang: string;
    line_start: number;
    line_end: number;
    kind: GraphNodeKind;
    // DeepWiki-specific fields stored as JSON strings
    symbols?: string;
    dependencies?: string;
    tokenUsage?: string;
    summaryType?: string;
    complexity?: string;
    repoPath?: string;
    lastUpdated?: string;
  };
}

export interface DeepWikiRecord {
  id: string;
  metadata: {
    repoPath: string;
    filePath?: string;
    type: "file_summary" | "directory_summary" | "root_overview";
    language?: string;
    symbols: string[];
    dependencies: string[];
    complexity: number;
    lastUpdated: string;
    tokenUsage?: TokenUsage;
    summary: string;
  };
}

export interface DeepWikiSearchRequest {
  query: string;
  namespace: string;
  topK?: number;
  summaryTypes?: ("file_summary" | "directory_summary" | "root_overview")[];
  includeSymbols?: boolean;
  includeDependencies?: boolean;
  minComplexity?: number;
  maxComplexity?: number;
}
