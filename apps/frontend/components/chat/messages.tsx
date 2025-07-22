import { cn } from "@/lib/utils";
import type { Message } from "@repo/types";
import { isAssistantMessage, isToolMessage, isUserMessage } from "@repo/types";
import { AssistantMessage } from "./assistant-message";
import { UserMessage } from "./user-message";

export function Messages({ messages }: { messages: Message[] }) {
  // Filter out standalone tool messages - they're already rendered within assistant message parts
  const filteredMessages = messages.filter(
    (message) => !isToolMessage(message)
  );

  // Separate user and assistant messages
  const userMessages = filteredMessages.filter(isUserMessage);
  const assistantMessages = filteredMessages.filter(isAssistantMessage);

  return (
    <div className="-mt-12 mb-24 flex w-full grow flex-col gap-3">
      {/* Sticky user messages at the top */}
      {userMessages.length > 0 && (
        <div className="sticky top-0 z-10 bg-background pb-2">
          {userMessages.map((message, index) => (
            <UserMessage
              key={message.id}
              message={message}
              className={cn("mb-2", index !== 0 && "mt-2")}
            />
          ))}
        </div>
      )}

      {/* Assistant messages below */}
      {assistantMessages.map((message) => (
        <AssistantMessage key={message.id} message={message} />
      ))}
    </div>
  );
}
