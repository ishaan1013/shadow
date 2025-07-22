import { cn } from "@/lib/utils";
import type { Message } from "@repo/types";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { MemoizedMarkdown } from "./memoized-markdown";
import { ToolMessage } from "./tools";

export function AssistantMessage({ message }: { message: Message }) {
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);

  if (message.metadata?.thinking) {
    return (
      <div>
        <div
          className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded"
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
          <div className="ml-6 p-3 bg-gray-50 rounded text-sm">
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

  // Group consecutive text parts together for better rendering
  const groupedParts: Array<
    | { type: "text"; text: string }
    | { type: "tool-call"; part: any; index: number }
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
      groupedParts.push({ type: "tool-call", part, index });
    }
  });

  // Don't forget any remaining text at the end
  if (currentTextGroup) {
    groupedParts.push({ type: "text", text: currentTextGroup });
  }

  return (
    <div className="space-y-2">
      {groupedParts.map((group, groupIndex) => {
        if (group.type === "text") {
          return (
            <div key={`text-${groupIndex}`} className="text-sm">
              <MemoizedMarkdown
                content={group.text}
                id={`${message.id}-text-${groupIndex}`}
              />
            </div>
          );
        }

        if (group.type === "tool-call") {
          const part = group.part;
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
                result: undefined,
              },
            },
          };

          return (
            <div key={`tool-${groupIndex}`}>
              <ToolMessage message={toolMessage} />
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
