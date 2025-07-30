import { Router } from "express";
import { asyncHandler } from "./middleware";
import { FileService } from "../services/file-service";
import {
  FileReadOptionsSchema,
  FileWriteRequestSchema,
  SearchReplaceRequestSchema,
} from "@repo/types";

export function createFilesRouter(fileService: FileService): Router {
  const router = Router();

  /**
   * GET /files/:path
   * Read file contents
   */
  router.get(
    "/files/*",
    asyncHandler(async (req, res) => {
      const filePath = req.params[0] || "";

      // Parse and validate query parameters
      const options = FileReadOptionsSchema.parse({
        shouldReadEntireFile: req.query.shouldReadEntireFile !== "false",
        startLineOneIndexed: req.query.startLineOneIndexed
          ? parseInt(req.query.startLineOneIndexed as string)
          : undefined,
        endLineOneIndexedInclusive: req.query.endLineOneIndexedInclusive
          ? parseInt(req.query.endLineOneIndexedInclusive as string)
          : undefined,
      });

      const result = await fileService.readFile(
        filePath,
        options.shouldReadEntireFile,
        options.startLineOneIndexed,
        options.endLineOneIndexedInclusive
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
   * GET /files/:path/stats
   * Get file stats (size, modification time, type)
   */
  router.get(
    "/files/*/stats",
    asyncHandler(async (req, res) => {
      const pathParts = req.params[0]?.split("/") || [];
      pathParts.pop(); // Remove "stats" from the path
      const filePath = pathParts.join("/");

      const result = await fileService.getFileStats(filePath);

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
   * POST /files/:path
   * Write file contents
   */
  router.post(
    "/files/*",
    asyncHandler(async (req, res) => {
      const filePath = req.params[0] || "";
      const body = FileWriteRequestSchema.parse(req.body);

      const result = await fileService.writeFile(
        filePath,
        body.content,
        body.instructions
      );

      if (!result.success) {
        res.status(500).json(result);
      } else {
        res.json(result);
      }
    })
  );

  /**
   * DELETE /files/:path
   * Delete file
   */
  router.delete(
    "/files/*",
    asyncHandler(async (req, res) => {
      const filePath = req.params[0] || "";

      const result = await fileService.deleteFile(filePath);

      if (!result.success && !result.wasAlreadyDeleted) {
        res.status(500).json(result);
      } else {
        res.json(result);
      }
    })
  );

  /**
   * POST /files/:path/replace
   * Search and replace in file
   */
  router.post(
    "/files/*/replace",
    asyncHandler(async (req, res) => {
      const pathParts = req.params[0]?.split("/") || [];
      pathParts.pop(); // Remove "replace" from the path
      const filePath = pathParts.join("/");

      const body = SearchReplaceRequestSchema.parse(req.body);

      const result = await fileService.searchReplace(
        filePath,
        body.oldString,
        body.newString
      );

      if (!result.success) {
        if (result.error === "TEXT_NOT_FOUND" || result.error === "TEXT_NOT_UNIQUE") {
          res.status(400).json(result);
        } else {
          res.status(500).json(result);
        }
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
          error: "MISSING_PATH"
        });
        return;
      }

      const result = await fileService.searchReplace(
        body.path,
        body.oldString,
        body.newString
      );

      if (!result.success) {
        if (result.error === "TEXT_NOT_FOUND" || result.error === "TEXT_NOT_UNIQUE" || 
            result.error === "EMPTY_OLD_STRING" || result.error === "IDENTICAL_STRINGS") {
          res.status(400).json(result);
        } else {
          res.status(500).json(result);
        }
      } else {
        res.json(result);
      }
    })
  );

  /**
   * GET /directory/:path
   * List directory contents
   */
  router.get(
    "/directory/*",
    asyncHandler(async (req, res) => {
      const dirPath = req.params[0] || "";

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

  return router;
}