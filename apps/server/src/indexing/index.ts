import indexRepo, { IndexRepoOptions } from "@/indexing/indexer";
import express from "express";
import TreeSitter from "tree-sitter";
import { getLanguageForPath } from "./languages";
import { retrieve } from "./retrieval";
import PineconeHandler from "./embedding/pineconeService";
import { isValidRepo } from "./utils/repository";

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

router.get("/test", (req, res) => {
  res.json({ message: "Hello from indexing API!" });
});

router.post(
  "/tree-sitter",
  async (req: express.Request<{}, {}, CodeBody>, res) => {
    const { text, filePath } = req.body;
    const parser = new TreeSitter();
    const languageSpec = await getLanguageForPath(filePath);
    if (!languageSpec || !languageSpec.language) {
      res.status(400).json({ error: "Unsupported language" });
      return;
    }
    parser.setLanguage(languageSpec.language);
    const tree = parser.parse(text);
    res.json({ tree: tree.rootNode, language: languageSpec.id });
  }
);

router.post(
  "/index",
  async (
    req: express.Request<{}, {}, { repo: string; options?: IndexRepoOptions }>,
    res,
    next
  ) => {
    const { repo, options } = req.body;
    if (!repo || !isValidRepo(repo)) {
      return res
        .status(400)
        .json({ error: "Invalid or missing repo parameter" });
    }

    try {
      const result = await indexRepo(repo, { ...options });
      res.json({ message: "Indexing complete", ...result });
    } catch (error: any) {
      if (error.message.includes("Not Found")) {
        return res.status(500).json({
          error: `Failed to fetch repository: ${error.message}`
        });
      }
      next(error);
    }
  }
);

router.post(
  "/search",
  async (
    req: express.Request<
      {},
      {},
      { query: string; namespace: string; topK?: number; fields?: string[] }
    >,
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
      const response = await retrieve(query, namespace, topK, fields);
      // The response from pinecone is { result: { hits: [] } }, let's return a `matches` property as expected by the test
      res.json({ matches: response.result?.hits || [] });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  "/clear-namespace",
  async (
    req: express.Request<{}, {}, { namespace: string }>,
    res,
    next
  ) => {
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

export { router };
