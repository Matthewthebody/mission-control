import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireAction } from "../middleware/rbac.js";
import { validateQuery } from "../middleware/validate.js";
import { withClientTransaction } from "../db/tx.js";
import { canViewCustomerServiceMetrics } from "../authz/authority.js";
import { isActiveMembership } from "../authz/policy.js";
import type { AuthenticatedRequest } from "../types/http.js";
import {
  getZendeskLeadershipSummary,
  getZendeskLeadershipTicketList,
  getZendeskLeadershipTrends,
  syncZendeskReporting
} from "../services/zendesk.js";
import { getRequestMeta } from "../utils/requestMeta.js";

const router = Router();

const trendQuerySchema = z.object({
  range: z.enum(["7d", "30d", "this_week", "this_month"]).optional()
});

const ticketListQuerySchema = z.object({
  status: z.enum(["open", "all"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

router.use(requireAuth, requireAction("dashboard.read"), requireZendeskLeadershipAccess);

router.post("/sync", async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      syncZendeskReporting(client, auth, getRequestMeta(req))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/leadership-summary", async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getZendeskLeadershipSummary(client, auth)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/leadership-trends", validateQuery(trendQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getZendeskLeadershipTrends(client, auth, req.query.range ? String(req.query.range) as "7d" | "30d" | "this_week" | "this_month" : "7d")
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/leadership-ticket-list", validateQuery(ticketListQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getZendeskLeadershipTicketList(client, auth, {
        status: req.query.status ? String(req.query.status) as "open" | "all" : "open",
        limit: req.query.limit ? Number(req.query.limit) : 12
      })
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
