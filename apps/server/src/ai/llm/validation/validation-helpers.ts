import { ToolResultSchemas } from "@repo/types";

export class ValidationHelpers {
  /**
   * Generates helpful suggestions for tool validation errors
   */
  generateToolValidationSuggestion(
    toolName: string,
    validationError: string
  ): string {
    const lowerError = validationError.toLowerCase();

    // Handle unknown tool errors (still relevant since these bypass repair)
    if (lowerError.includes("unknown tool")) {
      const availableTools = Object.keys(ToolResultSchemas).join(", ");
      return `The tool "${toolName}" does not exist. Please use one of the available tools: ${availableTools}`;
    }

    // For tool execution result validation errors (not parameter errors)
    if (lowerError.includes("required") || lowerError.includes("invalid_type")) {
      return `The ${toolName} tool execution failed validation. Please check the tool's expected result format.`;
    }

    // Generic fallback for tool result validation
    return `The ${toolName} tool result validation failed. Please check the tool's expected output format.`;
  }
}