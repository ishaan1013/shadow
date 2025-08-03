import type { MessageMetadata } from "../chat/messages";
import type {
  ToolName,
  TodoWriteResult,
  FileResult,
  WriteResult,
  SearchReplaceResult,
  DeleteResult,
  DirectoryListing,
  FileSearchResult,
  GrepResult,
  SemanticSearchToolResult,
  WebSearchResult,
  CommandResult,
} from "./schemas";
import { ToolResultSchemas } from "./schemas";
import { z } from "zod";

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export function createValidator<T>(schema: z.ZodSchema<T>) {
  return (data: unknown): ValidationResult<T> => {
    const result = schema.safeParse(data);
    if (result.success) {
      return { success: true, data: result.data };
    } else {
      const errorMessage = result.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      return { success: false, error: errorMessage };
    }
  };
}

// Function overloads for type-safe tool result access
export function getToolResult(
  toolMeta: MessageMetadata["tool"] | undefined,
  toolName: "todo_write"
): TodoWriteResult | null;
export function getToolResult(
  toolMeta: MessageMetadata["tool"] | undefined,
  toolName: "read_file"
): FileResult | null;
export function getToolResult(
  toolMeta: MessageMetadata["tool"] | undefined,
  toolName: "edit_file"
): WriteResult | null;
export function getToolResult(
  toolMeta: MessageMetadata["tool"] | undefined,
  toolName: "search_replace"
): SearchReplaceResult | null;
export function getToolResult(
  toolMeta: MessageMetadata["tool"] | undefined,
  toolName: "run_terminal_cmd"
): CommandResult | null;
export function getToolResult(
  toolMeta: MessageMetadata["tool"] | undefined,
  toolName: "list_dir"
): DirectoryListing | null;
export function getToolResult(
  toolMeta: MessageMetadata["tool"] | undefined,
  toolName: "grep_search"
): GrepResult | null;
export function getToolResult(
  toolMeta: MessageMetadata["tool"] | undefined,
  toolName: "file_search"
): FileSearchResult | null;
export function getToolResult(
  toolMeta: MessageMetadata["tool"] | undefined,
  toolName: "semantic_search"
): SemanticSearchToolResult | null;
export function getToolResult(
  toolMeta: MessageMetadata["tool"] | undefined,
  toolName: "web_search"
): WebSearchResult | null;
export function getToolResult(
  toolMeta: MessageMetadata["tool"] | undefined,
  toolName: "delete_file"
): DeleteResult | null;
// Implementation - accepts any tool name but overloads provide the typing

export function getToolResult(
  toolMeta: MessageMetadata["tool"] | undefined,
  toolName: ToolName
) {
  if (!toolMeta?.result || toolMeta.name !== toolName) return null;

  try {
    // Handle both new object format and legacy JSON strings
    const rawResult =
      typeof toolMeta.result === "string"
        ? JSON.parse(toolMeta.result)
        : toolMeta.result;

    // Get the appropriate schema for validation
    const schema = ToolResultSchemas[toolName];
    if (!schema) {
      console.warn(`No schema found for tool: ${toolName}`);
      return rawResult;
    }

    // Validate the result using Zod
    const validation = createValidator(schema)(rawResult);
    if (validation.success) {
      return validation.data;
    } else {
      console.warn(
        `Tool result validation failed for ${toolName}:`,
        validation.error
      );
      // Return raw result for backward compatibility, but log the validation error
      return rawResult;
    }
  } catch (error) {
    console.warn(`Failed to parse tool result for ${toolName}:`, error);
    return null;
  }
}

// Function overloads for type-safe tool result validation
export function validateToolResult(
  result: unknown,
  toolName: "todo_write"
): ValidationResult<TodoWriteResult>;
export function validateToolResult(
  result: unknown,
  toolName: "read_file"
): ValidationResult<FileResult>;
export function validateToolResult(
  result: unknown,
  toolName: "edit_file"
): ValidationResult<WriteResult>;
export function validateToolResult(
  result: unknown,
  toolName: "search_replace"
): ValidationResult<SearchReplaceResult>;
export function validateToolResult(
  result: unknown,
  toolName: "run_terminal_cmd"
): ValidationResult<CommandResult>;
export function validateToolResult(
  result: unknown,
  toolName: "list_dir"
): ValidationResult<DirectoryListing>;
export function validateToolResult(
  result: unknown,
  toolName: "grep_search"
): ValidationResult<GrepResult>;
export function validateToolResult(
  result: unknown,
  toolName: "file_search"
): ValidationResult<FileSearchResult>;
export function validateToolResult(
  result: unknown,
  toolName: "semantic_search"
): ValidationResult<SemanticSearchToolResult>;
export function validateToolResult(
  result: unknown,
  toolName: "web_search"
): ValidationResult<WebSearchResult>;
export function validateToolResult(
  result: unknown,
  toolName: "delete_file"
): ValidationResult<DeleteResult>;
export function validateToolResult(result: unknown, toolName: ToolName) {
  const schema = ToolResultSchemas[toolName];
  if (!schema) {
    return { success: false, error: `No schema found for tool: ${toolName}` };
  }

  return createValidator(schema)(result);
}

// Type guards are no longer needed - getToolResult() now provides proper typing through overloads
