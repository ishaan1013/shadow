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

    // Handle unknown tool errors
    if (lowerError.includes("unknown tool")) {
      const availableTools = Object.keys(ToolResultSchemas).join(", ");
      return `The tool "${toolName}" does not exist. Please use one of the available tools: ${availableTools}`;
    }

    // Handle common validation patterns
    if (lowerError.includes("required")) {
      return `The ${toolName} tool is missing required parameters. Please check the tool schema and provide all required fields.`;
    }

    if (lowerError.includes("invalid_type")) {
      return `The ${toolName} tool received incorrect parameter types. Please ensure all parameters match the expected types in the tool schema.`;
    }

    if (lowerError.includes("boolean") && lowerError.includes("undefined")) {
      return `The ${toolName} tool requires a boolean parameter that was not provided. Please set the missing boolean field to either true or false.`;
    }

    // Tool-specific suggestions
    switch (toolName) {
      case "read_file":
        return "For read_file, ensure 'should_read_entire_file' is provided as a boolean, and if false, provide both start_line_one_indexed and end_line_one_indexed_inclusive as numbers.";
      case "todo_write":
        return "For todo_write, ensure 'merge' is a boolean and 'todos' is an array with valid todo objects containing id, content, and status fields.";
      case "run_terminal_cmd":
        return "For run_terminal_cmd, ensure 'is_background' is provided as a boolean and 'command' is a non-empty string.";
      default:
        return `Please check the ${toolName} tool schema and ensure all required parameters are provided with correct types.`;
    }
  }
}