import type { RequestHandler } from "express";

export function requireFeatureFlag(
  enabled: boolean,
  options: {
    status?: number;
    message?: string;
  } = {}
): RequestHandler {
  return (_req, res, next) => {
    if (enabled) {
      return next();
    }
    return res.status(options.status ?? 503).json({
      error: options.message ?? "This feature is currently disabled."
    });
  };
}
