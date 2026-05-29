import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { hasAuthorityTier } from "../authz/authority.js";
import { withClientTransaction } from "../db/tx.js";
import { requireAuth } from "../middleware/auth.js";
import { requireElevatedSession } from "../middleware/security.js";
import { canConfigureSystemBehavior } from "../services/policy/operationalAuthorization.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { getRequestMeta } from "../utils/requestMeta.js";
import {
  approveSecurityApprovalRequest,
  cancelSecurityApprovalRequest,
  getSecurityOverview,
  listBreakGlassEvents,
  listSecurityApprovalRequests,
  markBreakGlassReviewed,
  rejectSecurityApprovalRequest
} from "../services/securityApprovals.js";
import { getMicrosoftSecurityTruthWorkspace, upsertMicrosoftSecurityEvidence } from "../services/microsoftSecurityTruth.js";

const router = Router();

const decisionBodySchema = z.object({
  note: z.string().max(500).optional()
});

const microsoftSecurityEvidenceSchema = z.object({
  status: z.enum(["healthy", "at_risk", "blocked"]),
  what: z.string().max(2000).optional(),
  why: z.string().max(2000).optional(),
  fix: z.string().max(2000).optional(),
  owner: z.string().max(200).optional(),
  retest: z.string().max(2000).optional(),
  expires_at: z.string().datetime().optional().nullable(),
  evidence_items: z
    .array(
      z.object({
        kind: z.enum(["screenshot", "file", "link", "note"]),
        label: z.string().min(1).max(240),
        href: z.string().max(1000).optional().nullable(),
        note: z.string().max(4000).optional().nullable()
      })
    )
    .optional()
});

router.use(requireAuth, requireSecurityReadAccess);

router.get("/overview", async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => getSecurityOverview(client, auth));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/microsoft-truth", async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => getMicrosoftSecurityTruthWorkspace(client, auth));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.put(
  "/microsoft-truth/:controlKey",
  requireSecurityManageAccess,
  requireElevatedSession,
  validateBody(microsoftSecurityEvidenceSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        upsertMicrosoftSecurityEvidence(client, auth, {
          controlKey: String(req.params.controlKey),
          status: req.body.status,
          what: req.body.what ?? null,
          why: req.body.why ?? null,
          fix: req.body.fix ?? null,
          owner: req.body.owner ?? null,
          retest: req.body.retest ?? null,
          expiresAt: req.body.expires_at ?? null,
          evidenceItems: req.body.evidence_items ?? []
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/approvals",
  validateQuery(
    z.object({
      status: z.enum(["pending", "approved", "rejected", "canceled", "executed"]).optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listSecurityApprovalRequests(client, auth, {
          status: req.query.status ? (String(req.query.status) as "pending" | "approved" | "rejected" | "canceled" | "executed") : null
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/:id/approve", requireSecurityManageAccess, requireElevatedSession, validateBody(decisionBodySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      approveSecurityApprovalRequest(client, auth, String(req.params.id), { note: req.body.note ?? null }, getRequestMeta(req))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/reject", requireSecurityManageAccess, requireElevatedSession, validateBody(decisionBodySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      rejectSecurityApprovalRequest(client, auth, String(req.params.id), { note: req.body.note ?? null }, getRequestMeta(req))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/cancel", requireElevatedSession, validateBody(decisionBodySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      cancelSecurityApprovalRequest(client, auth, String(req.params.id), { note: req.body.note ?? null }, getRequestMeta(req))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/break-glass-events", async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => listBreakGlassEvents(client, auth));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/break-glass-events/:id/review",
  requireSecurityManageAccess,
  requireElevatedSession,
  validateBody(decisionBodySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        markBreakGlassReviewed(client, auth, String(req.params.id), { note: req.body.note ?? null }, getRequestMeta(req))
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

export default router;

function requireSecurityReadAccess(req: Request, res: Response, next: NextFunction) {
  const auth = (req as AuthenticatedRequest).auth;
  if (
    auth.permissions.includes("audit.read") ||
    auth.permissions.includes("auditlog.read") ||
    canConfigureSystemBehavior(auth) ||
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])
  ) {
    return next();
  }
  return res.status(403).json({ error: "Forbidden" });
}

function requireSecurityManageAccess(req: Request, res: Response, next: NextFunction) {
  const auth = (req as AuthenticatedRequest).auth;
  if (auth.permissions.includes("security.manage") || hasAuthorityTier(auth, ["super_admin", "leadership"])) {
    return next();
  }
  return res.status(403).json({ error: "Forbidden" });
}
