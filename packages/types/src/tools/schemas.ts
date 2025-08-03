import { z } from "zod";
import type { ValidationErrorResult } from "../chat/streaming";

// === Base Schemas ===
const BaseResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  error: z.string().optional(),
});

const ExplanationSchema = z.object({
  explanation: z
    .string()
    .describe("One sentence explanation as to why this tool is being used"),
});

// === Tool Parameter Schemas ===
export const TodoWriteParamsSchema = z
  .object({
    merge: z
      .boolean()
      .describe(
        "Whether to merge with existing todos (true) or replace them (false)"
      ),
    todos: z
      .array(
        z.object({
          id: z.string().describe("Unique identifier for the todo item"),
          content: z.string().describe("Descriptive content of the todo"),
          status: z
            .enum(["pending", "in_progress", "completed", "cancelled"])
            .describe("Current status of the todo item"),
        })
      )
      .describe("Array of todo items to create or update"),
  })
  .merge(ExplanationSchema);

export const ReadFileParamsSchema = z
  .object({
    target_file: z.string().describe("The path of the file to read"),
    should_read_entire_file: z
      .boolean()
      .describe("Whether to read the entire file"),
    start_line_one_indexed: z
      .number()
      .optional()
      .describe("The one-indexed line number to start reading from"),
    end_line_one_indexed_inclusive: z
      .number()
      .optional()
      .describe("The one-indexed line number to end reading at"),
  })
  .merge(ExplanationSchema);

export const EditFileParamsSchema = z.object({
  target_file: z.string().describe("The target file to modify"),
  instructions: z
    .string()
    .describe(
      "A single sentence instruction describing what you are going to do"
    ),
  code_edit: z.string().describe("The precise lines of code to edit or create"),
});

export const SearchReplaceParamsSchema = z.object({
  file_path: z
    .string()
    .describe("The path to the file to search and replace in"),
  old_string: z
    .string()
    .describe("The text to replace (must be unique within the file)"),
  new_string: z.string().describe("The edited text to replace the old_string"),
});

export const RunTerminalCmdParamsSchema = z
  .object({
    command: z.string().describe("The terminal command to execute"),
    is_background: z
      .boolean()
      .describe("Whether the command should be run in the background"),
  })
  .merge(ExplanationSchema);

export const ListDirParamsSchema = z
  .object({
    relative_workspace_path: z
      .string()
      .describe("Path to list contents of, relative to the workspace root"),
  })
  .merge(ExplanationSchema);

export const GrepSearchParamsSchema = z
  .object({
    query: z.string().describe("The regex pattern to search for"),
    include_pattern: z
      .string()
      .optional()
      .describe("Glob pattern for files to include"),
    exclude_pattern: z
      .string()
      .optional()
      .describe("Glob pattern for files to exclude"),
    case_sensitive: z
      .boolean()
      .optional()
      .describe("Whether the search should be case sensitive"),
  })
  .merge(ExplanationSchema);

export const FileSearchParamsSchema = z
  .object({
    query: z.string().describe("Fuzzy filename to search for"),
  })
  .merge(ExplanationSchema);

export const DeleteFileParamsSchema = z
  .object({
    target_file: z.string().describe("The path of the file to delete"),
  })
  .merge(ExplanationSchema);

export const SemanticSearchParamsSchema = z
  .object({
    query: z.string().describe("The query to search the codebase for"),
  })
  .merge(ExplanationSchema);

export const WebSearchParamsSchema = z
  .object({
    query: z.string().describe("The search query"),
    domain: z
      .string()
      .optional()
      .describe("Optional domain to filter results to"),
  })
  .merge(ExplanationSchema);

// === Tool Result Schemas ===
export const TodoWriteResultSchema = BaseResultSchema.extend({
  todos: z
    .array(
      z.object({
        action: z.enum(["created", "updated"]),
        id: z.string(),
        content: z.string(),
        status: z.string(),
      })
    )
    .optional(),
  count: z.number().optional(),
  totalTodos: z.number().optional(),
  completedTodos: z.number().optional(),
});

export const FileResultSchema = BaseResultSchema.extend({
  content: z.string().optional(),
  totalLines: z.number().optional(),
  startLine: z.number().optional(),
  endLine: z.number().optional(),
});

export const WriteResultSchema = BaseResultSchema.extend({
  isNewFile: z.boolean().optional(),
  linesAdded: z.number().optional(),
  linesRemoved: z.number().optional(),
});

export const SearchReplaceResultSchema = BaseResultSchema.extend({
  isNewFile: z.literal(false),
  linesAdded: z.number(),
  linesRemoved: z.number(),
  occurrences: z.number(),
  oldLength: z.number(),
  newLength: z.number(),
});

export const DeleteResultSchema = BaseResultSchema.extend({
  wasAlreadyDeleted: z.boolean().optional(),
});

export const DirectoryListingSchema = BaseResultSchema.extend({
  contents: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(["file", "directory"]),
        isDirectory: z.boolean(),
      })
    )
    .optional(),
  path: z.string(),
});

export const FileSearchResultSchema = BaseResultSchema.extend({
  files: z.array(z.string()),
  query: z.string(),
  count: z.number(),
});

export const GrepMatchSchema = z.object({
  file: z.string(),
  lineNumber: z.number(),
  content: z.string(),
});

export const GrepResultSchema = BaseResultSchema.extend({
  matches: z.array(z.string()),
  detailedMatches: z.array(GrepMatchSchema).optional(),
  query: z.string(),
  matchCount: z.number(),
});

export const SemanticSearchResultSchema = BaseResultSchema.extend({
  results: z.array(
    z.object({
      id: z.number(),
      content: z.string(),
      relevance: z.number(),
      filePath: z.string(),
      lineStart: z.number(),
      lineEnd: z.number(),
      language: z.string(),
      kind: z.string(),
    })
  ),
  query: z.string(),
  searchTerms: z.array(z.string()),
});

