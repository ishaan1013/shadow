import { chunkSymbol } from "@/indexing/chunker";
import { extractGeneric } from "@/indexing/extractors/generic";
import {
  Graph,
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  GraphNodeKind,
} from "@/indexing/graph";
import { getLanguageForPath } from "@/indexing/languages";
import logger from "@/indexing/logger";
import { getHash, getNodeHash } from "@/indexing/utils/hash";
import { sliceByLoc } from "@/indexing/utils/text";
import { tokenize } from "@/indexing/utils/tokenize";
import TreeSitter from "tree-sitter";
import { embedAndUpsertToPinecone } from "./embedderWrapper";
import { getOwnerFromRepo, isValidRepo } from "./utils/repository";
import { LocalWorkspaceManager } from "@/execution/local/local-workspace-manager";

export interface FileContentResponse {
  content: string;
  path: string;
  type: string;
}

export interface IndexRepoOptions {
  clearNamespace: boolean;
  maxLines?: number;
  embed?: boolean;
  outDir?: string;
  paths?: string[] | null;
}

// Add GitHub API helper
async function fetchRepoFiles(
  taskId: string
): Promise<Array<{ path: string; content: string; type: string }>> {
  // For local indexing, we'll use the workspace manager
  // The repo parameter should be the taskId or we need to map repo to taskId

  // You'll need to get the taskId from the repo name or pass it differently

  const workspaceManager = new LocalWorkspaceManager();
  return await workspaceManager.getAllFilesFromWorkspace(taskId);
}

// Modified indexRepo to accept GitHub repo
async function indexRepo(
  repoName: string,
  taskId: string,
  options: IndexRepoOptions
): Promise<{
  graph: Graph;
  graphJSON: any;
  invertedIndex: any;
  embeddings?: { index: any; binary: Buffer };
}> {
  const {
    maxLines = 200,
    embed = false,
    paths = null,
    clearNamespace = true,
  } = options;

  logger.info(
    `Indexing ${repoName}${paths ? " (filtered)" : ""}${embed ? " + embeddings" : ""}`
  );

  let files: Array<{ path: string; content: string; type: string }> = [];
  let repoId: string;

  // Check if it's a GitHub repo (format: "owner/repo")
  if (isValidRepo(repoName)) {
    const { owner, repo } = getOwnerFromRepo(repoName);
    logger.info(`Fetching GitHub repo: ${owner}/${repo}`);

    files = await fetchRepoFiles(taskId);
    if (files.length === 0) {
      logger.warn(`No files found in ${owner}/${repo}`);
      throw new Error(`No files found in ${owner}/${repo}`);
    }

    repoId = getHash(`${owner}/${repo}`, 12);
    logger.info(`Number of files fetched: ${files.length}`);
    logger.info(`Files found: ${files.map((f) => f.path).join(", ")}`);
    const graph = new Graph(repoId);
    // Track symbols across all files for cross-file call resolution
    const globalSym = new Map<string, string[]>(); // name -> [nodeId]

    // REPO node
    const repoNode = new GraphNode({
      id: repoId,
      kind: GraphNodeKind.REPO,
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
      try {
        if (spec.language && typeof spec.language === "object") {
          parser.setLanguage(spec.language);
        } else {
          logger.warn(`Invalid language object for ${file.path}`);
          continue;
        }
      } catch (error) {
        logger.warn(
          `Failed to set language for ${file.path}: ${error instanceof Error ? error.message : String(error)}`
        );
        continue;
      }

      let tree, rootNode;
      try {
        tree = parser.parse(file.content);
        rootNode = tree.rootNode;
      } catch (error) {
        logger.warn(
          `Failed to parse ${file.path}: ${error instanceof Error ? error.message : String(error)}`
        );
        continue;
      }

      // FILE node (record content hash + mtime for future incremental checks)
      // TODO: Should get time of commit instead!
      const stat = { mtimeMs: Date.now() };

      const nodeHash = getNodeHash(repoId, file.path, "FILE", file.path);
      const fileNode = new GraphNode({
        id: nodeHash,
        kind: GraphNodeKind.FILE,
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
          kind: GraphEdgeKind.CONTAINS,
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
      logger.info(
        `File ${file.path}: Found ${defs.length} definitions, ${imports.length} imports, ${calls.length} calls, ${docs.length} docs`
      );

      // SYMBOL defs
      for (const d of defs) {
        const sig = buildSignatureFromNode(d.node, spec, file.content);
        const id = getNodeHash(repoId, file.path, "SYMBOL", d.name, d.loc);
        const symNode = new GraphNode({
          id,
          kind: GraphNodeKind.SYMBOL,
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
            kind: GraphEdgeKind.CONTAINS,
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
          kind: GraphNodeKind.COMMENT,
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
            kind: GraphEdgeKind.CONTAINS,
            meta: {},
          })
        );
        const near = symNodes.find((s) => s.loc.startLine >= ds.loc.endLine);
        if (near) {
          graph.addEdge(
            new GraphEdge({
              from: docNode.id,
              to: near.id,
              kind: GraphEdgeKind.DOCS_FOR,
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
          kind: GraphNodeKind.IMPORT,
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
            kind: GraphEdgeKind.CONTAINS,
            meta: {},
          })
        );
      }

      // CHUNK nodes per symbol
      let hasChunks = false;
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
              kind: GraphEdgeKind.PART_OF,
              meta: {},
            })
          );
          if (prev)
            graph.addEdge(
              new GraphEdge({
                from: prev.id,
                to: ch.id,
                kind: GraphEdgeKind.NEXT_CHUNK,
                meta: {},
              })
            );
          prev = ch;
          hasChunks = true;
        }
      }

      // If no symbols found, create file-level chunks for the entire file content
      if (!hasChunks && file.content.trim()) {
        const lines = file.content.split("\n");
        const chunkSize = maxLines;
        let chunkIndex = 0;

        for (
          let startLine = 0;
          startLine < lines.length;
          startLine += chunkSize
        ) {
          const endLine = Math.min(startLine + chunkSize - 1, lines.length - 1);
          const chunkContent = lines.slice(startLine, endLine + 1).join("\n");

          if (chunkContent.trim()) {
            const chunkId = getNodeHash(
              repoId,
              file.path,
              "CHUNK",
              `file-chunk-${chunkIndex}`,
              {
                startLine,
                endLine,
                startCol: 0,
                endCol: 0,
                byteStart: 0,
                byteEnd: chunkContent.length,
              }
            );

            const chunkNode = new GraphNode({
              id: chunkId,
              kind: GraphNodeKind.CHUNK,
              name: `${file.path}#${chunkIndex}`,
              path: file.path,
              lang: spec.id,
              loc: {
                startLine,
                endLine,
                startCol: 0,
                endCol: 0,
                byteStart: 0,
                byteEnd: chunkContent.length,
              },
              code: chunkContent,
              meta: { strategy: "file-level" },
            });

            graph.addNode(chunkNode);
            graph.addEdge(
              new GraphEdge({
                from: nodeHash,
                to: chunkNode.id,
                kind: GraphEdgeKind.CONTAINS,
                meta: {},
              })
            );

            chunkIndex++;
          }
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
              kind: GraphEdgeKind.CALLS,
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
      await embedAndUpsertToPinecone(
        Array.from(graph.nodes.values()),
        repoName,
        clearNamespace
      );
    } else {
      logger.info("Embedding skipped (embed=false).");
    }

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
  _spec: any,
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
      node.kind === GraphNodeKind.CHUNK &&
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
