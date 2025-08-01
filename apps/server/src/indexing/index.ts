import indexRepo, { IndexRepoOptions } from "@/indexing/indexer";
import express from "express";
import { isValidRepo } from "./utils/repository";
import { shallowwikiRouter } from "./shallowwiki/routes";

const router = express.Router();

// Mount the ShallowWiki router
router.use("/shallowwiki", shallowwikiRouter);

router.post(
  "/index",
  async (
    req: express.Request<
      object,
      object,
      { repo: string; taskId: string; options: IndexRepoOptions }
    >,
    res,
    next
  ) => {
    console.log("Indexing repo", req.body.repo);
    const { repo, taskId, options } = req.body;
    const clearNamespace = options.clearNamespace;
    if (!repo || !isValidRepo(repo)) {
      return res
        .status(400)
        .json({ error: "Invalid or missing repo parameter" });
    }

    try {
      const result = await indexRepo(repo, taskId, {
        ...options,
        clearNamespace: clearNamespace,
      });
      res.json({ message: "Indexing complete", ...result });
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("Not Found")) {
        return res.status(500).json({
          error: `Failed to fetch repository: ${error.message}`,
        });
      }
      next(error);
    }
  }
);

export { router };
