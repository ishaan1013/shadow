import { generateText } from "ai";
import { TextPart, ToolCallPart, ToolResultPart } from "ai";
import { ModelProvider } from "@/agent/llm/models/model-provider";
import { TaskModelContext } from "@/services/task-model-context";
import { ModelType, getModelProvider } from "@repo/types";
import { AssistantMessagePart, ReasoningPart } from "@repo/types";
import { ChatService } from "@/agent/chat";
import { prisma } from "@repo/db";

export class ChatSummarizationService {
  private modelProvider: ModelProvider;
  private chatService: ChatService;

  constructor() {
    this.modelProvider = new ModelProvider();
    this.chatService = new ChatService();
  }

  private getHardcodedMiniModel(
    provider: "anthropic" | "openai" | "openrouter"
  ): ModelType | null {
    switch (provider) {
      case "anthropic":
        return "claude-3-5-haiku-20241022";
      case "openai":
        return "gpt-4o-mini";
      case "openrouter":
        return "x-ai/grok-3";
      default:
        return null;
    }
  }

  async summarizeParentChat(
    parentTaskId: string,
    context: TaskModelContext
  ): Promise<string> {
    try {
      // Choose the first variant for the parent task if present; otherwise fall back to task-scoped DB messages
      const parentVariant = await prisma.variant.findFirst({
        where: { taskId: parentTaskId },
        select: { id: true },
      });

      let history: Array<{
        id: string;
        role: string;
        content: string;
        llmModel: string;
        createdAt: string;
        metadata?: any;
        pullRequestSnapshot?: any;
        stackedTaskId?: string;
        stackedTask?: { id: string; title: string };
      }>;

      if (parentVariant?.id) {
        history = await this.chatService.getChatHistory(
          parentTaskId,
          parentVariant.id
        );
      } else {
        const dbMessages = await prisma.chatMessage.findMany({
          where: { taskId: parentTaskId },
          include: {
            pullRequestSnapshot: true,
            stackedTask: {
              select: { id: true, title: true },
            },
          },
          orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
        });

        history = dbMessages.map((msg) => ({
          id: msg.id,
          role: msg.role.toLowerCase(),
          content: msg.content,
          llmModel: msg.llmModel,
          createdAt: msg.createdAt.toISOString(),
          metadata: msg.metadata as any,
          pullRequestSnapshot: msg.pullRequestSnapshot || undefined,
          stackedTaskId: msg.stackedTaskId || undefined,
          stackedTask: msg.stackedTask || undefined,
        }));
      }

      const relevantMessages = history.filter(
        (msg) =>
          (msg.role === "user" || msg.role === "assistant") &&
          !msg.stackedTaskId
      );

      if (relevantMessages.length === 0) {
        return "No previous conversation context available.";
      }

      const xmlParts: string[] = [];

      for (const msg of relevantMessages) {
        if (msg.role === "user") {
          // User messages get wrapped in user_msg tags
          const userContent = this.truncateLongContent(msg.content);
          xmlParts.push(`<user_msg>${userContent}</user_msg>`);
        } else if (msg.role === "assistant") {
          // Process assistant message parts with structured XML
          if (msg.metadata?.parts) {
            const structuredParts = this.processMessagePartsAsXML(
              msg.metadata.parts
            );
            xmlParts.push(...structuredParts);
          } else if (msg.content.trim()) {
            // Fallback for assistant messages without parts
            const assistantContent = this.truncateLongContent(msg.content);
            xmlParts.push(`<assistant_msg>${assistantContent}</assistant_msg>`);
          }
        }
      }

      const processedContent = xmlParts.join("\n");

      // Create XML-wrapped content
      const xmlContent = `<conversation_context>
${processedContent}
</conversation_context>`;

      // Get mini model for summarization
      const provider = getModelProvider(context.getMainModel());
      const miniModel = this.getHardcodedMiniModel(
        provider as "anthropic" | "openai" | "openrouter"
      );
      if (!miniModel) {
        throw new Error(`No mini model found for provider ${provider}`);
      }
      const miniModelInstance = this.modelProvider.getModel(
        miniModel,
        context.getApiKeys()
      );

      // Generate summary
      const { text } = await generateText({
        model: miniModelInstance,
        temperature: 0.1,
        maxTokens: 300,
        messages: [
          {
            role: "system",
            content: `Summarize this conversation history to provide context for a new stacked branch task. Focus on:
1. Key decisions made
2. Current state/progress 
3. Important context for continuing work
4. Technical approaches discussed

Be concise but capture the essential context needed to understand the project state. Use 2-4 sentences maximum.`,
          },
          {
            role: "user",
            content: xmlContent,
          },
        ],
      });

      return (
        text?.trim() ||
        "No meaningful context could be extracted from the conversation."
      );
    } catch (error) {
      console.error(
        `[CHAT_SUMMARY] Error summarizing parent chat for task ${parentTaskId}:`,
        error
      );
      return "Previous conversation context unavailable due to processing error.";
    }
  }

