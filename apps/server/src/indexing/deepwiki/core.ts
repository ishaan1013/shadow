import fg from "fast-glob";
import { createHash } from "crypto";
import { readFileSync, statSync } from "fs";
import path from "path";
import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import { CodebaseUnderstandingStorage } from "./db-storage";
import TS from "tree-sitter-typescript";
import { ModelProvider } from "@/agent/llm/models/model-provider";
import { ModelType, getModelProvider } from "@repo/types";
import { generateText } from "ai";

// Configuration
const TEMP = 0.15;

// Processing statistics
interface ProcessingStats {
  filesProcessed: number;
  directoriesProcessed: number;
  totalTokens: number;
}

// Type definitions
interface TreeNode {
  id: string;
  name: string;
  absPath: string;
  relPath: string;
  level: number;
  children: string[];
  files: string[];
  summary?: string;
}

interface IndexFile {
  root: string;
  nodes: Record<string, TreeNode>;
}

interface Symbols {
  defs: Set<string>;
  calls: Set<string>;
  imports: Set<string>;
}

// Tree-sitter setup
const parserJS = new Parser();
parserJS.setLanguage(JavaScript as any);
const parserTS = new Parser();
parserTS.setLanguage(TS.typescript as any);
const parserTSX = new Parser();
parserTSX.setLanguage(TS.tsx as any);

const LANGUAGES = {
  js: {
    parser: parserJS,
    extensions: [".js", ".cjs", ".mjs", ".jsx"],
    queryDefs: new Parser.Query(
      JavaScript as any,
      `
      (function_declaration name: (identifier) @def.name)
      (method_definition name: (property_identifier) @def.name)
      (class_declaration name: (identifier) @def.name)
      (lexical_declaration (variable_declarator name: (identifier) @def.name value: (arrow_function)))
    `
    ),
    queryCalls: new Parser.Query(
      JavaScript as any,
      `
      (call_expression function: (identifier) @call.name)
      (call_expression function: (member_expression property: (property_identifier) @call.name))
    `
    ),
    queryImports: new Parser.Query(
      JavaScript as any,
      `(import_statement source: (string) @import.source)`
    ),
  },
  ts: {
    parser: parserTS,
    extensions: [".ts", ".mts", ".cts"],
    queryDefs: new Parser.Query(
      TS.typescript as any,
      `(function_declaration name: (identifier) @def.name)`
    ),
    queryCalls: new Parser.Query(TS.typescript as any, ``),
    queryImports: new Parser.Query(
      TS.typescript as any,
      `(import_statement source: (string) @import.source)`
    ),
  },
  tsx: {
    parser: parserTSX,
    extensions: [".tsx"],
    queryDefs: new Parser.Query(
      TS.tsx as any,
      `(function_declaration name: (identifier) @def.name)`
    ),
    queryCalls: new Parser.Query(TS.tsx as any, ``),
    queryImports: new Parser.Query(
      TS.tsx as any,
      `(import_statement source: (string) @import.source)`
    ),
  },
};

const sha1 = (data: string) => createHash("sha1").update(data).digest("hex");

