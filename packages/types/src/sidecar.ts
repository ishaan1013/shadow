import { z } from "zod";
import { CommandSecurityLevel } from "@repo/command-security";

// === Base Response Interface ===
export interface SidecarResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface SuccessResponse extends SidecarResponse {
  success: true;
  message: string;
}

export interface ErrorResponse {
  error: string;
  message: string;
  details?: unknown;
}

// === File Operations ===

export const FileReadOptionsSchema = z.object({
  shouldReadEntireFile: z.boolean().default(true),
  startLineOneIndexed: z.number().min(1).optional(),
  endLineOneIndexedInclusive: z.number().min(1).optional(),
});

export const FileWriteRequestSchema = z.object({
  content: z.string(),
  instructions: z.string(),
});

export const SearchReplaceRequestSchema = z.object({
  oldString: z.string(),
  newString: z.string(),
});

export interface FileReadResponse extends SidecarResponse {
  content?: string;
  totalLines?: number;
  startLine?: number;
  endLine?: number;
}

export interface FileWriteResponse extends SidecarResponse {
  isNewFile?: boolean;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface FileDeleteResponse extends SidecarResponse {
  wasAlreadyDeleted?: boolean;
}

export interface FileStatsResponse extends SidecarResponse {
  stats?: {
    size: number;
    mtime: string; // ISO string for JSON serialization
    isFile: boolean;
    isDirectory: boolean;
  };
}

export interface DirectoryEntry {
  name: string;
  type: "file" | "directory";
  isDirectory: boolean;
}

export interface DirectoryListResponse extends SidecarResponse {
  path: string;
  contents?: DirectoryEntry[];
}

// === Search Operations ===

export const FileSearchRequestSchema = z.object({
  query: z.string(),
});

export const GrepSearchRequestSchema = z.object({
  query: z.string(),
  includePattern: z.string().optional(),
  excludePattern: z.string().optional(),
  caseSensitive: z.boolean().default(false),
});

export const CodebaseSearchRequestSchema = z.object({
  query: z.string(),
  targetDirectories: z.array(z.string()).optional(),
});

export interface FileSearchResponse extends SidecarResponse {
  files?: string[];
  query: string;
  count: number;
}

export interface GrepSearchResponse extends SidecarResponse {
  matches?: string[];
  query: string;
  matchCount: number;
}

export interface CodebaseSearchResult {
  id: number;
  content: string;
  relevance: number;
}

export interface CodebaseSearchResponse extends SidecarResponse {
  results?: CodebaseSearchResult[];
  query: string;
  searchTerms?: string[];
}

// === Command Operations ===

export const CommandRequestSchema = z.object({
  command: z.string(),
  isBackground: z.boolean().default(false),
  timeout: z.number().optional(),
});

export interface CommandResponse extends SidecarResponse {
  stdout?: string;
  stderr?: string;
  isBackground?: boolean;
  command?: string;
  securityLevel?: CommandSecurityLevel;
}

export interface BackgroundCommandResponse extends SidecarResponse {
  commandId: string;
}

// === Git Operations ===

export const GitCloneRequestSchema = z.object({
  repoUrl: z.string(),
  branch: z.string(),
  githubToken: z.string().optional(),
});

export const GitConfigRequestSchema = z.object({
  name: z.string(),
  email: z.string(),
});

export const GitBranchRequestSchema = z.object({
  baseBranch: z.string(),
  shadowBranch: z.string(),
});

export const GitCommitRequestSchema = z.object({
  user: z.object({
    name: z.string(),
    email: z.string(),
  }),
  coAuthor: z.object({
    name: z.string(),
    email: z.string(),
  }).optional(),
  message: z.string().min(1, "Commit message is required"),
});

export const GitPushRequestSchema = z.object({
  branchName: z.string(),
  setUpstream: z.boolean().default(true),
});

// TypeScript interfaces derived from Zod schemas
export type FileReadOptions = z.infer<typeof FileReadOptionsSchema>;
export type FileWriteRequest = z.infer<typeof FileWriteRequestSchema>;
export type SearchReplaceRequest = z.infer<typeof SearchReplaceRequestSchema>;
export type FileSearchRequest = z.infer<typeof FileSearchRequestSchema>;
export type GrepSearchRequest = z.infer<typeof GrepSearchRequestSchema>;
export type CodebaseSearchRequest = z.infer<typeof CodebaseSearchRequestSchema>;
export type CommandRequest = z.infer<typeof CommandRequestSchema>;
export type GitCloneRequest = z.infer<typeof GitCloneRequestSchema>;
export type GitConfigRequest = z.infer<typeof GitConfigRequestSchema>;
export type GitBranchRequest = z.infer<typeof GitBranchRequestSchema>;
export type GitCommitRequest = z.infer<typeof GitCommitRequestSchema>;
export type GitPushRequest = z.infer<typeof GitPushRequestSchema>;

export interface GitCloneResponse extends SidecarResponse {
  repoUrl?: string;
  branch?: string;
}

export interface GitConfigResponse extends SidecarResponse {
  user?: {
    name: string;
    email: string;
  };
}

export interface GitBranchResponse extends SidecarResponse {
  baseBranch?: string;
  shadowBranch?: string;
  baseCommitSha?: string;
}

export interface GitStatusResponse extends SidecarResponse {
  hasChanges: boolean;
  hasUnstagedChanges?: boolean;
  hasStagedChanges?: boolean;
  status?: string;
}

export interface GitDiffResponse extends SidecarResponse {
  diff: string;
  unstagedDiff?: string;
  stagedDiff?: string;
}

export interface GitCommitResponse extends SidecarResponse {
  commitMessage?: string;
  commitSha?: string;
}

export interface GitPushResponse extends SidecarResponse {
  branchName?: string;
}

// === Health & Status ===

export interface HealthResponse extends SidecarResponse {
  healthy: boolean;
  message: string;
  details?: Record<string, unknown>;
  uptime?: number;
  version?: string;
}

export interface WorkspaceStatusResponse extends SidecarResponse {
  exists: boolean;
  path: string;
  isReady: boolean;
  sizeBytes?: number;
}

// === Error Handling ===

export enum SidecarErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  CLIENT_ERROR = 'CLIENT_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
  CIRCUIT_BREAKER_OPEN = 'CIRCUIT_BREAKER_OPEN',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export interface SidecarError extends Error {
  type: SidecarErrorType;
  statusCode?: number;
  retryable: boolean;
}

// === Client Configuration ===

export interface SidecarClientConfig {
  taskId: string;
  namespace?: string;
  port?: number;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  circuitBreakerThreshold?: number;
  circuitBreakerTimeout?: number;
} 