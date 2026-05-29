import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import type { MaybeAuthenticatedRequest } from "../types/http.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    return next();
  }
  const auth = (req as MaybeAuthenticatedRequest).auth;
  if (!auth || auth.sessionTrust.requestTransport !== "cookie") {
    return next();
  }
  const cookies = parseCookies(req.headers.cookie ?? "");
  const cookieToken = cookies[config.AUTH_CSRF_COOKIE_NAME] ?? "";
  const headerToken = req.header("X-PMC-CSRF") ?? "";
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({
      error: "Security verification failed. Refresh the page and try again.",
      code: "csrf_required"
    });
  }
  return next();
}

export function requireElevatedSession(req: Request, res: Response, next: NextFunction) {
  const auth = (req as MaybeAuthenticatedRequest).auth;
  if (!auth) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!auth.sessionTrust.elevatedSessionActive && !auth.sessionTrust.breakGlassModeActive) {
    return res.status(428).json({
      error: "Recent reauthentication is required before this action can run.",
      code: "elevation_required"
    });
  }
  return next();
}

function parseCookies(cookieHeader: string) {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((accumulator, cookie) => {
      const separatorIndex = cookie.indexOf("=");
      if (separatorIndex <= 0) {
        return accumulator;
      }
      const key = cookie.slice(0, separatorIndex).trim();
      const value = cookie.slice(separatorIndex + 1).trim();
      accumulator[key] = decodeURIComponent(value);
      return accumulator;
    }, {});
}
