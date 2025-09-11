import { createHash } from "crypto";
import path from "path";
import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import { prisma, Prisma } from "@repo/db";
import { CodebaseUnderstandingStorage } from "./db-storage";
import { tryAcquireRepoLock, releaseRepoLock } from "../repo-lock";
import TS from "tree-sitter-typescript";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Python = require("tree-sitter-python");
import { ModelProvider } from "@/agent/llm/models/model-provider";
import { ModelType, ApiKeys } from "@repo/types";
import { CoreMessage, generateText, LanguageModel } from "ai";
import { TaskModelContext } from "@/services/task-model-context";
import { braintrustService } from "../../agent/llm/observability/braintrust-service";
import { createWorkspaceManager, type ToolExecutor } from "@/execution";

// Configuration
const TEMP = 0.15;

function getHardcodedMiniModel(
  provider: "anthropic" | "openai" | "openrouter"
): ModelType {
  switch (provider) {
    case "anthropic":
      return "claude-3-5-haiku-20241022";
    case "openai":
      return "gpt-4o-mini";
    case "openrouter":
      return "x-ai/grok-3";
    default:
      return "claude-3-5-haiku-20241022";
  }
}

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

// Tree-sitter setup - JS/TS/Python only
const parserJS = new Parser();
parserJS.setLanguage(JavaScript as any);
const parserTS = new Parser();
parserTS.setLanguage(TS.typescript as any);
const parserTSX = new Parser();
parserTSX.setLanguage(TS.tsx as any);
const parserPython = new Parser();
parserPython.setLanguage(Python as any);

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
    queryImports: new Parser.Query(
      TS.tsx as any,
      `(import_statement source: (string) @import.source)`
    ),
  },
  python: {
    parser: parserPython,
    extensions: [".py", ".pyx", ".pyi"],
    queryDefs: new Parser.Query(
      Python as any,
      `
      (function_definition name: (identifier) @def.name)
      (class_definition name: (identifier) @def.name)
      `
    ),
    queryImports: new Parser.Query(
      Python as any,
      `(import_statement name: (dotted_name) @import.name)`
    ),
  },
};

const sha1 = (data: string) => createHash("sha1").update(data).digest("hex");

