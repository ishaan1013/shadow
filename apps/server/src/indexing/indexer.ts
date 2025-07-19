import { chunkSymbol } from "@/indexing/chunker";
import { embedGraphChunks } from "@/indexing/embedding/embed";
import { extractGeneric } from "@/indexing/extractors/generic";
import { Graph, GraphEdge, GraphNode } from "@/indexing/graph";
import { getLanguageForPath } from "@/indexing/languages";
import logger from "@/indexing/logger";
import { getHash, getNodeHash } from "@/indexing/utils/hash";
import { sliceByLoc } from "@/indexing/utils/text";
import { tokenize } from "@/indexing/utils/tokenize";
import PineconeHandler from "@/indexing/embedding/pineconeService";
import TreeSitter from "tree-sitter";
import { embedAndUpsertToPinecone } from "./embedder";
import { getOwnerRepo, isValidRepo } from "./utils/repository";

export interface FileContentResponse {
  content: string;
  path: string;
  type: string;
}

export interface IndexRepoOptions {
  maxLines?: number;
  embed?: boolean;
  outDir?: string;
  force?: boolean;
  paths?: string[] | null;
}

// Add GitHub API helper
async function fetchRepoFiles(
  owner: string,
  repo: string,
  path: string = ""
): Promise<Array<{ path: string; content: string; type: string }>> {
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}/contents`;
  const url = path ? `${baseUrl}/${path}` : baseUrl;
  
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'shadow-indexer'
  };
  
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  try {
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    const files: Array<{ path: string; content: string; type: string }> = [];

    if (Array.isArray(data)) {
      // Directory
      for (const item of data) {
        if (item.type === "file") {
          const fileResponse = await fetch(item.url, { headers });
          const fileData = await fileResponse.json();
          const content = Buffer.from(fileData.content, "base64").toString("utf8");
          files.push({ path: fileData.path, content, type: "file" });
        } else if (item.type === "dir") {
          const subFiles = await fetchRepoFiles(owner, repo, item.path);
          files.push(...subFiles);
        }
      }
    } else {
      // Single file
      const content = Buffer.from(data.content, "base64").toString("utf8");
      files.push({ path: data.path, content, type: "file" });
    }

    return files;
  } catch (error) {
    logger.error(`Error fetching ${owner}/${repo}: ${error}`);
    return [];
  }
}

// Modified indexRepo to accept GitHub repo
async function indexRepo(
  repoName: string,
  options: IndexRepoOptions | null = {}
): Promise<{
  graph: Graph;
  graphJSON: any;
  invertedIndex: any;
  embeddings?: { index: any; binary: Buffer };
}> {
  const { maxLines = 200, embed = false, paths = null } = options || {};

  logger.info(
    `Indexing ${repoName}${paths ? " (filtered)" : ""}${embed ? " + embeddings" : ""}`
  );

  let files: Array<{ path: string; content: string; type: string }> = [];
  let repoId: string;

  // Check if it's a GitHub repo (format: "owner/repo")
  if (
    isValidRepo(repoName)
  ) {
    const { owner, repo } = getOwnerRepo(repoName);
    logger.info(`Fetching GitHub repo: ${owner}/${repo}`);

    files = await fetchRepoFiles(owner, repo);
    if (files.length === 0) {
      logger.warn(`No files found in ${owner}/${repo}`);
      throw new Error(`No files found in ${owner}/${repo}`);
    }

    repoId = getHash(`${owner}/${repo}`, 12);
    logger.info(`Number of files fetched: ${files.length}`);
    const graph = new Graph(repoId);
    // Track symbols across all files for cross-file call resolution
    const globalSym = new Map<string, string[]>(); // name -> [nodeId]

    // REPO node
    const repoNode = new GraphNode({
      id: repoId,
      kind: "REPO",
      name: repo,
      path: "",
      lang: "",
    });
    graph.addNode(repoNode);
    logger.info(`Number of nodes in the graph: ${graph.nodes.size}`);

    for (const file of files) {
      const spec = await getLanguageForPath(file.path);
      if (!spec || !spec.language) {
        logger.warn(`Skipping unsupported: ${file.path}`);
        continue;
      }
      const parser = new TreeSitter();
      parser.setLanguage(spec.language);
      const tree = parser.parse(file.content);
      const rootNode = tree.rootNode;

      // FILE node (record content hash + mtime for future incremental checks)
      // TODO: Should get time of commit instead!
      const stat = { mtimeMs: Date.now() };

      const nodeHash = getNodeHash(repoId, file.path, "FILE", file.path);
      const fileNode = new GraphNode({
        id: nodeHash,
        kind: "FILE",
        name: file.path,
        path: file.path,
        lang: spec.id,
        meta: { mtime: stat.mtimeMs, source: repoName },
      });
      graph.addNode(fileNode);
      graph.addEdge(
        new GraphEdge({
          from: repoId,
          to: nodeHash,
          kind: "CONTAINS",
          meta: {},
        })
      );

      // ================================ START OF THIS CODE SHOULD NOT BE CHANGED ================================ //
      // Extract
      const { defs, imports, calls, docs } = extractGeneric(
        rootNode,
        spec,
        file.content
      );
      const symNodes: GraphNode[] = [];

      // SYMBOL defs
      for (const d of defs) {
        const sig = buildSignatureFromNode(d.node, spec, file.content);
        const id = getNodeHash(repoId, file.path, "SYMBOL", d.name, d.loc);
        const symNode = new GraphNode({
          id,
          kind: "SYMBOL",
          name: d.name,
          path: file.path,
          lang: spec.id,
          loc: d.loc,
          signature: sig,
        }); // omit full code to avoid redundancy; chunks will hold code
        graph.addNode(symNode);
        graph.addEdge(
          new GraphEdge({
            from: nodeHash,
            to: symNode.id,
            kind: "CONTAINS",
            meta: {},
          })
        );
        symNodes.push(symNode);
        // record in global symbol registry
        if (!globalSym.has(d.name)) globalSym.set(d.name, []);
        globalSym.get(d.name)!.push(symNode.id);
      }

      // COMMENT / DOC nodes
      for (const ds of docs) {
        const docCode = sliceByLoc(file.content, ds.loc).trim();
        if (!docCode) continue;
        const docId = getNodeHash(
          repoId,
          file.path,
          "DOC",
          `doc@${ds.loc.startLine}`,
          ds.loc
        );
        const docNode = new GraphNode({
          id: docId,
          kind: "COMMENT",
          name: `doc@${file.path}:${ds.loc.startLine}`,
          path: file.path,
          lang: spec.id,
          loc: ds.loc,
          code: docCode,
          doc: docCode,
          meta: {},
        });
        graph.addNode(docNode);
        graph.addEdge(
          new GraphEdge({
            from: nodeHash,
            to: docNode.id,
            kind: "CONTAINS",
            meta: {},
          })
        );
        const near = symNodes.find((s) => s.loc.startLine >= ds.loc.endLine);
        if (near) {
          graph.addEdge(
            new GraphEdge({
              from: docNode.id,
              to: near.id,
              kind: "DOCS_FOR",
              meta: {},
            })
          );
        }
      }

      // IMPORT nodes
      for (const im of imports) {
        const imText = sliceByLoc(file.content, im.loc).trim();
        const name = imText.slice(0, 64);
        const imId = getNodeHash(repoId, file.path, "IMPORT", name, im.loc);
        const imNode = new GraphNode({
          id: imId,
          kind: "IMPORT",
          name,
          path: file.path,
          lang: spec.id,
          loc: im.loc,
          code: imText,
        });
        graph.addNode(imNode);
        graph.addEdge(
          new GraphEdge({
            from: nodeHash,
            to: imNode.id,
            kind: "CONTAINS",
            meta: {},
          })
        );
      }

      // CHUNK nodes per symbol
      for (const symNode of symNodes) {
        const d = defs.find(
          (x) =>
            x.name === symNode.name && x.loc.startLine === symNode.loc.startLine
        );
        if (!d) continue;
        const chunks = chunkSymbol({
          repoId,
          fileNode: symNode,
          sym: d,
          lang: spec.id,
          sourceText: file.content,
          maxLines,
        });
        let prev: GraphNode | null = null;
        for (const ch of chunks) {
          graph.addNode(ch);
          graph.addEdge(
            new GraphEdge({
              from: symNode.id,
              to: ch.id,
              kind: "PART_OF",
              meta: {},
            })
          );
          if (prev)
            graph.addEdge(
              new GraphEdge({
                from: prev.id,
                to: ch.id,
                kind: "NEXT_CHUNK",
                meta: {},
              })
            );
          prev = ch;
        }
      }

      // CALL edges (intra-file first, then cross-file if symbol unique)
      const symMap = new Map<string, string>(
        symNodes.map((s) => [s.name, s.id])
      );
      for (const c of calls) {
        const callText = file.content.slice(c.loc.byteStart, c.loc.byteEnd);
        const m = callText.match(/([A-Za-z_][A-Za-z0-9_]*)/);
        if (!m || !m[1]) continue;
        const callee = m[1];

        // identify caller symbol enclosing the call site (if any)
        const callerSym = symNodes.find(
          (s) =>
            s.loc.startLine <= c.loc.startLine && s.loc.endLine >= c.loc.endLine
        );

        let targetId: string | undefined = undefined;
        if (symMap.has(callee)) {
          targetId = symMap.get(callee);
        } else if (
          globalSym.has(callee) &&
          globalSym.get(callee)!.length === 1
        ) {
          targetId = globalSym.get(callee)![0]; // unique symbol across repo
        }

        if (callerSym && targetId) {
          graph.addEdge(
            new GraphEdge({
              from: callerSym.id,
              to: targetId,
              kind: "CALLS",
              meta: { callSiteLine: c.loc.startLine },
            })
          );
        }
      }
      // ================================ END OF THIS CODE SHOULD NOT BE CHANGED ================================ //
    } // END OF FILE LOOP
    // Embed chunks if requested

    // Output is the graph with nodes, adjacencies and inverted index
    // Only the nodes get embedded
    if (embed) {
      logger.info("Embedding and uploading to Pinecone...");      
      await embedAndUpsertToPinecone(Array.from(graph.nodes.values()), repoName);
    } else {
      logger.info("Embedding skipped (embed=false).");
    }

    // Persist
    // if (embed) saveEmbeddings(graph, repoName); // save binary embeddings first
    // saveGraph(graph, repoName); // then write graph (strips inlined embeddings)
    // buildInverted(graph, outDir); // This line is removed as per the new_code
    logger.info(`Indexed ${graph.nodes.size} nodes.`);
    return {
      graph,
      graphJSON: graph.graphToJSON(),
      invertedIndex: buildInvertedInMemory(graph),
      embeddings: buildEmbeddingsInMemory(graph),
    };
  }
  return {
    graph: new Graph(repoName),
    graphJSON: {},
    invertedIndex: {},
    embeddings: undefined,
  };
}

// Quick signature to see what a function does
function buildSignatureFromNode(
  node: { startIndex: number; endIndex: number } | undefined,
  spec: any,
  sourceText: string | undefined
): string {
  if (!node || !sourceText) return "";

  let start = "";
  if (
    node.startIndex !== undefined &&
    node.endIndex !== undefined &&
    sourceText !== undefined
  ) {
    start = sourceText.slice(node.startIndex, node.endIndex);
  }
  if (start) {
    const lines = start.split("\n");
    if (lines[0]) {
      start = lines[0].trim();
    }
  }

  return start.length > 200 ? start.slice(0, 200) + "…" : start;
}

// Helper functions that work in memory instead of writing files
function buildInvertedInMemory(graph: Graph): Record<string, string[]> {
  const idx: Record<string, Set<string>> = {};

  graph.nodes.forEach((node) => {
    const textParts: string[] = [];
    if (node.code) textParts.push(node.code);
    if (node.signature) textParts.push(node.signature);
    if (node.name) textParts.push(node.name);

    const tokens = tokenize(textParts.join("\n"));

    tokens.forEach((token) => {
      if (token.length > 0) {
        if (!idx[token]) idx[token] = new Set();
        idx[token].add(node.id);
      }
    });
  });

  const serial: Record<string, string[]> = {};
  Object.entries(idx).forEach(([key, value]) => {
    serial[key] = Array.from(value);
  });

  return serial;
}

function buildEmbeddingsInMemory(
  graph: Graph
): { index: any; binary: Buffer } | undefined {
  const chunks = Array.from(graph.nodes.values()).filter(
    (node): node is GraphNode & { embedding: Float32Array } =>
      node.kind === "CHUNK" &&
      Array.isArray(node.embedding) &&
      node.embedding.length > 0
  );

  if (chunks.length === 0) return undefined;

  const idx: Record<string, { offset: number; length: number }> = {};
  const allVecs: number[] = [];
  let offset = 0;

  chunks.forEach((chunk) => {
    const vec = Array.from(chunk.embedding);
    idx[chunk.id] = { offset, length: vec.length };
    allVecs.push(...vec);
    offset += vec.length;
  });

  const dim = chunks[0]?.embedding.length ?? 0;
  const f32 = new Float32Array(allVecs);
  const buf = Buffer.from(f32.buffer);

  return {
    index: { dim, idx },
    binary: buf,
  };
}

export default indexRepo;
