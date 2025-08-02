export class PRParser {
  /**
   * Parse the LLM response to extract PR metadata
   */
  parsePRMetadata(response: string): {
    title: string;
    description: string;
    isDraft: boolean;
  } {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      if (!jsonMatch || !jsonMatch[1]) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[1]);

      if (!parsed.title || !parsed.description) {
        throw new Error("Missing required fields in response");
      }

      return {
        title: String(parsed.title).slice(0, 50), // Enforce length limit
        description: String(parsed.description),
        isDraft: Boolean(parsed.isDraft),
      };
    } catch (error) {
      console.warn(`[LLM] Failed to parse PR metadata response:`, error);

      const lines = response
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const title =
        lines[0]?.replace(/^#+\s*/, "").slice(0, 50) ||
        "Update code via Shadow agent";
      const description = "Pull request description generation failed.";

      return {
        title,
        description,
        isDraft: true, // Default to draft
      };
    }
  }
}