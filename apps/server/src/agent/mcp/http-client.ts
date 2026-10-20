import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { jsonSchema, tool, type ToolSet } from "ai";
import type { MCPServerConfig } from "./types";

/** Adapt Streamable HTTP tools to the AI SDK 4 tool contract. */
export async function createHttpMCPClient(config: MCPServerConfig) {
  if (!config.url) {
    throw new Error(`HTTP transport requires URL for server ${config.name}`);
  }

  const client = new Client({ name: "Shadow-Agent", version: "1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: config.headers },
  });
  const timeout = config.timeout ?? 30000;

  try {
    await client.connect(transport, { timeout });
  } catch (error) {
    await client.close();
    throw error;
  }

  return {
    close: () => client.close(),
    async tools(): Promise<ToolSet> {
      const tools: ToolSet = {};
      let cursor: string | undefined;
      do {
        const page = await client.listTools({ cursor }, { timeout });
        for (const definition of page.tools) {
          tools[definition.name] = tool({
            description: definition.description,
            parameters: jsonSchema<Record<string, unknown>>(
              definition.inputSchema as Parameters<typeof jsonSchema>[0]
            ),
            execute: async (args, options) => {
              options?.abortSignal?.throwIfAborted();
              return client.callTool(
                { name: definition.name, arguments: args },
                undefined,
                { timeout, signal: options?.abortSignal }
              );
            },
          });
        }
        cursor = page.nextCursor;
      } while (cursor);
      return tools;
    },
  };
}
