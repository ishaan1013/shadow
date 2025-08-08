import { cn } from "@/lib/utils";
import type {
  Message,
  ErrorPart,
  ToolResultTypes,
  ValidationErrorResult,
  ToolCallPart,
  ReasoningPart,
  RedactedReasoningPart,
} from "@repo/types";
import { AlertCircle, Copy, Check, MoreHorizontal } from "lucide-react";
import { useState, useMemo, useCallback } from "react";
import { MemoizedMarkdown } from "./memoized-markdown";
import { ToolMessage } from "./tools";
import { ToolComponent } from "./tools/tool";
import { ValidationErrorTool } from "./tools/validation-error";
import { ReasoningComponent, RedactedReasoningComponent } from "./reasoning";
import {
  hasUsefulPartialArgs,
  STREAMING_ENABLED_TOOLS,
} from "@/lib/streaming-args";
import { PRCard } from "./pr-card";
import { Button } from "../ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

function getMessageCopyContent(
  groupedParts: Array<
    | { type: "text"; text: string }
    | { type: "tool-call"; part: unknown; index: number }
    | { type: "tool-result"; part: unknown; index: number }
    | { type: "error"; part: ErrorPart; index: number }
    | { type: "reasoning"; part: ReasoningPart; index: number }
    | { type: "redacted-reasoning"; part: RedactedReasoningPart; index: number }
  >
): string {
  return groupedParts
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      } else if (
        part.type === "tool-call" &&
        typeof part.part === "object" &&
        part.part !== null &&
        "toolName" in part.part
      ) {
        return `Tool Call: ${part.part.toolName}`;
      } else if (part.type === "reasoning") {
        return `Thinking: ${part.part.text}`;
      } else if (part.type === "redacted-reasoning") {
        return `Thinking: [redacted]`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export function AssistantMessage({
  message,
  taskId,
}: {
  message: Message;
  taskId: string;
}) {
  const [isMoreDropdownOpen, setIsMoreDropdownOpen] = useState(false);
  const {
    copyToClipboard: copyMessageContent,
    isCopied: isMessageContentCopied,
  } = useCopyToClipboard();
  const { copyToClipboard: copyMessageId } = useCopyToClipboard();

  const toolResultsMap = useMemo(() => {
    const map = new Map<string, { result: unknown; toolName: string }>();
    if (!message.metadata?.parts || message.metadata.parts.length === 0)
      return map;
    message.metadata.parts.forEach((part) => {
      if (part.type === "tool-result") {
        map.set(part.toolCallId, {
          result: part.result,
          toolName: part.toolName,
        });
      }
    });
    return map;
  }, [message.metadata?.parts]);

  // Group consecutive text parts together for better rendering
  const groupedParts = useMemo(() => {
    if (!message.metadata?.parts || message.metadata.parts.length === 0)
      return [];

    const parts: Array<
      | { type: "text"; text: string }
      | { type: "tool-call"; part: unknown; index: number }
      | { type: "tool-result"; part: unknown; index: number }
      | { type: "error"; part: ErrorPart; index: number }
      | { type: "reasoning"; part: ReasoningPart; index: number }
      | {
          type: "redacted-reasoning";
          part: RedactedReasoningPart;
          index: number;
        }
    > = [];
    let currentTextGroup = "";

    message.metadata.parts.forEach((part, index) => {
      if (part.type === "text") {
        currentTextGroup += part.text;
      } else {
        // If we have accumulated text, add it as a group
        if (currentTextGroup) {
          parts.push({ type: "text", text: currentTextGroup });
          currentTextGroup = "";
        }
        // Add the non-text part
        if (part.type === "tool-call") {
          parts.push({ type: "tool-call", part, index });
        } else if (part.type === "tool-result") {
          parts.push({ type: "tool-result", part, index });
        } else if (part.type === "error") {
          parts.push({ type: "error", part: part as ErrorPart, index });
        } else if (part.type === "reasoning") {
          parts.push({ type: "reasoning", part: part as ReasoningPart, index });
        } else if (part.type === "redacted-reasoning") {
          parts.push({
            type: "redacted-reasoning",
            part: part as RedactedReasoningPart,
            index,
          });
        }
      }
    });

    // Don't forget any remaining text at the end
    if (currentTextGroup) {
      parts.push({ type: "text", text: currentTextGroup });
    }

    return parts;
  }, [message.metadata?.parts]);

  const copyContent = useMemo(
    () => getMessageCopyContent(groupedParts),
    [groupedParts]
  );

  const handleCopyMessageContent = useCallback(() => {
    copyMessageContent(copyContent);
  }, [copyMessageContent, copyContent]);

  const handleCopyMessageId = useCallback(() => {
    copyMessageId(message.id);
  }, [copyMessageId, message.id]);

  if (!message.metadata?.parts || message.metadata.parts.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "group/assistant-message relative flex flex-col gap-1",
        groupedParts[groupedParts.length - 1]?.type !== "text" ? "pb-3" : ""
      )}
    >
      {groupedParts.map((group, groupIndex) => {
        if (group.type === "text") {
          return (
            <div key={`text-${groupIndex}`} className="px-3 py-2 text-sm">
              <MemoizedMarkdown
                content={group.text}
                id={`${message.id}-text-${groupIndex}`}
              />
            </div>
          );
        }

        if (group.type === "tool-call") {
          const part = group.part as ToolCallPart;
          const toolResult = toolResultsMap.get(part.toolCallId);

          // Check if result is a validation error
          const isValidationError =
            toolResult?.result &&
            typeof toolResult.result === "object" &&
            "success" in toolResult.result &&
            toolResult.result.success === false &&
            // Exclude terminal commands that actually executed (have exitCode)
            !(
              part.toolName === "run_terminal_cmd" &&
              "exitCode" in toolResult.result
            );

          if (isValidationError) {
            return (
              <ValidationErrorTool
                key={`validation-error-${groupIndex}`}
                toolName={part.toolName}
                toolCallId={part.toolCallId}
                args={part.args as Record<string, unknown>}
                error={toolResult.result as ValidationErrorResult}
              />
            );
          }

          // Determine status from streaming state and result availability
          const isStreamingMessage = part.streamingState !== undefined;
          const isInProgress = isStreamingMessage
            ? !part.argsComplete || !toolResult // Streaming: check both
            : !toolResult; // Database: only check result exists
          const status = isInProgress ? "RUNNING" : "COMPLETED";

          if (isStreamingMessage && isInProgress) {
            if (
              STREAMING_ENABLED_TOOLS.includes(
                part.toolName as (typeof STREAMING_ENABLED_TOOLS)[number]
              )
            ) {
              if (
                !hasUsefulPartialArgs(part.partialArgs || {}, part.toolName)
              ) {
                return null;
              }
            } else {
              // For all other tools, hide until complete to avoid errors with incomplete data
              // This can be removed once support is added for streaming all tool calls
              // For the initial launch we'll leave at this
              return null;
            }
          }

          // Create a proper tool message for rendering
          // Merge regular args with partial args from streaming
          const mergedArgs = {
            ...(part.args || {}),
            ...(part.partialArgs || {}), // Partial args take precedence during streaming
          } as Record<string, unknown>;

          const toolMessage: Message = {
            id: `${message.id}-tool-${part.toolCallId}`,
            role: "tool",
            content: "",
            createdAt: message.createdAt,
            llmModel: message.llmModel,
            metadata: {
              tool: {
                name: part.toolName,
                args: mergedArgs,
                status,
                result: toolResult?.result as ToolResultTypes["result"],
              },
              streamingState: part.streamingState,
              partialArgs: part.partialArgs,
            },
          };

          return (
            <div key={`tool-${groupIndex}`}>
              <ToolMessage message={toolMessage} />
            </div>
          );
        }

        // Skip standalone tool-result parts since they're handled with tool-call parts
        if (group.type === "tool-result") {
          return null;
        }

        // Render error parts
        if (group.type === "error") {
          return (
            <ToolComponent
              key={`error-${groupIndex}`}
              icon={<AlertCircle className="text-destructive" />}
              title="Error occurred"
              type={"error"}
              collapsible
            >
              {group.part.error}
            </ToolComponent>
          );
        }

        // Render reasoning parts
        if (group.type === "reasoning") {
          // Show loading only when reasoning hasn't completed (no signature yet)
          const isStreamingMessage = message.metadata?.isStreaming === true;
          const isIncomplete = !(group.part as ReasoningPart).signature;
          const isLoading = isStreamingMessage && isIncomplete;

          return (
            <ReasoningComponent
              key={`reasoning-${groupIndex}`}
              part={group.part}
              isLoading={isLoading}
              forceOpen={isLoading}
            />
          );
        }

        // Render redacted reasoning parts
        if (group.type === "redacted-reasoning") {
          return (
            <RedactedReasoningComponent
              key={`redacted-reasoning-${groupIndex}`}
            />
          );
        }

        return null;
      })}

      {/* Show PR card if this assistant message has a PR snapshot */}
      {message.pullRequestSnapshot && (
        <PRCard taskId={taskId} snapshot={message.pullRequestSnapshot} />
      )}

      <div
        className={cn(
          "absolute -bottom-4 left-0 flex w-full items-center justify-end px-3 opacity-0 transition-all",
          "focus-within:opacity-100 group-hover/assistant-message:opacity-100",
          isMoreDropdownOpen && "opacity-100"
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="iconSm"
              className="text-muted-foreground hover:text-foreground"
              disabled={isMessageContentCopied}
              onClick={handleCopyMessageContent}
            >
              {isMessageContentCopied ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </TooltipTrigger>

          <TooltipContent side="bottom" align="end">
            Copy to Clipboard
          </TooltipContent>
        </Tooltip>

        <DropdownMenu
          open={isMoreDropdownOpen}
          onOpenChange={setIsMoreDropdownOpen}
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="iconSm"
              className="text-muted-foreground hover:text-foreground"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent className="rounded-lg" align="end">
            <DropdownMenuItem
              className="text-muted-foreground hover:text-foreground h-7 rounded-md py-0"
              onClick={handleCopyMessageId}
            >
              Copy Message ID
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
