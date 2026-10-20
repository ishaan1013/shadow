import { experimental_createMCPClient } from "ai";
import type { ToolSet } from "ai";
import type { MCPServerConfig, MCPClientWrapper } from "./types";
import { createHttpMCPClient } from "./http-client";

const getMCPServers = (): MCPServerConfig[] => [
  {
    name: "context7",
    transport: "sse",
    url: process.env.MCP_CONTEXT7_URL || "https://mcp.context7.com/sse",
    enabled: process.env.MCP_CONTEXT7_ENABLED !== "false", // Default to enabled
    timeout: 30000, // 30 second timeout
    headers: {
      "User-Agent": "Shadow-Agent/1.0",
    },
  },
  {
    name: "parallel",
    transport: "http",
    url: process.env.MCP_PARALLEL_URL || "https://search.parallel.ai/mcp",
    enabled: process.env.MCP_PARALLEL_ENABLED !== "false",
    timeout: 30000,
    headers: {
      "User-Agent": "Shadow-Agent/1.0",
    },
  },
];

export class MCPManager {
  private clients: Map<string, MCPClientWrapper> = new Map();
  private isShuttingDown: boolean = false;

  async initializeConnections(): Promise<void> {
    const connectionPromises = getMCPServers()
      .filter((config) => config.enabled)
      .map(async (config) => {
        try {
          await this.connectToServer(config);
        } catch (error) {
          console.error(
            `[MCP_MANAGER] Failed to connect to ${config.name}:`,
            error
          );
          // Store failed connection for status tracking
          this.clients.set(config.name, {
            serverName: config.name,
            client: null,
            connected: false,
            lastError: error instanceof Error ? error.message : "Unknown error",
          });
        }
      });

    await Promise.allSettled(connectionPromises);
  }

  /**
   * Connect to a specific MCP server
   */
  private async connectToServer(config: MCPServerConfig): Promise<void> {
    if (this.isShuttingDown) {
      throw new Error("MCP Manager is shutting down");
    }

    try {
      let client;

      switch (config.transport) {
        case "sse":
          if (!config.url) {
            throw new Error(
              `SSE transport requires URL for server ${config.name}`
            );
          }
          client = await experimental_createMCPClient({
            transport: {
              type: "sse",
              url: config.url,
              headers: config.headers,
            },
          });
          break;

        case "stdio":
          if (!config.command) {
            throw new Error(
              `Stdio transport requires command for server ${config.name}`
            );
          }
          // Note: stdio transport would require additional import
          // import { Experimental_StdioMCPTransport as StdioMCPTransport } from 'ai/mcp-stdio';
          throw new Error("Stdio transport not implemented yet");

        case "http":
          if (!config.url) {
            throw new Error(
              `HTTP transport requires URL for server ${config.name}`
            );
          }
          client = await createHttpMCPClient(config);
          break;

        default:
          throw new Error(`Unsupported transport type: ${config.transport}`);
      }

      // Store successful connection
      this.clients.set(config.name, {
        serverName: config.name,
        client,
        connected: true,
        lastConnected: new Date(),
        lastError: undefined,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error(
        `[MCP_MANAGER] Connection failed for ${config.name}:`,
        errorMessage
      );

      // Store failed connection
      this.clients.set(config.name, {
        serverName: config.name,
        client: null,
        connected: false,
        lastError: errorMessage,
      });

      throw error;
    }
  }

  /**
   * Get all available tools from connected MCP servers
   */
  async getAvailableTools(serverName?: string): Promise<ToolSet> {
    const toolSet: ToolSet = {};
    const clientsToProcess = serverName
      ? [this.clients.get(serverName)].filter(Boolean)
      : Array.from(this.clients.values()).filter((c) => c.connected);

    if (clientsToProcess.length === 0) {
      return toolSet;
    }

    for (const clientWrapper of clientsToProcess) {
      if (!clientWrapper || !clientWrapper.connected || !clientWrapper.client) {
        continue;
      }

      try {
        // Get tools from MCP client
        const serverTools = await clientWrapper.client.tools();

        if (serverTools && typeof serverTools === "object") {
          // Prefix tool names with server name to avoid conflicts
          for (const [toolName, toolDefinition] of Object.entries(
            serverTools
          )) {
            const prefixedName = `${clientWrapper.serverName}:${toolName}`;
            toolSet[prefixedName] = toolDefinition as any; // Type assertion for MCP tools
          }
        }
      } catch (error) {
        console.error(
          `[MCP_MANAGER] Failed to get tools from ${clientWrapper.serverName}:`,
          error
        );

        // Mark client as disconnected
        clientWrapper.connected = false;
        clientWrapper.lastError =
          error instanceof Error ? error.message : "Unknown error";
      }
    }

    return toolSet;
  }

  /**
   * Close all MCP connections
   */
  async closeAllConnections(): Promise<void> {
    this.isShuttingDown = true;

    const closePromises = Array.from(this.clients.values()).map(
      async (clientWrapper) => {
        if (clientWrapper.client) {
          try {
            await clientWrapper.client.close();
          } catch (error) {
            console.error(
              `[MCP_MANAGER] Error closing ${clientWrapper.serverName}:`,
              error
            );
          }
        }
      }
    );

    await Promise.allSettled(closePromises);
    this.clients.clear();
  }
}
