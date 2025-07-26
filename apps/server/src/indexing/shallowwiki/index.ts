import { config } from "dotenv";
import fg from "fast-glob";
import { createHash } from "crypto";
import { writeFileSync, readFileSync, statSync } from "fs";
import { OpenAI } from "openai";
import path from "path";
import { DeepWikiStorage } from "./storage";

// Tree-sitter imports
import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import TS from "tree-sitter-typescript";
import Python from "tree-sitter-python";

config();

// Configuration
const ROOT = path.resolve(process.argv[2] || ".");
const TEMP = 0.15;
const USE_PINECONE = process.env.USE_PINECONE !== "false";

// Output directory
const OUT_DIR = path.join(ROOT, ".shadow", "tree");
const CACHE_FILE = path.join(OUT_DIR, "cache.json");

// Processing statistics
const processingStats = {
  filesProcessed: 0,
  directoriesProcessed: 0,
};

// Export functions for API usage
export function getProcessingStats() {
  return { ...processingStats };
}

// Type definitions
type NodeId = string;

interface TreeNode {
  id: NodeId;
  name: string;
  absPath: string;
  relPath: string;
  level: number;
  children: NodeId[];
  files: string[];
  summary_md?: string;
}

interface IndexFile {
  root: NodeId;
  nodes: Record<NodeId, TreeNode>;
}

interface CacheEntry {
  fingerprint: string;
  summary: string;
  detailedAnalysis?: string;
  complexity?: { needsDeepAnalysis: boolean; reason: string };
}

// Helper functions
function bold(s: string) {
  return `[DEEPWIKI] ${s}`;
}

const sha1 = (data: string) => createHash("sha1").update(data).digest("hex");

