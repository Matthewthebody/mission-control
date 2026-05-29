import { Router } from "express";
import { z } from "zod";
import { withClientTransaction } from "../db/tx.js";
import { requireAuth } from "../middleware/auth.js";
import { requireOperatingSystemModuleManage, requireOperatingSystemModuleView } from "../middleware/operatingSystemAccess.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { applyExceptionAction, getExceptionDetail, getExceptionWorkspace, reconcileUrgentWatchWorkspace } from "../services/urgentWatch.js";
import { getLocalDateString } from "../utils/localDate.js";
import type { AuthenticatedRequest } from "../types/http.js";

const router = Router();

// Canonical operator-facing exception center.
// /api/watch remains available only as a migration alias.

const workspaceQuerySchema = z.object({
  date: z.string().optional()
});

const reconcileBodySchema = z.object({
  date: z.string().optional()
});

const exceptionActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign_owner"),
    owner_user_id: z.string().uuid().nullable(),
    note: z.string().trim().max(1000).nullable().optional()
  }),
  z.object({
    action: z.literal("snooze"),
    reason: z.string().trim().min(2).max(240),
    duration_minutes: z.number().int().min(5).max(7 * 24 * 60),
    note: z.string().trim().max(1000).nullable().optional()
  }),
  z.object({
    action: z.literal("mark_handled"),
    note: z.string().trim().max(1000).nullable().optional()
  })
]);

router.get("/", requireAuth, requireOperatingSystemModuleView("exceptions"), validateQuery(workspaceQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getExceptionWorkspace(client, auth, {
        date: req.query.date ? String(req.query.date) : getLocalDateString()
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/reconcile", requireAuth, requireOperatingSystemModuleManage("exceptions"), validateBody(reconcileBodySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    await withClientTransaction(auth.tenantId, auth.id, (client) =>
      reconcileUrgentWatchWorkspace(client, auth, {
        date: req.body.date ? String(req.body.date) : getLocalDateString()
      })
    );
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", requireAuth, requireOperatingSystemModuleView("exceptions"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getExceptionDetail(client, auth, String(req.params.id))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/actions", requireAuth, requireOperatingSystemModuleManage("exceptions"), validateBody(exceptionActionSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      applyExceptionAction(client, auth, String(req.params.id), req.body)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;
