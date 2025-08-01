import {
  CommandOptions,
  DeleteResult,
  DirectoryListing,
  FileResult,
  FileSearchResult,
  FileStatsResult,
  GrepOptions,
  GrepResult,
  ReadFileOptions,
  SearchOptions,
  WriteResult,
  SearchReplaceResult,
  SemanticSearchToolResult,
  WebSearchResult,
  GitStatusResponse,
  GitDiffResponse,
  GitCommitResponse,
  GitPushResponse,
  GitCommitRequest,
  GitPushRequest,
} from "@repo/types";
import { CommandResult } from "./types";

/**
 * ToolExecutor interface abstracts all tool operations for both local and remote execution
 */
export interface ToolExecutor {
  // File operations
  readFile(
    targetFile: string,
    options?: ReadFileOptions
  ): Promise<FileResult>;

  getFileStats(targetFile: string): Promise<FileStatsResult>;

  writeFile(
    targetFile: string,
    content: string,
    instructions: string
  ): Promise<WriteResult>;

  deleteFile(targetFile: string): Promise<DeleteResult>;

  searchReplace(
    filePath: string,
    oldString: string,
    newString: string
  ): Promise<SearchReplaceResult>;

  // Directory operations
  listDirectory(relativeWorkspacePath: string): Promise<DirectoryListing>;

  // Search operations
  searchFiles(query: string, options?: SearchOptions): Promise<FileSearchResult>;

  grepSearch(
    query: string,
    options?: GrepOptions
  ): Promise<GrepResult>;

  semanticSearch(
    query: string,
    repo: string,
    options?: SearchOptions
  ): Promise<SemanticSearchToolResult>;
  webSearch(
    query: string,
    domain?: string
  ): Promise<WebSearchResult>;

  // Command execution
  executeCommand(
    command: string,
    options?: CommandOptions
  ): Promise<CommandResult>;

  // Workspace information
  getWorkspacePath(): string;
  isRemote(): boolean;

  // Task context
  getTaskId(): string;

  // Git operations
  getGitStatus(): Promise<GitStatusResponse>;
  getGitDiff(): Promise<GitDiffResponse>;
  commitChanges(request: GitCommitRequest): Promise<GitCommitResponse>;
  pushBranch(request: GitPushRequest): Promise<GitPushResponse>;
}