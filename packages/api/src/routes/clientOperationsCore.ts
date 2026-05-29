import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { hasAuthorityTier } from "../authz/authority.js";
import { requireAuth } from "../middleware/auth.js";
import { getClientOperationsCoreContract } from "../services/clientOperationsCoreContracts.js";
import type { AuthenticatedRequest } from "../types/http.js";

const router = Router();

router.get("/contracts", requireAuth, requireClientOperationsCoreReadAccess, (_req, res) => {
  return res.json(getClientOperationsCoreContract());
});

function requireClientOperationsCoreReadAccess(req: Request, res: Response, next: NextFunction) {
  const auth = (req as AuthenticatedRequest).auth;
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    return next();
  }
  return res.status(403).json({ error: "Forbidden" });
}

export default router;
