import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import { logger } from "../utils/logger";
import { WorkspaceService } from "./workspace-service";
import {
  FileSearchResponse,
  GrepSearchResponse,
  GrepMatch,
} from "@repo/types";

const execAsync = promisify(exec);

export class SearchService {
  constructor(private workspaceService: WorkspaceService) { }

  /**
   * Search for files by name pattern
   */
  async searchFiles(query: string): Promise<FileSearchResponse> {
    try {
      const workspaceDir = this.workspaceService.getWorkspaceDir();

      // Use find command for file search
      const command = `find "${workspaceDir}" -name "*${query}*" -type f | head -100`;

      logger.debug("Executing file search", { command });
      const { stdout } = await execAsync(command);

      const files = stdout
        .trim()
        .split("\n")
        .filter(line => line.length > 0)
        .map(file => path.relative(workspaceDir, file));

      return {
        success: true,
        files,
        query,
        count: files.length,
        message: `Found ${files.length} files matching: ${query}`,
      };
    } catch (error) {
      logger.error("File search failed", { query, error });

      return {
        success: false,
        query,
        count: 0,
        message: `Failed to search for files: ${query}`,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Search file contents using ripgrep
   */
  async grepSearch(
    query: string,
    includePattern?: string,
    excludePattern?: string,
    caseSensitive: boolean = false
  ): Promise<GrepSearchResponse> {
    try {
      const workspaceDir = this.workspaceService.getWorkspaceDir();

      // Build ripgrep command with file names and line numbers
      let command = `rg -n --with-filename "${query}" "${workspaceDir}"`;

      if (!caseSensitive) {
        command += " -i";
      }

      if (includePattern) {
        command += ` --glob "${includePattern}"`;
      }

      if (excludePattern) {
        command += ` --glob "!${excludePattern}"`;
      }

      // Limit results
      command += " --max-count 50";

      logger.debug("Executing grep search", { command });

      try {
        const { stdout } = await execAsync(command);

        const rawMatches = stdout
          .trim()
          .split("\n")
          .filter(line => line.length > 0);

        // Parse structured output: "file:line:content"
        const detailedMatches: GrepMatch[] = [];
        const matches: string[] = [];

        for (const rawMatch of rawMatches) {
          const colonIndex = rawMatch.indexOf(':');
          const secondColonIndex = rawMatch.indexOf(':', colonIndex + 1);
          
          if (colonIndex > 0 && secondColonIndex > colonIndex) {
            const file = rawMatch.substring(0, colonIndex); // Full absolute path
            const lineNumber = parseInt(rawMatch.substring(colonIndex + 1, secondColonIndex), 10);
            let content = rawMatch.substring(secondColonIndex + 1); // Complete line content
            
            // Truncate content to 250 characters max
            if (content.length > 250) {
              content = content.substring(0, 250) + "...";
            }
            
            detailedMatches.push({ file, lineNumber, content });
            matches.push(rawMatch); // Keep original format for backward compatibility
          } else {
            // Fallback for unexpected format
            matches.push(rawMatch);
          }
        }

        return {
          success: true,
          matches,
          detailedMatches,
          query,
          matchCount: matches.length,
          message: `Found ${matches.length} matches for pattern: ${query}`,
        };
      } catch (error) {
        // ripgrep returns exit code 1 when no matches found
        if (error instanceof Error && error.message.includes("exit code 1")) {
          return {
            success: true,
            matches: [],
            detailedMatches: [],
            query,
            matchCount: 0,
            message: `No matches found for pattern: ${query}`,
          };
        }
        throw error;
      }
    } catch (error) {
      logger.error("Grep search failed", { query, error });

      return {
        success: false,
        query,
        matchCount: 0,
        matches: [],
        detailedMatches: [],
        message: `Failed to search for pattern: ${query}`,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

}

export default SearchService;