import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import { logger } from "../utils/logger";
import { WorkspaceService } from "./workspace-service";
import {
  FileSearchResponse,
  GrepSearchResponse,
  CodebaseSearchResponse,
  CodebaseSearchResult,
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

      // Build ripgrep command
      let command = `rg "${query}" "${workspaceDir}"`;

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

        const matches = stdout
          .trim()
          .split("\n")
          .filter(line => line.length > 0)
          .map(line => {
            // Make paths relative to workspace
            const match = line.match(/^(.+?):(.*)/);
            if (match && match[1] && match[2]) {
              const relativePath = path.relative(workspaceDir, match[1]);
              return `${relativePath}:${match[2]}`;
            }
            return line;
          });

        return {
          success: true,
          matches,
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
        message: `Failed to search for pattern: ${query}`,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Semantic codebase search (simplified implementation using ripgrep)
   */
  async codebaseSearch(
    query: string,
    targetDirectories?: string[]
  ): Promise<CodebaseSearchResponse> {
    try {
      const workspaceDir = this.workspaceService.getWorkspaceDir();

      // Split query into search terms
      const searchTerms = query
        .split(" ")
        .filter(term => term.length > 2);

      const searchPattern = searchTerms.join("|");

      let searchPath = workspaceDir;
      if (targetDirectories && targetDirectories.length > 0) {
        // Use the first target directory
        searchPath = this.workspaceService.resolvePath(targetDirectories[0] || ".");
      }

      // Use ripgrep with context for semantic-like search
      const command = `rg -i -C 3 --max-count 10 "${searchPattern}" "${searchPath}"`;

      logger.debug("Executing codebase search", { command });

      try {
        const { stdout } = await execAsync(command);

        const results: CodebaseSearchResult[] = stdout
          .trim()
          .split("\n--\n")
          .map((chunk, index) => ({
            id: index + 1,
            content: chunk.trim(),
            relevance: 0.8 - (index * 0.1), // Mock relevance score
          }))
          .filter(result => result.content.length > 0)
          .slice(0, 5); // Limit to top 5 results

        return {
          success: true,
          results,
          query,
          searchTerms,
          message: `Found ${results.length} relevant code snippets for "${query}"`,
        };
      } catch (error) {
        // No matches found
        if (error instanceof Error && error.message.includes("exit code 1")) {
          return {
            success: true,
            results: [],
            query,
            searchTerms,
            message: `No relevant code found for "${query}"`,
          };
        }
        throw error;
      }
    } catch (error) {
      logger.error("Codebase search failed", { query, error });

      return {
        success: false,
        query,
        message: `Failed to search codebase for: ${query}`,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

export default SearchService;