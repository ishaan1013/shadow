import { AvailableModels, ModelType, type Message } from "@repo/types";

export function getMostRecentMessageModel(
  messages: Message[]
): ModelType | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message) {
      if (
        !Object.values(AvailableModels).includes(message.llmModel as ModelType)
      ) {
        return null;
      }

      return message.llmModel as ModelType;
    }
  }

  return null;
}
