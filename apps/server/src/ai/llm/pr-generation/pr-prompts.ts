export class PRPrompts {
  /**
   * Build the prompt for PR metadata generation
   */
  buildPRGenerationPrompt(options: {
    taskTitle: string;
    gitDiff: string;
    commitMessages: string[];
    wasTaskCompleted: boolean;
  }): string {
    const sections = [
      "Generate a pull request title and description based on the following information:",
      "",
      `**Task Title:** ${options.taskTitle}`,
      `**Task Status:** ${options.wasTaskCompleted ? "Completed successfully" : "Partially completed or stopped early"}`,
      "",
    ];

    if (options.commitMessages.length > 0) {
      sections.push(
        "**Recent Commits:**",
        ...options.commitMessages.map((msg) => `- ${msg}`),
        ""
      );
    }

    if (options.gitDiff.trim()) {
      sections.push(
        "**Git Diff:**",
        "```diff",
        options.gitDiff.slice(0, 3000), // Limit diff size for token efficiency
        "```",
        ""
      );
    }

    sections.push(
      "Please respond with JSON in this exact format:",
      "```json",
      "{",
      '  "title": "Concise PR title (max 50 chars)",',
      '  "description": "• Bullet point description\\n• What was changed\\n• Key files modified",',
      `  "isDraft": ${!options.wasTaskCompleted}`,
      "}",
      "```",
      "",
      "Guidelines:",
      "- Title should be concise and action-oriented (e.g., 'Add user authentication', 'Fix API error handling')",
      "- Description should use bullet points and be informative but concise",
      "- Set isDraft to true only if the task was not fully completed",
      "- Focus on what was implemented, not implementation details"
    );

    return sections.join("\n");
  }
}