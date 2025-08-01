import { loader } from "@monaco-editor/react";
import { shikiToMonaco } from "@shikijs/monaco";
import {
  BundledLanguage,
  createHighlighter,
  createJavaScriptRegexEngine,
  ThemeInput,
  type Highlighter,
} from "shiki";
import theme from "./theme.json";

// Language must satisfy Shiki-supported languages
// https://shiki.style/languages
export const LANGUAGES: { id: BundledLanguage }[] = [
  { id: "typescript" },
  { id: "javascript" },
  { id: "tsx" },
  { id: "ts" },
  { id: "jsx" },
  { id: "js" },
  { id: "json" },
  { id: "markdown" },
  { id: "css" },
  { id: "html" },
  { id: "c" },
  { id: "cpp" },
  { id: "python" },
  { id: "go" },
  { id: "rust" },
  { id: "java" },
];

export const jsEngine = createJavaScriptRegexEngine({ forgiving: true });

let highlighterPromise: Promise<Highlighter> | null = null;
let monacoPatched = false;

export async function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [theme as unknown as ThemeInput, "github-dark"],
      langs: LANGUAGES.map((lang) => lang.id),
      engine: jsEngine,
    });
  }
  return highlighterPromise;
}

export async function patchMonacoWithShiki() {
  if (monacoPatched) return;

  try {
    const monaco = await loader.init();

    // Register languages
    LANGUAGES.forEach((lang) => {
      if (
        !monaco.languages
          .getLanguages()
          .find((l: { id: string }) => l.id === lang.id)
      ) {
        monaco.languages.register(lang);
      }
    });

    // Define the theme
    monaco.editor.defineTheme("vesper", {
      base: "vs",
      inherit: false,
      rules: [],
      colors: theme.colors,
    });

    // Set as default theme
    monaco.editor.setTheme("vesper");

    // Apply Shiki highlighting
    const highlighter = await getHighlighter();
    shikiToMonaco(highlighter, monaco);

    monacoPatched = true;
    return true;
  } catch (error) {
    console.error("Failed to initialize Shiki with Monaco:", error);
    return false;
  }
}
