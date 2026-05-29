import type { NextFunction, Request, Response } from "express";
import { canPerformAction, LEGACY_PERMISSION_TO_ACTION, type AccessAction } from "../authz/policy.js";
import { isSharedPermissionKey } from "../services/policy/permissionRegistry.js";
import { hasOperationalPermission } from "../services/policy/operationalAuthorization.js";
import type { MaybeAuthenticatedRequest } from "../types/http.js";

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = (req as MaybeAuthenticatedRequest).auth;
    if (!auth) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (isSharedPermissionKey(permission)) {
      if (!hasOperationalPermission(auth, permission)) {
        return res.status(403).json({ error: "Forbidden", permission });
      }
      return next();
    }
    const action = LEGACY_PERMISSION_TO_ACTION[permission];
    if (!auth.permissions.includes(permission)) {
      return res.status(403).json({ error: "Forbidden", permission });
    }
    if (action && !canPerformAction(auth, action)) {
      return res.status(403).json({ error: "Forbidden", permission });
    }
    return next();
  };
}

export function requireAction(action: AccessAction) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = (req as MaybeAuthenticatedRequest).auth;
    if (!auth) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!auth.permissions.includes(action) || !canPerformAction(auth, action)) {
      return res.status(403).json({ error: "Forbidden", action });
    }
    return next();
  };
}
