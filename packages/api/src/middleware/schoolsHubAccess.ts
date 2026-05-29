import type { NextFunction, Request, Response } from "express";
import { canManageSchoolsHub, getSchoolsHubAccessScope } from "../authz/authority.js";
import type { MaybeAuthenticatedRequest } from "../types/http.js";

export function requireSchoolsHubReadAccess(req: Request, res: Response, next: NextFunction) {
  const auth = (req as MaybeAuthenticatedRequest).auth;
  if (!auth) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!getSchoolsHubAccessScope(auth)) {
    return res.status(403).json({ error: "Forbidden", action: "schools_hub.view" });
  }
  return next();
}

export function requireSchoolsHubManageAccess(req: Request, res: Response, next: NextFunction) {
  const auth = (req as MaybeAuthenticatedRequest).auth;
  if (!auth) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!canManageSchoolsHub(auth)) {
    return res.status(403).json({ error: "Forbidden", action: "schools_hub.manage" });
  }
  return next();
}
