import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { withClientTransaction } from "../db/tx.js";
import type { AuthenticatedRequest } from "../types/http.js";
import {
  acknowledgeNotification,
  canReadNotificationInbox,
  getNotificationCenter,
  listNotifications,
  markNotificationsSeen,
  resolveNotification,
  snoozeNotification
} from "../services/opsNotifications.js";

const router = Router();

function ensureNotificationReadAccess(req: AuthenticatedRequest, res: any) {
  if (!canReadNotificationInbox(req.auth)) {
    res.status(403).json({ error: "Forbidden", action: "notification.read" });
    return false;
  }
  return true;
}

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    if (!ensureNotificationReadAccess(req as AuthenticatedRequest, res)) {
      return;
    }
    const includeResolved = String(req.query.include_resolved ?? "false") === "true";
    const limit = Number.isFinite(Number(req.query.limit)) ? Math.max(1, Math.min(Number(req.query.limit), 100)) : 25;
    const rows = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listNotifications(client, auth, {
        limit,
        includeResolved
      })
    );
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.get("/center", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    if (!ensureNotificationReadAccess(req as AuthenticatedRequest, res)) {
      return;
    }
    const limit = Number.isFinite(Number(req.query.limit)) ? Math.max(1, Math.min(Number(req.query.limit), 100)) : 50;
    const requestedView = String(req.query.view ?? "all");
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getNotificationCenter(client, auth, {
        limit,
        view:
          requestedView === "my_action_needed" ||
          requestedView === "team_risk" ||
          requestedView === "approval_queue" ||
          requestedView === "escalated" ||
          requestedView === "resolved_recent"
            ? requestedView
            : "all"
      })
    );
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.post("/seen", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    if (!ensureNotificationReadAccess(req as AuthenticatedRequest, res)) {
      return;
    }
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0) : undefined;
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) => markNotificationsSeen(client, auth, ids));
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/acknowledge", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    if (!ensureNotificationReadAccess(req as AuthenticatedRequest, res)) {
      return;
    }
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) => acknowledgeNotification(client, auth, String(req.params.id)));
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/snooze", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    if (!ensureNotificationReadAccess(req as AuthenticatedRequest, res)) {
      return;
    }
    const minutes = Number.isFinite(Number(req.body?.minutes)) ? Number(req.body.minutes) : undefined;
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) => snoozeNotification(client, auth, String(req.params.id), minutes));
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/resolve", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    if (!ensureNotificationReadAccess(req as AuthenticatedRequest, res)) {
      return;
    }
    const response = await withClientTransaction(auth.tenantId, auth.id, (client) => resolveNotification(client, auth, String(req.params.id)));
    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

export default router;
