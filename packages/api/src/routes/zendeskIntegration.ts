import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireAction } from "../middleware/rbac.js";
import { withClientTransaction } from "../db/tx.js";
import { canViewCustomerServiceMetrics } from "../authz/authority.js";
import { isActiveMembership } from "../authz/policy.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { getZendeskStatus, testZendeskConnection } from "../services/zendesk.js";
import { getRequestMeta } from "../utils/requestMeta.js";

const router = Router();

router.use(requireAuth, requireAction("dashboard.read"), requireZendeskLeadershipAccess);

router.get("/status", async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => getZendeskStatus(client, auth));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/test", async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      testZendeskConnection(client, auth, getRequestMeta(req))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;

function requireZendeskLeadershipAccess(req: Request, res: Response, next: NextFunction) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!isActiveMembership(auth)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (canViewCustomerServiceMetrics(auth)) {
    return next();
  }
  return res.status(403).json({ error: "Forbidden" });
}
