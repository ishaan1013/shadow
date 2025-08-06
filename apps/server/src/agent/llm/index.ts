import {
  Message,
  ModelType,
  StreamChunk,
  ApiKeys,
  getAvailableModels,
} from "@repo/types";
import type { ToolSet } from "ai";
import { StreamProcessor } from "./streaming/stream-processor";
import { PRGenerator } from "./pr-generation/pr-generator";

export class LLMService {
  private streamProcessor = new StreamProcessor();
  private prGenerator = new PRGenerator();

  /**
   * Create a streaming response for LLM messages with tool support
   */
  async *createMessageStream(
    systemPrompt: string,
    messages: Message[],
    model: ModelType,
    userApiKeys: ApiKeys,
    enableTools: boolean = true,
    taskId: string,
    workspacePath?: string,
    abortSignal?: AbortSignal,
    preCreatedTools?: ToolSet,
    thinkingConfig?: {
      enabled: boolean;
      budgetTokens?: number;
    }
  ): AsyncGenerator<StreamChunk> {
    yield* this.streamProcessor.createMessageStream(
      systemPrompt,
      messages,
      model,
      userApiKeys,
      enableTools,
      taskId,
      workspacePath,
      abortSignal,
      preCreatedTools,
      thinkingConfig
    );
  }

  /**
   * Get available models based on user API keys
   */
  async getAvailableModels(userApiKeys: ApiKeys): Promise<ModelType[]> {
    return await getAvailableModels(userApiKeys);
  }

  /**
   * Generate PR metadata using LLM based on task context and git changes
   */
  async generatePRMetadata(
    options: {
      taskTitle: string;
      gitDiff: string;
      commitMessages: string[];
      wasTaskCompleted: boolean;
    },
    userApiKeys: ApiKeys
  ): Promise<{
    title: string;
    description: string;
    isDraft: boolean;
  }> {
    return this.prGenerator.generatePRMetadata(options, userApiKeys);
  }
}
