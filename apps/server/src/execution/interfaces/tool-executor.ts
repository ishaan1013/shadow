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
  CodebaseSearchToolResult,
  WebSearchResult,
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
  ): Promise<WriteResult>;

  // Directory operations
  listDirectory(relativeWorkspacePath: string): Promise<DirectoryListing>;

  // Search operations
  searchFiles(query: string, options?: SearchOptions): Promise<FileSearchResult>;

  grepSearch(
    query: string,
    options?: GrepOptions
  ): Promise<GrepResult>;

  codebaseSearch(
    query: string,
    options?: SearchOptions
  ): Promise<CodebaseSearchToolResult>;

  semanticSearch(
    query: string,
    repo: string,
    options?: SearchOptions
  ): Promise<CodebaseSearchResult>;
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
}