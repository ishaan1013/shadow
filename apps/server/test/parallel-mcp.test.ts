import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MockLanguageModelV1 } from "ai/test";
import { simulateReadableStream } from "ai";

const state = vi.hoisted(() => ({
  mode: "local",
  model: undefined as unknown,
  localExecutor: vi.fn(),
  remoteExecutor: vi.fn(),
}));
vi.mock("../src/config", () => ({
  default: {
    get agentMode() {
      return state.mode;
    },
  },
}));
vi.mock("@repo/db", async (original) => ({
  ...(await original<typeof import("@repo/db")>()),
  prisma: { task: { findUnique: vi.fn(async () => null) } },
}));
vi.mock("../src/execution/local/local-tool-executor", () => ({
  LocalToolExecutor: class {
    constructor() {
      state.localExecutor();
    }
  },
}));
vi.mock("../src/execution/remote/remote-tool-executor", () => ({
  RemoteToolExecutor: class {
    constructor() {
      state.remoteExecutor();
    }
  },
}));
vi.mock("../src/execution/remote/remote-vm-runner", () => ({
  RemoteVMRunner: class {
    async getVMPodStatus() {
      return { status: { podIP: "127.0.0.1" } };
    }
  },
}));
vi.mock("../src/execution/local/local-workspace-manager", () => ({
  LocalWorkspaceManager: class {},
}));
vi.mock("../src/execution/remote/remote-workspace-manager", () => ({
  RemoteWorkspaceManager: class {},
}));
vi.mock("../src/execution/local/local-git-service", () => ({
  LocalGitService: class {},
}));
vi.mock("../src/execution/remote/remote-git-service", () => ({
  RemoteGitService: class {},
}));
vi.mock("../src/services/git-manager", () => ({ GitManager: class {} }));
vi.mock("../src/services/local-filesystem-watcher", () => ({
  LocalFileSystemWatcher: class {},
}));
vi.mock("../src/socket", () => ({
  emitTerminalOutput: vi.fn(),
  emitStreamChunk: vi.fn(),
}));
vi.mock("../src/initialization/background-indexing", () => ({
  isIndexingComplete: vi.fn(async () => false),
}));
vi.mock("../src/agent/llm/models/model-provider", () => ({
  ModelProvider: class {
    getModel() {
      return state.model;
    }
  },
}));
vi.mock("../src/agent/llm/observability/braintrust-service", () => ({
  braintrustService: { getOperationTelemetry: () => undefined },
}));

import { createTools, stopAllMCPManagers } from "../src/agent/tools";
import { MCPManager } from "../src/agent/mcp/mcp-manager";
import { createHttpMCPClient } from "../src/agent/mcp/http-client";
import { StreamProcessor } from "../src/agent/llm/streaming/stream-processor";
import {
  AvailableModels,
  isTransformedMCPTool,
  parseMCPToolName,
  type StreamChunk,
} from "@repo/types";