// Simple timeout utility for tree-sitter parsing
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  const timeoutPromise = new Promise<T>((_, reject) => {
    setTimeout(() => {
      reject(
        new Error(`Operation '${operation}' timed out after ${timeoutMs}ms`)
      );
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

// Check if a file is critical and should always be analyzed
function isCriticalFile(filePath: string): boolean {
  const fileName = path.basename(filePath).toLowerCase();
  const relativePath = filePath.toLowerCase();

  const criticalFiles = [
    "package.json",
    "tsconfig.json",
    "pyproject.toml",
    "requirements.txt",
    "cargo.toml",
    "go.mod",
    "webpack.config.js",
    "vite.config.js",
    "next.config.js",
    "tailwind.config.js",
    "prisma/schema.prisma",
    ".env.example",
    "dockerfile",
    "docker-compose.yml",
    "readme.md",
    "claude.md",
    "makefile",
    ".gitignore",
  ];

  const criticalPatterns = [
    /\/index\.(ts|js|tsx|jsx|py)$/,
    /\/main\.(ts|js|tsx|jsx|py)$/,
    /\/app\.(ts|js|tsx|jsx|py)$/,
    /\/server\.(ts|js|py)$/,
    /\/client\.(ts|js)$/,
    /\/__init__\.py$/,
    /types?\.(ts|d\.ts)$/,
    /config\.(ts|js|json|py)$/,
    /schema\.(ts|js|prisma|sql|py)$/,
    /setup\.py$/,
    /manage\.py$/,
  ];

  return (
    criticalFiles.includes(fileName) ||
    criticalPatterns.some((pattern) => pattern.test(relativePath))
  );
}

// Smart file selection: pick representative files for each directory
function selectRepresentativeFiles(
  files: Array<{ path: string; size: number; symbols: Symbols }>,
  maxFiles: number = 3
): string[] {
  if (files.length <= maxFiles) {
    return files.map((f) => f.path);
  }

  const selected = new Set<string>();

  // 1. Always include main entry files
  const entryFiles = files.filter((f) => {
    const name = path.basename(f.path).toLowerCase();
    return (
      name.includes("index") ||
      name.includes("main") ||
      name.includes("__init__")
    );
  });
  entryFiles.slice(0, 1).forEach((f) => selected.add(f.path));

  // 2. Include largest file (likely most complex)
  if (selected.size < maxFiles) {
    const largest = files.sort((a, b) => b.size - a.size)[0];
    if (largest) selected.add(largest.path);
  }

  // 3. Include file with most symbols/imports (most connected)
  if (selected.size < maxFiles) {
    const mostConnected = files.sort(
      (a, b) =>
        b.symbols.defs.size +
        b.symbols.imports.size -
        (a.symbols.defs.size + a.symbols.imports.size)
    )[0];
    if (mostConnected) selected.add(mostConnected.path);
  }

  return Array.from(selected).slice(0, maxFiles);
}

// Simple truncation - no complex AST logic
function simpleTruncation(src: string, maxChars: number): string {
  if (src.length <= maxChars) {
    return src;
  }

  const halfChars = Math.floor((maxChars - 100) / 2);
  return (
    src.slice(0, halfChars) +
    "\n\n// ... [TRUNCATED MIDDLE] ...\n\n" +
    src.slice(-halfChars)
  );
}

// Check if a file is parseable - simplified
function isParseableFile(src: string, filePath: string): boolean {
  if (!src || src.trim().length === 0) {
    return false;
  }

  if (isCriticalFile(filePath)) {
    return true;
  }

  if (src.length > 2_000_000) {
    return false;
  }

  if (src.includes("\0")) {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  const parseableExtensions = [
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".py",
    ".java",
    ".go",
    ".rs",
    ".cpp",
    ".c",
    ".h",
    ".hpp",
    ".php",
    ".rb",
    ".md",
    ".json",
    ".yaml",
    ".yml",
    ".txt",
    ".prisma",
    ".sql",
    ".sh",
    ".bash",
    ".zsh",
    ".bat",
    ".cmd",
    ".ps1",
    ".dockerfile",
  ];

  return parseableExtensions.includes(ext);
}

// Extract symbols using tree-sitter - simplified
async function extractSymbols(
  src: string,
  langSpec: any,
  filePath: string = "unknown"
): Promise<Symbols> {
  const emptySymbols: Symbols = {
    defs: new Set(),
    calls: new Set(),
    imports: new Set(),
  };

  if (!isParseableFile(src, filePath)) {
    return emptySymbols;
  }

  try {
    const tree = await withTimeout(
      Promise.resolve(langSpec.parser.parse(src)),
      5000,
      `Symbol extraction parsing of ${filePath}`
    );

    if (!tree || !tree.rootNode) {
      return emptySymbols;
    }

    const out: Symbols = {
      defs: new Set(),
      calls: new Set(),
      imports: new Set(),
    };

    const format = (n: Parser.SyntaxNode) => {
      const name = src.slice(n.startIndex, n.endIndex);
      const lineStart = n.startPosition.row + 1;
      const lineEnd = n.endPosition.row + 1;
      return `${name} (L${lineStart}-${lineEnd})`;
    };

    // Extract definitions
    try {
      for (const m of langSpec.queryDefs.matches(tree.rootNode)) {
        m.captures.forEach((cap: any) => {
          try {
            out.defs.add(format(cap.node));
          } catch (_e) {
            // Skip individual problematic nodes
          }
        });
      }
    } catch (_error) {
      // Skip defs extraction on error
    }

    // Extract imports
    try {
      for (const m of langSpec.queryImports.matches(tree.rootNode)) {
        m.captures.forEach((cap: any) => {
          try {
            out.imports.add(
              src
                .slice(cap.node.startIndex, cap.node.endIndex)
                .replace(/['"`]/g, "")
            );
          } catch (_e) {
            // Skip individual problematic nodes
          }
        });
      }
    } catch (_error) {
      // Skip imports extraction on error
    }

    return out;
  } catch (error) {
    console.warn(
      `[SHADOW-WIKI] Tree-sitter parse failed for ${filePath}:`,
      error
    );
    return emptySymbols;
  }
}

function symbolsToMarkdown(sym: Symbols): string {
  const md: string[] = [];
  if (sym.imports.size) md.push("**Imports**: " + [...sym.imports].join(", "));
  if (sym.defs.size) md.push("**Defs**: " + [...sym.defs].join(", "));
  return md.join("\n");
}

// Check if a file should be skipped - simplified
function shouldSkipFile(
  filePath: string,
  fileSize?: number
): { skip: boolean; reason?: string } {
  const fileName = path.basename(filePath).toLowerCase();
  const ext = path.extname(filePath).toLowerCase();
  const size = fileSize || 0;

  // NEVER skip README.md files - they provide crucial context
  if (fileName === "readme.md") {
    return { skip: false };
  }
  // Skip binary/media files
  const binaryExtensions = [
    ".bin",
    ".exe",
    ".dmg",
    ".iso",
    ".img",
    ".zip",
    ".tar",
    ".gz",
    ".7z",
    ".rar",
    ".mp4",
    ".mp3",
    ".wav",
    ".avi",
    ".mov",
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
  ];

  if (binaryExtensions.includes(ext)) {
    return { skip: true, reason: `Binary/media file (${ext})` };
  }

  // Skip large data files (but not README files)
  if (size > 1_000_000 && [".sql", ".csv", ".log", ".dat"].includes(ext)) {
    return {
      skip: true,
      reason: `Large data file (${Math.round(size / 1024 / 1024)}MB)`,
    };
  }

  // Skip generated files
  if (
    /\.min\.(js|css)$|bundle\.(js|css)$|vendor\.(js|css)$|\.d\.ts$/.test(
      fileName
    )
  ) {
    return { skip: true, reason: "Generated file" };
  }

  // Skip any file over 50MB (but not README files)
  if (size > 50_000_000) {
    return {
      skip: true,
      reason: `Extremely large file (${Math.round(size / 1024 / 1024)}MB)`,
    };
  }

  return { skip: false };
}

// Check if file should be included based on allowlist
function shouldIncludeFileForShadowWiki(filePath: string): boolean {
  const fileName = path.basename(filePath).toLowerCase();
  const ext = path.extname(filePath).toLowerCase();

  // Skip directories we never want to analyze
  const skipDirectories = [
    "node_modules/",
    ".git/",
    "dist/",
    "build/",
    ".shadow/",
    "coverage/",
    ".nyc_output/",
    "__pycache__/",
    ".pytest_cache/",
    "target/", // Rust
    "bin/",
    "obj/", // C#/.NET
  ];

  if (skipDirectories.some((dir) => filePath.includes(dir))) {
    return false;
  }

  // Always include critical files regardless of extension
  const criticalFiles = [
    "readme.md",
    "claude.md",
    "package.json",
    "tsconfig.json",
    "cargo.toml",
    "pyproject.toml",
    "requirements.txt",
    "dockerfile",
    "docker-compose.yml",
    "makefile",
    ".env.example",
  ];

  if (criticalFiles.includes(fileName)) {
    return true;
  }

  // Allowlist of file extensions we want to analyze
  const allowedExtensions = [
    // Code files
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".d.ts",
    ".py",
    ".pyx",
    ".pyi",
    ".cpp",
    ".cc",
    ".cxx",
    ".c++",
    ".c",
    ".h",
    ".hpp",
    ".hxx",
    ".java",
    ".kt",
    ".scala",
    ".go",
    ".rs",
    ".php",
    ".rb",
    ".swift",
    ".cs",
    ".fs",
    ".vb",
    ".sh",
    ".bash",
    ".zsh",
    ".fish",
    ".ps1",
    ".bat",
    ".cmd",

    // Config/data files
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".xml",
    ".html",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".md",
    ".mdx",
    ".txt",
    ".rst",
    ".sql",
    ".prisma",
    ".graphql",
    ".gql",

    // Build/project files
    ".dockerfile",
    ".containerfile",
    ".gitignore",
    ".gitattributes",
    ".eslintrc",
    ".prettierrc",
    ".editorconfig",
  ];

  return allowedExtensions.includes(ext);
}

// Build directory tree - using ToolExecutor for both local and remote modes
async function buildTree(
  executor: ToolExecutor,
  repoName?: string,
  recursionLimit: number = Number.POSITIVE_INFINITY
): Promise<IndexFile> {
  // Get all files using ToolExecutor
  const recursiveListing = await executor.listDirectoryRecursive(".");

  if (!recursiveListing.success) {
    console.error(
      `[SHADOW-WIKI] Failed to list directory:`,
      recursiveListing.error
    );
    throw new Error(`Failed to list directory: ${recursiveListing.error}`);
  }

  const allFiles = recursiveListing.entries.filter(
    (entry: any) => !entry.isDirectory
  );
  const files: string[] = [];
  let skippedCount = 0;

  for (const fileEntry of allFiles) {
    // Enforce recursion limit early (depth from root based on path parts)
    const depthFromRoot = fileEntry.relativePath.split("/").length - 1;
    if (depthFromRoot > recursionLimit) {
      skippedCount++;
      continue;
    }
    // Check if file should be included
    if (!shouldIncludeFileForShadowWiki(fileEntry.relativePath)) {
      skippedCount++;
      continue;
    }

    // Get file stats for skip logic
    const statsResult = await executor.getFileStats(fileEntry.relativePath);
    const fileSize =
      statsResult.success && statsResult.stats ? statsResult.stats.size : 0;

    const { skip } = shouldSkipFile(fileEntry.relativePath, fileSize);

    if (skip) {
      skippedCount++;
    } else {
      files.push(fileEntry.relativePath);
    }
  }

  if (skippedCount > 0) {
    console.log(`[SHADOW-WIKI] Skipped ${skippedCount} files`);
  }

  const nodes: Record<string, TreeNode> = {};

  let cleanRepoName: string;
  if (repoName) {
    cleanRepoName = repoName.includes("/")
      ? repoName.split("/").pop()!
      : repoName;
  } else {
    cleanRepoName = "workspace"; // Default name since we don't have rootPath anymore
  }

  const rootNode: TreeNode = {
    id: "root",
    name: cleanRepoName,
    absPath: "/workspace", // Standard workspace path
    relPath: ".",
    level: 0,
    children: [],
    files: [],
  };
  nodes[rootNode.id] = rootNode;

  for (const relativePath of files) {
    const parts = relativePath.split("/");
    let curPath = ".";
    let parent = "root";

    for (let d = 0; d < parts.length - 1; d++) {
      curPath = curPath === "." ? parts[d]! : `${curPath}/${parts[d]!}`;
      const nid = toNodeId(curPath);
      if (!nodes[nid]) {
        nodes[nid] = {
          id: nid,
          name: parts[d]!,
          absPath: `/workspace/${curPath}`,
          relPath: curPath,
          level: d + 1,
          children: [],
          files: [],
        };
        nodes[parent]?.children.push(nid);
      }
      parent = nid;
    }

    nodes[parent]?.files.push(relativePath);
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

// Analyze file complexity - simplified
function analyzeFileComplexity(symbols: Symbols, fileSize: number): boolean {
  const defCount = symbols.defs.size;
  const importCount = symbols.imports.size;

  return (
    defCount > 15 || (importCount > 10 && defCount > 5) || fileSize > 10000
  );
}

// Get basic file info - simplified
function getBasicFileInfo(filePath: string, fileSize?: number): string {
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const size = fileSize || 0;

  const fileTypeDescriptions: Record<string, string> = {
    ".js": "JavaScript file",
    ".ts": "TypeScript file",
    ".jsx": "React component (JSX)",
    ".tsx": "React component (TSX)",
    ".py": "Python script",
    ".cpp": "C++ source file",
    ".c": "C source file",
    ".h": "C/C++ header file",
    ".java": "Java class file",
    ".go": "Go source file",
    ".rs": "Rust source file",
    ".php": "PHP script",
    ".rb": "Ruby script",
    ".sql": "SQL script/database file",
    ".json": "JSON configuration/data",
    ".yaml": "YAML configuration",
    ".yml": "YAML configuration",
    ".md": "Markdown documentation",
    ".txt": "Text file",
    ".css": "CSS stylesheet",
    ".html": "HTML template",
    ".env": "Environment variables",
    ".gitignore": "Git ignore rules",
    ".dockerfile": "Docker container config",
    ".sh": "Shell script",
    ".bat": "Batch script",
    ".ps1": "PowerShell script",
  };

  let description =
    fileTypeDescriptions[ext] || `${ext.slice(1).toUpperCase()} file`;

  if (size > 1024) {
    const sizeStr =
      size > 1024 * 1024
        ? `${Math.round((size / 1024 / 1024) * 10) / 10}MB`
        : `${Math.round(size / 1024)}KB`;
    description += ` (${sizeStr})`;
  }

  if (fileName.includes("test") || fileName.includes("spec")) {
    description += " - Test file";
  } else if (fileName.includes("config")) {
    description += " - Configuration";
  } else if (fileName.includes("util") || fileName.includes("helper")) {
    description += " - Utility functions";
  } else if (fileName.includes("component")) {
    description += " - UI component";
  } else if (fileName.includes("service")) {
    description += " - Service layer";
  } else if (fileName.includes("model")) {
    description += " - Data model";
  } else if (fileName.includes("route") || fileName.includes("controller")) {
    description += " - API/routing";
  }

  return description;
}

// Summarize a file - using ToolExecutor for both local and remote modes
async function summarizeFile(
  executor: ToolExecutor,
  rel: string,
  miniModelInstance: LanguageModel,
  skipLLM: boolean = false
): Promise<string | null> {
  let src: string;

  try {
    // Get file stats using executor
    const statsResult = await executor.getFileStats(rel);
    if (!statsResult.success || !statsResult.stats) {
      console.warn(
        `[SHADOW-WIKI] Failed to get stats for ${rel}:`,
        statsResult.error
      );
      return null;
    }

    // Read file content using executor
    const fileResult = await executor.readFile(rel);
    if (!fileResult.success || !fileResult.content) {
      console.warn(`[SHADOW-WIKI] Failed to read ${rel}:`, fileResult.error);
      return null;
    }
    src = fileResult.content;
  } catch (error) {
    console.warn(`[SHADOW-WIKI] Failed to read ${rel}:`, error);
    return null;
  }

  // Skip empty files
  if (!src || src.trim().length === 0) {
    return null;
  }

  const fileExt = path.extname(rel).toLowerCase();
  const dataFileExtensions = [".yaml", ".yml", ".md", ".txt", ".csv", ".xml"];
  const isDataFile = dataFileExtensions.includes(fileExt);

  if (isDataFile && src.trim().length > 0) {
    const emptySymbols: Symbols = {
      defs: new Set(),
      calls: new Set(),
      imports: new Set(),
    };
    return await analyzeFileWithLLM(rel, src, emptySymbols, miniModelInstance);
  }

  if (!isParseableFile(src, rel)) {
    // Binary or unsupported file - don't store
    return null;
  }

  // Only use tree-sitter for supported languages
  let langSpec = null;
  for (const [_key, lang] of Object.entries(LANGUAGES)) {
    if (lang.extensions.includes(fileExt)) {
      langSpec = lang;
      break;
    }
  }

  const symbols = langSpec
    ? await extractSymbols(src, langSpec, rel)
    : {
        defs: new Set<string>(),
        calls: new Set<string>(),
        imports: new Set<string>(),
      };
  const needsDeepAnalysis = analyzeFileComplexity(symbols, src.length);

  if (needsDeepAnalysis && !skipLLM) {
    return await analyzeFileWithLLM(rel, src, symbols, miniModelInstance);
  } else {
    const markdown = symbolsToMarkdown(symbols);
    if (markdown) {
      return markdown;
    } else {
      // No symbols extracted - don't store this file
      return null;
    }
  }
}

// Analyze file with LLM - simplified
async function analyzeFileWithLLM(
  rel: string,
  src: string,
  symbols: Symbols,
  miniModelInstance: LanguageModel
): Promise<string | null> {
  const ext = path.extname(rel).toLowerCase();
  const isDataFile =
    /\.(csv|json|txt|md|png|jpg|jpeg|gif|svg|ico|xlsx|xls|tsv|yaml|yml)$/i.test(
      ext
    );
  const isCritical = isCriticalFile(rel);

  // Skip analysis for extremely large files (over 50k chars ~ 12.5k tokens)
  if (src.length > 50000) {
    return null;
  }

  const maxTokens = 200;

  let truncatedSrc = src;
  if (src.length > maxTokens * 4) {
    truncatedSrc = simpleTruncation(src, maxTokens * 4);
  }

  const wasTruncated = truncatedSrc.length < src.length;

  let systemPrompt = "";
  if (isDataFile) {
    systemPrompt = `Give a 1-3 line description of this data file. Be extremely concise. Only describe what you can actually see in the content. Do not hallucinate or assume functionality not present in the code. File: ${path.basename(rel)}${wasTruncated ? " (content truncated)" : ""}`;
  } else {
    systemPrompt = `Analyze this code file. Be ultra-concise, use bullet points and fragments. ONLY mention what you can actually see in the code - do not hallucinate or assume functionality. Include:
1. Purpose (1 line, based only on visible code)
2. Main symbols with line numbers (only exports and functions you can see)
3. Key dependencies and imports (only those explicitly imported)
4. Critical algorithms/patterns (only if clearly visible in code)
${isCritical ? "5. This is a CRITICAL file - provide extra detail on architecture/config visible in the code" : ""}

IMPORTANT: Only describe the actual tech stack, frameworks, and functionality that you can see in the provided code. Do not make assumptions about the broader system or add information not present in the file.

File: ${path.basename(rel)}${wasTruncated ? " (content was truncated to focus on key sections)" : ""}`;
  }

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: truncatedSrc },
  ];

  try {
    const { text } = await generateText({
      model: miniModelInstance,
      temperature: 0.6,
      messages,
      maxTokens,
      experimental_telemetry: braintrustService.getOperationTelemetry(
        "shadowwiki-file-summary",
        {
          filePath: rel,
          fileExtension: path.extname(rel),
          isCritical,
          fileSize: truncatedSrc.length,
          wasTruncated,
          hasSymbols:
            symbols.defs.size + symbols.calls.size + symbols.imports.size > 0,
          analysisType: "llm-deep-analysis",
        }
      ),
    });

    let result = text?.trim() || "_(no response)_";

    if (isCritical && result !== "_(no response)_") {
      result = `**[CRITICAL FILE]** ${result}`;
    }

    if (wasTruncated && result !== "_(no response)_") {
      result = `${result}\n\n_Note: Large file was truncated for analysis_`;
    }

    return result;
  } catch (err) {
    console.error(`Error analyzing ${rel} with LLM:`, err);
    let fallback = symbolsToMarkdown(symbols);
    if (!fallback) {
      fallback = getBasicFileInfo(rel) + " _(LLM analysis failed)_";
    }
    return isCritical ? `**[CRITICAL FILE]** ${fallback}` : fallback;
  }
}

async function chat(
  messages: Array<CoreMessage>,
  budget: number,
  miniModelInstance: LanguageModel
): Promise<string> {
  const { text } = await generateText({
    model: miniModelInstance,
    temperature: TEMP,
    messages,
    maxTokens: budget,
    experimental_telemetry: braintrustService.getTelemetryConfig({
      operation: "shadowwiki-directory-summary",
      messageCount: messages.length,
      budget,
    }),
  });

  return text?.trim() || "_(no response)_";
}

// Enhanced directory analysis using symbol data
function analyzeDirectoryPatterns(node: TreeNode): string {
  const dirName = node.name.toLowerCase();
  const files = node.files || [];
  const symbolData = (global as any).__shadowWikiSymbolData as Map<
    string,
    { size: number; symbols: Symbols }
  >;

  const directoryPurposes: Record<string, string> = {
    src: "Source code directory",
    lib: "Library/utility functions",
    components: "React/UI components",
    pages: "Page components (Next.js/routing)",
    api: "API endpoints and handlers",
    utils: "Utility functions and helpers",
    services: "Business logic and services",
    hooks: "React hooks",
    context: "React context providers",
    types: "TypeScript type definitions",
    models: "Data models and schemas",
    tests: "Test files",
    test: "Test files",
    __tests__: "Jest test files",
    config: "Configuration files",
    scripts: "Build/deployment scripts",
    assets: "Static assets (images, fonts)",
    public: "Public static files",
    styles: "CSS/styling files",
    docs: "Documentation",
    examples: "Example code",
    vendor: "Third-party vendor files",
    middleware: "Middleware functions",
    routes: "Route definitions",
    controllers: "MVC controllers",
    views: "View templates",
    common: "Common/shared utilities",
    shared: "Shared components/utilities",
    core: "Core functionality",
    helpers: "Helper functions",
    store: "State management (Redux/Zustand)",
    constants: "Application constants",
    data: "Data files",
  };

  // Analyze file extensions and symbols
  const extensions = files.map((f) => path.extname(f).toLowerCase());
  const extensionCounts: Record<string, number> = {};
  extensions.forEach((ext) => {
    if (ext) extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
  });

  // Rich symbol analysis from all files in directory
  let totalDefs = 0;
  let totalImports = 0;
  const majorImports = new Set<string>();
  const functionTypes = new Set<string>();

  files.forEach((filePath) => {
    const data = symbolData?.get(filePath);
    if (data) {
      totalDefs += data.symbols.defs.size;
      totalImports += data.symbols.imports.size;

      // Collect major imports/frameworks
      data.symbols.imports.forEach((imp) => {
        const cleaned = imp.toLowerCase().replace(/['"`]/g, "");
        if (cleaned.includes("react")) majorImports.add("React");
        if (cleaned.includes("express")) majorImports.add("Express");
        if (
          cleaned.includes("fastapi") ||
          cleaned.includes("flask") ||
          cleaned.includes("django")
        )
          majorImports.add("Python Web Framework");
        if (cleaned.includes("numpy") || cleaned.includes("pandas"))
          majorImports.add("Data Science");
        if (
          cleaned.includes("tensorflow") ||
          cleaned.includes("torch") ||
          cleaned.includes("sklearn")
        )
          majorImports.add("ML/AI");
        if (cleaned.includes("prisma") || cleaned.includes("mongoose"))
          majorImports.add("Database ORM");
      });

      // Analyze function patterns
      data.symbols.defs.forEach((def) => {
        if (def.includes("component") || def.includes("Component"))
          functionTypes.add("Components");
        if (
          def.includes("handler") ||
          def.includes("Handler") ||
          def.includes("api")
        )
          functionTypes.add("API Handlers");
        if (
          def.includes("test") ||
          def.includes("Test") ||
          def.includes("spec")
        )
          functionTypes.add("Tests");
        if (def.includes("util") || def.includes("helper"))
          functionTypes.add("Utilities");
      });
    }
  });

  // Build tech stack from extensions + imports
  const techStack: string[] = [];
  if (
    extensionCounts[".tsx"] ||
    extensionCounts[".jsx"] ||
    majorImports.has("React")
  )
    techStack.push("React");
  if (extensionCounts[".ts"]) techStack.push("TypeScript");
  if (extensionCounts[".js"]) techStack.push("JavaScript");
  if (extensionCounts[".py"]) techStack.push("Python");
  if (extensionCounts[".go"]) techStack.push("Go");
  if (extensionCounts[".rs"]) techStack.push("Rust");
  if (extensionCounts[".java"]) techStack.push("Java");

  // Add framework info from imports
  majorImports.forEach((framework) => techStack.push(framework));

  let analysis = directoryPurposes[dirName] || `Directory: ${node.name}`;

  if (techStack.length > 0) {
    analysis += ` (${Array.from(new Set(techStack)).join(", ")})`;
  }

  const fileCount = files.length;
  if (fileCount > 0) {
    analysis += `\n- ${fileCount} files`;
    if (totalDefs > 0) analysis += `, ${totalDefs} definitions`;
    if (totalImports > 0) analysis += `, ${totalImports} imports`;

    const mainExtensions = Object.entries(extensionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([ext, count]) => `${count}${ext}`)
      .join(", ");

    if (mainExtensions) {
      analysis += ` (${mainExtensions})`;
    }
  }

  // Add function type insights
  if (functionTypes.size > 0) {
    analysis += `\n- Contains: ${Array.from(functionTypes).join(", ")}`;
  }

  return analysis;
}

// Summarize directory - simplified
async function summarizeDir(
  node: TreeNode,
  childSummaries: string[],
  miniModelInstance: LanguageModel,
  rootPath?: string
): Promise<string> {
  if (!childSummaries || childSummaries.length === 0) {
    if (rootPath) {
      return analyzeDirectoryPatterns(node);
    }
    return `Empty directory: ${node.relPath}`;
  }

  const meaningfulSummaries = childSummaries.filter(
    (summary) => summary && summary.trim().length > 20
  );

  if (meaningfulSummaries.length < childSummaries.length * 0.3 && rootPath) {
    const patternAnalysis = analyzeDirectoryPatterns(node);
    childSummaries.push(
      `\n### Directory Pattern Analysis:\n${patternAnalysis}`
    );
  }

  const budget = 400;
  const systemPrompt = `Summarize this code directory. Be ultra-concise. ONLY describe what you can see in the provided file summaries - do not hallucinate or assume functionality.

Include only:
1. Main purpose (1 line, based only on visible files)
2. Key components and their roles (only from actual file content)
3. Critical patterns or algorithms (only if visible in files)

Use bullet points, fragments, abbreviations. Only mention tech stack and frameworks that are explicitly visible in the file summaries. Directory: ${node.relPath}`;

  const userContent = childSummaries.join("\n---\n");

  if (!userContent || userContent.trim().length === 0) {
    if (rootPath) {
      const patternContent = analyzeDirectoryPatterns(node);
      if (patternContent && patternContent.trim().length > 0) {
        return patternContent;
      }
    }
    return `Directory: ${node.relPath} - ${node.files?.length || 0} files, ${node.children?.length || 0} subdirectories`;
  }

  if (userContent.trim().length < 20) {
    if (rootPath) {
      const patternContent = analyzeDirectoryPatterns(node);
      if (patternContent && patternContent.trim().length > 0) {
        return `${userContent}\n\n### Additional Context:\n${patternContent}`;
      }
    }
  }

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userContent },
  ];

  return chat(messages, budget, miniModelInstance);
}

// Summarize root - simplified
async function summarizeRoot(
  node: TreeNode,
  childSummaries: string[],
  miniModelInstance: LanguageModel
): Promise<string> {
  if (!childSummaries || childSummaries.length === 0) {
    return `Empty project: ${node.name}`;
  }

  const budget = 800;
  const systemPrompt = `Create a concise architecture overview for ${node.name}. ONLY describe what you can see in the provided directory summaries - do not hallucinate or assume functionality.

Include only the most essential:
1. Core components and their roles (based only on visible directory content)
2. Main data flows between components (only if explicitly visible)
3. Key architectural patterns (only if clearly present in summaries)
4. Tech stack basics (only technologies explicitly mentioned in summaries)

Use bullet points and fragments. Ultra-concise technical descriptions only. Do not make assumptions about the system beyond what is provided.`;

  const userContent = childSummaries.join("\n---\n");

  if (!userContent || userContent.trim().length === 0) {
    return `Project: ${node.name}\n- Empty or unanalyzable repository\n- ${node.children?.length || 0} top-level directories\n- No processable content found`;
  }

  if (userContent.trim().length < 50) {
    const basicInfo = `\n\n### Basic Project Info:\n- Project: ${node.name}\n- Directories: ${node.children?.length || 0}\n- Content: Limited analyzable content`;
    return `${userContent}${basicInfo}`;
  }

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userContent },
  ];

  return chat(messages, budget, miniModelInstance);
}

/**
 * Main function to run Shadow Wiki analysis and store in database
 */
export async function runShadowWiki(
  taskId: string,
  repoFullName: string,
  repoUrl: string,
  userId: string,
  contextOrApiKeys: TaskModelContext | ApiKeys,
  options: {
    concurrency?: number;
    model?: ModelType;
    modelMini?: ModelType;
    recursionLimit?: number;
  }
): Promise<{ codebaseUnderstandingId: string; stats: ProcessingStats }> {
  // Freshness check (24h) and single-run lock
  let haveLock = false;
  try {
    const existing = await prisma.codebaseUnderstanding.findUnique({
      where: { repoFullName },
      select: { id: true, updatedAt: true },
    });
    const isFresh = existing
      ? Date.now() - new Date(existing.updatedAt).getTime() <=
        24 * 60 * 60 * 1000
      : false;

    if (existing && isFresh) {
      await prisma.task.update({
        where: { id: taskId },
        data: { codebaseUnderstandingId: existing.id },
      });
      console.log(
        `[SHADOW-WIKI] Using fresh summary for ${repoFullName}. Skipping regeneration.`
      );
      return {
        codebaseUnderstandingId: existing.id,
        stats: { filesProcessed: 0, directoriesProcessed: 0, totalTokens: 0 },
      };
    }

    haveLock = await tryAcquireRepoLock(repoFullName);
    if (!haveLock) {
      console.log(
        `[SHADOW-WIKI] Another generation in progress for ${repoFullName}, waiting...`
      );
      const start = Date.now();
      const maxWaitMs = 15 * 60 * 1000;
      const pollMs = 2000;
      while (Date.now() - start < maxWaitMs) {
        const ready = await prisma.codebaseUnderstanding.findUnique({
          where: { repoFullName },
          select: { id: true },
        });
        if (ready) {
          await prisma.task.update({
            where: { id: taskId },
            data: { codebaseUnderstandingId: ready.id },
          });
          return {
            codebaseUnderstandingId: ready.id,
            stats: {
              filesProcessed: 0,
              directoriesProcessed: 0,
              totalTokens: 0,
            },
          };
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
      console.warn(
        `[SHADOW-WIKI] Timeout waiting for repo summary for ${repoFullName}; proceeding`
      );
    }
  } catch (e) {
    console.warn(
      `[SHADOW-WIKI] Freshness/lock precheck failed, continuing:`,
      e
    );
  }
  console.log(
    `[SHADOW-WIKI] Initializing codebase analysis for ${repoFullName}`
  );
  console.log(`[SHADOW-WIKI] Task ${taskId} - Repository: ${repoUrl}`);
  console.log(
    `[SHADOW-WIKI] Configuration: concurrency=${options.concurrency || 12}`
  );

  let context: TaskModelContext;
  if (contextOrApiKeys instanceof TaskModelContext) {
    context = contextOrApiKeys;
  } else {
    const defaultModel = contextOrApiKeys.openai
      ? "gpt-4o"
      : "claude-sonnet-4-20250514";
    context = new TaskModelContext(
      taskId,
      defaultModel as ModelType,
      contextOrApiKeys
    );
  }

  let mainModel: ModelType;
  let miniModel: ModelType;

  if (options.model && options.modelMini) {
    mainModel = options.model;
    miniModel = options.modelMini;
  } else {
    mainModel = context.getModelForOperation("pr-gen");
    miniModel = getHardcodedMiniModel(context.getProvider());
  }

  if (!context.validateAccess()) {
    throw new Error(
      "Required API keys not available. Please configure your API keys in settings."
    );
  }

  console.log(
    `[SHADOW-WIKI] Model configuration: main=${mainModel}, mini=${miniModel}`
  );
  console.log(
    `[SHADOW-WIKI] API validation complete - provider=${context.getProvider()}`
  );

  const recursionLimit =
    typeof options.recursionLimit === "number"
      ? options.recursionLimit
      : Number.POSITIVE_INFINITY;
  console.log(
    `[SHADOW-WIKI] Recursion limit: ${Number.isFinite(recursionLimit) ? recursionLimit : "unlimited"}`
  );

  const modelProvider = new ModelProvider();
  const miniModelInstance = modelProvider.getModel(
    miniModel,
    context.getApiKeys()
  );
  const stats: ProcessingStats = {
    filesProcessed: 0,
    directoriesProcessed: 0,
    totalTokens: 0,
  };

  let consecutiveLLMFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 5;

  // Create ToolExecutor for file operations (works in both local and remote modes)
  console.log(`[SHADOW-WIKI] Initializing workspace manager and file executor`);
  const workspaceManager = createWorkspaceManager();
  const executor = await workspaceManager.getExecutor(taskId);

  console.log(`[SHADOW-WIKI] Building directory tree structure`);
  const tree = await buildTree(executor, repoFullName, recursionLimit);

  const fileCache: Record<string, string> = {};
  const allFiles: string[] = [];

  for (const nid in tree.nodes) {
    const node = tree.nodes[nid]!;
    if (node.level <= recursionLimit) {
      for (const rel of node.files || []) {
        allFiles.push(rel);
      }
    }
  }

  console.log(`[SHADOW-WIKI] Discovered ${allFiles.length} files for analysis`);

  // PHASE 1: Fast symbol extraction for ALL files
  console.log(`[SHADOW-WIKI] Phase 1: Fast symbol extraction for all files`);
  const fileData = new Map<
    string,
    { size: number; symbols: Symbols; content?: string }
  >();

  for (const rel of allFiles) {
    try {
      const statsResult = await executor.getFileStats(rel);
      const fileSize =
        statsResult.success && statsResult.stats ? statsResult.stats.size : 0;

      const fileResult = await executor.readFile(rel);
      if (
        !fileResult.success ||
        !fileResult.content ||
        !fileResult.content.trim()
      ) {
        continue; // Skip empty/unreadable files
      }

      const src = fileResult.content;
      const fileExt = path.extname(rel).toLowerCase();

      // Fast symbol extraction
      let symbols: Symbols = {
        defs: new Set(),
        calls: new Set(),
        imports: new Set(),
      };
      for (const [_key, lang] of Object.entries(LANGUAGES)) {
        if (lang.extensions.includes(fileExt)) {
          symbols = await extractSymbols(src, lang, rel);
          break;
        }
      }

      fileData.set(rel, { size: fileSize, symbols, content: src });
    } catch (error) {
      console.warn(
        `[SHADOW-WIKI] Failed to extract symbols from ${rel}:`,
        error
      );
    }
  }

  console.log(
    `[SHADOW-WIKI] Symbol extraction complete: ${fileData.size}/${allFiles.length} files processed`
  );

  // PHASE 2: Smart file selection for LLM analysis
  console.log(
    `[SHADOW-WIKI] Phase 2: Smart file selection for detailed analysis`
  );

  const filesToAnalyze = new Set<string>();
  const filesByDirectory = new Map<
    string,
    Array<{ path: string; size: number; symbols: Symbols }>
  >();

  // Group files by directory
  for (const [filePath, data] of fileData.entries()) {
    const dir = path.dirname(filePath);
    if (!filesByDirectory.has(dir)) {
      filesByDirectory.set(dir, []);
    }
    filesByDirectory
      .get(dir)!
      .push({ path: filePath, size: data.size, symbols: data.symbols });
  }

  // Select files for analysis
  for (const filePath of fileData.keys()) {
    // Always analyze critical files
    if (isCriticalFile(filePath)) {
      filesToAnalyze.add(filePath);
    }
  }

  // Add representative files from each directory
  for (const [, files] of filesByDirectory.entries()) {
    if (files.length > 3) {
      // Only sample if directory has many files
      const representatives = selectRepresentativeFiles(files, 2);
      representatives.forEach((f) => filesToAnalyze.add(f));
    } else {
      // Analyze all files in small directories
      files.forEach((f) => filesToAnalyze.add(f.path));
    }
  }

  console.log(
    `[SHADOW-WIKI] Selected ${filesToAnalyze.size} files for LLM analysis (${Math.round((filesToAnalyze.size / allFiles.length) * 100)}% of total)`
  );

  // PHASE 3: LLM analysis of selected files
  const BATCH_SIZE = 10;
  const selectedFiles = Array.from(filesToAnalyze);

  for (let i = 0; i < selectedFiles.length; i += BATCH_SIZE) {
    const batch = selectedFiles.slice(i, i + BATCH_SIZE);
    const skipLLM = consecutiveLLMFailures >= MAX_CONSECUTIVE_FAILURES;

    const batchTasks = batch.map(async (rel) => {
      try {
        const data = fileData.get(rel);
        if (!data?.content) return;

        const summary = await summarizeFile(
          executor,
          rel,
          miniModelInstance,
          skipLLM
        );

        if (summary !== null) {
          fileCache[rel] = summary;
          stats.filesProcessed++;
        }
        if (!skipLLM) consecutiveLLMFailures = 0;
      } catch (error) {
        console.error(`[SHADOW-WIKI] Failed to process ${rel}:`, error);
        if (!skipLLM) consecutiveLLMFailures++;
      }
    });

    await Promise.all(batchTasks);
    console.log(
      `[SHADOW-WIKI] Processed ${Math.min(i + BATCH_SIZE, selectedFiles.length)}/${selectedFiles.length} selected files`
    );
  }

  // Store symbol data for directory analysis
  (global as any).__shadowWikiSymbolData = fileData;

  console.log(
    `[SHADOW-WIKI] File analysis complete - starting directory summarization phase`
  );
  const nodesByDepth = Object.keys(tree.nodes)
    .filter((id) => tree.nodes[id]!.level <= recursionLimit)
    .sort((a, b) => tree.nodes[b]!.level - tree.nodes[a]!.level);
  console.log(
    `[SHADOW-WIKI] Processing ${nodesByDepth.length - 1} directories (excluding root)`
  );

  for (const nid of nodesByDepth) {
    if (nid === "root") continue;
    const node = tree.nodes[nid]!;
    if (node.level > recursionLimit) continue;

    const blocks: string[] = [];

    if (node.level < recursionLimit) {
      node.children.forEach((cid) => {
        const c = tree.nodes[cid]!;
        if (c.level <= recursionLimit) {
          blocks.push(`## Directory: ${c.name}\n${c.summary || "_missing_"}`);
        }
      });
    }

    for (const filePath of node.files) {
      const fileName = path.basename(filePath);
      const fileContent = fileCache[filePath];

      // Only include files that were successfully processed and stored
      if (fileContent) {
        const contentPreview =
          fileContent.split("\n\n")[0]?.trim() ||
          fileContent.trim() ||
          "_(no content)_";
        blocks.push(`### ${fileName}\n${contentPreview}`);
      }
    }

    node.summary = await summarizeDir(
      node,
      blocks,
      miniModelInstance,
      "/workspace" // Use standard workspace path
    );
    stats.directoriesProcessed++;
  }

  const root = tree.nodes[tree.root]!;
  const topBlocks = root.children
    .map((cid) => tree.nodes[cid]!)
    .filter((c) => c.level <= recursionLimit)
    .map((c) => `## ${c.name}\n${c.summary || "_missing_"}`);

  console.log(`[SHADOW-WIKI] Generating root-level project summary`);
  root.summary = await summarizeRoot(root, topBlocks, miniModelInstance);

  console.log(`[SHADOW-WIKI] Preparing summary content for database storage`);
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
  const contentJson: Prisma.InputJsonValue = JSON.parse(
    JSON.stringify(summaryContent)
  );

  console.log(`[SHADOW-WIKI] Storing analysis results in database`);
  // Use shared storage helper to create/update and link to task
  const storage = new CodebaseUnderstandingStorage(taskId);
  const codebaseUnderstandingId = await storage.storeSummary(
    repoFullName,
    repoUrl,
    contentJson,
    userId,
    { forceUpdate: true }
  );

  console.log(
    `[SHADOW-WIKI] Analysis complete! Summary stored with ID: ${codebaseUnderstandingId}`
  );
  console.log(
    `[SHADOW-WIKI] Final statistics - files=${stats.filesProcessed}, directories=${stats.directoriesProcessed}, totalTokens=${stats.totalTokens}`
  );

  if (haveLock) {
    await releaseRepoLock(repoFullName);
  }
  return { codebaseUnderstandingId, stats };
}