function ensureDir(dirPath: string) {
  const fs = require("fs");
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Tree-sitter language setup
const parserJS = new Parser();
parserJS.setLanguage(JavaScript as any);
const parserTS = new Parser();
parserTS.setLanguage((TS as any).typescript);
const parserTSX = new Parser();
parserTSX.setLanguage((TS as any).tsx);
const parserPy = new Parser();
parserPy.setLanguage(Python as any);

// Typed language aliases for tree-sitter
const LangJS = JavaScript as any;
const LangTS = (TS as any).typescript;
const LangTSX = (TS as any).tsx;
const LangPy = Python as any;

type LangKey = "js" | "ts" | "tsx" | "py";
interface LangSpec {
  parser: Parser;
  queryDefs: Parser.Query;
  queryCalls: Parser.Query;
  queryImports: Parser.Query;
  extensions: string[]; // File extensions this language handles
}

const LANGUAGES: Record<LangKey, LangSpec> = {
  js: {
    parser: parserJS,
    extensions: [".js", ".cjs", ".mjs", ".jsx"],
    queryDefs: new Parser.Query(LangJS, `
      (function_declaration name: (identifier) @def.name)
      (method_definition name: (property_identifier) @def.name)
      (class_declaration name: (identifier) @def.name)
      (lexical_declaration (variable_declarator name: (identifier) @def.name value: (arrow_function)))
    `),
    queryCalls: new Parser.Query(LangJS, `
      (call_expression function: (identifier) @call.name)
      (call_expression function: (member_expression property: (property_identifier) @call.name))
    `),
    queryImports: new Parser.Query(LangJS, `
      (import_statement source: (string) @import.source)
    `),
  },
  ts: {
    parser: parserTS,
    extensions: [".ts", ".mts", ".cts"],
    queryDefs: new Parser.Query(LangTS, `
      (function_declaration name: (identifier) @def.name)
    `),
    queryCalls: new Parser.Query(LangTS, ``),
    queryImports: new Parser.Query(LangTS, `
      (import_statement source: (string) @import.source)
    `),
  },
  tsx: {
    parser: parserTSX,
    extensions: [".tsx"],
    queryDefs: new Parser.Query(LangTSX, `
      (function_declaration name: (identifier) @def.name)
    `),
    queryCalls: new Parser.Query(LangTSX, ``),
    queryImports: new Parser.Query(LangTSX, `
      (import_statement source: (string) @import.source)
    `),
  },
  py: {
    parser: parserPy,
    extensions: [".py"],
    queryDefs: new Parser.Query(LangPy, `
      (function_definition name: (identifier) @def.name)
      (class_definition name: (identifier) @def.name)
    `),
    queryCalls: new Parser.Query(LangPy, `
      (call function: (identifier) @call.name)
    `),
    queryImports: new Parser.Query(LangPy, `
      (import_from_statement module_name: (dotted_name) @import.module)
      (import_statement name: (dotted_name) @import.module)
    `),
  },
};

// Caching helpers
let cache: Record<string, CacheEntry> = {};
function loadCache() {
  try {
    cache = JSON.parse(statSync(CACHE_FILE).size ? readFileSync(CACHE_FILE, "utf8") : "{}");
  } catch {
    cache = {};
  }
}
function saveCache() {
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}
function fingerprint(abs: string) {
  const st = statSync(abs);
  return sha1(`${st.size}_${st.mtimeMs}`);
}

// Function extraction via tree-sitter
interface Symbols {
  defs: Set<string>; // functions and classes
  calls: Set<string>;
  imports: Set<string>;
}

function extractSymbols(src: string, spec: LangSpec): Symbols {
  const format = (n: Parser.SyntaxNode) => {
    const name = src.slice(n.startIndex, n.endIndex);
    const lineStart = n.startPosition.row + 1;
    const lineEnd = n.endPosition.row + 1;
    return `${name} (L${lineStart}-${lineEnd})`;
  };
  const tree = spec.parser.parse(src);
  const out: Symbols = { defs: new Set(), calls: new Set(), imports: new Set() };

  for (const m of spec.queryDefs.matches(tree.rootNode)) {
    m.captures.forEach((cap) => out.defs.add(format(cap.node)));
  }
  for (const m of spec.queryCalls.matches(tree.rootNode)) {
    m.captures.forEach((cap) => out.calls.add(format(cap.node)));
  }
  for (const m of spec.queryImports.matches(tree.rootNode)) {
    m.captures.forEach((cap) => out.imports.add(src.slice(cap.node.startIndex, cap.node.endIndex).replace(/['"`]/g, "")));
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
async function buildTree(ignore: string[]): Promise<IndexFile> {
  const entries = await fg("**/*", { cwd: ROOT, absolute: true, dot: true, ignore });
  const files = entries.filter((p) => statSync(p).isFile());

  const nodes: Record<NodeId, TreeNode> = {};
  const rootNode: TreeNode = {
    id: "root",
    name: path.basename(ROOT),
    absPath: ROOT,
    relPath: ".",
    level: 0,
    children: [],
    files: [],
  };
  nodes[rootNode.id] = rootNode;

  for (const abs of files) {
    const rel = path.relative(ROOT, abs);
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
          absPath: path.join(ROOT, curPath),
          relPath: curPath,
          level: d + 1,
          children: [],
          files: [],
        };
        nodes[parent]?.children.push(nid);
      }
      parent = nid;
    }

    // Add the file to the appropriate parent (either root or a subdirectory)
    nodes[parent]?.files.push(rel);
  }

  // Post-process to collapse single-child directories with no files
  postProcessTree(nodes);

  return { root: "root", nodes };
}

// Helper to collapse empty directories and simplify the tree
function postProcessTree(nodes: Record<NodeId, TreeNode>): void {
  // Find directories with only one child and no files (intermediates)
  const nodesToCollapse = Object.values(nodes).filter(
    node => node.files.length === 0 && node.children.length === 1
  );

  // Process each node that could be collapsed
  for (const node of nodesToCollapse) {
    if (node.id === "root") continue; // Don't collapse root

    // Find the parent of this node
    const parentNode = Object.values(nodes).find(
      n => n.children.includes(node.id)
    );

    if (!parentNode) continue;

    // Get the child
    const childId = node.children[0];
    if (!childId) continue;

    const childNode = nodes[childId];
    if (!childNode) continue;

    // Remove current node from parent's children list
    const parentChildIdx = parentNode.children.findIndex(id => id === node.id);
    if (parentChildIdx !== -1) {
      parentNode.children.splice(parentChildIdx, 1);

      // Add the child node directly to parent
      parentNode.children.push(childId);

      // Update the child's name to reflect collapsed path
      childNode.name = `${node.name}/${childNode.name}`; // Both names are defined at this point

      console.log(` Collapsing empty directory: ${node.relPath}`);
    }
  }

  // Remove directories with no files and no children (empty leaves)
  const emptyNodes = Object.values(nodes).filter(
    node => node.files.length === 0 && node.children.length === 0 && node.id !== "root"
  );

  for (const node of emptyNodes) {
    // Find the parent
    const parentNode = Object.values(nodes).find(
      n => n.children.includes(node.id)
    );

    if (parentNode) {
      // Remove this empty node from parent's children
      const idx = parentNode.children.findIndex(id => id === node.id);
      if (idx !== -1) {
        parentNode.children.splice(idx, 1);
        console.log(` Removing empty directory: ${node.relPath}`);
      }
    }

    // Remove the node from nodes collection
    delete nodes[node.id];
  }
}

function toNodeId(rel: string) {
  const slug = rel
    .replace(/[^a-z0-9/]+/gi, "_")
    .replace(/\/+/g, "__")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return slug || `node_${sha1(rel).slice(0, 6)}`;
}

// Helper to detect data folders vs code folders
function isDataFolder(relPath: string): boolean {
  // List of common data folder indicators
  const dataFolderPatterns = [
    /data\b/i,                  // 'data' as a word
    /dataset/i,                  // dataset
    /\braw\b/i,                 // raw
    /\bimages?\b/i,             // image or images
    /\bcsv\b/i,                 // csv
    /\bjson\b/i,                // json
    /\btxt\b/i,                 // txt
    /\bsamples?\b/i,            // sample or samples
    /\bcorpus\b/i,              // corpus
    /\bmnist\b/i,               // mnist (specific dataset)
    /\bcifar\b/i,               // cifar (specific dataset)
  ];

  // Check if path matches any data folder patterns
  return dataFolderPatterns.some(pattern => pattern.test(relPath));
}

// Analyze file complexity based on Tree-sitter results
function analyzeFileComplexity(symbols: Symbols, fileSize: number): { needsDeepAnalysis: boolean; reason: string } {
  // Determine if a file needs deeper analysis based on symbol count and file size
  const defCount = symbols.defs.size;
  const importCount = symbols.imports.size;
  const callCount = symbols.calls.size;

  // Files with many symbols or large size might benefit from deeper analysis
  if (defCount > 15) {
    return { needsDeepAnalysis: true, reason: `High symbol count (${defCount} definitions)` };
  }

  if (importCount > 10 && defCount > 5) {
    return { needsDeepAnalysis: true, reason: `Complex dependencies (${importCount} imports, ${defCount} definitions)` };
  }

  if (fileSize > 10000 && defCount > 3) { // 10KB with multiple definitions
    return { needsDeepAnalysis: true, reason: `Large file (${Math.round(fileSize / 1024)}KB) with multiple definitions` };
  }

  if (callCount > 30 && defCount > 0) {
    return { needsDeepAnalysis: true, reason: `High call complexity (${callCount} calls)` };
  }

  return { needsDeepAnalysis: false, reason: "Basic symbol extraction sufficient" };
}

// Summarise a file (tree-sitter → markdown list)
async function summariseFile(rel: string, storage?: DeepWikiStorage): Promise<string> {
  const abs = path.join(ROOT, rel);
  const src = readFileSync(abs, "utf8");
  const fp = fingerprint(abs);

  // Check cache first
  if (cache[rel] && cache[rel]!.fingerprint === fp) {
    return cache[rel]!.summary;
  }

  // Determine the language based on file extension
  const fileExt = path.extname(rel);
  // Find appropriate language spec based on file extension
  let langSpec: LangSpec | undefined;
  for (const langKey of Object.keys(LANGUAGES)) {
    const lang = LANGUAGES[langKey as keyof typeof LANGUAGES];
    if (lang.extensions.includes(fileExt)) {
      langSpec = lang;
      break;
    }
  }

  // Default to JavaScript if no match (or handle differently if needed)
  if (!langSpec) {
    langSpec = LANGUAGES.js;
  }

  // Extract symbols using Tree-sitter with the correct language spec
  const symbols = extractSymbols(src, langSpec);

  // Analyze file complexity to decide if we need deep analysis
  const complexity = analyzeFileComplexity(symbols, src.length);

  let summary: string;
  let detailedAnalysis: string | undefined;

  if (complexity.needsDeepAnalysis) {
    console.log(`[DEEPWIKI] Analyzing: ${rel}`);
    // Use GPT for detailed analysis
    const langKey = Object.keys(LANGUAGES).find(k => {
      const langSpec = LANGUAGES[k as keyof typeof LANGUAGES];
      return langSpec && langSpec.extensions && langSpec.extensions.some((ext: string) => rel.endsWith(ext));
    }) || "unknown";
    detailedAnalysis = await analyzeFileWithGPT(rel, src, symbols, langKey);
    summary = detailedAnalysis;

    // Summary has been set from detailedAnalysis
  } else {
    // Use basic symbol extraction
    summary = symbolsToMarkdown(symbols) || "_(no symbols found)_";
  }

  // Store in Pinecone if enabled
  if (storage && USE_PINECONE) {
    const symbolNames = Array.from(symbols.defs);
    const dependencies = Array.from(symbols.imports);
    const language = Object.keys(LANGUAGES).find(k => {
      const langSpec = LANGUAGES[k as keyof typeof LANGUAGES];
      return langSpec && langSpec.extensions && langSpec.extensions.some((ext: string) => rel.endsWith(ext));
    });

    await storage.storeFileSummary(
      ROOT,
      rel,
      summary,
      symbolNames,
      dependencies,
      language,
      complexity.needsDeepAnalysis ? 1 : 0
    );
  }

  // Update cache
  cache[rel] = {
    fingerprint: fp,
    summary,
    detailedAnalysis,
    complexity
  };

  return summary;
}

// Analyze file with GPT for deeper understanding
async function analyzeFileWithGPT(rel: string, src: string, symbols: Symbols, langKey: string): Promise<string> {
  // Use a smaller context model (GPT-4o-mini) for file analysis
  const MODEL_MINI = process.env.MODEL_MINI || "gpt-4o-mini";

  // Get basic symbol information
  const basicSymbols = symbolsToMarkdown(symbols);

  // Check file extension for data files
  const ext = path.extname(rel).toLowerCase();
  const isDataFile = /\.(csv|json|txt|md|png|jpg|jpeg|gif|svg|ico|xlsx|xls|tsv|yaml|yml)$/i.test(ext);

  // Adjust the prompt based on file type
  let systemPrompt = '';
  if (isDataFile) {
    systemPrompt = `Give a 1-3 line description of this data file. Be extremely concise. Correct grammar isn't necessary, focus on key info only.\nFile: ${path.basename(rel)}`;
  } else {
    systemPrompt = `Analyze this ${langKey} file. Be ultra-concise, no extra words. Grammar isn't important.\n\nInclude:\n1. Purpose (1 line)\n2. Main symbols with line numbers\n3. Key dependencies\n4. Critical algorithms/patterns (if any)\n5. Brief code snippets ONLY if essential\n\nUse bullet points, abbreviations, and fragments. No complete sentences needed. Prioritize technical accuracy over readability.\n\nFile: ${path.basename(rel)}`;
  }

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: src }
  ];

  try {

    const res = await openai.chat.completions.create({
      model: MODEL_MINI,
      temperature: 0.6,
      messages,
      max_tokens: 2048 // Reduced token limit for more concise analysis
    });

    // Process response

    return res.choices[0]?.message?.content?.trim() || "_(no response)_";
  } catch (err) {
    console.error(`Error analyzing ${rel} with GPT:`, err);
    // Fall back to basic symbol extraction if GPT analysis fails
    return basicSymbols || "_(no symbols found)_";
  }
}

// Directory / root summaries via LLM (still concise)
const openai = new OpenAI();

// Model selection - use environment variables or defaults

async function chat(messages: any[], budget: number): Promise<string> {
  const MODEL = process.env.MODEL || "gpt-4o";

  const res = await openai.chat.completions.create({
    model: MODEL,
    temperature: TEMP,
    messages,
    max_tokens: budget
  });

  return res.choices[0]?.message?.content?.trim() || "_(no response)_";
}

function dirBudget(childCount: number) {
  return Math.min(800, 200 + childCount * 40); // Reduced budget for concise directory summary
}

function rootBudget(childCount: number) {
  return Math.min(500, 150 + childCount * 30); // Reduced budget for concise root overview
}
async function summariseDir(node: TreeNode, blocks: string[]): Promise<string> {
  // Check if this appears to be a data directory
  const isData = isDataFolder(node.relPath);

  // Extract only the most important analyses from files in this directory
  const fileAnalyses: string[] = [];
  for (const filePath of node.files) {
    if (cache[filePath]?.summary) {
      // For data folders, we only need very brief file mentions
      if (isData) {
        fileAnalyses.push(`- ${path.basename(filePath)}`);
      } else {
        // For code folders, include more detailed summaries but keep them concise
        fileAnalyses.push(`### ${path.basename(filePath)}\n${cache[filePath]?.summary.slice(0, 250)}...`);
      }
    }
  }

  // Combine analyses with regular blocks
  const allContent = [...blocks];
  if (fileAnalyses.length > 0) {
    allContent.push("\n## Files");
    allContent.push(...fileAnalyses);
  }

  const budget = dirBudget(blocks.length);
  let systemPrompt = "";

  if (isData) {
    // Data directory - ultra concise summary
    systemPrompt = `Give a 1-3 line description of this data directory. No grammar needed, just key facts. 

Directory: ${node.relPath}`;
  } else {
    // Code directory - concise but technical summary
    systemPrompt = `Summarize this code directory. Be ultra-concise.

Include only:
1. Main purpose (1 line)
2. Key components and their roles
3. Critical patterns or algorithms

Use bullet points, fragments, abbreviations. No complete sentences needed.

Directory: ${node.relPath}`;
  }

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: allContent.join("\n---\n") },
  ];

  // Use the main model (GPT-4o) for directory summaries
  return chat(messages, budget);
}
async function summariseRoot(node: TreeNode, blocks: string[]): Promise<string> {
  const budget = rootBudget(blocks.length);
  const messages = [
    {
      role: "system" as const, content: `Create a concise architecture overview for ${node.name}. 

Include only the most essential:
1. Core components and their roles (very brief)
2. Main data flows between components
3. Key architectural patterns
4. Tech stack basics

Use bullet points and fragments. Grammar not important. Ultra-concise technical descriptions only.` },
    { role: "user" as const, content: blocks.join("\n---\n") },
  ];

  // Use the main model (GPT-4o) for root summaries
  return chat(messages, budget);
}

