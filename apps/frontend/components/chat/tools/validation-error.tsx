import type { ValidationErrorResult } from "@repo/types";
import { AlertCircle } from "lucide-react";
import { ToolComponent } from "./collapsible-tool";

export function ValidationErrorTool({
  toolName,
  args,
  error,
}: {
  toolName: string;
  args: Record<string, unknown>;
  error: ValidationErrorResult;
}) {
  return (
    <ToolComponent
      icon={<AlertCircle className="text-destructive" />}
      type="error"
      title={`${toolName} - Validation Error`}
      collapsible
    >
      <div className="space-y-2 text-sm">
        <div className="text-destructive font-medium">{error.error}</div>
        {error.suggestedFix && (
          <div className="text-muted-foreground">
            <strong>Suggestion:</strong> {error.suggestedFix}
          </div>
        )}
        {error.validationDetails && (
          <div className="text-xs opacity-70">
            Expected: {error.validationDetails.expectedType}, Got:{" "}
            {error.validationDetails.receivedType}
          </div>
        )}
        {Object.keys(args).length > 0 && (
          <details className="text-xs opacity-70">
            <summary className="cursor-pointer">Tool Arguments</summary>
            <pre className="bg-muted mt-1 overflow-x-auto rounded p-2 text-xs">
              {JSON.stringify(args, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </ToolComponent>
  );
}