export const WebSearchResultSchema = BaseResultSchema.extend({
  results: z.array(
    z.object({
      text: z.string(),
      url: z.string(),
      title: z.string().optional(),
    })
  ),
  query: z.string(),
  domain: z.string().optional(),
});

export const CommandResultSchema = BaseResultSchema.extend({
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  isBackground: z.boolean().optional(),
  command: z.string().optional(),
  securityLevel: z.string().optional(),
});

export const FileStatsResultSchema = BaseResultSchema.extend({
  stats: z
    .object({
      size: z.number(),
      mtime: z.date(),
      isFile: z.boolean(),
      isDirectory: z.boolean(),
    })
    .optional(),
});

// === Inferred Types ===
export type TodoWriteParams = z.infer<typeof TodoWriteParamsSchema>;
export type ReadFileParams = z.infer<typeof ReadFileParamsSchema>;
export type EditFileParams = z.infer<typeof EditFileParamsSchema>;
export type SearchReplaceParams = z.infer<typeof SearchReplaceParamsSchema>;
export type RunTerminalCmdParams = z.infer<typeof RunTerminalCmdParamsSchema>;
export type ListDirParams = z.infer<typeof ListDirParamsSchema>;
export type GrepSearchParams = z.infer<typeof GrepSearchParamsSchema>;
export type FileSearchParams = z.infer<typeof FileSearchParamsSchema>;
export type DeleteFileParams = z.infer<typeof DeleteFileParamsSchema>;
export type SemanticSearchParams = z.infer<typeof SemanticSearchParamsSchema>;
export type WebSearchParams = z.infer<typeof WebSearchParamsSchema>;

export type TodoWriteResult = z.infer<typeof TodoWriteResultSchema>;
export type FileResult = z.infer<typeof FileResultSchema>;
export type WriteResult = z.infer<typeof WriteResultSchema>;
export type SearchReplaceResult = z.infer<typeof SearchReplaceResultSchema>;
export type DeleteResult = z.infer<typeof DeleteResultSchema>;
export type DirectoryListing = z.infer<typeof DirectoryListingSchema>;
export type FileSearchResult = z.infer<typeof FileSearchResultSchema>;
export type GrepMatch = z.infer<typeof GrepMatchSchema>;
export type GrepResult = z.infer<typeof GrepResultSchema>;
export type SemanticSearchToolResult = z.infer<
  typeof SemanticSearchResultSchema
>;
export type WebSearchResult = z.infer<typeof WebSearchResultSchema>;
export type CommandResult = z.infer<typeof CommandResultSchema>;
export type FileStatsResult = z.infer<typeof FileStatsResultSchema>;

// === Tool Schema Map ===
export const ToolResultSchemas = {
  todo_write: TodoWriteResultSchema,
  read_file: FileResultSchema,
  edit_file: WriteResultSchema,
  search_replace: SearchReplaceResultSchema,
  run_terminal_cmd: CommandResultSchema,
  list_dir: DirectoryListingSchema,
  grep_search: GrepResultSchema,
  file_search: FileSearchResultSchema,
  semantic_search: SemanticSearchResultSchema,
  web_search: WebSearchResultSchema,
  delete_file: DeleteResultSchema,
} as const;

export type ToolName = keyof typeof ToolResultSchemas;

// === Discriminated Union for Tool Results ===
export type ToolResultTypes =
  | { toolName: "todo_write"; result: TodoWriteResult }
  | { toolName: "read_file"; result: FileResult }
  | { toolName: "edit_file"; result: WriteResult }
  | { toolName: "search_replace"; result: SearchReplaceResult }
  | { toolName: "run_terminal_cmd"; result: CommandResult }
  | { toolName: "list_dir"; result: DirectoryListing }
  | { toolName: "grep_search"; result: GrepResult }
  | { toolName: "file_search"; result: FileSearchResult }
  | { toolName: "semantic_search"; result: SemanticSearchToolResult }
  | { toolName: "web_search"; result: WebSearchResult }
  | { toolName: "delete_file"; result: DeleteResult };

// Extended type that includes validation errors
export type ToolResultTypesWithValidation = ToolResultTypes & {
  result: ToolResultTypes["result"] | ValidationErrorResult;
};

export enum ToolTypes {
  EDIT_FILE = "edit_file",
  READ_FILE = "read_file",
  SEARCH_REPLACE = "search_replace",
  SEMANTIC_SEARCH = "semantic_search",
  GREP_SEARCH = "grep_search",
  FILE_SEARCH = "file_search",
  LIST_DIR = "list_dir",
  DELETE_FILE = "delete_file",
  WEB_SEARCH = "web_search",
  TODO_WRITE = "todo_write",
  RUN_TERMINAL_CMD = "run_terminal_cmd",
}

// Tool prefixes for UI display
export const TOOL_PREFIXES: Record<ToolTypes, string> = {
  [ToolTypes.EDIT_FILE]: "Edited",
  [ToolTypes.READ_FILE]: "Read",
  [ToolTypes.SEARCH_REPLACE]: "Replaced in",
  [ToolTypes.SEMANTIC_SEARCH]: "Semantic search",
  [ToolTypes.GREP_SEARCH]: "Grepped",
  [ToolTypes.FILE_SEARCH]: "Searched files",
  [ToolTypes.LIST_DIR]: "Listed",
  [ToolTypes.DELETE_FILE]: "Deleted",
  [ToolTypes.WEB_SEARCH]: "Searched web",
  [ToolTypes.TODO_WRITE]: "Updated todo list",
  [ToolTypes.RUN_TERMINAL_CMD]: "Ran",
};
