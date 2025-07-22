import fs from "fs";
import path from "path";
import chalk from "chalk";
import fg from "fast-glob";
import ignore from "ignore";
import readline from "readline";
import { OpenAI } from "openai";

/*────────── config you might tweak ─────────────────────────────────────────*/
const ROOT = path.resolve(process.argv[2] || ".");
const OUT_DIR = path.join(ROOT, ".shadow");
const MODEL = process.env.MODEL || "gpt-4o-mini";

const FILES_PER_CHUNK = 12;      // leaf prompt granularity
const MAX_SNIPPET_CHARS = 600;     // per‑file snippet
const MAX_LEAF_CONTEXT = 7_000;   // tokens (≈ chars) per leaf prompt
const OVERVIEW_TOKENS = 160;     // repo overview budget
const SECTION_TOKENS = 160;     // section budget

/*────────── tiny helpers ───────────────────────────────────────────────────*/
const bold = (s: string) => chalk.bold.cyan(s);
const pad4 = (n: number) => n.toString().padStart(4, " ");

async function yesNo(q: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(q + " (y/N) ", a => { rl.close(); r(/^y(es)?$/i.test(a.trim())); }));
}

/*────────── OpenAI wrapper ─────────────────────────────────────────────────*/
const openai = new OpenAI();

async function chat(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  expectJson = false
) {
  const res = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    messages,
    ...(expectJson && { response_format: { type: "json_object" as const } }),
  });
  return res.choices[0]?.message?.content?.trim() || "";
}

/*────────── repo scanning utilities ────────────────────────────────────────*/
interface FileMeta {
  rel: string;  // path relative to ROOT
  snip: string;  // line‑numbered snippet
  deps: string[];// relative import targets
}

function numberedSnippet(abs: string): string {
  const srcBuf = fs.readFileSync(abs);
  if (!srcBuf.length) return "";
  const lines = srcBuf.toString("utf8").split(/\r?\n/);

  const first = lines.slice(0, 15);
  const midIdx = Math.floor(lines.length / 2);
  const middle = lines.slice(Math.max(0, midIdx - 7), midIdx + 8);

  const num = (chunk: string[], base: number) =>
    chunk.map((l, i) => `${pad4(base + i)}│ ${l}`).join("\n");

  let out = num(first, 1);
  if (midIdx > 15) out += "\n…\n" + num(middle, midIdx - 6);
  return out.slice(0, MAX_SNIPPET_CHARS);
}

function extractDeps(src: string): string[] {
  const re = /\bimport\s+(?:.+?\s+from\s+)?["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;
  const deps: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const spec = (m[1] || m[2] || "").trim();
    if (spec.startsWith(".")) deps.push(spec);
  }
  return deps;
}

/*────────── hierarchial summary engine ─────────────────────────────────────*/
interface DirSum { id: string; md: string; }