const endpoint = "https://search.parallel.ai/mcp";
const requests: { url: string; headers: Headers; body?: any }[] = [];
let origin: string;
let behavior: "normal" | "error" | "http-error" | "hang" = "normal";
let sseResponse: ServerResponse | undefined;
const response = (name: string) => ({
  content: [
    {
      type: "text",
      text:
        name === "web_fetch"
          ? "# Node.js documentation\nhttps://nodejs.org/api/"
          : "Node.js API docs: https://nodejs.org/api/",
    },
  ],
});
const toolDefinitions = [
  {
    name: "web_search",
    description: "Search the web",
    inputSchema: {
      type: "object",
      properties: {
        objective: { type: "string" },
        search_queries: { type: "array", items: { type: "string" } },
        session_id: { type: "string" },
      },
      required: ["objective", "search_queries"],
    },
  },
  {
    name: "web_fetch",
    description: "Read web pages",
    inputSchema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" } },
        session_id: { type: "string" },
      },
      required: ["urls"],
    },
  },
];
function rpcResult(body: any) {
  if (body.method === "initialize")
    return {
      protocolVersion: body.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "fixture", version: "1" },
    };
  if (body.method === "tools/list") return { tools: toolDefinitions };
  if (body.method === "tools/call")
    return behavior === "error"
      ? {
          isError: true,
          content: [{ type: "text", text: "Search unavailable" }],
        }
      : response(body.params.name);
  return {};
}
const server = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET" && req.url === "/sse") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("event: endpoint\ndata: /messages\n\n");
      sseResponse = res;
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let data = "";
    for await (const chunk of req) data += chunk;
    const body = JSON.parse(data);
    if (body.method === "tools/call" && behavior === "hang") return;
    if (behavior === "http-error") {
      res.writeHead(503).end("Unavailable");
      return;
    }
    const result = { jsonrpc: "2.0", id: body.id, result: rpcResult(body) };
    if (req.url === "/messages") {
      if (body.id !== undefined)
        sseResponse?.write(
          `event: message\ndata: ${JSON.stringify(result)}\n\n`
        );
      res.writeHead(202).end();
    } else if (body.id === undefined) {
      res.writeHead(202).end();
    } else {
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(result));
    }
  }
);
const nativeFetch = globalThis.fetch;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture address");
  origin = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
  requests.length = 0;
  behavior = "normal";
  vi.stubEnv("MCP_CONTEXT7_ENABLED", "false");
  vi.stubEnv("MCP_PARALLEL_ENABLED", "true");
  vi.stubEnv("MCP_PARALLEL_URL", "");
  // Isolate ambient credentials; the built-in MCP configuration must not use them.
  vi.stubEnv("PARALLEL_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      requests.push({
        url,
        headers,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return nativeFetch(url === endpoint ? origin + "/mcp" : input, init);
    }
  );
});
afterEach(async () => {
  await stopAllMCPManagers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  sseResponse?.end();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const options = { toolCallId: "test", messages: [] };
const searchArgs = {
  objective: "Find current Node.js API documentation",
  search_queries: ["Node.js API documentation"],
};

// Scripted model: the real AI SDK dispatcher executes the registered tools and
// presents results to the next model step. No live model inference is claimed.
function scriptedModel(enableTools = true) {
  let step = 0;
  return new MockLanguageModelV1({
    doStream: async (call) => {
      const index = step++;
      if (!enableTools)
        expect(call.mode.type === "regular" && call.mode.tools).toBeUndefined();
      if (enableTools && index > 0) {
        expect(JSON.stringify(call.prompt)).toContain(
          "https://nodejs.org/api/"
        );
      }
      const toolName =
        index === 0 ? "parallel_web_search" : "parallel_web_fetch";
      const args =
        index === 0 ? searchArgs : { urls: ["https://nodejs.org/api/"] };
      const stream =
        enableTools && index < 2
          ? [
              {
                type: "tool-call",
                toolCallType: "function",
                toolCallId: `call-${index}`,
                toolName,
                args: JSON.stringify(args),
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: { promptTokens: 1, completionTokens: 1 },
              },
            ]
          : [
              {
                type: "text-delta",
                textDelta:
                  "Node.js documentation found at https://nodejs.org/api/",
              },
              {
                type: "finish",
                finishReason: "stop",
                usage: { promptTokens: 1, completionTokens: 1 },
              },
            ];
      return {
        stream: simulateReadableStream({
          chunks: stream as any,
          initialDelayInMs: 0,
          chunkDelayInMs: 0,
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  });
}

async function runStream(task: string, enabled = true) {
  state.model = scriptedModel(enabled);
  const chunks: StreamChunk[] = [];
  const stream = new StreamProcessor().createMessageStream(
    "Find documentation",
    [{ role: "user", content: "Find Node.js documentation" }] as any,
    AvailableModels.GPT_5,
    {},
    enabled,
    task
  );
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe("built-in Parallel MCP", () => {
  it.each(["local", "remote"])(
    "runs search and fetch through the %s resolver, stream dispatcher and result consumer",
    async (mode) => {
      state.mode = mode;
      const chunks = await runStream(`task-${mode}`);
      expect(
        chunks.filter((chunk) => chunk.type === "tool-result")
      ).toHaveLength(2);
      expect(chunks.filter((chunk) => chunk.type === "error")).toEqual([]);
      expect(JSON.stringify(chunks)).toContain("Node.js documentation found");
      expect(JSON.stringify(chunks)).not.toContain('"isValid":false');
      expect(
        mode === "local" ? state.localExecutor : state.remoteExecutor
      ).toHaveBeenCalled();
      const calls = requests.filter((r) => r.body?.method === "tools/call");
      expect(calls.map((r) => r.body.params.name)).toEqual([
        "web_search",
        "web_fetch",
      ]);
      expect(calls[1]?.body.params.arguments.urls).toEqual([
        "https://nodejs.org/api/",
      ]);
      expect(
        calls.every((r) => !("session_id" in r.body.params.arguments))
      ).toBe(true);
      const rpcRequests = requests.filter((r) => r.body?.id !== undefined);
      expect(rpcRequests.map((r) => r.body.method)).toEqual([
        "initialize",
        "tools/list",
        "tools/call",
        "tools/call",
      ]);
      expect(
        rpcRequests.every(
          (r) =>
            r.url === endpoint &&
            r.headers.get("User-Agent") === "Shadow-Agent/1.0" &&
            !r.headers.has("Authorization")
        )
      ).toBe(true);
      expect(isTransformedMCPTool("parallel_web_search")).toBe(true);
      expect(parseMCPToolName("parallel_web_fetch")?.displayServerName).toBe(
        "Parallel"
      );
    }
  );

  it("honors both explicit disable settings without discovery traffic", async () => {
    vi.stubEnv("MCP_PARALLEL_ENABLED", "false");
    const tools = await createTools("disabled");
    expect(tools).not.toHaveProperty("parallel_web_search");
    expect(requests).toEqual([]);
  });

  it("preserves the Context7 SSE endpoint and independent enable control", async () => {
    vi.stubEnv("MCP_PARALLEL_ENABLED", "false");
    vi.stubEnv("MCP_CONTEXT7_ENABLED", "true");
    vi.stubEnv("MCP_CONTEXT7_URL", origin + "/sse");
    const tools = await createTools("context7");
    expect(tools).toHaveProperty("context7_web_search");
    expect(tools).not.toHaveProperty("parallel_web_search");
    expect(requests.some((r) => r.url === origin + "/sse")).toBe(true);
  });

  it("honors endpoint overrides and passes host-supplied conversation arguments unchanged", async () => {
    vi.stubEnv("MCP_PARALLEL_URL", origin + "/custom");
    const tools = await createTools("override");
    await tools.parallel_web_search!.execute!(
      { ...searchArgs, session_id: "f41e3b32-902b-4c45-82ad-1ecae4fb2f5a" },
      options
    );
    const request = requests.find((r) => r.body?.method === "tools/call");
    expect(request?.url).toBe(origin + "/custom");
    expect(request?.body.params.arguments.session_id).toBe(
      "f41e3b32-902b-4c45-82ad-1ecae4fb2f5a"
    );
  });

  it("respects the stream's tool permission gate", async () => {
    const chunks = await runStream("no-tools", false);
    expect(chunks.some((c) => c.type === "error")).toBe(false);
    expect(requests.some((r) => r.body?.method === "tools/call")).toBe(false);
  });

  it("returns MCP service errors intact without provider fallback", async () => {
    const tools = await createTools("service-error");
    behavior = "error";
    const result = await tools.parallel_web_search!.execute!(
      searchArgs,
      options
    );
    expect(result).toMatchObject({ isError: true });
    expect(
      requests.filter((r) => r.body?.method === "tools/call")
    ).toHaveLength(1);
  });

  it("reports connection failure without exposing unusable tools", async () => {
    behavior = "http-error";
    const manager = new MCPManager();
    await manager.initializeConnections();
    expect(await manager.getAvailableTools()).toEqual({});
    await manager.closeAllConnections();
  });

  it("forwards cancellation through the actual tool wrapper", async () => {
    const tools = await createTools("cancel");
    behavior = "hang";
    const controller = new AbortController();
    const result = tools.parallel_web_search!.execute!(searchArgs, {
      ...options,
      abortSignal: controller.signal,
    });
    const rejection = expect(result).rejects.toThrow();
    await vi.waitFor(() =>
      expect(requests.some((r) => r.body?.method === "tools/call")).toBe(true)
    );
    controller.abort();
    await rejection;
  });

  it("enforces a bounded SDK request timeout", async () => {
    const client = await createHttpMCPClient({
      name: "short-timeout",
      transport: "http",
      enabled: true,
      url: origin + "/mcp",
      timeout: 30,
    });
    try {
      const tools = await client.tools();
      behavior = "hang";
      await expect(
        tools.web_search!.execute!(searchArgs, options)
      ).rejects.toThrow(/timed out/i);
    } finally {
      await client.close();
    }
  });

  it("rejects a pre-aborted tool call before sending it", async () => {
    const tools = await createTools("pre-aborted");
    const controller = new AbortController();
    controller.abort();
    await expect(
      tools.parallel_web_search!.execute!(searchArgs, {
        ...options,
        abortSignal: controller.signal,
      })
    ).rejects.toThrow();
    expect(requests.some((r) => r.body?.method === "tools/call")).toBe(false);
  });
});

it.runIf(process.env.RUN_LIVE_PARALLEL === "true")(
  "searches and fetches through the live anonymous MCP configuration",
  async () => {
    // Opt-in integration test. Model inference and VM provisioning are unnecessary
    // for this server-owned MCP connection; deterministic stream coverage is above.
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: String(input),
          headers: new Headers(init?.headers),
          body:
            typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        });
        return nativeFetch(input, init);
      }
    );
    const tools = await createTools("live-anonymous");
    expect(tools).toHaveProperty("parallel_web_search");
    const search = await tools.parallel_web_search!.execute!(
      searchArgs,
      options
    );
    console.log("LIVE_PARALLEL_SEARCH", JSON.stringify(search));
    expect(search).not.toMatchObject({ isError: true });
    const fetched = await tools.parallel_web_fetch!.execute!(
      { urls: ["https://nodejs.org/api/"] },
      options
    );
    console.log("LIVE_PARALLEL_FETCH", JSON.stringify(fetched));
    expect(fetched).not.toMatchObject({ isError: true });
    expect(JSON.stringify(fetched)).toContain("Node.js");
    expect(
      requests
        .filter((r) => r.body?.id !== undefined)
        .every(
          (r) =>
            r.url === endpoint &&
            r.headers.get("User-Agent") === "Shadow-Agent/1.0" &&
            !r.headers.has("Authorization")
        )
    ).toBe(true);
  },
  90000
);
