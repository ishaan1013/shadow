import { ToolExecutor } from "../interfaces/tool-executor";
import {
  CommandOptions,
  DeleteResult,
  DirectoryListing,
  FileResult,
  FileSearchResult,
  FileStatsResult,
  GrepOptions,
  GrepResult,
  ReadFileOptions,
  WriteResult,
  CodebaseSearchToolResult,
  SearchOptions,
  WebSearchResult,
} from "@repo/types";
import { CommandResult } from "../interfaces/types";
import config from "../../config";
import { SidecarClient } from "./sidecar-client";
import { BackgroundCommandResponse } from "@repo/types";
import { EmbeddingSearchResult } from "../../indexing/embedding/types";

/**
 * RemoteToolExecutor implements tool operations via HTTP calls to a sidecar API
 * This is used when the agent is running in distributed mode with Kubernetes pods
 */
export class RemoteToolExecutor implements ToolExecutor {
  private taskId: string;
  private workspacePath: string;
  private sidecarClient: SidecarClient;

  constructor(
    taskId: string,
    workspacePath: string = "/workspace",
    sidecarUrl?: string,
    timeout: number = 30000,
    maxRetries: number = 3,
    retryDelay: number = 1000
  ) {
    this.taskId = taskId;
    this.workspacePath = workspacePath;

    // Create SidecarClient with custom configuration if provided
    if (sidecarUrl) {
      // For backward compatibility, extract namespace and port from URL
      const urlParts = sidecarUrl.match(/http:\/\/shadow-agent-[^.]+\.([^.]+)\.svc\.cluster\.local:([0-9]+)/);
      const namespace = urlParts?.[1] || config.kubernetesNamespace || "shadow";
      const port = urlParts?.[2] ? parseInt(urlParts[2]) : config.sidecarPort || 8080;

      this.sidecarClient = new SidecarClient({
        taskId,
        namespace,
        port,
        timeout,
        maxRetries,
        retryDelay,
      });
    } else {
      this.sidecarClient = new SidecarClient({
        taskId,
        timeout,
        maxRetries,
        retryDelay,
      });
    }
  }

