import { type NextFunction, type Request, type Response, Router } from "express";
import { z } from "zod";
import { canViewComplianceWorkspace } from "../authz/authority.js";
import { requireAuth } from "../middleware/auth.js";
import { requireFeatureFlag } from "../middleware/featureFlag.js";
import { validateQuery } from "../middleware/validate.js";
import { withClientTransaction } from "../db/tx.js";
import { featureFlags } from "../featureFlags.js";
import type { AuthenticatedRequest } from "../types/http.js";
import {
  getComplianceWorkspaceItemDetail,
  listComplianceWorkspaceItems
} from "../services/complianceWorkspace.js";
import { listComplianceIncidentPatterns } from "../services/compliancePatterns.js";

const router = Router();

router.use(requireFeatureFlag(featureFlags.complianceWorkspaceV1, { message: "Compliance Workspace is currently disabled." }));

function requireComplianceWorkspaceView(req: Request, res: Response, next: NextFunction) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!canViewComplianceWorkspace(auth)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
}

// G6 slice 1: repeated-incident pattern report (leadership lens over the same
// gate as the workspace — read-only, no new write paths).
router.get(
  "/patterns",
  requireAuth,
  requireComplianceWorkspaceView,
  validateQuery(
    z.object({
      window_days: z.coerce.number().int().min(7).max(365).optional(),
      min_incidents: z.coerce.number().int().min(1).max(20).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listComplianceIncidentPatterns(client, auth, {
          windowDays: req.query.window_days ? Number(req.query.window_days) : undefined,
          minIncidents: req.query.min_incidents ? Number(req.query.min_incidents) : undefined,
          limit: req.query.limit ? Number(req.query.limit) : undefined
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/workspace",
  requireAuth,
  requireComplianceWorkspaceView,
  validateQuery(
    z.object({
      date: z.string().optional(),
      window: z.enum(["today", "this_week", "overdue", "all"]).optional(),
      status: z.enum(["unresolved", "resolved", "all"]).optional(),
      employee_id: z.string().uuid().optional(),
      organization_id: z.string().uuid().optional(),
      shoot_id: z.string().uuid().optional(),
      issue_type: z
        .enum([
          "missing_setup_photo",
          "missing_post_shoot_evaluation",
          "mileage_blocked_missing_post_shoot_evaluation",
          "upload_while_off_clock",
          "unresolved_end_of_day_confirmation",
          "no_lunch_challenge",
          "missed_clock_in_request",
          "likely_present_missing_clock_in",
          "assigned_but_missing",
          "manual_time_adjustment",
          "mileage_review_required"
        ])
        .optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listComplianceWorkspaceItems(client, auth, {
          date: req.query.date ? String(req.query.date) : undefined,
          window: req.query.window ? (String(req.query.window) as "today" | "this_week" | "overdue" | "all") : undefined,
          status: req.query.status ? (String(req.query.status) as "unresolved" | "resolved" | "all") : undefined,
          employeeId: req.query.employee_id ? String(req.query.employee_id) : undefined,
          organizationId: req.query.organization_id ? String(req.query.organization_id) : undefined,
          shootId: req.query.shoot_id ? String(req.query.shoot_id) : undefined,
          issueType: req.query.issue_type
            ? (String(req.query.issue_type) as
                | "missing_setup_photo"
                | "missing_post_shoot_evaluation"
                | "mileage_blocked_missing_post_shoot_evaluation"
                | "upload_while_off_clock"
                | "unresolved_end_of_day_confirmation"
                | "no_lunch_challenge"
                | "missed_clock_in_request"
                | "likely_present_missing_clock_in"
                | "assigned_but_missing"
                | "manual_time_adjustment"
                | "mileage_review_required")
            : undefined
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/workspace/:sourceKind/:sourceId",
  requireAuth,
  requireComplianceWorkspaceView,
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const sourceKind = String(req.params.sourceKind);
      const sourceId = String(req.params.sourceId);
      if (
        !["compliance_flag", "attendance_exception", "presence_incident", "exception_request", "mileage_reimbursement"].includes(
          sourceKind
        )
      ) {
        return res.status(400).json({ error: "Unsupported compliance source kind." });
      }

      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getComplianceWorkspaceItemDetail(client, auth, {
          sourceKind: sourceKind as
            | "compliance_flag"
            | "attendance_exception"
            | "presence_incident"
            | "exception_request"
            | "mileage_reimbursement",
          sourceId
        })
      );

      if (!payload) {
        return res.status(404).json({ error: "Compliance review item not found." });
      }

      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