// Extract symbols using tree-sitter
function extractSymbols(src: string, langSpec: any): Symbols {
  const format = (n: Parser.SyntaxNode) => {
    const name = src.slice(n.startIndex, n.endIndex);
    const lineStart = n.startPosition.row + 1;
    const lineEnd = n.endPosition.row + 1;
    return `${name} (L${lineStart}-${lineEnd})`;
  };

  const tree = langSpec.parser.parse(src);
  const out: Symbols = {
    defs: new Set(),
    calls: new Set(),
    imports: new Set(),
  };

  for (const m of langSpec.queryDefs.matches(tree.rootNode)) {
    m.captures.forEach((cap: any) => out.defs.add(format(cap.node)));
  }
  for (const m of langSpec.queryCalls.matches(tree.rootNode)) {
    m.captures.forEach((cap: any) => out.calls.add(format(cap.node)));
  }
  for (const m of langSpec.queryImports.matches(tree.rootNode)) {
    m.captures.forEach((cap: any) =>
      out.imports.add(
        src.slice(cap.node.startIndex, cap.node.endIndex).replace(/['"`]/g, "")
      )
    );
  }
  return out;
}

function symbolsToMarkdown(sym: Symbols): string {
  const md: string[] = [];
  if (sym.imports.size) md.push("**Imports**: " + [...sym.imports].join(", "));
  if (sym.defs.size) md.push("**Defs**: " + [...sym.defs].join(", "));
  if (sym.calls.size) md.push("**Calls**: " + [...sym.calls].join(", "));
  return md.join("\n");
}

// Build directory tree
async function buildTree(rootPath: string): Promise<IndexFile> {
  const ignore = [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/build/**",
    "**/*.png",
    "**/*.jpg",
    "**/*.jpeg",
    "**/*.gif",
    "**/*.svg",
    "**/*.ico",
    "**/*.lock",
    "**/.shadow/**",
  ];

  const entries = await fg("**/*", {
    cwd: rootPath,
    absolute: true,
    dot: true,
    ignore,
  });
  const files = entries.filter((p) => statSync(p).isFile());

  const nodes: Record<string, TreeNode> = {};
  const rootNode: TreeNode = {
    id: "root",
    name: path.basename(rootPath),
    absPath: rootPath,
    relPath: ".",
    level: 0,
    children: [],
    files: [],
  };
  nodes[rootNode.id] = rootNode;

  for (const abs of files) {
    const rel = path.relative(rootPath, abs);
    const parts = rel.split(path.sep);
    let curPath = ".";
    let parent = "root";

    // Handle files in subdirectories
    for (let d = 0; d < parts.length - 1; d++) {
      curPath = path.join(curPath, parts[d]!);
      const nid = toNodeId(curPath);
      if (!nodes[nid]) {
        nodes[nid] = {
          id: nid,
          name: parts[d]!,
          absPath: path.join(rootPath, curPath),
          relPath: curPath,
          level: d + 1,
          children: [],
          files: [],
        };
        nodes[parent]?.children.push(nid);
      }
      parent = nid;
    }

    // Add the file to the appropriate parent
    nodes[parent]?.files.push(rel);
  }

  return { root: "root", nodes };
}

function toNodeId(rel: string) {
  const slug = rel
    .replace(/[^a-z0-9/]+/gi, "_")
    .replace(/\/+/g, "__")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return slug || `node_${sha1(rel).slice(0, 6)}`;
}

// Analyze file complexity
function analyzeFileComplexity(symbols: Symbols, fileSize: number): boolean {
  const defCount = symbols.defs.size;
  const importCount = symbols.imports.size;
  const callCount = symbols.calls.size;

  return (
    defCount > 15 ||
    (importCount > 10 && defCount > 5) ||
    (fileSize > 10000 && defCount > 3) ||
    (callCount > 30 && defCount > 0)
  );
}

// Summarize a file
async function summarizeFile(
  rootPath: string,
  rel: string,
  modelProvider: ModelProvider,
  userApiKeys: { openai?: string; anthropic?: string },
  modelMini: ModelType
): Promise<string> {
  const abs = path.join(rootPath, rel);
  const src = readFileSync(abs, "utf8");

  // Determine the language based on file extension
  const fileExt = path.extname(rel);
  let langSpec = LANGUAGES.js; // default

  for (const [_key, lang] of Object.entries(LANGUAGES)) {
    if (lang.extensions.includes(fileExt)) {
      langSpec = lang;
      break;
    }
  }

  // Extract symbols using Tree-sitter
  const symbols = extractSymbols(src, langSpec);
  const needsDeepAnalysis = analyzeFileComplexity(symbols, src.length);

  if (needsDeepAnalysis) {
    // Use GPT for complex files
    return await analyzeFileWithLLM(
      rel,
      src,
      symbols,
      modelProvider,
      userApiKeys,
      modelMini
    );
  } else {
    // Use basic symbol extraction
    return symbolsToMarkdown(symbols) || "_(no symbols found)_";
  }
}

// Analyze file with GPT
async function analyzeFileWithLLM(
  rel: string,
  src: string,
  symbols: Symbols,
  modelProvider: ModelProvider,
  userApiKeys: { openai?: string; anthropic?: string },
  modelMini: ModelType
): Promise<string> {
  const ext = path.extname(rel).toLowerCase();
  const isDataFile =
    /\.(csv|json|txt|md|png|jpg|jpeg|gif|svg|ico|xlsx|xls|tsv|yaml|yml)$/i.test(
      ext
    );

  let systemPrompt = "";
  if (isDataFile) {
    systemPrompt = `Give a 1-3 line description of this data file. Be extremely concise. File: ${path.basename(rel)}`;
  } else {
    systemPrompt = `Analyze this code file. Be ultra-concise, use bullet points and fragments. Include:
1. Purpose (1 line)
2. Main symbols with line numbers
3. Key dependencies
4. Critical algorithms/patterns (if any)

File: ${path.basename(rel)}`;
  }

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: src },
  ];

  try {
    const model = modelProvider.getModel(modelMini, userApiKeys);

    const { text } = await generateText({
      model,
      temperature: 0.6,
      messages,
      maxTokens: 2048,
    });

    return text?.trim() || "_(no response)_";
  } catch (err) {
    console.error(`Error analyzing ${rel} with GPT:`, err);
    return symbolsToMarkdown(symbols) || "_(no symbols found)_";
  }
}

