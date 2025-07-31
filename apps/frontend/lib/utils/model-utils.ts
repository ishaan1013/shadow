import type { Message } from "@repo/types";
import type { ModelType } from "@repo/types";

/**
 * Gets the model from the most recent user message in the conversation.
 * This represents the user's last chosen model preference.
 */
export function getLastUserMessageModel(messages: Message[]): ModelType | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message && message.role === "user" && message.llmModel) {
      return message.llmModel as ModelType;
    }
  }
  return null;
}

/**
 * Gets the model from the most recent message (user or assistant) in the conversation.
 * Uses fallback hierarchy: recent user > recent assistant > null
 */
export function getMostRecentMessageModel(
  messages: Message[]
): ModelType | null {
  // First try to get the most recent user message model
  const userModel = getLastUserMessageModel(messages);
  if (userModel) {
    return userModel;
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message && message.role === "assistant" && message.llmModel) {
      return message.llmModel as ModelType;
    }
  }

  return null;
}
