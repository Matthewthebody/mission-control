import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import type { AuthUser, SessionTransport } from "../types/auth.js";

type RequestContextStore = {
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  sourceSurface: string | null;
  method: string;
  path: string;
  operationType: "read" | "action";
  auth: AuthUser | null;
  requestTransport: SessionTransport;
  cache: Map<string, unknown>;
};

const requestContext = new AsyncLocalStorage<RequestContextStore>();

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = typeof req.id === "string" ? req.id : req.header("X-Request-Id") ?? randomUUID();
  const store: RequestContextStore = {
    requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
    sourceSurface: req.get("X-PMC-Surface") ?? null,
    method: req.method,
    path: req.originalUrl,
    operationType: "read",
    auth: null,
    requestTransport: "unknown",
    cache: new Map<string, unknown>()
  };
  res.setHeader("X-Request-Id", requestId);
  requestContext.run(store, next);
}

export function getRequestContext() {
  return requestContext.getStore() ?? null;
}

export function setRequestContextAuth(auth: AuthUser | null, requestTransport: SessionTransport) {
  const context = requestContext.getStore();
  if (!context) {
    return;
  }
  context.auth = auth;
  context.requestTransport = requestTransport;
}

export function setRequestContextSourceSurface(sourceSurface: string | null) {
  const context = requestContext.getStore();
  if (!context) {
    return;
  }
  context.sourceSurface = sourceSurface;
}

export function markRequestContextAsAction() {
  const context = requestContext.getStore();
  if (!context) {
    return;
  }
  context.operationType = "action";
}

export function getRequestCacheValue<T>(key: string) {
  const context = requestContext.getStore();
  return (context?.cache.get(key) as T | undefined) ?? null;
}

export function setRequestCacheValue<T>(key: string, value: T) {
  const context = requestContext.getStore();
  context?.cache.set(key, value);
}
