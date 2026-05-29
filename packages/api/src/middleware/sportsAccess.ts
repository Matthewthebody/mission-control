import type { NextFunction, Request, Response } from "express";
import {
  canManageSportsFinance,
  canManageSportsSettings,
  canManageSportsWorkspace,
  canPublishSportsImports,
  getSportsWorkspaceAccessScope
} from "../authz/authority.js";
import type { MaybeAuthenticatedRequest } from "../types/http.js";

function getAuth(req: Request) {
  return (req as MaybeAuthenticatedRequest).auth;
}

export function requireSportsReadAccess(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!getSportsWorkspaceAccessScope(auth)) {
    return res.status(403).json({ error: "Forbidden", action: "sports_hub.view" });
  }
  return next();
}

export function requireSportsManageAccess(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!canManageSportsWorkspace(auth)) {
    return res.status(403).json({ error: "Forbidden", action: "sports_hub.manage" });
  }
  return next();
}

export function requireSportsFinanceAccess(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!canManageSportsFinance(auth)) {
    return res.status(403).json({ error: "Forbidden", action: "sports_finance.manage" });
  }
  return next();
}

export function requireSportsSettingsAccess(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!canManageSportsSettings(auth)) {
    return res.status(403).json({ error: "Forbidden", action: "sports_hub.settings" });
  }
  return next();
}

export function requireSportsImportPublishAccess(req: Request, res: Response, next: NextFunction) {
  const auth = getAuth(req);
  if (!auth) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!canPublishSportsImports(auth)) {
    return res.status(403).json({ error: "Forbidden", action: "sports_hub.import_publish" });
  }
  return next();
}
