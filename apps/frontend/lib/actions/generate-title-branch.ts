"use server";

import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

const WORD_LIMIT = 8;

function cleanTitle(title: string) {
  return title
    .trim()
    .replace(/^[`"']|[`"']$/g, "") // Remove leading/trailing quotes or backticks
    .replace(/[`"']/g, ""); // Remove any remaining quotes or backticks within the string
}

function generateRandomSuffix(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateShadowBranchName(title: string, taskId: string): string {
  const branchSafeTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "") // Remove special chars except spaces and hyphens
    .trim()
    .split(/\s+/) // Split by whitespace
    .slice(0, WORD_LIMIT) // Limit words
    .join("-") // Join with hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single
    .replace(/^-|-$/g, ""); // Remove leading/trailing hyphens
  const randomSuffix = generateRandomSuffix(6);

  if (branchSafeTitle) {
    return `shadow/${branchSafeTitle}-${randomSuffix}`;
  } else {
    return `shadow/task-${taskId}`;
  }
}

export async function generateTaskTitleAndBranch(
  taskId: string,
  userPrompt: string
) {
  try {
    // Check if OpenAI API key is available
    if (!process.env.OPENAI_API_KEY) {
      console.warn(
        `[GENERATE_TITLE_BRANCH] OpenAI API key not configured, skipping title generation for task ${taskId}`
      );
      return {
        title: userPrompt.slice(0, 50),
        shadowBranch: `shadow/task-${taskId}`,
      };
    }

    // Generate a descriptive title using AI
    const { text: generatedText } = await generateText({
      model: openai("gpt-4o-mini"),
      temperature: 0.3,
      prompt: `Generate a concise title (under 50 chars) for this coding task:

"${userPrompt}"

Return ONLY the title.`,
    });

    const title = cleanTitle(generatedText);

    console.log(
      `[GENERATE_TITLE_BRANCH] Generated title for task ${taskId}: "${title}"`
    );

    return { title, shadowBranch: generateShadowBranchName(title, taskId) };
  } catch (error) {
    console.error(
      `[GENERATE_TITLE_BRANCH] Failed to generate title for task ${taskId}:`,
      error
    );
    // Don't throw error, just log it - title generation is not critical
    return {
      title: userPrompt.slice(0, 50),
      shadowBranch: `shadow/task-${taskId}`,
    };
  }
}
