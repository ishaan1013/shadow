import { Router } from "express";
import { asyncHandler } from "./middleware";
import { CommandService, CommandStreamEvent } from "../services/command-service";
import { TerminalBuffer } from "../services/terminal-buffer";
import { CommandRequestSchema } from "@repo/types";

export function createExecuteRouter(commandService: CommandService, terminalBuffer: TerminalBuffer): Router {
  const router = Router();

  /**
   * POST /execute/command
   * Execute a terminal command
   */
  router.post(
    "/execute/command",
    asyncHandler(async (req, res) => {
      const body = CommandRequestSchema.parse(req.body);

      const result = await commandService.executeCommand(
        body.command,
        body.isBackground,
        body.timeout
      );

      if (!result.success) {
        res.status(500).json(result);
      } else {
        res.json(result);
      }
    })
  );

  /**
   * POST /execute/command/stream
   * Execute command with streaming output via Server-Sent Events
   */
  router.post(
    "/execute/command/stream",
    asyncHandler(async (req, res) => {
      const body = CommandRequestSchema.parse(req.body);

      // Set up SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // Disable Nginx buffering

      // Send initial connection event
      res.write(":ok\n\n");

      // Keep connection alive
      const keepAlive = setInterval(() => {
        res.write(":keepalive\n\n");
      }, 30000);

      // Handle client disconnect
      req.on("close", () => {
        clearInterval(keepAlive);
      });

      // Add command to terminal buffer
      terminalBuffer.addCommand(body.command);

      // Stream command output
      commandService.streamCommand(body.command, (event: CommandStreamEvent) => {
        // Add to terminal buffer
        if (event.content) {
          const outputType = event.type === 'stderr' ? 'stderr' : 'stdout';
          terminalBuffer.addEntry(event.content, outputType);
        }

        const data = JSON.stringify({
          content: event.content,
          code: event.code,
          message: event.message,
        });

        res.write(`event: ${event.type}\n`);
        res.write(`data: ${data}\n\n`);

        // End stream on exit
        if (event.type === "exit" || event.type === "error") {
          // Add exit message to buffer
          if (event.message) {
            terminalBuffer.addSystemMessage(event.message);
          }

          clearInterval(keepAlive);
          res.end();
        }
      });
    })
  );

  /**
   * POST /commands/background
   * Start a background command and return command ID
   */
  router.post(
    "/commands/background",
    asyncHandler(async (req, res) => {
      const body = CommandRequestSchema.parse(req.body);

      // Add command to terminal buffer
      const commandId = `background-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      terminalBuffer.addCommand(body.command);

      const result = await commandService.executeCommand(
        body.command,
        true, // isBackground = true
        body.timeout
      );

      if (!result.success) {
        terminalBuffer.addEntry(`Error: ${result.error || result.message}`, 'stderr');
        res.status(500).json(result);
      } else {
        // Return command ID for background command tracking
        res.json({
          commandId,
          success: true,
        });
      }
    })
  );

  /**
   * GET /terminal/history
   * Get terminal history for replay
   */
  router.get(
    "/terminal/history",
    asyncHandler(async (req, res) => {
      const count = req.query.count ? parseInt(req.query.count as string) : undefined;
      const sinceId = req.query.sinceId ? parseInt(req.query.sinceId as string) : undefined;

      let entries;
      if (sinceId) {
        entries = terminalBuffer.getEntriesSince(sinceId);
      } else {
        entries = terminalBuffer.getRecentEntries(count);
      }

      res.json({
        success: true,
        entries,
        stats: terminalBuffer.getStats(),
      });
    })
  );

  /**
   * GET /terminal/stats
   * Get terminal buffer statistics
   */
  router.get(
    "/terminal/stats",
    asyncHandler(async (_req, res) => {
      res.json({
        success: true,
        stats: terminalBuffer.getStats(),
      });
    })
  );

  /**
   * POST /terminal/clear
   * Clear terminal history
   */
  router.post(
    "/terminal/clear",
    asyncHandler(async (_req, res) => {
      terminalBuffer.clear();
      terminalBuffer.addSystemMessage("Terminal history cleared");

      res.json({
        success: true,
        message: "Terminal history cleared",
      });
    })
  );

  /**
   * GET /terminal/stream
   * Stream terminal output with Server-Sent Events
   */
  router.get(
    "/terminal/stream",
    asyncHandler(async (req, res) => {
      // Set up SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // Disable Nginx buffering

      // Send initial connection event
      res.write(":connected\n\n");

      // Send recent history if requested
      const includeHistory = req.query.history === 'true';
      if (includeHistory) {
        const recentEntries = terminalBuffer.getRecentEntries(100); // Last 100 entries
        recentEntries.forEach(entry => {
          const data = JSON.stringify({
            id: entry.id,
            timestamp: entry.timestamp,
            content: entry.data,
            type: entry.type,
            processId: entry.processId,
          });
          res.write(`event: history\n`);
          res.write(`data: ${data}\n\n`);
        });
      }

      // Subscribe to new entries
      const unsubscribe = terminalBuffer.subscribe((entry) => {
        const data = JSON.stringify({
          id: entry.id,
          timestamp: entry.timestamp,
          content: entry.data,
          type: entry.type,
          processId: entry.processId,
        });
        res.write(`event: output\n`);
        res.write(`data: ${data}\n\n`);
      });

      // Keep connection alive
      const keepAlive = setInterval(() => {
        res.write(":keepalive\n\n");
      }, 30000);

      // Handle client disconnect
      req.on("close", () => {
        clearInterval(keepAlive);
        unsubscribe();
      });

      req.on("error", () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
    })
  );

  return router;
}