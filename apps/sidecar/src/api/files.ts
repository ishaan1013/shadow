import { Router } from "express";
import { asyncHandler } from "./middleware";
import { FileService } from "../services/file-service";
import { SearchReplaceRequestSchema } from "@repo/types";

export function createFilesRouter(fileService: FileService): Router {
  const router = Router();

  /**
   * POST /files/read
   * Read file contents (FirecrackerToolExecutor endpoint)
   */
  router.post(
    "/files/read",
    asyncHandler(async (req, res) => {
      const {
        path,
        shouldReadEntireFile,
        startLineOneIndexed,
        endLineOneIndexedInclusive,
      } = req.body;

      const result = await fileService.readFile(
        path,
        shouldReadEntireFile,
        startLineOneIndexed,
        endLineOneIndexedInclusive
      );

      if (!result.success && result.error === "FILE_NOT_FOUND") {
        res.status(404).json(result);
      } else if (!result.success) {
        res.status(400).json(result);
      } else {
        res.json(result);
      }
    })
  );

  /**
   * POST /files/stats
   * Get file stats (FirecrackerToolExecutor endpoint)
   */
  router.post(
    "/files/stats",
    asyncHandler(async (req, res) => {
      const { path } = req.body;

      const result = await fileService.getFileStats(path);

      if (!result.success && result.error === "FILE_NOT_FOUND") {
        res.status(404).json(result);
      } else if (!result.success) {
        res.status(500).json(result);
      } else {
        res.json(result);
      }
    })
  );

  /**
   * POST /files/write
   * Write file contents (FirecrackerToolExecutor endpoint)
   */
  router.post(
    "/files/write",
    asyncHandler(async (req, res) => {
      const { path, content, instructions } = req.body;

      const result = await fileService.writeFile(path, content, instructions);

      if (!result.success) {
        res.status(500).json(result);
      } else {
        res.json(result);
      }
    })
  );

  /**
   * POST /files/delete
   * Delete file (FirecrackerToolExecutor endpoint)
   */
  router.post(
    "/files/delete",
    asyncHandler(async (req, res) => {
      const { path } = req.body;

      const result = await fileService.deleteFile(path);

      if (!result.success && !result.wasAlreadyDeleted) {
        res.status(500).json(result);
      } else {
        res.json(result);
      }
    })
  );

  /**
   * POST /files/list
   * List directory contents (FirecrackerToolExecutor endpoint)
   */
  router.post(
    "/files/list",
    asyncHandler(async (req, res) => {
      const { path } = req.body;
      const dirPath = path || "";

      const result = await fileService.listDirectory(dirPath);

      if (!result.success && result.error === "DIRECTORY_NOT_FOUND") {
        res.status(404).json(result);
      } else if (!result.success) {
        res.status(500).json(result);
      } else {
        res.json(result);
      }
    })
  );

  /**
   * POST /files/search-replace
   * Search and replace in file (alternative endpoint for FirecrackerToolExecutor)
   */
  router.post(
    "/files/search-replace",
    asyncHandler(async (req, res) => {
      const body = SearchReplaceRequestSchema.parse(req.body);

      if (!body.path) {
        res.status(400).json({
          success: false,
          message: "Path is required for this endpoint",
          error: "MISSING_PATH",
        });
        return;
      }

      const result = await fileService.searchReplace(
        body.path,
        body.oldString,
        body.newString
      );

      if (!result.success) {
        if (
          result.error === "TEXT_NOT_FOUND" ||
          result.error === "TEXT_NOT_UNIQUE" ||
          result.error === "EMPTY_OLD_STRING" ||
          result.error === "IDENTICAL_STRINGS"
        ) {
          res.status(400).json(result);
        } else {
          res.status(500).json(result);
        }
      } else {
        res.json(result);
      }
    })
  );

  return router;
}
