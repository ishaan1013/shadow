import indexRepo, { IndexRepoOptions } from "@/indexing/indexer";
import express from "express";
import TreeSitter from "tree-sitter";
import { getLanguageForPath } from "./languages";
import { retrieve } from "./retrieval";
import PineconeHandler from "./embedding/pineconeService";

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
    req: express.Request<
      {},
      {},
      { repo: string; options: IndexRepoOptions | null }
    >,
    res
  ) => {
    if (!req.body) {
      res.status(400).json({ error: "Request body is missing" });
      return;
    }
    const { repo, options = {} } = req.body;

    const { graph, graphJSON, invertedIndex, embeddings } = await indexRepo(
      repo,
      options
    );
    res.json({ graph, graphJSON, invertedIndex, embeddings });
  }
);

router.post(
  "/search",
  async (
    req: express.Request<{}, {}, { query: string; namespace: string; topK?: number; fields?: string[] }>,
    res
  ) => {
    const { query, namespace, topK, fields } = req.body;
    const response = await retrieve(query, namespace, topK, fields);
    res.json(response);
  }
);

router.delete(
  "/clear-namespace",
  async (
    req: express.Request<{}, {}, { namespace: string }>,
    res
  ) => {
    const { namespace } = req.body;
    await pinecone.clearNamespace(namespace);
    res.json({ message: "Namespace cleared" });
  }
);

export { router };
