import type { NextFunction, Request, Response } from "express";
import pino from "pino";
import { ApiError } from "../errors/apiError.js";
import { config } from "../config.js";

const logger = pino({
  name: "pmc-api",
  enabled: config.NODE_ENV !== "test" || process.env.PMC_LOG_TEST_ERRORS === "1"
});

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = req.id ?? null;
  logger.error({ err, requestId, path: req.originalUrl, method: req.method }, "Unhandled API error");
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: err.message,
      ...(err.details !== undefined ? { details: err.details } : {})
    });
  }
  return res.status(500).json({
    error: "Internal server error",
    request_id: requestId
  });
}
