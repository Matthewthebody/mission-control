import type { NextFunction, Request, Response } from "express";
import { canManageOperatingSystemModule, getOperatingSystemScope } from "../services/operatingSystemAccess.js";
import type { MaybeAuthenticatedRequest } from "../types/http.js";
import type { OperatingSystemModuleKey } from "../types/operatingSystem.js";

export function requireOperatingSystemModuleView(module: OperatingSystemModuleKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = (req as MaybeAuthenticatedRequest).auth;
    if (!auth) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (getOperatingSystemScope(auth, module) === "none") {
      return res.status(403).json({ error: "Forbidden", action: `${module}.view` });
    }
    return next();
  };
}

export function requireOperatingSystemModuleManage(module: OperatingSystemModuleKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = (req as MaybeAuthenticatedRequest).auth;
    if (!auth) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!canManageOperatingSystemModule(auth, module)) {
      return res.status(403).json({ error: "Forbidden", action: `${module}.manage` });
    }
    return next();
  };
}
