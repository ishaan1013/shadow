import {
  ToolName,
  ToolResultTypes,
  ToolResultSchemas,
  ValidationErrorResult,
  createValidator,
} from "@repo/types";
import { ValidationHelpers } from "./validation-helpers";

export class ToolValidator {
  private validationHelpers = new ValidationHelpers();

  /**
   * Validates a tool result and creates a graceful error result if validation fails
   */
  validateToolResult(
    toolName: ToolName,
    result: unknown
  ): {
    isValid: boolean;
    validatedResult: ToolResultTypes["result"] | ValidationErrorResult;
    shouldEmitError: boolean;
    errorDetails?: {
      error: string;
      suggestedFix: string;
      originalResult: unknown;
    };
  } {
    try {
      // toolName is guaranteed to be valid, validate the result directly
      const schema = ToolResultSchemas[toolName];
      const validation = createValidator(schema)(result);

      if (validation.success) {
        return {
          isValid: true,
          validatedResult: validation.data!,
          shouldEmitError: false,
        };
      }

      // Generate helpful error message for the LLM
      const errorMessage = `Tool call validation failed for ${toolName}: ${validation.error}`;
      const suggestedFix = this.validationHelpers.generateToolValidationSuggestion(
        toolName,
        validation.error || ""
      );

      const errorResult: ValidationErrorResult = {
        success: false,
        error: errorMessage,
        suggestedFix,
        originalResult: result,
        validationDetails: {
          expectedType: "Valid tool result schema",
          receivedType: typeof result,
          fieldPath: validation.error || "",
        },
      };

      return {
        isValid: false,
        validatedResult: errorResult,
        shouldEmitError: true,
        errorDetails: {
          error: errorMessage,
          suggestedFix,
          originalResult: result,
        },
      };
    } catch (error) {
      // Fallback for unexpected validation errors
      const fallbackMessage = `Unexpected validation error for tool ${toolName}: ${error instanceof Error ? error.message : "Unknown error"}`;

      return {
        isValid: false,
        validatedResult: {
          success: false,
          error: fallbackMessage,
          suggestedFix:
            "Please retry the tool call with valid parameters according to the tool schema.",
          originalResult: result,
        } as ValidationErrorResult,
        shouldEmitError: true,
        errorDetails: {
          error: fallbackMessage,
          suggestedFix:
            "Please retry the tool call with valid parameters according to the tool schema.",
          originalResult: result,
        },
      };
    }
  }
}