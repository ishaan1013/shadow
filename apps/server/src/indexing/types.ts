import { GraphNodeKind } from "./graph";

/**
 * Metadata structure for Pinecone records
 * Used in: pineconeService.ts for storing code chunks with their metadata
 * Contains file path, code content, language, line ranges, and node type
 */
export interface PineconeRecordMetadata {
  code: string;
  path: string;
  name: string;
  lang: string;
  line_start: number;
  line_end: number;
  kind: GraphNodeKind;

  // Custom fields for different services (stored as JSON strings)
  symbols?: string;
  dependencies?: string;
  tokenUsage?: string;
  summaryType?: string;
  complexity?: string;
  repoPath?: string;
  lastUpdated?: string;

  [key: string]: any;
}

/**
 * Standard Pinecone batch record for upserting data
 * Used in: pineconeService.ts upsertAutoEmbed() method
 * Contains unique ID and metadata for batch operations
 */
export interface PineconeBatchRecord {
  id: string; // Unique identifier for the record
  metadata: PineconeRecordMetadata;
}

/**
 * Pinecone auto-embed record with text field for embedding
 * Used in: pineconeService.ts for auto-embedding functionality
 * Extends metadata with _id and text fields required by Pinecone SDK
 */
export interface PineconeAutoEmbedRecord extends PineconeRecordMetadata {
  _id: string;
  text: string;
  [key: string]: any;
}
