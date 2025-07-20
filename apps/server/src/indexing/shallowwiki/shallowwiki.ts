#!/usr/bin/env ts-node

/*─────────────────────────────────────────────────────────────────────────────
  deepwiki_llm.ts – Minimal “LLM-First” DeepWiki generator
  ---------------------------------------------------------------------------
  • Rely on the language model to decide taxonomy, risks, diagrams, etc.
  • Script only assembles context + simple heuristics for snippet selection.
  • Outputs Markdown files only.
─────────────────────────────────────────────────────────────────────────────*/

import fs from "fs";
import path from "path";
import glob from "fast-glob";
import readline from "readline";
import { OpenAI } from "openai";
import chalk from "chalk";

// ───────── configuration ────────────────────────────────────────────────────
const ROOT = path.resolve(process.argv[2] || ".");
const OUT_DIR = path.join(ROOT, ".shadow");
const MAX_FILE_BYTES = 80_000;        // read at most 80 KB per file
const MAX_SNIPPET_CHARS = 2_000;      // per file snippet limit in context
const MAX_GLOBAL_CHARS = 120_000;     // overall context cap (will crop)
const MODEL = process.env.MODEL || "gpt-4o-mini"; // override as needed

// ignore rules similar to .gitignore common folders
const IGNORE_GLOBS = [
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
  "**/*.min.*",
  "**/*.map",
  "**/*.woff*",
  "**/*.eot",
  "**/*.class",
  "**/*.exe",
];

// ───────── helper functions ─────────────────────────────────────────────────
function bold(s: string) {
  return chalk.bold.cyan(s);
}

function readSnippets(absPath: string): string {
  const buf = fs.readFileSync(absPath);
  if (buf.length === 0) return "";
  if (buf.length > MAX_FILE_BYTES) return ""; // skip huge binaries / packs

  const content = buf.toString("utf8");
  const lines = content.split(/\r?\n/);
  // take first 20 lines + 20 around middle of file
  const start = lines.slice(0, 20).join("\n");
  const midIndex = Math.floor(lines.length / 2);
  const mid = lines.slice(Math.max(0, midIndex - 10), midIndex + 10).join("\n");
  let snippet = start;
  if (mid && mid !== start) snippet += "\n...\n" + mid;
  if (snippet.length > MAX_SNIPPET_CHARS)
    snippet = snippet.slice(0, MAX_SNIPPET_CHARS);
  return snippet;
}

async function promptYesNo(question: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<boolean>((resolve) => {
    rl.question(question + " (y/N) ", (ans) => {
      rl.close();
      resolve(/^y(es)?$/i.test(ans.trim()));
    });
  });
}

// ───────── openai wrapper ───────────────────────────────────────────────────
const openai = new OpenAI();

async function chat(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  expectJson = false,
) {
  const res = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    messages,
    ...(expectJson ? { response_format: { type: "json_object" as const } } : {}),
  });
  return res.choices[0]?.message?.content?.trim() || "";
}

