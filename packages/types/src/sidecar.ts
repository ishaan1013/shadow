import { CommandSecurityLevel } from "@repo/command-security";
import { z } from "zod";
import { GrepMatch } from "./tools/schemas";

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



export const SearchReplaceRequestSchema = z.object({
  path: z.string().optional(),
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

export interface SearchReplaceResponse extends SidecarResponse {
  isNewFile: false;
  linesAdded: number;
  linesRemoved: number;
  occurrences: number;
  oldLength: number;
  newLength: number;
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

export interface FileSearchResponse extends SidecarResponse {
  files?: string[];
  query: string;
  count: number;
}

export interface GrepSearchResponse extends SidecarResponse {
  matches?: string[];
  detailedMatches?: GrepMatch[];
  query: string;
  matchCount: number;
}

// === Terminal Operations ===

export interface TerminalBufferStats {
  totalEntries: number;
  memoryUsage: number;
  droppedCount: number;
  backpressureActive: boolean;
  oldestEntry?: number;
  newestEntry?: number;
}

export interface TerminalHistoryResponse extends SidecarResponse {
  entries?: Array<{
    id: number;
    timestamp: number;
    data: string;
    type: "stdout" | "stderr" | "command" | "system";
    processId?: number;
  }>;
  stats?: TerminalBufferStats;
}

export interface TerminalStatsResponse extends SidecarResponse {
  stats?: TerminalBufferStats;
}

export interface TerminalClearResponse extends SidecarResponse {
  message: string;
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
  coAuthor: z
    .object({
      name: z.string(),
      email: z.string(),
    })
    .optional(),
  message: z.string().min(1, "Commit message is required"),
});

export const GitPushRequestSchema = z.object({
  branchName: z.string(),
  setUpstream: z.boolean().default(true),
});

// TypeScript interfaces derived from Zod schemas
export type SearchReplaceRequest = z.infer<typeof SearchReplaceRequestSchema>;
export type FileSearchRequest = z.infer<typeof FileSearchRequestSchema>;
export type GrepSearchRequest = z.infer<typeof GrepSearchRequestSchema>;
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
  NETWORK_ERROR = "NETWORK_ERROR",
  TIMEOUT_ERROR = "TIMEOUT_ERROR",
  CLIENT_ERROR = "CLIENT_ERROR",
  SERVER_ERROR = "SERVER_ERROR",
  CIRCUIT_BREAKER_OPEN = "CIRCUIT_BREAKER_OPEN",
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
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