// LLM chat function
async function chat(
  messages: any[],
  budget: number,
  modelProvider: ModelProvider,
  userApiKeys: { openai?: string; anthropic?: string },
  model: ModelType
): Promise<string> {
  const modelInstance = modelProvider.getModel(model, userApiKeys);

  const { text } = await generateText({
    model: modelInstance,
    temperature: TEMP,
    messages,
    maxTokens: budget,
  });

  return text?.trim() || "_(no response)_";
}

// Summarize directory
async function summarizeDir(
  node: TreeNode,
  childSummaries: string[],
  modelProvider: ModelProvider,
  userApiKeys: { openai?: string; anthropic?: string },
  model: ModelType
): Promise<string> {
  const budget = Math.min(800, 200 + childSummaries.length * 40);
  const systemPrompt = `Summarize this code directory. Be ultra-concise.

Include only:
1. Main purpose (1 line)
2. Key components and their roles
3. Critical patterns or algorithms

Use bullet points, fragments, abbreviations. Directory: ${node.relPath}`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: childSummaries.join("\n---\n") },
  ];

  return chat(messages, budget, modelProvider, userApiKeys, model);
}

// Summarize root
async function summarizeRoot(
  node: TreeNode,
  childSummaries: string[],
  modelProvider: ModelProvider,
  userApiKeys: { openai?: string; anthropic?: string },
  model: ModelType
): Promise<string> {
  const budget = Math.min(500, 150 + childSummaries.length * 30);
  const systemPrompt = `Create a concise architecture overview for ${node.name}.

Include only the most essential:
1. Core components and their roles (very brief)
2. Main data flows between components
3. Key architectural patterns
4. Tech stack basics

Use bullet points and fragments. Ultra-concise technical descriptions only.`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: childSummaries.join("\n---\n") },
  ];

  return chat(messages, budget, modelProvider, userApiKeys, model);
}

/**
 * Main function to run deep wiki analysis and store in database
 */