// ───────── main generation logic ────────────────────────────────────────────
(async () => {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY env var not set");
    process.exit(1);
  }
  console.log(
    bold(`📚 DeepWiki-LLM: scanning ${ROOT} … (this may take a moment)`),
  );

  const entries = await glob("**/*", {
    cwd: ROOT,
    absolute: true,
    dot: true,
    ignore: IGNORE_GLOBS,
  });

  const fileMeta: { rel: string; snippet: string }[] = [];
  for (const abs of entries) {
    if (!fs.statSync(abs).isFile()) continue;
    const rel = path.relative(ROOT, abs);
    const snippet = readSnippets(abs);
    fileMeta.push({ rel, snippet });
  }

  /** Manifest text the LLM will see */
  let manifest = "# Repository Manifest\n\n";
  manifest +=
    "| File | Size (bytes) |\n|------|--------------|\n" +
    fileMeta
      .map((f) => {
        const size = fs.statSync(path.join(ROOT, f.rel)).size;
        return `| ${f.rel} | ${size} |`;
      })
      .join("\n") +
    "\n";

  /** Concatenate snippets – truncated to MAX_GLOBAL_CHARS */
  let allSnips = "";
  for (const f of fileMeta) {
    const header = `\n// ===== ${f.rel} =====\n`;
    allSnips += header + f.snippet + "\n";
    if (allSnips.length > MAX_GLOBAL_CHARS) break;
  }

  // ───── 1️⃣ root prompt – ask model to decide wiki structure ──────────────
  console.log(bold("🧠  Step 1: generating TOC & overview via LLM…"));
  const tocPrompt: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        `You are DeepWiki-LLM, an expert at generating concise, hierarchical Markdown docs for a codebase.\n` +
        `Rules:\n` +
        ` • Decide the best conceptual TOC (section names). Avoid generic 'Misc'.\n` +
        ` • Output in valid JSON with keys: overview_md (string) and sections (array of {id, title, file_globs}).\n` +
        ` • Each section’s file_globs describes the files most relevant to that section (glob or comma-sep rel paths).\n` +
        ` • Keep overview < 350 tokens.\n`,
    },
    {
      role: "user",
      content:
        manifest +
        "\n\n## CODE SNIPPETS (truncated):\n```txt\n" +
        allSnips +
        "\n```",
    },
  ];

  const tocJsonRaw = await chat(tocPrompt, true);
  let toc: {
    overview_md: string;
    sections: { id: string; title: string; file_globs: string }[];
  };

  try {
    toc = JSON.parse(tocJsonRaw);
  } catch (e) {
    console.error("❌ Failed to parse LLM JSON; content was:\n", tocJsonRaw);
    process.exit(1);
  }

  console.log(bold("📑  Sections decided by LLM:"));
  toc.sections.forEach((s, i) =>
    console.log(`  ${i + 1}. ${s.title}  [${s.file_globs}]`),
  );

  // Ask confirmation to proceed (optional UX)
  const cont = await promptYesNo("Proceed to generate wiki with these sections?");
  if (!cont) process.exit(0);

  // ensure output dir
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // write overview
  fs.writeFileSync(
    path.join(OUT_DIR, "00_OVERVIEW.md"),
    `> Generated: ${new Date().toISOString()} • Model: ${MODEL}\n\n` +
      toc.overview_md.trim() +
      "\n",
  );
  console.log(bold("✅  Wrote 00_OVERVIEW.md"));

  // ───── 2️⃣ per-section generation ───────────────────────────────────────
  for (const sec of toc.sections) {
    // resolve globs to file list
    const matchedFiles = await glob(
      sec.file_globs.split(/[,;]/).map((g) => g.trim()),
      { cwd: ROOT, absolute: true },
    );

    let context = "";
    matchedFiles.forEach((mf) => {
      const rel = path.relative(ROOT, mf);
      const snip =
        fileMeta.find((m) => m.rel === rel)?.snippet || readSnippets(mf);
      context += `\n// >>> ${rel}\n${snip}\n`;
    });

    // Fallback if model globbed too broadly:
    if (!context.trim()) {
      context =
        "\n(No specific snippets matched; rely on manifest above for context.)";
    }

    console.log(bold(`🧠  Generating section «${sec.title}»…`));
    const secPrompt: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content:
          `You are DeepWiki-LLM.\n` +
          `Write a **single Markdown document** for the section titled "${sec.title}".\n` +
          `Expected headings inside:\n` +
          `# ${sec.title}\n` +
          `## Purpose  (brief)\n` +
          `## Details  (bullet or paragraphs)\n` +
          `## Relevant Files  (list)\n` +
          `## Further Reading  (if any links / RFC / spec else omit)\n` +
          `Keep total length < 300 tokens. Reference code identifiers as \`code\` spans. Do not invent APIs.\n`,
      },
      {
        role: "user",
        content:
          manifest +
          "\n\n### SNIPPETS SELECTED\n```txt\n" +
          context.slice(0, MAX_GLOBAL_CHARS) +
          "\n```\n",
      },
    ];

    const md = await chat(secPrompt);
    const fname =
      sec.id
        .replace(/[^a-z0-9\-]+/gi, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase() + ".md";
    fs.writeFileSync(path.join(OUT_DIR, fname), md.trim() + "\n");
    console.log(bold(`✅  Wrote ${fname}`));
  }

  console.log(
    bold(
      "\n🎉  DeepWiki-LLM generation complete. Explore docs at:",
    ),
    OUT_DIR,
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
