import { Router } from "express";
import { asyncHandler } from "./middleware";
import { WorkspaceService } from "../services/workspace-service";
import { HealthResponse } from "@repo/types";

export function createHealthRouter(workspaceService: WorkspaceService): Router {
  const router = Router();

  /**
   * GET /health
   * Health check endpoint
   */
  router.get(
    "/health",
    asyncHandler(async (_req, res) => {
      const response: HealthResponse = {
        success: true,
        healthy: true,
        message: "Sidecar service is healthy",
        details: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          pid: process.pid,
        },
      };

      res.json(response);
    })
  );

  /**
   * GET /status
   * Get workspace status
   */
  router.get(
    "/status",
    asyncHandler(async (_req, res) => {
      const status = await workspaceService.getStatus();
      res.json(status);
    })
  );

  return router;
}