  /**
   * Wrap tool operations with consistent error handling and logging
   */
  private async withErrorHandling<T>(
    operation: string,
    executor: () => Promise<T>,
    fallbackValue?: T
  ): Promise<T> {
    try {
      const result = await executor();
      console.log(`[REMOTE_TOOL] ${operation} completed successfully for task ${this.taskId}`);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[REMOTE_TOOL] ${operation} failed for task ${this.taskId}:`, errorMessage);

      // If a fallback value is provided, use it instead of throwing
      if (fallbackValue !== undefined) {
        console.warn(`[REMOTE_TOOL] Using fallback value for ${operation}`);
        return fallbackValue;
      }

      // Re-throw with additional context
      throw new Error(`Remote ${operation} failed: ${errorMessage}`);
    }
  }

  async readFile(
    targetFile: string,
    options?: ReadFileOptions
  ): Promise<FileResult> {
    const fallback: FileResult = {
      success: false,
      error: "Remote execution unavailable",
      message: `Failed to read file: ${targetFile}`,
    };

    return this.withErrorHandling(
      `readFile(${targetFile})`,
      async () => {
        const params = new URLSearchParams();
        if (options?.shouldReadEntireFile !== undefined) {
          params.set('shouldReadEntireFile', options.shouldReadEntireFile.toString());
        }
        if (options?.startLineOneIndexed) {
          params.set('startLineOneIndexed', options.startLineOneIndexed.toString());
        }
        if (options?.endLineOneIndexedInclusive) {
          params.set('endLineOneIndexedInclusive', options.endLineOneIndexedInclusive.toString());
        }

        const queryString = params.toString();
        const endpoint = `/files/${encodeURIComponent(targetFile)}${queryString ? '?' + queryString : ''}`;

        return await this.sidecarClient.request<FileResult>(endpoint, {
          method: "GET",
        });
      },
      fallback
    );
  }

  async getFileStats(targetFile: string): Promise<FileStatsResult> {
    const fallback: FileStatsResult = {
      success: false,
      error: "Remote execution unavailable",
      message: `Failed to get file stats: ${targetFile}`,
    };

    return this.withErrorHandling(
      `getFileStats(${targetFile})`,
      async () => {
        const response = await this.sidecarClient.request<FileStatsResult>(`/files/${encodeURIComponent(targetFile)}/stats`, {
          method: "GET",
        });

        // Convert mtime string back to Date object
        if (response.success && response.stats) {
          response.stats.mtime = new Date(response.stats.mtime);
        }

        return response;
      },
      fallback
    );
  }

  async writeFile(
    targetFile: string,
    content: string,
    instructions: string
  ): Promise<WriteResult> {
    const fallback: WriteResult = {
      success: false,
      error: "Remote execution unavailable",
      message: `Failed to edit file: ${targetFile}`,
    };

    return this.withErrorHandling(
      `writeFile(${targetFile})`,
      async () => {
        return await this.sidecarClient.request<WriteResult>(`/files/${encodeURIComponent(targetFile)}`, {
          method: "POST",
          body: JSON.stringify({
            content,
            instructions,
          }),
        });
      },
      fallback
    );
  }

  async deleteFile(targetFile: string): Promise<DeleteResult> {
    const fallback: DeleteResult = {
      success: false,
      error: "Remote execution unavailable",
      message: `Failed to delete file: ${targetFile}`,
    };

    return this.withErrorHandling(
      `deleteFile(${targetFile})`,
      async () => {
        return await this.sidecarClient.request<DeleteResult>(`/files/${encodeURIComponent(targetFile)}`, {
          method: "DELETE",
        });
      },
      fallback
    );
  }

  async searchReplace(
    filePath: string,
    oldString: string,
    newString: string
  ): Promise<WriteResult> {
    const fallback: WriteResult = {
      success: false,
      error: "Remote execution unavailable",
      message: `Failed to search and replace in file: ${filePath}`,
    };

    return this.withErrorHandling(
      `searchReplace(${filePath})`,
      async () => {
        return await this.sidecarClient.request<WriteResult>(`/files/${encodeURIComponent(filePath)}/replace`, {
          method: "POST",
          body: JSON.stringify({
            oldString,
            newString,
          }),
        });
      },
      fallback
    );
  }

  async listDirectory(relativeWorkspacePath: string): Promise<DirectoryListing> {
    const fallback: DirectoryListing = {
      success: false,
      error: "Remote execution unavailable",
      message: `Failed to list directory: ${relativeWorkspacePath}`,
      path: relativeWorkspacePath,
    };

    return this.withErrorHandling(
      `listDirectory(${relativeWorkspacePath})`,
      async () => {
        return await this.sidecarClient.request<DirectoryListing>(`/directory/${encodeURIComponent(relativeWorkspacePath)}`, {
          method: "GET",
        });
      },
      fallback
    );
  }

  async searchFiles(
    query: string,
    options?: SearchOptions
  ): Promise<FileSearchResult> {
    const fallback: FileSearchResult = {
      success: false,
      error: "Remote execution unavailable",
      message: `Failed to search for files: ${query}`,
      files: [],
      query,
      count: 0,
    };

    return this.withErrorHandling(
      `searchFiles(${query})`,
      async () => {
        return await this.sidecarClient.request<FileSearchResult>("/search/files", {
          method: "POST",
          body: JSON.stringify({
            query,
            targetDirectories: options?.targetDirectories,
          }),
        });
      },
      fallback
    );
  }

  async grepSearch(query: string, options?: GrepOptions): Promise<GrepResult> {
    const fallback: GrepResult = {
      success: false,
      error: "Remote execution unavailable",
      message: `Failed to search for pattern: ${query}`,
      matches: [],
      query,
      matchCount: 0,
    };

    return this.withErrorHandling(
      `grepSearch(${query})`,
      async () => {
        return await this.sidecarClient.request<GrepResult>("/search/grep", {
          method: "POST",
          body: JSON.stringify({
            query,
            includePattern: options?.includePattern,
            excludePattern: options?.excludePattern,
            caseSensitive: options?.caseSensitive,
          }),
        });
      },
      fallback
    );
  }

  async codebaseSearch(
    query: string,
    options?: SearchOptions
  ): Promise<CodebaseSearchToolResult> {
    const fallback: CodebaseSearchToolResult = {
      success: false,
      error: "Remote execution unavailable",
      message: `Failed to search codebase for: ${query}`,
      results: [],
      query,
      searchTerms: [],
    };

    return this.withErrorHandling(
      `codebaseSearch(${query})`,
      async () => {
        return await this.sidecarClient.request<CodebaseSearchToolResult>("/search/codebase", {
          method: "POST",
          body: JSON.stringify({
            query,
            targetDirectories: options?.targetDirectories,
          }),
        });
      },
      fallback
    );
  }

  async semanticSearch(query: string, repo: string, options?: SearchOptions): Promise<CodebaseSearchToolResult> {
    if (!config.useSemanticSearch) {
      console.log("semanticSearch disabled, falling back to codebaseSearch");
      return this.codebaseSearch(query, options);
    }
    try {
      console.log("semanticSearch enabled");
      console.log("semanticSearchParams", query, repo);
      const response = await fetch(`${config.apiUrl}/api/indexing/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          namespace: repo,
          topK: 5,
          fields: ["content", "filePath", "language"]
        }),
      });

      if (!response.ok) {
        throw new Error(`Indexing service error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { matches: EmbeddingSearchResult[] };
      const matches = data.matches;

      const parsedData = {
        success: !!matches,
        results: matches.map((match: EmbeddingSearchResult, i: number) => ({
          id: i + 1,
          content: match?.fields?.code || match?.fields?.text || "",
          relevance: typeof match?._score === "number" ? match._score : 0.8,
        })),
        query,
        searchTerms: query.split(/\s+/),
        message: matches?.length
          ? `Found ${matches.length} relevant code snippets for "${query}"`
          : `No relevant code found for "${query}"`,
      }
      console.log("semanticSearch", parsedData);

      return parsedData;
    } catch (error) {
      console.error(`[SEMANTIC_SEARCH_ERROR] Failed to query indexing service:`, error);

      // Fallback to ripgrep if indexing service is unavailable
      return this.codebaseSearch(query, options);
    }
  }

  async webSearch(query: string, domain?: string): Promise<WebSearchResult> {
    const fallback: WebSearchResult = {
      success: false,
      results: [],
      query,
      domain,
      message: `Failed to perform web search: ${query}`,
      error: "Web search unavailable",
    };

    return this.withErrorHandling(
      `webSearch(${query})`,
      async () => {
        if (!config.exaApiKey) {
          throw new Error("EXA_API_KEY is not configured");
        }

        interface ExaApiRequestBody {
          query: string;
          type: "fast" | "auto" | "keyword" | "neural";
          contents: {
            text: boolean;
          };
          num_results: number;
          include_domains?: string[];
        }

        const requestBody: ExaApiRequestBody = {
          query,
          type: "fast",
          contents: {
            text: true
          },
          num_results: 5
        };

        if (domain) {
          requestBody.include_domains = [domain];
        }

        // Use node-fetch to make the API call
        const response = await fetch("https://api.exa.ai/search", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": config.exaApiKey
          },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Exa API error (${response.status}): ${errorText}`);
        }

        interface ExaSearchResult {
          text: string;
          url: string;
          title?: string;
        }

        const data = await response.json() as { results?: ExaSearchResult[] };

        const results = data.results?.map((result: ExaSearchResult) => ({
          text: result.text || "",
          url: result.url || "",
          title: result.title || undefined
        })) || [];

        return {
          success: true,
          results,
          query,
          domain,
          message: `Found ${results.length} web search results for query: ${query}`
        } as WebSearchResult;
      },
      fallback
    );
  }

  async executeCommand(
    command: string,
    options?: CommandOptions
  ): Promise<CommandResult> {
    const fallback: CommandResult = {
      success: false,
      error: "Remote execution unavailable",
      message: `Failed to execute command: ${command}`,
    };

    return this.withErrorHandling(
      `executeCommand(${command})`,
      async () => {
        if (options?.isBackground) {
          // For background commands, use Server-Sent Events
          return await this.executeBackgroundCommand(command);
        }

        return await this.sidecarClient.request<CommandResult>("/execute/command", {
          method: "POST",
          body: JSON.stringify({
            command,
            timeout: options?.timeout,
            isBackground: false,
          }),
        });
      },
      fallback
    );
  }

  /**
   * Execute background command using Server-Sent Events for streaming output
   */
  private async executeBackgroundCommand(command: string): Promise<CommandResult> {
    const fallback: CommandResult = {
      success: false,
      error: "Remote execution unavailable",
      message: `Failed to start background command: ${command}`,
    };

    return this.withErrorHandling(
      `executeBackgroundCommand(${command})`,
      async () => {
        // Start the background command
        const response = await this.sidecarClient.request<BackgroundCommandResponse>("/commands/background", {
          method: "POST",
          body: JSON.stringify({ command }),
        });

        // TODO: In a full implementation, we'd set up SSE listener here
        // For now, just return success immediately
        console.log(`[REMOTE] Started background command ${response.commandId}: ${command}`);

        return {
          success: true,
          message: `Background command started: ${command}`,
          isBackground: true,
        } as CommandResult;
      },
      fallback
    );
  }

  /**
   * Health check endpoint
   */
  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    const fallback: { healthy: boolean; message: string } = {
      healthy: false,
      message: "Remote sidecar unavailable",
    };

    return this.withErrorHandling(
      "healthCheck",
      async () => {
        const response = await this.sidecarClient.healthCheck();
        return {
          healthy: response.healthy,
          message: response.message || "Health check completed",
        };
      },
      fallback
    );
  }

  getWorkspacePath(): string {
    return this.workspacePath;
  }

  isRemote(): boolean {
    return true;
  }

  getTaskId(): string {
    return this.taskId;
  }

  getSidecarUrl(): string {
    return this.sidecarClient.getSidecarUrl();
  }

  /**
   * Get the underlying sidecar client (useful for advanced operations)
   */
  getSidecarClient(): SidecarClient {
    return this.sidecarClient;
  }

  /**
   * Test connectivity to sidecar
   */
  async testConnection(): Promise<boolean> {
    return this.withErrorHandling(
      "testConnection",
      async () => {
        return await this.sidecarClient.testConnection();
      },
      false // Return false on any error
    );
  }
}