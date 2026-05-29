import { Router } from "express";
import { z } from "zod";
import { withClientTransaction } from "../db/tx.js";
import { featureFlags } from "../featureFlags.js";
import { requireAuth } from "../middleware/auth.js";
import { requireFeatureFlag } from "../middleware/featureFlag.js";
import { requireOperatingSystemModuleManage, requireOperatingSystemModuleView } from "../middleware/operatingSystemAccess.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import {
  applyOperationalApprovalDecision,
  createOperationalApprovalRequest,
  getOperationalApprovalDetail,
  listOperationalApprovalSourceSummary,
  listOperationalApprovalWorkspace
} from "../services/operationalApprovals.js";
import type { AuthenticatedRequest } from "../types/http.js";

const router = Router();
router.use(requireFeatureFlag(featureFlags.coreApprovalFramework, { message: "Operational approvals are currently disabled." }));

const sourceSummarySchema = z.object({
  source_module: z.string().min(1),
  source_entity_type: z.string().min(1),
  source_entity_id: z.string().min(1)
});

const approvalActionSchema = z.object({
  action: z.enum(["approve", "reject", "send_back", "cancel", "resubmit", "delegate"]),
  note: z.string().trim().max(2000).nullable().optional(),
  delegate_to_user_id: z.string().uuid().nullable().optional()
});

const createOperationalApprovalSchema = z.object({
  request_type: z.enum([
    "staffing_exception_approval",
    "schedule_change_approval",
    "role_override_approval",
    "overtime_labor_exception_approval",
    "rush_order_approval",
    "fee_refund_approval",
    "due_date_extension_approval",
    "deadline_override_approval",
    "peer_review_exception_approval",
    "qc_exception_approval",
    "release_override_approval",
    "rework_waiver_approval",
    "cancellation_approval",
    "policy_exception_approval"
  ]),
  source_module: z.string().trim().min(1),
  source_entity_type: z.enum(["job", "production_item"]),
  source_entity_id: z.string().trim().min(1),
  requested_action_code: z.string().trim().min(1),
  request_title: z.string().trim().min(1).max(200),
  request_summary: z.string().trim().max(500).nullable().optional(),
  reason: z.string().trim().min(1).max(4000),
  severity: z.enum(["low", "normal", "high", "critical"]).nullable().optional(),
  blocking: z.boolean().nullable().optional(),
  current_state: z.record(z.string(), z.unknown()).optional(),
  requested_state: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  dedupe_key: z.string().trim().max(200).nullable().optional()
});

router.get("/operational", requireAuth, requireOperatingSystemModuleView("approvals"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => listOperationalApprovalWorkspace(client, auth));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/operational/:id", requireAuth, requireOperatingSystemModuleView("approvals"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getOperationalApprovalDetail(client, auth, String(req.params.id))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/operational", requireAuth, validateBody(createOperationalApprovalSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createOperationalApprovalRequest(client, auth, {
        request_type: req.body.request_type,
        source_module: req.body.source_module,
        source_entity_type: req.body.source_entity_type,
        source_entity_id: req.body.source_entity_id,
        requested_action_code: req.body.requested_action_code,
        request_title: req.body.request_title,
        request_summary: req.body.request_summary ?? null,
        reason: req.body.reason,
        severity: req.body.severity ?? null,
        blocking: req.body.blocking ?? null,
        current_state: req.body.current_state,
        requested_state: req.body.requested_state,
        metadata: req.body.metadata,
        dedupe_key: req.body.dedupe_key ?? null
      })
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/operational/:id/actions", requireAuth, requireOperatingSystemModuleManage("approvals"), validateBody(approvalActionSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      applyOperationalApprovalDecision(client, auth, String(req.params.id), {
        action: req.body.action,
        note: req.body.note ?? null,
        delegate_to_user_id: req.body.delegate_to_user_id ?? null
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/source-summary", requireAuth, validateQuery(sourceSummarySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listOperationalApprovalSourceSummary(client, auth, {
        sourceModule: String(req.query.source_module),
        sourceEntityType: String(req.query.source_entity_type),
        sourceEntityId: String(req.query.source_entity_id)
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;
