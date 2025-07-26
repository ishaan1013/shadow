import express from "express";
import { DeepWikiStorage } from "./storage";
import { resolveRepoPath } from "./resolveRepoPath";



const shallowwikiRouter = express.Router();

/**
 * Generate markdown summaries for a repository using ShallowWiki
 * This runs ONLY the summarization pipeline without any embedding/Pinecone logic
 */
shallowwikiRouter.post(
  "/generate-summaries",
  async (
    req: express.Request<{}, {}, { repo: string; forceRefresh?: boolean }>,
    res,
    next
  ) => {
    const { repo, forceRefresh = false } = req.body;
    if (!repo) {
      return res.status(400).json({ error: "Missing required parameter: repo" });
    }

    try {
      console.log(`Processing repo ${repo} with forceRefresh=${forceRefresh}`);
      const repoPath = await resolveRepoPath(repo, forceRefresh);
      
      // Set environment to disable Pinecone for pure ShallowWiki
      const originalUsePinecone = process.env.USE_PINECONE;
      process.env.USE_PINECONE = "false";
      
      // Change to repo directory and run ShallowWiki
      const originalCwd = process.cwd();
      const originalArgv = process.argv[2] || "";
      
      process.chdir(repoPath);
      process.argv[2] = repoPath;
      
      // Import and run the ShallowWiki summarizer with the new runDeepWiki function
      const { runDeepWiki } = await import("./index.js");
      await runDeepWiki(repoPath, {
        concurrency: 12,
        model: "gpt-4o", 
        modelMini: "gpt-4o-mini"
      });
      
      // Restore original state
      process.argv[2] = originalArgv;
      process.chdir(originalCwd);
      process.env.USE_PINECONE = originalUsePinecone;
      
      // Read the generated summaries from .shadow/tree directory
      const fs = await import("fs");
      const path = await import("path");
      const summaryDir = path.join(repoPath, ".shadow", "tree");
      
      let summaries: string[] = [];
      if (fs.existsSync(summaryDir)) {
        // Get all .md files, excluding cache.json and index.json
        summaries = fs.readdirSync(summaryDir)
          .filter(f => f.endsWith(".md"));
      }
      
      return res.json({ 
        message: "ShallowWiki summaries generated successfully",
        repoPath,
        summaryDir,
        summariesGenerated: summaries.length,
        summaries
      });
    } catch (error) {
      console.error("Error generating ShallowWiki summaries:", error);
      next(error);
    }
  }
);

/**
 * Get a specific generated summary file
 */
shallowwikiRouter.post(
  "/get-summary",
  async (
    req: express.Request<{}, {}, { repo: string; fileName: string }>,
    res,
    next
  ) => {
    const { repo, fileName } = req.body;
    if (!repo || !fileName) {
      return res.status(400).json({ error: "Missing required parameters: repo, fileName" });
    }

    try {
      const repoPath = await resolveRepoPath(repo);
      const fs = await import("fs");
      const path = await import("path");
      
      const summaryPath = path.join(repoPath, ".shadow", "tree", fileName);
      
      if (!fs.existsSync(summaryPath)) {
        return res.status(404).json({ error: `Summary file not found: ${fileName}` });
      }
      
      const content = fs.readFileSync(summaryPath, "utf-8");
      
      return res.json({
        message: "Summary retrieved successfully",
        fileName,
        content
      });
    } catch (error) {
      console.error("Error getting summary:", error);
      next(error);
    }
  }
);

/**
 * List all summaries for a repository
 */
shallowwikiRouter.post(
  "/list-summaries",
  async (
    req: express.Request<{}, {}, { repo: string }>,
    res,
    next
  ) => {
    const { repo } = req.body;
    if (!repo) {
      return res.status(400).json({ error: "Missing required parameter: repo" });
    }

    try {
      const repoPath = await resolveRepoPath(repo);
      const storage = new DeepWikiStorage(repoPath);
      
      // Search for all summaries in this namespace
      const results = await storage.searchSummaries("", 1000); // Large topK to get all
      
      const summaries = results.map((hit: any) => ({
        id: hit.id || hit._id,
        type: hit.metadata?.type,
        filePath: hit.metadata?.filePath,
        language: hit.metadata?.language,
        complexity: hit.metadata?.complexity,
        lastUpdated: hit.metadata?.lastUpdated,
        symbols: hit.metadata?.symbols ? JSON.parse(hit.metadata.symbols) : [],
        dependencies: hit.metadata?.dependencies ? JSON.parse(hit.metadata.dependencies) : []
      }));
      
      return res.json({
        message: "Summaries retrieved successfully",
        namespace: storage.getNamespace(),
        count: summaries.length,
        summaries
      });
    } catch (error) {
      console.error("Error listing summaries:", error);
      next(error);
    }
  }
);

/**
 * Get a specific summary by file path or directory path
 */
shallowwikiRouter.post(
  "/get-summary",
  async (
    req: express.Request<{}, {}, { repo: string; filePath: string; type?: 'file' | 'directory' | 'root' }>,
    res,
    next
  ) => {
    const { repo, filePath, type = 'file' } = req.body;
    if (!repo || !filePath) {
      return res.status(400).json({ error: "Missing required parameters: repo, filePath" });
    }

    try {
      const repoPath = await resolveRepoPath(repo);
      const storage = new DeepWikiStorage(repoPath);
      
      let summary = null;
      
      if (type === 'file') {
        summary = await storage.getFileSummary(filePath);
      } else if (type === 'directory') {
        summary = await storage.getDirectorySummary(filePath);
      } else if (type === 'root') {
        summary = await storage.getRootOverview();
      }
      
      if (!summary) {
        return res.status(404).json({ error: `Summary not found for ${type}: ${filePath}` });
      }
      
      return res.json({
        message: "Summary retrieved successfully",
        namespace: storage.getNamespace(),
        summary: {
          id: summary.id,
          type: summary.metadata.type,
          filePath: summary.metadata.filePath,
          language: summary.metadata.language,
          symbols: summary.metadata.symbols,
          dependencies: summary.metadata.dependencies,
          complexity: summary.metadata.complexity,
          lastUpdated: summary.metadata.lastUpdated,
          tokenUsage: summary.metadata.tokenUsage,
          content: summary.metadata.summary
        }
      });
    } catch (error) {
      console.error("Error getting summary:", error);
      next(error);
    }
  }
);

export { shallowwikiRouter };
