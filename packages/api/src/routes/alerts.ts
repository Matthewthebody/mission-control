import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { withClientTransaction } from "../db/tx.js";
import { ApiError } from "../errors/apiError.js";
import { listAlerts, resolveAlert } from "../services/alerts.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { validateQuery } from "../middleware/validate.js";
import { getRequestMeta } from "../utils/requestMeta.js";

const router = Router();

router.get(
  "/",
  requireAuth,
  requirePermission("alerts.read"),
  validateQuery(z.object({ status: z.enum(["open", "all"]).optional(), limit: z.coerce.number().int().min(1).max(500).optional() })),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const alerts = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listAlerts(
          client,
          auth.tenantId,
          (req.query.status as "open" | "all" | undefined) ?? "open",
          req.query.limit ? Number(req.query.limit) : undefined
        )
      );
      return res.json(alerts);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/:id/resolve", requireAuth, requirePermission("alerts.resolve"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const alert = await withClientTransaction(auth.tenantId, auth.id, async (client) =>
      resolveAlert(client, auth, String(req.params.id), getRequestMeta(req))
    );
    if (!alert) {
      throw new ApiError(404, "Alert not found");
    }
    return res.json(alert);
  } catch (error) {
    return next(error);
  }
});

export default router;
