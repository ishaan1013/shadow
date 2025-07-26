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
  CodebaseSearchResult,
} from "@repo/types";
import { CommandResult } from "../interfaces/types";
import config from "../../config";
import { EmbeddingSearchResult } from "../../indexing/embedding/types";
/**
 * MockRemoteToolExecutor simulates HTTP calls to a sidecar API
 * Used for testing the abstraction layer without real infrastructure
 */
export class MockRemoteToolExecutor implements ToolExecutor {
  private taskId: string;
  private workspacePath: string;
  private simulateFailures: boolean;
  private latencyMs: number;

  constructor(
    taskId: string,
    workspacePath: string = "/mock/workspace",
    options: {
      simulateFailures?: boolean;
      latencyMs?: number;
    } = {}
  ) {
    this.taskId = taskId;
    this.workspacePath = workspacePath;
    this.simulateFailures = options.simulateFailures || false;
    this.latencyMs = options.latencyMs || 100; // Default 100ms latency
  }

  /**
   * Simulate network latency and potential failures
   */
  private async simulateNetworkCall<T>(operation: string, mockResponse: () => T): Promise<T> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, this.latencyMs));

    // Randomly simulate failures if enabled (10% chance)
    if (this.simulateFailures && Math.random() < 0.1) {
      throw new Error(`Mock network error during ${operation}`);
    }

    console.log(`[MOCK_REMOTE] Simulated ${operation} call`);
    return mockResponse();
  }

  async readFile(
    targetFile: string,
    options?: ReadFileOptions
  ): Promise<FileResult> {
    return this.simulateNetworkCall("readFile", () => {
      const mockContent = `// Mock file content for ${targetFile}\nconsole.log("Hello from mock file");\n// End of mock content`;
      const lines = mockContent.split("\n");

      if (options?.shouldReadEntireFile) {
        return {
          success: true,
          content: mockContent,
          totalLines: lines.length,
          message: `Read entire file: ${targetFile} (${lines.length} lines)`,
        };
      }

      const startLine = options?.startLineOneIndexed || 1;
      const endLine = options?.endLineOneIndexedInclusive || lines.length;

      if (startLine < 1 || endLine > lines.length || startLine > endLine) {
        return {
          success: false,
          error: `Invalid line range: ${startLine}-${endLine} for file with ${lines.length} lines`,
          message: `Failed to read file: ${targetFile}`,
        };
      }

      const selectedLines = lines.slice(startLine - 1, endLine);
      const selectedContent = selectedLines.join("\n");

      return {
        success: true,
        content: selectedContent,
        startLine,
        endLine,
        totalLines: lines.length,
        message: `Read lines ${startLine}-${endLine} of ${targetFile}`,
      };
    });
  }

  async getFileStats(targetFile: string): Promise<FileStatsResult> {
    return this.simulateNetworkCall("getFileStats", () => {
      // Generate mock file stats
      const mockSize = Math.floor(Math.random() * 100000) + 1000; // 1KB to 100KB
      const mockMtime = new Date(Date.now() - Math.floor(Math.random() * 30 * 24 * 60 * 60 * 1000)); // Up to 30 days ago
      const isDirectory = targetFile.endsWith('/') || !targetFile.includes('.');

      return {
        success: true,
        stats: {
          size: mockSize,
          mtime: mockMtime,
          isFile: !isDirectory,
          isDirectory: isDirectory,
        },
        message: `Retrieved stats for: ${targetFile} (${mockSize} bytes)`,
      };
    });
  }

  async writeFile(
    targetFile: string,
    content: string,
    _instructions: string
  ): Promise<WriteResult> {
    return this.simulateNetworkCall("writeFile", () => {
      const isNewFile = Math.random() > 0.5; // Randomly decide if it's a new file
      const linesAdded = content.split("\n").length;

      return {
        success: true,
        isNewFile,
        message: isNewFile
          ? `Created new file: ${targetFile}`
          : `Modified file: ${targetFile}`,
        linesAdded: isNewFile ? linesAdded : Math.floor(linesAdded * 0.8),
        linesRemoved: isNewFile ? 0 : Math.floor(linesAdded * 0.2),
      };
    });
  }

  async deleteFile(targetFile: string): Promise<DeleteResult> {
    return this.simulateNetworkCall("deleteFile", () => {
      // Simulate that 90% of files exist and get deleted
      const fileExists = Math.random() > 0.1;

      if (fileExists) {
        return {
          success: true,
          message: `Successfully deleted file: ${targetFile}`,
        };
      } else {
        return {
          success: true,
          message: `File does not exist: ${targetFile}`,
          wasAlreadyDeleted: true,
        };
      }
    });
  }

  async searchReplace(
    filePath: string,
    _oldString: string,
    _newString: string
  ): Promise<WriteResult> {
    return this.simulateNetworkCall("searchReplace", () => {
      // Simulate different scenarios
      const scenario = Math.random();

      if (scenario < 0.1) {
        // 10% chance text not found
        return {
          success: false,
          message: `Text not found in file: ${filePath}`,
        };
      } else if (scenario < 0.15) {
        // 5% chance multiple occurrences
        return {
          success: false,
          message: `Multiple occurrences found (3). The old_string must be unique.`,
        };
      } else {
        // 85% chance success
        return {
          success: true,
          message: `Successfully replaced text in ${filePath}`,
        };
      }
    });
  }

  async listDirectory(relativeWorkspacePath: string): Promise<DirectoryListing> {
    return this.simulateNetworkCall("listDirectory", () => {
      // Generate mock directory contents
      const mockContents = [
        { name: "src", type: "directory" as const, isDirectory: true },
        { name: "package.json", type: "file" as const, isDirectory: false },
        { name: "README.md", type: "file" as const, isDirectory: false },
        { name: "node_modules", type: "directory" as const, isDirectory: true },
        { name: "index.js", type: "file" as const, isDirectory: false },
      ];

      return {
        success: true,
        contents: mockContents,
        path: relativeWorkspacePath,
        message: `Listed ${mockContents.length} items in ${relativeWorkspacePath}`,
      };
    });
  }

  async searchFiles(
    query: string,
    _options?: SearchOptions
  ): Promise<FileSearchResult> {
    return this.simulateNetworkCall("searchFiles", () => {
      // Generate mock file search results
      const mockFiles = [
        `src/${query}.js`,
        `tests/${query}.test.js`,
        `docs/${query}.md`,
        `components/${query}Component.tsx`,
      ].slice(0, Math.floor(Math.random() * 4) + 1); // Return 1-4 results

      return {
        success: true,
        files: mockFiles,
        query,
        count: mockFiles.length,
        message: `Found ${mockFiles.length} files matching: ${query}`,
      };
    });
  }

  async grepSearch(query: string, _options?: GrepOptions): Promise<GrepResult> {
    return this.simulateNetworkCall("grepSearch", () => {
      // Generate mock grep results
      const mockMatches = [
        `src/index.js:15:    console.log("${query} found here");`,
        `src/utils.js:42:    function handle${query}() {`,
        `README.md:8:This project uses ${query} for processing.`,
      ].slice(0, Math.floor(Math.random() * 3) + 1); // Return 1-3 results

      return {
        success: true,
        matches: mockMatches,
        query,
        matchCount: mockMatches.length,
        message: `Found ${mockMatches.length} matches for pattern: ${query}`,
      };
    });
  }

  async codebaseSearch(
    query: string,
    _options?: SearchOptions
  ): Promise<CodebaseSearchToolResult> {
    return this.simulateNetworkCall("codebaseSearch", () => {
      const searchTerms = query.split(" ").filter(term => term.length > 2);

      // Generate mock code search results
      const mockResults = [
        {
          id: 1,
          content: `function process${query.replace(/\s+/g, '')}() {\n  // Mock implementation\n  return true;\n}`,
          relevance: 0.95,
        },
        {
          id: 2,
          content: `// Configuration for ${query}\nconst config = {\n  enabled: true,\n  options: {}\n};`,
          relevance: 0.87,
        },
        {
          id: 3,
          content: `import { ${searchTerms[0] || 'util'} } from './utils';\n\n// Use ${query} here`,
          relevance: 0.72,
        },
      ].slice(0, Math.floor(Math.random() * 3) + 1); // Return 1-3 results

      return {
        success: true,
        results: mockResults,
        query,
        searchTerms,
        message: `Found ${mockResults.length} relevant code snippets for "${query}"`,
      };
    });
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
    return this.simulateNetworkCall("webSearch", () => {
      // Generate mock web search results
      const mockResults = [
        {
          text: `This is a mock search result for "${query}". It contains detailed information about the topic you're searching for.`,
          url: `https://example.com/search-result-1?q=${encodeURIComponent(query)}`,
          title: `${query} - Comprehensive Guide`,
        },
        {
          text: `Another mock result showing how ${query} is used in practice with real-world examples and best practices.`,
          url: `https://docs.example.com/${query.toLowerCase().replace(/\s+/g, '-')}`,
          title: `Understanding ${query}: Documentation`,
        },
        {
          text: `Latest news and updates about ${query}. Stay informed about recent developments and trends.`,
          url: `https://news.example.com/articles/${query.toLowerCase().replace(/\s+/g, '-')}`,
          title: `${query} News & Updates`,
        },
      ];

      // Filter by domain if specified
      const filteredResults = domain
        ? mockResults.filter(result => result.url.includes(domain))
        : mockResults;

      // Randomly return 1-3 results
      const selectedResults = filteredResults.slice(0, Math.floor(Math.random() * 3) + 1);

      return {
        success: true,
        results: selectedResults,
        query,
        domain,
        message: `Found ${selectedResults.length} web search results for "${query}"${domain ? ` from ${domain}` : ''}`,
      };
    });
  }

  async executeCommand(
    command: string,
    options?: CommandOptions
  ): Promise<CommandResult> {
    return this.simulateNetworkCall("executeCommand", () => {
      if (options?.isBackground) {
        return {
          success: true,
          message: `Background command started: ${command}`,
          isBackground: true,
        };
      }

      // Simulate different command scenarios
      const scenario = Math.random();

      if (scenario < 0.1) {
        // 10% chance of command failure
        return {
          success: false,
          error: "Command execution failed",
          message: `Failed to execute command: ${command}`,
        };
      } else {
        // 90% chance of success
        const mockStdout = `Mock output from command: ${command}\nOperation completed successfully.`;
        const mockStderr = Math.random() > 0.8 ? "Warning: mock warning message" : "";

        return {
          success: true,
          stdout: mockStdout,
          stderr: mockStderr,
          message: `Command executed successfully: ${command}`,
        };
      }
    });
  }

  getWorkspacePath(): string {
    return this.workspacePath;
  }

  isRemote(): boolean {
    return true; // Mock remote behavior
  }

  getTaskId(): string {
    return this.taskId;
  }

  /**
   * Configure mock behavior for testing
   */
  setSimulateFailures(enabled: boolean): void {
    this.simulateFailures = enabled;
  }

  setLatency(ms: number): void {
    this.latencyMs = ms;
  }
}