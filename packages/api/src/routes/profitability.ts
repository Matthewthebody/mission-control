import { canViewProfitabilityLeadership } from "../authz/authority.js";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { withClientTransaction } from "../db/tx.js";
import { ApiError } from "../errors/apiError.js";
import { requireAuth } from "../middleware/auth.js";
import { hasOperationalPermission } from "../services/policy/operationalAuthorization.js";
import { validateQuery } from "../middleware/validate.js";
import { getProfitabilityPhase0Contract } from "../domain/profitability/index.js";
import { hasFinanceSensitiveAccess } from "../services/appAuthorization.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { getLocalDateString } from "../utils/localDate.js";
import { loadProfitabilityWorkspace } from "../application/profitability/load-profitability-workspace.action.js";

const router = Router();

function requireFinanceOverlay(req: Request, _res: Response, next: NextFunction) {
  const auth = (req as AuthenticatedRequest).auth;
  if (auth && hasFinanceSensitiveAccess(auth)) {
    return next();
  }
  return next(new ApiError(403, "Finance-sensitive access is not enabled for this user."));
}

function requireProfitabilityReadAccess(req: Request, res: Response, next: NextFunction) {
  const auth = (req as AuthenticatedRequest).auth;
  if (hasOperationalPermission(auth, "profitability.read") || canViewProfitabilityLeadership(auth)) {
    return next();
  }
  return res.status(403).json({ error: "Forbidden", permission: "profitability.read" });
}

const workspaceQuerySchema = z.object({
  date: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  department: z.string().optional(),
  focus: z.enum(["overview", "watch", "burden", "data_health"]).optional()
});

router.get(
  "/contracts",
  requireAuth,
  requireProfitabilityReadAccess,
  requireFinanceOverlay,
  (_req, res) => {
    return res.json(getProfitabilityPhase0Contract());
  }
);

router.get(
  "/workspace",
  requireAuth,
  requireProfitabilityReadAccess,
  requireFinanceOverlay,
  validateQuery(workspaceQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const anchorDate = req.query.date ? String(req.query.date) : getLocalDateString();
      const dateFrom = req.query.date_from ? String(req.query.date_from) : addDays(anchorDate, -14);
      const dateTo = req.query.date_to ? String(req.query.date_to) : addDays(anchorDate, 30);
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        loadProfitabilityWorkspace(client, auth, {
          anchorDate,
          dateFrom,
          dateTo,
          department: req.query.department ? String(req.query.department) : null,
          focus: req.query.focus ? (String(req.query.focus) as "overview" | "watch" | "burden" | "data_health") : "overview"
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

function addDays(value: string, days: number) {
  const next = new Date(`${value}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export default router;