export async function runDeepWiki(
  repoPath: string,
  taskId: string,
  repoFullName: string,
  repoUrl: string,
  userId: string,
  userApiKeys: { openai?: string; anthropic?: string },
  options: {
    concurrency?: number;
    model?: ModelType;
    modelMini?: ModelType;
  }
): Promise<{ codebaseUnderstandingId: string; stats: ProcessingStats }> {
  console.log(`[DEEP-WIKI] Analyzing ${repoPath} for task ${taskId}`);

  // Determine which models to use based on available API keys
  let mainModel: ModelType;
  let miniModel: ModelType;

  if (options.model && options.modelMini) {
    // Use provided models if both are specified
    mainModel = options.model;
    miniModel = options.modelMini;
  } else {
    // Auto-select based on available API keys
    if (userApiKeys.openai) {
      mainModel = "gpt-4o" as ModelType;
      miniModel = "gpt-4o-mini" as ModelType;
    } else if (userApiKeys.anthropic) {
      mainModel = "claude-sonnet-4-20250514" as ModelType;
      miniModel = "claude-3-5-haiku-latest" as ModelType;
    } else {
      throw new Error(
        "No API keys provided. Please configure either OpenAI or Anthropic API key."
      );
    }
  }

  // Validate that we have the required API key for the selected models
  const mainProvider = getModelProvider(mainModel);
  const miniProvider = getModelProvider(miniModel);

  if (mainProvider === "openai" && !userApiKeys.openai) {
    throw new Error(
      "OpenAI API key required for selected model but not provided."
    );
  }
  if (mainProvider === "anthropic" && !userApiKeys.anthropic) {
    throw new Error(
      "Anthropic API key required for selected model but not provided."
    );
  }
  if (miniProvider === "openai" && !userApiKeys.openai) {
    throw new Error("OpenAI API key required for mini model but not provided.");
  }
  if (miniProvider === "anthropic" && !userApiKeys.anthropic) {
    throw new Error(
      "Anthropic API key required for mini model but not provided."
    );
  }

  console.log(
    `[DEEP-WIKI] Using models: ${mainModel} (main), ${miniModel} (mini)`
  );

  const modelProvider = new ModelProvider();
  const stats: ProcessingStats = {
    filesProcessed: 0,
    directoriesProcessed: 0,
    totalTokens: 0,
  };

  // Build tree
  const tree = await buildTree(repoPath);

  // Process files (parallel)
  const fileCache: Record<string, string> = {};
  const fileTasks: Promise<void>[] = [];

  for (const nid in tree.nodes) {
    const node = tree.nodes[nid]!;
    for (const rel of node.files || []) {
      fileTasks.push(
        summarizeFile(
          repoPath,
          rel,
          modelProvider,
          userApiKeys,
          miniModel
        ).then((summary) => {
          fileCache[rel] = summary;
          stats.filesProcessed++;
        })
      );
    }
  }
  await Promise.all(fileTasks);

  // Process directories (bottom-up)
  const nodesByDepth = Object.keys(tree.nodes).sort(
    (a, b) => tree.nodes[b]!.level - tree.nodes[a]!.level
  );

  for (const nid of nodesByDepth) {
    if (nid === "root") continue;
    const node = tree.nodes[nid]!;

    // Collect child summaries
    const blocks: string[] = [];

    // Add child directory summaries
    node.children.forEach((cid) => {
      const c = tree.nodes[cid]!;
      blocks.push(`## Directory: ${c.name}\n${c.summary || "_missing_"}`);
    });

    // Add file summaries
    for (const filePath of node.files) {
      const fileName = path.basename(filePath);
      const fileContent = fileCache[filePath] || "_missing_";
      blocks.push(`### ${fileName}\n${fileContent.split("\n\n")[0]}`);
    }

    node.summary = await summarizeDir(
      node,
      blocks,
      modelProvider,
      userApiKeys,
      mainModel
    );
    stats.directoriesProcessed++;
  }

  // Process root
  const root = tree.nodes[tree.root]!;
  const topBlocks = root.children.map((cid) => {
    const c = tree.nodes[cid]!;
    return `## ${c.name}\n${c.summary || "_missing_"}`;
  });

  root.summary = await summarizeRoot(
    root,
    topBlocks,
    modelProvider,
    userApiKeys,
    mainModel
  );

  // Create final summary structure
  const summaryContent = {
    rootSummary: root.summary,
    structure: tree,
    fileCache,
    metadata: {
      filesProcessed: stats.filesProcessed,
      directoriesProcessed: stats.directoriesProcessed,
      generatedAt: new Date().toISOString(),
    },
  };

  // Store in database
  const storage = new CodebaseUnderstandingStorage(taskId);
  const codebaseUnderstandingId = await storage.storeSummary(
    repoFullName,
    repoUrl,
    summaryContent,
    userId
  );

  console.log(
    `[DEEP-WIKI] Complete: ${stats.filesProcessed} files, ${stats.directoriesProcessed} dirs`
  );

  return { codebaseUnderstandingId, stats };
}
