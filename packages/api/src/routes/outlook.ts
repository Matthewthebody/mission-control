import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireAction } from "../middleware/rbac.js";
import { requireElevatedSession } from "../middleware/security.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { withClientTransaction } from "../db/tx.js";
import { withSystemTransaction } from "../db/tx.js";
import { canAccessOutlookCalendarIntegration } from "../authz/authority.js";
import { isActiveMembership } from "../authz/policy.js";
import type { AuthenticatedRequest } from "../types/http.js";
import {
  connectOutlook,
  disconnectOutlook,
  getOutlookReconciliationReport,
  getOutlookStatus,
  handleOutlookOAuthCallback,
  listOutlookCalendars,
  previewOutlookEvents,
  replayOutlookSyncHistory,
  resetOutlookState,
  syncOutlook,
  updateOutlookCalendarVisibility
} from "../services/outlook.js";
import { markRequestContextAsAction } from "../services/requestContext.js";
import { getLocalDateString } from "../utils/localDate.js";
import { getRequestMeta } from "../utils/requestMeta.js";

const router = Router();

const previewFiltersSchema = z.object({
  date: z.string().optional(),
  provider: z.enum(["mock", "graph"]).optional(),
  calendar_id: z.string().optional(),
  window: z.enum(["today", "3day", "week"]).optional(),
  enabled_only: z.enum(["true", "false"]).optional(),
  overlap_only: z.enum(["true", "false"]).optional()
});

const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional()
});

const resetBodySchema = z.object({
  scope: z.enum(["mock_preview", "graph_live_connection", "pilot_tenant_test_data"])
});

const replayBodySchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  statuses: z
    .array(z.enum(["pending", "processing", "succeeded", "failed", "conflict"]))
    .min(1)
    .optional(),
  limit: z.number().int().min(1).max(500).optional()
});

router.get("/oauth/callback", validateQuery(callbackQuerySchema), async (req, res, next) => {
  try {
    markRequestContextAsAction();
    const redirectUrl = await withSystemTransaction((client) =>
      handleOutlookOAuthCallback(
        client,
        {
          code: req.query.code ? String(req.query.code) : undefined,
          state: req.query.state ? String(req.query.state) : undefined,
          error: req.query.error ? String(req.query.error) : undefined,
          errorDescription: req.query.error_description ? String(req.query.error_description) : undefined
        },
        getRequestMeta(req)
      )
    );
    return res.redirect(302, redirectUrl);
  } catch (error) {
    return next(error);
  }
});

router.use(requireAuth, requireAction("dashboard.read"), requireOutlookAccess);

router.get("/status", validateQuery(previewFiltersSchema.pick({ date: true })), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const date = req.query.date ? String(req.query.date) : getLocalDateString();
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => getOutlookStatus(client, auth, date));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/connect", requireElevatedSession, validateQuery(previewFiltersSchema.pick({ date: true, provider: true })), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const date = req.query.date ? String(req.query.date) : getLocalDateString();
    const provider = req.query.provider === "graph" ? "graph" : "mock";
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      connectOutlook(client, auth, date, provider, getRequestMeta(req))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/disconnect", requireElevatedSession, validateQuery(previewFiltersSchema.pick({ date: true })), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const date = req.query.date ? String(req.query.date) : getLocalDateString();
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      disconnectOutlook(client, auth, date, getRequestMeta(req))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/reset",
  requireElevatedSession,
  validateQuery(previewFiltersSchema.pick({ date: true })),
  validateBody(resetBodySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const date = req.query.date ? String(req.query.date) : getLocalDateString();
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        resetOutlookState(client, auth, date, req.body.scope, getRequestMeta(req))
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/sync", requireElevatedSession, validateQuery(previewFiltersSchema.pick({ date: true })), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const date = req.query.date ? String(req.query.date) : getLocalDateString();
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      syncOutlook(client, auth, date, getRequestMeta(req))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/replay", requireElevatedSession, validateBody(replayBodySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      replayOutlookSyncHistory(client, auth, {
        dateFrom: req.body.date_from ?? null,
        dateTo: req.body.date_to ?? null,
        statuses: req.body.statuses ?? null,
        limit: req.body.limit
      })
    );
    return res.status(202).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/calendars", validateQuery(previewFiltersSchema.pick({ date: true })), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const date = req.query.date ? String(req.query.date) : getLocalDateString();
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => listOutlookCalendars(client, auth, date));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.patch(
  "/calendars/:id/visibility",
  requireElevatedSession,
  validateQuery(previewFiltersSchema.pick({ date: true })),
  validateBody(
    z.object({
      visible_in_app: z.boolean()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const date = req.query.date ? String(req.query.date) : getLocalDateString();
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updateOutlookCalendarVisibility(
          client,
          auth,
          {
            calendarId: String(req.params.id),
            visibleInApp: Boolean(req.body.visible_in_app),
            date
          },
          getRequestMeta(req)
        )
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/events/preview",
  validateQuery(previewFiltersSchema.pick({ date: true, calendar_id: true, overlap_only: true, window: true, enabled_only: true })),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        previewOutlookEvents(client, auth, {
          date: req.query.date ? String(req.query.date) : getLocalDateString(),
          calendarId: req.query.calendar_id ? String(req.query.calendar_id) : undefined,
          overlapOnly: req.query.overlap_only === "true",
          window: req.query.window ? (String(req.query.window) as "today" | "3day" | "week") : "today",
          enabledOnly: req.query.enabled_only === "false" ? false : true
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/reconciliation",
  validateQuery(previewFiltersSchema.pick({ date: true, window: true })),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getOutlookReconciliationReport(client, auth, {
          date: req.query.date ? String(req.query.date) : getLocalDateString(),
          window: req.query.window ? (String(req.query.window) as "today" | "3day" | "week") : "week"
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

export default router;

function requireOutlookAccess(req: Request, res: Response, next: NextFunction) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!isActiveMembership(auth)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (canAccessOutlookCalendarIntegration(auth)) {
    return next();
  }
  return res.status(403).json({ error: "Forbidden" });
}
