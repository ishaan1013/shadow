import fg from "fast-glob";
import { createHash } from "crypto";
import { readFileSync, statSync } from "fs";
import path from "path";
import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import { CodebaseUnderstandingStorage } from "./db-storage";
import TS from "tree-sitter-typescript";
import { ModelProvider } from "@/agent/llm/models/model-provider";
import { ModelType, ApiKeys } from "@repo/types";
import { CoreMessage, generateText, LanguageModel } from "ai";
import { TaskModelContext } from "@/services/task-model-context";
import { braintrustService } from "../../agent/llm/observability/braintrust-service";

// Configuration
const TEMP = 0.15;

/**
 * Get hardcoded mini model for each provider
 */
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

// Tree-sitter setup - simplified to just JS/TS
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
};

const sha1 = (data: string) => createHash("sha1").update(data).digest("hex");

// Simple timeout utility
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
  ];

  const criticalPatterns = [
    /\/index\.(ts|js|tsx|jsx)$/,
    /\/main\.(ts|js|tsx|jsx)$/,
    /\/app\.(ts|js|tsx|jsx)$/,
    /\/server\.(ts|js)$/,
    /\/client\.(ts|js)$/,
    /types?\.(ts|d\.ts)$/,
    /config\.(ts|js|json)$/,
    /schema\.(ts|js|prisma|sql)$/,
  ];

  return (
    criticalFiles.includes(fileName) ||
    criticalPatterns.some((pattern) => pattern.test(relativePath))
  );
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
    } catch (error) {
      console.debug(`[SHADOW-WIKI] Defs query failed for ${filePath}:`, error);
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
    } catch (error) {
      console.debug(
        `[SHADOW-WIKI] Imports query failed for ${filePath}:`,
        error
      );
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

// Build directory tree - simplified
async function buildTree(
  rootPath: string,
  repoName?: string
): Promise<IndexFile> {
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
    "**/coverage/**",
    "**/.nyc_output/**",
  ];

  const entries = await fg(["*", "*/*"], {
    cwd: rootPath,
    absolute: true,
    dot: true,
    ignore,
  });

  const allFiles = entries.filter((p) => statSync(p).isFile());
  const files: string[] = [];
  let skippedCount = 0;

  for (const filePath of allFiles) {
    const stats = statSync(filePath);
    const { skip, reason } = shouldSkipFile(filePath, stats.size);

    if (skip) {
      console.debug(
        `[SHADOW-WIKI] Skipping ${path.relative(rootPath, filePath)}: ${reason}`
      );
      skippedCount++;
    } else {
      files.push(filePath);
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
    cleanRepoName = path.basename(rootPath);
  }

  const rootNode: TreeNode = {
    id: "root",
    name: cleanRepoName,
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

// Summarize a file - simplified
async function summarizeFile(
  rootPath: string,
  rel: string,
  miniModelInstance: LanguageModel,
  skipLLM: boolean = false
): Promise<string> {
  const abs = path.join(rootPath, rel);

  let src: string;
  let fileSize: number = 0;

  try {
    const stats = statSync(abs);
    fileSize = stats.size;
    src = readFileSync(abs, "utf8");
  } catch (error) {
    console.warn(`[SHADOW-WIKI] Failed to read ${rel}:`, error);
    try {
      const stats = statSync(abs);
      return getBasicFileInfo(rel, stats.size) + " _(unreadable)_";
    } catch {
      return getBasicFileInfo(rel, 0) + " _(unreadable)_";
    }
  }

  const fileExt = path.extname(rel).toLowerCase();
  const dataFileExtensions = [
    ".json",
    ".yaml",
    ".yml",
    ".md",
    ".txt",
    ".csv",
    ".xml",
  ];
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
    return "_(binary or unsupported file type)_";
  }

  let langSpec = LANGUAGES.js;
  for (const [_key, lang] of Object.entries(LANGUAGES)) {
    if (lang.extensions.includes(fileExt)) {
      langSpec = lang;
      break;
    }
  }

  const symbols = await extractSymbols(src, langSpec, rel);
  const needsDeepAnalysis = analyzeFileComplexity(symbols, src.length);

  if (needsDeepAnalysis && !skipLLM) {
    return await analyzeFileWithLLM(rel, src, symbols, miniModelInstance);
  } else {
    const markdown = symbolsToMarkdown(symbols);
    if (markdown) {
      return markdown;
    } else {
      return getBasicFileInfo(rel, fileSize) + " _(no symbols extracted)_";
    }
  }
}

// Analyze file with LLM - simplified
async function analyzeFileWithLLM(
  rel: string,
  src: string,
  symbols: Symbols,
  miniModelInstance: LanguageModel
): Promise<string> {
  const ext = path.extname(rel).toLowerCase();
  const isDataFile =
    /\.(csv|json|txt|md|png|jpg|jpeg|gif|svg|ico|xlsx|xls|tsv|yaml|yml)$/i.test(
      ext
    );
  const isCritical = isCriticalFile(rel);

  // Skip analysis for extremely large files (over 50k chars ~ 12.5k tokens)
  if (src.length > 50000) {
    return `Large file: ${path.basename(rel)} (${Math.round(src.length / 1000)}KB) - skipped analysis due to size`;
  }

  const maxTokens = isCritical ? 15000 : isDataFile ? 4000 : 8000;

  let truncatedSrc = src;
  if (src.length > maxTokens * 4) {
    truncatedSrc = simpleTruncation(src, maxTokens * 4);
  }

  const wasTruncated = truncatedSrc.length < src.length;

  let systemPrompt = "";
  if (isDataFile) {
    systemPrompt = `Give a 1-3 line description of this data file. Be extremely concise. File: ${path.basename(rel)}${wasTruncated ? " (content truncated)" : ""}`;
  } else {
    systemPrompt = `Analyze this code file. Be ultra-concise, use bullet points and fragments. Include:
1. Purpose (1 line)
2. Main symbols with line numbers (focus on exports and key functions)
3. Key dependencies and imports
4. Critical algorithms/patterns (if any)
${isCritical ? "5. This is a CRITICAL file - provide extra detail on architecture/config" : ""}

File: ${path.basename(rel)}${wasTruncated ? " (content was truncated to focus on key sections)" : ""}`;
  }

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: truncatedSrc },
  ];

  try {
    const { text } = await withTimeout(
      generateText({
        model: miniModelInstance,
        temperature: 0.6,
        messages,
        maxTokens: isCritical ? 3000 : 2048,
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
      }),
      60000,
      `LLM analysis of ${rel}`
    );

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

// LLM chat function - simplified
async function chat(
  messages: Array<CoreMessage>,
  budget: number,
  mainModelInstance: LanguageModel
): Promise<string> {
  const { text } = await withTimeout(
    generateText({
      model: mainModelInstance,
      temperature: TEMP,
      messages,
      maxTokens: budget,
      experimental_telemetry: braintrustService.getTelemetryConfig({
        operation: "shadowwiki-directory-summary",
        messageCount: messages.length,
        budget,
      }),
    }),
    45000,
    "Directory/root summary generation"
  );

  return text?.trim() || "_(no response)_";
}

// Simple directory analysis - no complex pattern matching
function analyzeDirectoryPatterns(node: TreeNode): string {
  const dirName = node.name.toLowerCase();
  const files = node.files || [];

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

  const extensions = files.map((f) => path.extname(f).toLowerCase());
  const extensionCounts: Record<string, number> = {};
  extensions.forEach((ext) => {
    if (ext) extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
  });

  const techStack: string[] = [];
  if (extensionCounts[".tsx"] || extensionCounts[".jsx"])
    techStack.push("React");
  if (extensionCounts[".ts"]) techStack.push("TypeScript");
  if (extensionCounts[".js"]) techStack.push("JavaScript");
  if (extensionCounts[".py"]) techStack.push("Python");
  if (
    extensionCounts[".cpp"] ||
    extensionCounts[".cc"] ||
    extensionCounts[".h"]
  )
    techStack.push("C++");
  if (extensionCounts[".java"]) techStack.push("Java");
  if (extensionCounts[".go"]) techStack.push("Go");
  if (extensionCounts[".rs"]) techStack.push("Rust");
  if (extensionCounts[".php"]) techStack.push("PHP");
  if (extensionCounts[".rb"]) techStack.push("Ruby");
  if (extensionCounts[".sql"]) techStack.push("SQL");
  if (extensionCounts[".css"] || extensionCounts[".scss"])
    techStack.push("Styles");

  let analysis = directoryPurposes[dirName] || `Directory: ${node.name}`;

  if (techStack.length > 0) {
    analysis += ` (${techStack.join(", ")})`;
  }

  const fileCount = files.length;
  if (fileCount > 0) {
    analysis += `\n- ${fileCount} files`;

    const mainExtensions = Object.entries(extensionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([ext, count]) => `${count}${ext}`)
      .join(", ");

    if (mainExtensions) {
      analysis += ` (${mainExtensions})`;
    }
  }

  if (files.length > 0) {
    const sampleFiles = files.slice(0, 3).map((f) => path.basename(f));
    analysis += `\n- Key files: ${sampleFiles.join(", ")}${files.length > 3 ? "..." : ""}`;
  }

  return analysis;
}

// Summarize directory - simplified
async function summarizeDir(
  node: TreeNode,
  childSummaries: string[],
  mainModelInstance: LanguageModel,
  rootPath?: string
): Promise<string> {
  if (!childSummaries || childSummaries.length === 0) {
    if (rootPath) {
      return analyzeDirectoryPatterns(node);
    }
    return `Empty directory: ${node.relPath}`;
  }

  const meaningfulSummaries = childSummaries.filter(
    (summary) =>
      summary &&
      !summary.includes("_(no symbols found)_") &&
      !summary.includes("_(no response)_") &&
      !summary.includes("_(binary or unsupported file type)_") &&
      !summary.includes("_(unreadable file)_") &&
      summary.trim().length > 20
  );

  if (meaningfulSummaries.length < childSummaries.length * 0.3 && rootPath) {
    const patternAnalysis = analyzeDirectoryPatterns(node);
    childSummaries.push(
      `\n### Directory Pattern Analysis:\n${patternAnalysis}`
    );
  }

  const budget = Math.min(800, 200 + childSummaries.length * 40);
  const systemPrompt = `Summarize this code directory. Be ultra-concise.

Include only:
1. Main purpose (1 line)
2. Key components and their roles
3. Critical patterns or algorithms

Use bullet points, fragments, abbreviations. Directory: ${node.relPath}`;

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

  return chat(messages, budget, mainModelInstance);
}

// Summarize root - simplified
async function summarizeRoot(
  node: TreeNode,
  childSummaries: string[],
  mainModelInstance: LanguageModel
): Promise<string> {
  if (!childSummaries || childSummaries.length === 0) {
    return `Empty project: ${node.name}`;
  }

  const budget = Math.min(500, 150 + childSummaries.length * 30);
  const systemPrompt = `Create a concise architecture overview for ${node.name}.

Include only the most essential:
1. Core components and their roles (very brief)
2. Main data flows between components
3. Key architectural patterns
4. Tech stack basics

Use bullet points and fragments. Ultra-concise technical descriptions only.`;

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

  return chat(messages, budget, mainModelInstance);
}

/**
 * Main function to run Shadow Wiki analysis and store in database
 */
export async function runShadowWiki(
  repoPath: string,
  taskId: string,
  repoFullName: string,
  repoUrl: string,
  userId: string,
  contextOrApiKeys: TaskModelContext | ApiKeys,
  options: {
    concurrency?: number;
    model?: ModelType;
    modelMini?: ModelType;
  }
): Promise<{ codebaseUnderstandingId: string; stats: ProcessingStats }> {
  console.log(`[SHADOW-WIKI] Analyzing ${repoPath} for task ${taskId}`);

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
    `[SHADOW-WIKI] Using models: ${mainModel} (main), ${miniModel} (mini)`
  );

  const modelProvider = new ModelProvider();
  const miniModelInstance = modelProvider.getModel(
    miniModel,
    context.getApiKeys()
  );
  const mainModelInstance = modelProvider.getModel(
    mainModel,
    context.getApiKeys()
  );
  const stats: ProcessingStats = {
    filesProcessed: 0,
    directoriesProcessed: 0,
    totalTokens: 0,
  };

  let consecutiveLLMFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 5;

  const tree = await buildTree(repoPath, repoFullName);

  const fileCache: Record<string, string> = {};
  const allFiles: string[] = [];

  for (const nid in tree.nodes) {
    const node = tree.nodes[nid]!;
    for (const rel of node.files || []) {
      allFiles.push(rel);
    }
  }

  console.log(`[SHADOW-WIKI] Processing ${allFiles.length} files in batches`);

  // Dynamic batch size based on total files to prevent overwhelming large codebases
  const BATCH_SIZE = Math.max(
    10,
    Math.min(50, Math.ceil(allFiles.length / 50))
  );
  console.log(`[SHADOW-WIKI] Using batch size: ${BATCH_SIZE}`);

  for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
    const batch = allFiles.slice(i, i + BATCH_SIZE);
    const skipLLM = consecutiveLLMFailures >= MAX_CONSECUTIVE_FAILURES;
    if (skipLLM && i === 0) {
      console.warn(
        `[SHADOW-WIKI] Too many consecutive LLM failures (${consecutiveLLMFailures}), switching to symbol-only analysis`
      );
    }

    const batchTasks = batch.map(async (rel) => {
      try {
        const summary = await summarizeFile(
          repoPath,
          rel,
          miniModelInstance,
          skipLLM
        );
        fileCache[rel] = summary;
        stats.filesProcessed++;
        if (!skipLLM) consecutiveLLMFailures = 0; // Reset on success
      } catch (error) {
        console.error(`[SHADOW-WIKI] Failed to process ${rel}:`, error);
        if (!skipLLM) consecutiveLLMFailures++;
        fileCache[rel] = getBasicFileInfo(rel) + " _(processing failed)_";
        stats.filesProcessed++;
      }
    });

    await Promise.all(batchTasks);
    console.log(
      `[SHADOW-WIKI] Processed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allFiles.length / BATCH_SIZE)} (${stats.filesProcessed}/${allFiles.length} files)`
    );

    if (i + BATCH_SIZE < allFiles.length) {
      // Dynamic delay based on codebase size - smaller for larger codebases
      const delay =
        allFiles.length > 1000 ? 200 : allFiles.length > 500 ? 350 : 500;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  const nodesByDepth = Object.keys(tree.nodes).sort(
    (a, b) => tree.nodes[b]!.level - tree.nodes[a]!.level
  );

  for (const nid of nodesByDepth) {
    if (nid === "root") continue;
    const node = tree.nodes[nid]!;

    const blocks: string[] = [];

    node.children.forEach((cid) => {
      const c = tree.nodes[cid]!;
      blocks.push(`## Directory: ${c.name}\n${c.summary || "_missing_"}`);
    });

    for (const filePath of node.files) {
      const fileName = path.basename(filePath);
      let fileContent = fileCache[filePath];

      if (!fileContent || fileContent.trim().length === 0) {
        console.warn(
          `[SHADOW-WIKI] Missing content for ${filePath}, using fallback`
        );
        fileContent = getBasicFileInfo(filePath) + " _(content unavailable)_";
      }

      const contentPreview =
        fileContent.split("\n\n")[0]?.trim() ||
        fileContent.trim() ||
        "_(no content)_";
      blocks.push(`### ${fileName}\n${contentPreview}`);
    }

    node.summary = await summarizeDir(
      node,
      blocks,
      mainModelInstance,
      repoPath
    );
    stats.directoriesProcessed++;
  }

  const root = tree.nodes[tree.root]!;
  const topBlocks = root.children.map((cid) => {
    const c = tree.nodes[cid]!;
    return `## ${c.name}\n${c.summary || "_missing_"}`;
  });

  root.summary = await summarizeRoot(root, topBlocks, mainModelInstance);

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

  const storage = new CodebaseUnderstandingStorage(taskId);
  const codebaseUnderstandingId = await storage.storeSummary(
    repoFullName,
    repoUrl,
    summaryContent,
    userId
  );

  console.log(
    `[SHADOW-WIKI] Complete: ${stats.filesProcessed} files, ${stats.directoriesProcessed} dirs`
  );

  return { codebaseUnderstandingId, stats };
}
