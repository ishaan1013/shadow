import { GraphNodeKind } from "./graph";

export interface CodebaseSearchResponse {
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
  };
}

export interface CodebaseSearchRequest {
  query: string;
  namespace: string;
  topK?: number;
  includeTypes?: GraphNodeKind[];
  excludeFiles?: string[];
  maxResults?: number;
  includeContext?: boolean;
}
