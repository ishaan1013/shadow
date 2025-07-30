// Tool type enum - shared between frontend and backend
export enum ToolType {
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
export const TOOL_PREFIXES: Record<ToolType, string> = {
  [ToolType.EDIT_FILE]: "Edited",
  [ToolType.READ_FILE]: "Read",
  [ToolType.SEARCH_REPLACE]: "Replaced in",
  [ToolType.SEMANTIC_SEARCH]: "Semantic search",
  [ToolType.GREP_SEARCH]: "Grepped",
  [ToolType.FILE_SEARCH]: "Searched files",
  [ToolType.LIST_DIR]: "Listed",
  [ToolType.DELETE_FILE]: "Deleted",
  [ToolType.WEB_SEARCH]: "Searched web",
  [ToolType.TODO_WRITE]: "Updated todo list",
  [ToolType.RUN_TERMINAL_CMD]: "Ran",
};
