import { Router } from "express";
import { asyncHandler } from "./middleware";
import { SearchService } from "../services/search-service";
import {
  FileSearchRequestSchema,
  GrepSearchRequestSchema,
} from "@repo/types";

export function createSearchRouter(searchService: SearchService): Router {
  const router = Router();

  /**
   * POST /search/files
   * Search for files by name
   */
  router.post(
    "/search/files",
    asyncHandler(async (req, res) => {
      const body = FileSearchRequestSchema.parse(req.body);

      const result = await searchService.searchFiles(body.query);

      if (!result.success) {
        res.status(500).json(result);
      } else {
        res.json(result);
      }
    })
  );

  /**
   * POST /search/grep
   * Search file contents using grep
   */
  router.post(
    "/search/grep",
    asyncHandler(async (req, res) => {
      const body = GrepSearchRequestSchema.parse(req.body);

      const result = await searchService.grepSearch(
        body.query,
        body.includePattern,
        body.excludePattern,
        body.caseSensitive
      );

      if (!result.success) {
        res.status(500).json(result);
      } else {
        res.json(result);
      }
    })
  );


  return router;
}