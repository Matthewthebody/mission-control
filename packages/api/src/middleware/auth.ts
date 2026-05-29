import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import type { MaybeAuthenticatedRequest } from "../types/http.js";
import type { SessionTransport } from "../types/auth.js";
import { resolveAuthenticatedUser } from "../services/auth.js";
import { setRequestContextAuth } from "../services/requestContext.js";

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const bearerToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  const cookieToken = parseCookies(req.headers.cookie ?? "")[config.AUTH_COOKIE_NAME] ?? null;
  const token = bearerToken ?? cookieToken;
  const requestTransport: SessionTransport = bearerToken ? "bearer" : cookieToken ? "cookie" : "unknown";
  if (!token) {
    setRequestContextAuth(null, requestTransport);
    return next();
  }
  try {
    const auth = await resolveAuthenticatedUser(token);
    if (auth) {
      auth.sessionTrust.requestTransport = requestTransport;
      (req as MaybeAuthenticatedRequest).auth = auth;
      setRequestContextAuth(auth, requestTransport);
    }
    return next();
  } catch {
    setRequestContextAuth(null, requestTransport);
    return next();
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!(req as MaybeAuthenticatedRequest).auth) {
    return res.status(401).json({ error: "Unauthorized" });
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
