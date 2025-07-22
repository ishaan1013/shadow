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

  return (
    <div className="-mt-12 mb-24 flex w-full grow flex-col gap-3">
      {filteredMessages.map((message, index) => {
        if (isUserMessage(message)) {
          return (
            <div key={message.id} className="sticky top-0 z-10 bg-background">
              <UserMessage
                message={message}
                className={cn("mb-4", index !== 0 && "mt-4")}
              />
            </div>
          );
        }
        if (isAssistantMessage(message)) {
          return <AssistantMessage key={message.id} message={message} />;
        }
        return null;
      })}
    </div>
  );
}
