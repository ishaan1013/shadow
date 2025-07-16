import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import {
  Message,
  ModelType,
  StreamChunk,
  getModelProvider,
  toCoreMessage,
} from "@repo/types";
import { CoreMessage, LanguageModel, streamText, tool } from "ai";
import { z } from "zod";
import { DEFAULT_MODEL } from "./chat";
import config from "./config";
import toolsDefinitions from "./prompt/tools.json";
import { systemPrompt } from "./prompt/system";
import { ToolExecutor } from "./tool-executor";

// Create a shared tool executor instance
const toolExecutor = new ToolExecutor();

// Transform tools.json into AI SDK format with execution handlers
const transformedTools = toolsDefinitions.reduce((acc, toolDef) => {
  const toolSchema = z.object(
    Object.entries(toolDef.parameters.properties).reduce((props, [key, schema]: [string, any]) => {
      let zodSchema: z.ZodTypeAny;
      
      switch (schema.type) {
        case 'string':
          zodSchema = z.string();
          break;
        case 'number':
        case 'integer':
          zodSchema = z.number();
          break;
        case 'boolean':
          zodSchema = z.boolean();
          break;
        case 'array':
          if (schema.items?.type === 'string') {
            zodSchema = z.array(z.string());
          } else {
            zodSchema = z.array(z.any());
          }
          break;
        default:
          zodSchema = z.any();
      }
      
      if (schema.description) {
        zodSchema = zodSchema.describe(schema.description);
      }
      
      // Handle optional vs required fields
      if (toolDef.parameters.required && !toolDef.parameters.required.includes(key)) {
        zodSchema = zodSchema.optional();
      }
      
      props[key] = zodSchema;
      return props;
    }, {} as Record<string, z.ZodTypeAny>)
  );

  acc[toolDef.name] = tool({
    description: toolDef.description,
    parameters: toolSchema,
    execute: async (args) => {
      console.log(`Executing tool: ${toolDef.name} with args:`, args);
      const result = await toolExecutor.executeTool(toolDef.name, args);
      
      if (result.success) {
        return result.result || "Tool executed successfully";
      } else {
        throw new Error(result.error || "Tool execution failed");
      }
    },
  });
  
  return acc;
}, {} as Record<string, any>);

export class LLMService {
  private getModel(modelId: ModelType): LanguageModel {
    const provider = getModelProvider(modelId);

    switch (provider) {
      case "anthropic":
        if (!config.anthropicApiKey) {
          throw new Error("Anthropic API key not configured");
        }
        return anthropic(modelId);

      case "openai":
        if (!config.openaiApiKey) {
          throw new Error("OpenAI API key not configured");
        }
        return openai(modelId);

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  async *createMessageStream(
    systemPromptText: string,
    messages: Message[],
    model: ModelType = DEFAULT_MODEL,
    enableTools: boolean = true
  ): AsyncGenerator<StreamChunk> {
    try {
      const modelInstance = this.getModel(model);
      const coreMessages: CoreMessage[] = messages.map(toCoreMessage);

      console.log("Creating message stream with messages:", coreMessages.length);

      if (enableTools && Object.keys(transformedTools).length > 0) {
        // Stream with tools using streamText
        const result = streamText({
          model: modelInstance,
          system: systemPromptText,
          messages: coreMessages,
          tools: transformedTools,
          maxTokens: 4096,
          temperature: 0.7,
        });

        // Handle the streaming with tools
        for await (const delta of result.fullStream) {
          switch (delta.type) {
            case 'text-delta':
              if (delta.textDelta) {
                yield {
                  type: "content",
                  content: delta.textDelta,
                };
              }
              break;

            case 'tool-call':
              yield {
                type: "tool-call",
                toolCall: {
                  id: delta.toolCallId,
                  name: delta.toolName,
                  args: delta.args,
                },
              };
              break;

            case 'tool-result':
              yield {
                type: "tool-result",
                toolResult: {
                  id: delta.toolCallId,
                  result: JSON.stringify(delta.result),
                },
              };
              break;
          }
        }

        // Get final results
        const finalResult = await result;
        const finalUsage = await finalResult.usage;
        const finalFinishReason = await finalResult.finishReason;

        yield {
          type: "usage",
          usage: {
            promptTokens: finalUsage.promptTokens,
            completionTokens: finalUsage.completionTokens,
            totalTokens: finalUsage.totalTokens,
          },
        };

        yield {
          type: "complete",
          finishReason: finalFinishReason === "stop" ? "stop"
            : finalFinishReason === "length" ? "length"
            : finalFinishReason === "content-filter" ? "content-filter"
            : finalFinishReason === "tool-calls" ? "tool_calls"
            : "stop",
        };
      } else {
        // Fallback to text-only streaming when tools are disabled
        const result = streamText({
          model: modelInstance,
          system: systemPromptText,
          messages: coreMessages,
          maxTokens: 4096,
          temperature: 0.7,
        });

        // Stream content chunks
        for await (const chunk of result.textStream) {
          yield {
            type: "content",
            content: chunk,
          };
        }

        // Wait for final results
        const finalResult = await result;
        const finalUsage = await finalResult.usage;
        const finalFinishReason = await finalResult.finishReason;

        yield {
          type: "usage",
          usage: {
            promptTokens: finalUsage.promptTokens,
            completionTokens: finalUsage.completionTokens,
            totalTokens: finalUsage.totalTokens,
          },
        };

        yield {
          type: "complete",
          finishReason: finalFinishReason === "stop" ? "stop" 
            : finalFinishReason === "length" ? "length"
            : finalFinishReason === "content-filter" ? "content-filter"
            : finalFinishReason === "tool-calls" ? "tool_calls"
            : "stop",
        };
      }
    } catch (error) {
      console.error("LLM Service Error:", error);
      yield {
        type: "error",
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
        finishReason: "error",
      };
    }
  }

  // Helper method to get available models based on configured API keys
  getAvailableModels(): ModelType[] {
    const models: ModelType[] = [];

    if (config.anthropicApiKey) {
      models.push("claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022");
    }

    if (config.openaiApiKey) {
      models.push("gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o3", "o4-mini-high");
    }

    return models;
  }

  // Get available tools
  getAvailableTools() {
    return Object.keys(transformedTools);
  }
}
