import type { NextFunction, Request, Response } from "express";
import { canManageCanonicalDirectoryRecords, canManageSchoolFoundation } from "../authz/authority.js";
import type { MaybeAuthenticatedRequest } from "../types/http.js";

export function requireCanonicalDirectoryReadAccess(req: Request, res: Response, next: NextFunction) {
  const auth = (req as MaybeAuthenticatedRequest).auth;
  if (!auth) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

export function requireCanonicalDirectoryManageAccess(req: Request, res: Response, next: NextFunction) {
  const auth = (req as MaybeAuthenticatedRequest).auth;
  if (!auth) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!canManageCanonicalDirectoryRecords(auth)) {
    return res.status(403).json({ error: "Forbidden", action: "directory.manage" });
  }
  return next();
}

export function requireSchoolFoundationManageAccess(req: Request, res: Response, next: NextFunction) {
  const auth = (req as MaybeAuthenticatedRequest).auth;
  if (!auth) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!canManageSchoolFoundation(auth)) {
    return res.status(403).json({ error: "Forbidden", action: "school_foundation.manage" });
  }
  return next();
}