// Main orchestrator
export async function run() {
  // Initialize storage
  const storage = USE_PINECONE ? new DeepWikiStorage(ROOT) : null;

  if (USE_PINECONE) {
    console.log(bold(`Using Pinecone storage (namespace: ${storage!.getNamespace()})`));
    // Clear existing data for this repository
    await storage!.clearRepository();
  } else {
    console.log(bold("Using legacy file storage"));
    ensureDir(OUT_DIR);
  }

  loadCache();

  // build ignore list
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
    "**/*.class",
    "**/*.exe",
    "**/__pycache__/**",
    "**/.venv/**",
    "**/venv/**",
    "**/.shadow/**",
  ];

  console.log(bold("Scanning repo…"));
  const tree = await buildTree(ignore);

  //----------------------------------------------
  // File symbol extraction (parallel, throttled)
  //----------------------------------------------  // Define file processing function
  const processFile = async (rel: string) => { return summariseFile(rel, storage || undefined); };
  const fileTasks: Promise<void>[] = [];
  let totalFiles = 0;
  for (const nid in tree.nodes) {
    const node = tree.nodes[nid]!;
    for (const rel of node?.files || []) {
      fileTasks.push(
        processFile(rel).then((summary) => {
          if (cache[rel]) {
            cache[rel]!.summary = summary;
          } else {
            cache[rel] = { fingerprint: "", summary } as CacheEntry;
          }
          totalFiles++;
        })
      );
    }
  }
  await Promise.all(fileTasks);

  // Update processing stats
  processingStats.filesProcessed = totalFiles;

  console.log(bold("File summaries complete"));

  //----------------------------------------------
  // Directory summaries (bottom-up)
  //----------------------------------------------
  const nodesByDepth = Object.keys(tree.nodes).sort((a, b) => tree.nodes[b]!.level - tree.nodes[a]!.level);
  for (const nid of nodesByDepth) {
    if (nid === "root") continue;
    const node = tree.nodes[nid]!;
    const blocks: string[] = [];

    // Add child directory summaries
    node.children.forEach((cid) => {
      const c = tree.nodes[cid]!;
      blocks.push(`## Directory: ${c.name}\n${c.summary_md || "_missing_"}`);
    });

    // Check if this is a data folder
    const isDataDir = isDataFolder(node.relPath);

    // Collect file analyses for this directory - much more concise now
    const fileBlocks: string[] = [];
    for (const filePath of node.files) {
      const fileEntry = cache[filePath];
      if (!fileEntry) continue;

      // Keep file summaries ultra-brief, especially for data files
      const fileName = path.basename(filePath);
      if (isDataDir) {
        // For data directories, just list files with minimal info
        fileBlocks.push(`- **${fileName}**: ${fileEntry.summary?.split('\n')[0] || 'data file'}`);
      } else {
        // For code directories, include concise summaries
        const fileContent = fileEntry.summary || "_missing_";
        // Just show file name and first paragraph of summary
        const briefSummary = fileContent.split('\n\n')[0];
        fileBlocks.push(`### ${fileName}\n${briefSummary}`);
      }
    }

    // Generate directory summary
    node.summary_md = await summariseDir(node, blocks);

    // Store in Pinecone if enabled
    if (storage && USE_PINECONE) {
      await storage.storeDirectorySummary(
        ROOT,
        node.relPath,
        node.summary_md,
        node.files,
        node.children.map(cid => tree.nodes[cid]?.name || cid)
      );
    }

    // Legacy file output (optional)
    if (!USE_PINECONE) {
      const front = `---\nid: ${node.id}\ntitle: ${node.name}\nlevel: ${node.level}\n---\n\n`;
      const fullContent = isDataDir
        ? `${node.summary_md}\n\n## Files\n${fileBlocks.join('\n')}`
        : `${node.summary_md}\n\n## Files\n${fileBlocks.join('\n\n')}`;

      // Ensure node.id is valid for a file name - replace any problematic characters
      const safeNodeId = node.id.replace(/[\/\\:*?"<>|]/g, '_');
      const outputFilePath = path.join(OUT_DIR, `${safeNodeId}.md`);

      const dirPath = path.dirname(outputFilePath);
      ensureDir(dirPath);

      console.log(`Writing file summary: ${outputFilePath}`);
      writeFileSync(outputFilePath, front + fullContent + "\n");
    }

    console.log(bold(`Dir: ${node.relPath}`));
    processingStats.directoriesProcessed++;
  }

  //----------------------------------------------
  // Root summary
  //----------------------------------------------
  const root = tree.nodes[tree.root]!;
  const topBlocks = root.children.map((cid) => {
    const c = tree.nodes[cid]!;
    return `## ${c.name}\n${c.summary_md || "_missing_"}`;
  });

  // Generate comprehensive root summary
  root.summary_md = await summariseRoot(root, topBlocks);

  // Store in Pinecone if enabled
  if (storage && USE_PINECONE) {
    await storage.storeRootOverview(
      ROOT,
      root.summary_md,
      processingStats.filesProcessed,
      processingStats.directoriesProcessed
    );
    console.log(bold(`DeepWiki stored in Pinecone (namespace: ${storage.getNamespace()})`));
  }

  // Legacy file output (optional)
  if (!USE_PINECONE) {
    const toc = ['## Project Structure'];
    root.children.forEach(cid => {
      const child = tree.nodes[cid];
      if (child) {
        toc.push(`- [${child.name}](${child.id}.md)`);
      }
    });

    const fullContent = [
      root.summary_md,
      '\n\n---\n',
      toc.join('\n')
    ].join('\n');

    ensureDir(OUT_DIR);

    // Write root overview file
    writeFileSync(
      path.join(OUT_DIR, "00_OVERVIEW.md"),
      `---\nid: ${root.id}\ntitle: ${root.name}\nlevel: 0\n---\n\n${fullContent}\n`
    );

    // Write individual summary files for each node
    console.log(bold("Writing summary files..."));
    let fileCount = 0;

    for (const nodeId in tree.nodes) {
      if (nodeId === "root") continue; // Skip root, already written as 00_OVERVIEW.md

      const node = tree.nodes[nodeId];
      if (node && node.summary_md) {
        const fileName = `${node.id}.md`;
        const fileContent = `---\nid: ${node.id}\ntitle: ${node.name}\nlevel: ${node.level}\n---\n\n${node.summary_md}\n`;

        writeFileSync(path.join(OUT_DIR, fileName), fileContent);
        fileCount++;
      }
    }

    writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify(tree, null, 2));
    console.log(bold(`ShallowWiki generated at ${OUT_DIR} (${fileCount + 1} files)`));
  }

  saveCache();

  // Generation complete
}

