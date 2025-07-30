// Core tool result interfaces - shared between frontend and backend
export interface FileResult {
  success: boolean;
  content?: string;
  error?: string;
  message: string;
  totalLines?: number;
  startLine?: number;
  endLine?: number;
}

export interface WriteResult {
  success: boolean;
  message: string;
  error?: string;
  isNewFile?: boolean;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface SearchReplaceResult {
  success: boolean;
  message: string;
  error?: string;
  isNewFile: false;
  linesAdded: number;
  linesRemoved: number;
  occurrences: number;
  oldLength: number;
  newLength: number;
}

export interface DeleteResult {
  success: boolean;
  message: string;
  error?: string;
  wasAlreadyDeleted?: boolean;
}

export interface FileStatsResult {
  success: boolean;
  stats?: {
    size: number;
    mtime: Date;
    isFile: boolean;
    isDirectory: boolean;
  };
  message: string;
  error?: string;
}

export interface DirectoryListing {
  success: boolean;
  contents?: Array<{
    name: string;
    type: "file" | "directory";
    isDirectory: boolean;
  }>;
  path: string;
  message: string;
  error?: string;
}

export interface FileSearchResult {
  success: boolean;
  files: string[];
  query: string;
  count: number;
  message: string;
  error?: string;
}

export interface GrepMatch {
  file: string;
  lineNumber: number;
  content: string;
}

export interface GrepResult {
  success: boolean;
  matches: string[];
  detailedMatches?: GrepMatch[];
  query: string;
  matchCount: number;
  message: string;
  error?: string;
}

export interface SemanticSearchToolResult {
  success: boolean;
  results: Array<{
    id: number;
    content: string;
    relevance: number;
    filePath: string;
    lineStart: number;
    lineEnd: number;
    language: string;
    kind: string;
  }>;
  query: string;
  searchTerms: string[];
  message: string;
  error?: string;
}

export interface WebSearchResult {
  success: boolean;
  results: Array<{
    text: string;
    url: string;
    title?: string;
  }>;
  query: string;
  domain?: string;
  message: string;
  error?: string;
}

export interface CommandResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  message: string;
  error?: string;
  isBackground?: boolean;
  command?: string;
  securityLevel?: string;
}

export interface TodoWriteResult {
  success: boolean;
  message: string;
  todosCreated?: number;
  todosUpdated?: number;
  error?: string;
}

// Discriminated union for all tool results
export type ToolResultTypes =
  | { toolName: "edit_file"; result: WriteResult }
  | { toolName: "search_replace"; result: SearchReplaceResult }
  | { toolName: "run_terminal_cmd"; result: CommandResult }
  | { toolName: "read_file"; result: FileResult }
  | { toolName: "grep_search"; result: GrepResult }
  | { toolName: "list_dir"; result: DirectoryListing }
  | { toolName: "file_search"; result: FileSearchResult }
  | { toolName: "semantic_search"; result: SemanticSearchToolResult }
  | { toolName: "web_search"; result: WebSearchResult }
  | { toolName: "delete_file"; result: DeleteResult }
  | { toolName: "todo_write"; result: TodoWriteResult };
