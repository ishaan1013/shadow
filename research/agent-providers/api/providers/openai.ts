import { APIHandler } from "@/api/llm";
import { ChatMessage, LLMConfig, LLM, Role, ToolCall } from "@/api/types";
import { OpenAI } from "openai";
import { Anthropic } from "@anthropic-ai/sdk";
import { APIStream, APIStreamChunk } from "@/api/stream";
import { convertToOpenAiMessages } from "@/agent/tools/convertToOpenAI";

// Just a wrapper around the OpenAI API with  streaming
// TODO: Add support for tools
export class OpenAIAPIHandler implements APIHandler {
  private apiKey: string;
  private modelName: string;
  private isReasoning: boolean;
  private client: OpenAI;

  constructor(config: LLMConfig) {
    this.apiKey = config.apiKey;
    this.modelName = config.model.name;
    this.isReasoning = config.model.isReasoning;

    try {
      this.client = new OpenAI({ apiKey: this.apiKey });
    } catch (error) {
      throw new Error("Failed to initialize OpenAI client");
    }
  }

  async *createMessage(
    systemPrompt: string,
    messages: Anthropic.Messages.MessageParam[]
  ): APIStream {
    const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...convertToOpenAiMessages(messages),
    ];
    // Some newer OpenAI models (e.g., o1-series, GPT-5) no longer accept `max_tokens`
    // and require `max_completion_tokens` instead. Use a simple heuristic to choose.
    const requiresMaxCompletionTokens =
      this.isReasoning ||
      /^gpt-5/i.test(this.modelName) ||
      /^o[1-9]/i.test(this.modelName);

    const payload: Record<string, unknown> = {
      model: this.modelName,
      messages: openAiMessages,
      temperature: 0.0,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (requiresMaxCompletionTokens) {
      payload["max_completion_tokens"] = 1000;
      // Only include reasoning controls for models that support it
      payload["reasoning_effort"] = "high";
    } else {
      payload["max_tokens"] = 1000;
    }

    const stream = await this.client.chat.completions.create(payload as any);

    // Type is complex so set to any
    for await (const chunk of stream as any) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        yield {
          type: "text",
          text: delta.content,
        };
      }

      if (delta && "reasoning_content" in delta && delta.reasoning_content) {
        yield {
          type: "reasoning",
          reasoning: (delta.reasoning_content as string | undefined) || "",
        };
      }

      if (chunk.usage) {
        yield {
          type: "usage",
          inputTokens: chunk.usage.prompt_tokens || 0,
          outputTokens: chunk.usage.completion_tokens || 0,
          // @ts-ignore-next-line
          cacheReadTokens:
            chunk.usage.prompt_tokens_details?.cached_tokens || 0,
          // @ts-ignore-next-line
          cacheWriteTokens: chunk.usage.prompt_cache_miss_tokens || 0,
        };
      }
    }
  }

  getModel(): LLM {
    return { name: this.modelName, isReasoning: this.isReasoning };
  }
}
