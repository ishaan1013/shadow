import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { logger } from "../utils/logger";
import { ErrorResponse } from "@repo/types";

/**
 * Error handling middleware
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response<ErrorResponse>,
  _next: NextFunction
): void {
  logger.error("Request error", {
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack,
  });

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Invalid request parameters",
      details: err.errors,
    });
    return;
  }

  // Handle path traversal errors
  if (err.message.includes("Path traversal detected")) {
    res.status(400).json({
      error: "SECURITY_ERROR",
      message: "Invalid path: path traversal detected",
    });
    return;
  }

  // Default error response
  const statusCode = (err as any).statusCode || 500;
  res.status(statusCode).json({
    error: "INTERNAL_ERROR",
    message: err.message || "An unexpected error occurred",
  });
}

/**
 * Request logging middleware
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();

  // Log request
  logger.info("Incoming request", {
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip,
  });

  // Log response
  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info("Request completed", {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
    });
  });

  next();
}

/**
 * Async route handler wrapper
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}