async function buildDeepWiki() {
  console.log(bold(`📚 Indexing ${ROOT}`));

  /* ── 1. honour .gitignore ───────────────────────────────────────────────*/
  const ig = ignore();
  ig.add([".git/", "node_modules/"]);            // always ignore
  const gitIgnoreFile = path.join(ROOT, ".gitignore");
  if (fs.existsSync(gitIgnoreFile)) ig.add(fs.readFileSync(gitIgnoreFile, "utf8"));

  const allFiles = await fg("**/*", { cwd: ROOT, dot: true, absolute: true });

  const metas: FileMeta[] = [];
  const importGraph: Record<string, string[]> = {};

  for (const abs of allFiles) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
    if (ig.ignores(rel) || fs.statSync(abs).isDirectory()) continue;

    const snip = numberedSnippet(abs);
    const deps = /\.[jt]sx?$/.test(abs)
      ? extractDeps(fs.readFileSync(abs, "utf8").slice(0, 20_000))
      : [];

    if (deps.length) importGraph[rel] = deps;
    metas.push({ rel, snip, deps });
  }

  /* ── 2. leaf‑level summaries (≤ FILES_PER_CHUNK each) ──────────────────*/
  const dirSums: Record<string, DirSum> = {};

  async function summariseChunk(dir: string, chunk: FileMeta[]) {
    const ctx = chunk
      .map(m => `// ===== ${m.rel} =====\n${m.snip}`)
      .join("\n\n")
      .slice(0, MAX_LEAF_CONTEXT);

    const relTxt = chunk
      .filter(m => importGraph[m.rel])
      .map(m => `${m.rel} -> ${importGraph[m.rel]?.join(", ") || ""}`)
      .join("\n") || "(no deps)";

    const md = await chat([
      {
        role: "system", content:
          `You are DeepWiki‑LLM. Summarise the following code chunk in ≤8 crisp bullets.
Mention standout identifiers and import relations. Use wiki‑links [[file.ts]].`},
      { role: "user", content: `\`\`\`txt\n${ctx}\n\`\`\`\n\n## RELATIONS\n\`\`\`txt\n${relTxt}\n\`\`\`` }
    ]);
    return md.trim();
  }

  async function recurse(dirRel: string): Promise<DirSum> {
    const absDir = path.join(ROOT, dirRel || ".");
    const children = fs.readdirSync(absDir, { withFileTypes: true });

    const localFiles = metas.filter(m => path.dirname(m.rel) === dirRel);
    const chunks: FileMeta[][] = [];
    for (let i = 0; i < localFiles.length; i += FILES_PER_CHUNK)
      chunks.push(localFiles.slice(i, i + FILES_PER_CHUNK));

    const leafMd: string[] = [];
    for (const ch of chunks) if (ch.length)
      leafMd.push(await summariseChunk(dirRel, ch));

    const subMd: string[] = [];
    for (const child of children) if (child.isDirectory()) {
      const subDirRel = path.posix.join(dirRel, child.name);
      subMd.push((await recurse(subDirRel)).md);
    }

    const md = [
      `### ${dirRel || "./"}`,
      ...leafMd,
      ...subMd,
    ].join("\n\n");

    const id = (dirRel || "root").replace(/[\\/]/g, "_") || "root";
    return dirSums[dirRel] = { id, md };
  }

  await recurse("");     // build summaries bottom‑up

  /* ── 3. repo‑wide overview & TOC from only dir summaries ────────────────*/
  const dirsFlatMd = Object.values(dirSums)
    .map(s => `[[${s.id}]]\n${s.md}`).join("\n\n");

  const tocJSON = await chat([
    {
      role: "system", content:
        `You are DeepWiki-LLM. Craft: 
  • overview_md (≤${OVERVIEW_TOKENS} tokens, start with a bullet diagram of subsystems)
  • sections (array of {id,title,file_globs})  
Respond **only** with JSON.`},
    { role: "user", content: dirsFlatMd }
  ], true);

  let toc: { overview_md: string; sections: { id: string; title: string; file_globs: string }[] };
  try { toc = JSON.parse(tocJSON); } catch { throw new Error("LLM returned bad JSON:\n" + tocJSON); }

  console.log(bold("📑 Sections")); toc.sections.forEach((s, i) => console.log(`  ${i + 1}.`, s.title));
  if (!(await yesNo("Generate wiki now?"))) return;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const nowISO = new Date().toISOString();

  /* ── 4. write overview ──────────────────────────────────────────────────*/
  fs.writeFileSync(path.join(OUT_DIR, "00_OVERVIEW.md"),
    `---\nid: overview\ntitle: Overview\ngenerated: ${nowISO}\nmodel: ${MODEL}\n---\n\n${toc.overview_md.trim()}\n`);

  /* ── 5. section pages ───────────────────────────────────────────────────*/
  for (const sec of toc.sections) {
    const globs = sec.file_globs.split(/[,;]/).map(s => s.trim());
    const rels = (await fg(globs, { cwd: ROOT, absolute: false })).map(f => f.replace(/\\/g, "/"));

    /* compress context further: stitch directory summaries of matching files */
    const ctx = rels
      .map(r => dirSums[path.dirname(r)]?.md)
      .filter(Boolean).join("\n\n") || "(no summary)";

    const mdBody = await chat([
      {
        role: "system", content:
          `DeepWiki‑LLM. Produce a section doc with YAML front‑matter.
Headings:
# ${sec.title}
## Purpose  (≤2 bullets)
## Architecture Highlights (≤4 bullets, reference deps / lines)
## Key Snippets (• file: Lx‑Ly → summary)
## Further Reading (omit if none)
≤${SECTION_TOKENS} tokens, use [[wikilinks]].`
      },
      { role: "user", content: ctx }
    ]);

    const fn = sec.id.replace(/[^a-z0-9\-]+/gi, "_").toLowerCase() + ".md";
    fs.writeFileSync(path.join(OUT_DIR, fn),
      `---\nid:${sec.id}\ntitle:${sec.title}\ngenerated:${nowISO}\n---\n\n${mdBody.trim()}\n`);
    console.log("  ✍️ ", fn);
  }

  console.log(bold("\n🎉  DeepWiki ready in"), OUT_DIR);
}

/*────────── main entry (CJS‑safe) ──────────────────────────────────────────*/
(async () => {
  try { await buildDeepWiki(); }
  catch (err) { console.error(err); process.exit(1); }
})();