// Wrapper function for API usage that accepts parameters
export async function runDeepWiki(repoPath: string, options: {
  concurrency?: number;
  model?: string;
  modelMini?: string;
}) {
  // Store original values
  const originalPath = process.argv[2];
  const originalConcurrency = process.env.CONCURRENCY;
  const originalModel = process.env.MODEL;
  const originalModelMini = process.env.MODEL_MINI;

  console.log(bold(`Generating summaries for ${repoPath}`));

  try {
    // Set parameters as environment variables and argv
    process.argv[2] = repoPath;
    if (options.concurrency) {
      process.env.CONCURRENCY = options.concurrency.toString();
    }
    if (options.model) {
      process.env.MODEL = options.model;
    }
    if (options.modelMini) {
      process.env.MODEL_MINI = options.modelMini;
    }

    // Run the main function
    await run();

    // Return the processing stats
    return {
      processingStats: getProcessingStats()
    };
  } finally {
    // Restore original values
    if (originalPath !== undefined) {
      process.argv[2] = originalPath;
    } else {
      // Remove the argument if it wasn't there originally
      process.argv.splice(2, 1);
    }
    if (originalConcurrency) process.env.CONCURRENCY = originalConcurrency;
    if (originalModel) process.env.MODEL = originalModel;
    if (originalModelMini) process.env.MODEL_MINI = originalModelMini;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
