// Constants for file size limits
export const FILE_SIZE_LIMITS = {
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024, // 10MB - single limit for both memory and client
} as const;

// Language mapping for editor syntax highlighting
export const LANGUAGE_MAP = {
  tsx: "tsx",
  ts: "typescript",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  md: "markdown",
  css: "css",
  scss: "css",
  sass: "css",
  less: "css",
  html: "html",
  py: "python",
  go: "go",
  java: "java",
  rs: "rust",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  c: "c",
  h: "cpp",
} as const;

export type SupportedExtension = keyof typeof LANGUAGE_MAP;
export type EditorLanguage = typeof LANGUAGE_MAP[SupportedExtension];

// Supported extensions as a Set for fast lookup
export const SUPPORTED_EXTENSIONS = new Set<string>(Object.keys(LANGUAGE_MAP));

// Function to get editor language from file path (for editor component)
export const getLanguageFromPath = (path: string): EditorLanguage | "plaintext" => {
  const extension = path.split(".").pop()?.toLowerCase() as SupportedExtension;
  return LANGUAGE_MAP[extension] || "plaintext";
};

// Function to check if file extension is supported (for files.ts)
export const isSupportedFileType = (path: string): boolean => {
  const extension = path.split(".").pop()?.toLowerCase();
  if (!extension) return false;

  // Also support README files without extension
  const fileName = path.split("/").pop()?.toLowerCase() || "";
  if (/^readme/i.test(fileName)) return true;

  return SUPPORTED_EXTENSIONS.has(extension);
};