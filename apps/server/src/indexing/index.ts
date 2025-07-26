import indexRepo, { IndexRepoOptions } from "@/indexing/indexer";
import express from "express";
import PineconeHandler from "./embedding/pineconeService";
import { retrieve } from "./retrieval";
import { getNamespaceFromRepo, isValidRepo } from "./utils/repository";
import config from "@/config";
import { shallowwikiRouter } from "./shallowwiki/routes";


const router = express.Router();
const pinecone = new PineconeHandler();

interface CodeBody {
  text: string;
  language: string;
  filePath: string;
}
// Basic hello world route
router.get("/", (req, res) => {
  res.json({ message: "Hello from indexing API!" });
});

// Mount the ShallowWiki router
router.use("/shallowwiki", shallowwikiRouter);

router.post(
  "/index",
  async (
    req: express.Request<object, object, { repo: string; taskId: string; options: IndexRepoOptions }>,
    res,
    next
  ) => {
    console.log("Indexing repo", req.body.repo);
    console.log("Semantic search enabled: ", config.useSemanticSearch);
    if (!config.useSemanticSearch) {
      console.log("Semantic search is not enabled - skipping indexing");
      return res.status(200).json({ message: "Semantic search is not enabled - skipping indexing" });
    }
    const { repo, taskId, options } = req.body;
    const clearNamespace = options.clearNamespace;
    if (!repo || !isValidRepo(repo)) {
      return res
        .status(400)
        .json({ error: "Invalid or missing repo parameter" });
    }

    try {
      const result = await indexRepo(repo, taskId, { ...options, clearNamespace: clearNamespace });
      res.json({ message: "Indexing complete", ...result });
    } catch (error: any) {
      if (error.message.includes("Not Found")) {
        return res.status(500).json({
          error: `Failed to fetch repository: ${error.message}`,
        });
      }
      next(error);
    }
  }
);

router.post(
  "/search",
  async (
    req: express.Request<object, object, { query: string; namespace: string; topK?: number; fields?: string[] }>,
    res,
    next
  ) => {
    try {
      const { query, namespace, topK, fields } = req.body;
      if (!query || !namespace) {
        return res
          .status(400)
          .json({ error: "Missing required parameters: query, namespace" });
      }
      let namespaceToUse = namespace;
      if (isValidRepo(namespace)) {
        namespaceToUse = getNamespaceFromRepo(namespace);
      }
      const response = await retrieve(query, namespaceToUse, topK, fields);
      // The response from pinecone is { result: { hits: [] } }, let's return a `matches` property as expected by the test
      res.json({ matches: response.result?.hits || [] });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  "/clear-namespace",
  async (req: express.Request<object, object, { namespace: string }>, res, next) => {
    try {
      const { namespace } = req.body;
      if (!namespace) {
        return res
          .status(400)
          .json({ error: "Missing required parameter: namespace" });
      }
      await pinecone.clearNamespace(namespace);
      res.json({ message: "Namespace cleared" });
    } catch (error) {
      next(error);
    }
  }
);

// DeepWiki indexer endpoint
router.post(
  "/deepwiki",
  async (
    req: express.Request<{}, {}, { repoPath: string; concurrency?: number; model?: string; modelMini?: string }>,
    res,
    next
  ) => {
    const { repoPath, concurrency, model, modelMini } = req.body;

    if (!repoPath) {
      return res
        .status(400)
        .json({ error: "Missing required parameter: repoPath" });
    }

    try {
      // Dynamically import the DeepWiki indexer
      const { runDeepWiki } = await import("./shallowwiki/index.js");

      const result = await runDeepWiki(repoPath, {
        concurrency: concurrency || 12,
        model: model || "gpt-4o",
        modelMini: modelMini || "gpt-4o-mini"
      });

      res.json({
        message: "DeepWiki indexing complete",
        ...result
      });
    } catch (error: any) {
      console.error("DeepWiki indexing error:", error);
      next(error);
    }
  }
);

// DeepWiki search endpoint
router.post(
  "/deepwiki/search",
  async (
    req: express.Request<{}, {}, { repoPath: string; query: string; topK?: number; type?: string }>,
    res,
    next
  ) => {
    const { repoPath, query, topK, type } = req.body;

    if (!repoPath || !query) {
      return res
        .status(400)
        .json({ error: "Missing required parameters: repoPath, query" });
    }

    try {
      // Dynamically import the DeepWiki storage
      const { DeepWikiStorage } = await import("./shallowwiki/storage.js");

      const storage = new DeepWikiStorage(repoPath);

      // Build search query with type filter if specified
      let searchQuery = query;
      if (type) {
        searchQuery = `${query} type:${type}`;
      }

      const results = await storage.searchSummaries(searchQuery, topK || 10);

      res.json({
        message: "Search complete",
        namespace: storage.getNamespace(),
        results: results.map(result => ({
          id: result.id,
          score: result.score,
          type: result.metadata?.type,
          filePath: result.metadata?.filePath,
          summary: result.metadata?.text || result.metadata?.summary,
          symbols: result.metadata?.symbols ? JSON.parse(result.metadata.symbols) : [],
          dependencies: result.metadata?.dependencies ? JSON.parse(result.metadata.dependencies) : [],
          lastUpdated: result.metadata?.lastUpdated
        }))
      });
    } catch (error: any) {
      console.error("DeepWiki search error:", error);
      next(error);
    }
  }
);

// DeepWiki get specific summary endpoint
router.post(
  "/deepwiki/get",
  async (
    req: express.Request<{}, {}, { repoHash: string; type: string; path: string }>,
    res,
    next
  ) => {
    const { repoHash, type, path } = req.body;

    if (!repoHash || !type) {
      return res
        .status(400)
        .json({ error: "Missing required parameters: repoHash, type" });
    }

    try {
      // Dynamically import the DeepWiki storage
      const { DeepWikiStorage } = await import("./shallowwiki/storage.js");

      // Create storage with dummy repo path (we'll use the hash directly)
      const storage = new (class extends DeepWikiStorage {
        constructor() {
          super("/dummy");
          this.namespace = `deepwiki_${repoHash}`;
        }
      })();

      let result;
      switch (type) {
        case 'file':
          result = await storage.getFileSummary(path || '');
          break;
        case 'directory':
          result = await storage.getDirectorySummary(path || '');
          break;
        case 'root':
          result = await storage.getRootOverview();
          break;
        default:
          return res.status(400).json({ error: "Invalid type. Must be 'file', 'directory', or 'root'" });
      }

      if (!result) {
        return res.status(404).json({ error: "Summary not found" });
      }

      res.json({
        message: "Summary retrieved",
        namespace: storage.getNamespace(),
        result
      });
    } catch (error: any) {
      console.error("DeepWiki get summary error:", error);
      next(error);
    }
  }
);

export { router };
