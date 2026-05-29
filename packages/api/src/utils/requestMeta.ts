import type { Request } from "express";

export function getRequestMeta(req: Request) {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
    requestId: typeof req.id === "string" ? req.id : null,
    sourceSurface: req.get("X-PMC-Surface") ?? null
  };
}
