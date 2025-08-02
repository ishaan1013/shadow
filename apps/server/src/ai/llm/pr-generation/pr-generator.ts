import { generateText } from "ai";
import { ModelProvider } from "../models/model-provider";
import { PRPrompts } from "./pr-prompts";
import { PRParser } from "./pr-parser";

export class PRGenerator {
  private modelProvider = new ModelProvider();
  private prPrompts = new PRPrompts();
  private prParser = new PRParser();

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
    userApiKeys: { openai?: string; anthropic?: string }
  ): Promise<{
    title: string;
    description: string;
    isDraft: boolean;
  }> {
    try {
      const prompt = this.prPrompts.buildPRGenerationPrompt(options);

      const prModel = userApiKeys.openai
        ? "gpt-4o-mini"
        : // TODO: Add Claude 3.5 Haiku
          "claude-sonnet-4-20250514";

      const { text } = await generateText({
        model: this.modelProvider.getModel(prModel, userApiKeys),
        temperature: 0.3,
        maxTokens: 1000,
        prompt,
      });

      const result = this.prParser.parsePRMetadata(text);

      console.log(`[LLM] Generated PR metadata:`, {
        title: result.title,
        isDraft: result.isDraft,
        descriptionLength: result.description.length,
      });

      return result;
    } catch (error) {
      console.error(`[LLM] Failed to generate PR metadata:`, error);
      throw error;
    }
  }
}