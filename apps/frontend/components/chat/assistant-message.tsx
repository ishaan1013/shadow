import { cn } from "@/lib/utils";
import type { Message } from "@repo/types";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { MemoizedMarkdown } from "./memoized-markdown";
import { ToolMessage } from "./tools";

export function AssistantMessage({ message }: { message: Message }) {
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);

  // TODO(Ishaan) test with a reasoning model
  if (message.metadata?.thinking) {
    return (
      <div>
        <div
          className="flex cursor-pointer items-center gap-2 rounded p-2 hover:bg-gray-50"
          onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
        >
          <span className="text-muted-foreground">
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                isThinkingExpanded ? "rotate-180" : ""
              )}
            />
            Thinking ({message.metadata.thinking.duration}s)
          </span>
        </div>
        {isThinkingExpanded && (
          <div className="ml-6 rounded p-3 text-sm">
            <MemoizedMarkdown
              content={message.metadata.thinking.content}
              id={`${message.id}-thinking`}
            />
          </div>
        )}
      </div>
    );
  }

  // Render structured parts in chronological order
  if (!message.metadata?.parts || message.metadata.parts.length === 0) {
    return null;
  }

  const toolResultsMap = new Map<
    string,
    { result: unknown; toolName: string }
  >();
  message.metadata.parts.forEach((part) => {
    if (part.type === "tool-result") {
      toolResultsMap.set(part.toolCallId, {
        result: part.result,
        toolName: part.toolName,
      });
    }
  });

  // Group consecutive text parts together for better rendering
  const groupedParts: Array<
    | { type: "text"; text: string }
    | { type: "tool-call"; part: any; index: number }
    | { type: "tool-result"; part: any; index: number }
  > = [];
  let currentTextGroup = "";

  message.metadata.parts.forEach((part, index) => {
    if (part.type === "text") {
      currentTextGroup += part.text;
    } else {
      // If we have accumulated text, add it as a group
      if (currentTextGroup) {
        groupedParts.push({ type: "text", text: currentTextGroup });
        currentTextGroup = "";
      }
      // Add the non-text part
      if (part.type === "tool-call") {
        groupedParts.push({ type: "tool-call", part, index });
      } else if (part.type === "tool-result") {
        groupedParts.push({ type: "tool-result", part, index });
      }
    }
  });

  // Don't forget any remaining text at the end
  if (currentTextGroup) {
    groupedParts.push({ type: "text", text: currentTextGroup });
  }

  return (
    <div className="flex flex-col gap-1">
      {groupedParts.map((group, groupIndex) => {
        if (group.type === "text") {
          return (
            <div key={`text-${groupIndex}`} className="p-3 text-sm">
              <MemoizedMarkdown
                content={group.text}
                id={`${message.id}-text-${groupIndex}`}
              />
            </div>
          );
        }

        if (group.type === "tool-call") {
          const part = group.part;
          const toolResult = toolResultsMap.get(part.toolCallId);

          // Create a proper tool message for rendering
          const toolMessage: Message = {
            id: `${message.id}-tool-${part.toolCallId}`,
            role: "tool",
            content: "",
            createdAt: message.createdAt,
            metadata: {
              tool: {
                name: part.toolName,
                args: part.args,
                status: "COMPLETED",
                result: toolResult?.result as any, // Tool result from stream - cast for compatibility
              },
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

        return null;
      })}
    </div>
  );
}