  /**
   * Process assistant message parts into structured XML elements
   */
  private processMessagePartsAsXML(parts: AssistantMessagePart[]): string[] {
    const xmlParts: string[] = [];
    const textParts: string[] = [];

    // First pass: collect all text parts
    for (const part of parts) {
      if (part.type === "text") {
        const textPart = part as TextPart;
        textParts.push(textPart.text);
      }
    }

    // If we have text parts, create an assistant_msg block
    if (textParts.length > 0) {
      const combinedText = textParts.join(" ");
      const truncatedText = this.truncateLongContent(combinedText);
      xmlParts.push(`<assistant_msg>${truncatedText}</assistant_msg>`);
    }

    // Second pass: handle all non-text parts
    for (const part of parts) {
      switch (part.type) {
        case "text": {
          // Already handled above
          break;
        }

        case "reasoning": {
          const reasoningPart = part as ReasoningPart;
          const truncatedReasoning = this.truncateLongContent(
            reasoningPart.text
          );
          xmlParts.push(`<reasoning>${truncatedReasoning}</reasoning>`);
          break;
        }

        case "tool-call": {
          const toolCall = part as ToolCallPart;
          const argsStr =
            typeof toolCall.args === "object"
              ? JSON.stringify(toolCall.args, null, 2)
              : String(toolCall.args);
          const truncatedArgs = this.truncateLongContent(argsStr);
          xmlParts.push(
            `<tool_call>${toolCall.toolName}: ${truncatedArgs}</tool_call>`
          );
          break;
        }

        case "tool-result": {
          const toolResult = part as ToolResultPart;
          const resultStr =
            typeof toolResult.result === "object"
              ? JSON.stringify(toolResult.result, null, 2)
              : String(toolResult.result);
          const truncatedResult = this.truncateLongContent(resultStr);
          xmlParts.push(
            `<tool_result>${toolResult.toolName}: ${truncatedResult}</tool_result>`
          );
          break;
        }

        case "error": {
          const truncatedError = this.truncateLongContent(part.error);
          xmlParts.push(`<error>${truncatedError}</error>`);
          break;
        }

        case "redacted-reasoning": {
          xmlParts.push(`<redacted_reasoning />`);
          break;
        }

        default:
          // Handle any other part types gracefully
          break;
      }
    }

    return xmlParts;
  }

  /**
   * Truncate content longer than 1000 characters with XML separators
   */
  private truncateLongContent(content: string): string {
    if (content.length <= 1000) {
      return content;
    }

    const halfLength = Math.floor((1000 - 50) / 2);
    const truncated =
      content.slice(0, halfLength) +
      "\n...[TRUNCATED]...\n" +
      content.slice(-halfLength);

    return `<truncated_content>\n${truncated}\n</truncated_content>`;
  }
}
