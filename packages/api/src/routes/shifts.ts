import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireAction } from "../middleware/rbac.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { withClientTransaction } from "../db/tx.js";
import type { AuthenticatedRequest } from "../types/http.js";
import {
  cancelTradeRequest,
  createShift,
  deleteShift,
  getShiftById,
  listScheduleMembers,
  listTradeCandidates,
  listShifts,
  listTradeRequests,
  publishShift,
  respondToTradeRequest,
  requestShiftTrade,
  reviewTradeRequest,
  updateShift
} from "../services/scheduling.js";
import {
  availabilityRequestStatuses,
  availabilityRequestTypes,
  blockedDateTypes,
  cancelPTORequest,
  createAvailabilityRule,
  createBlockedDate,
  createPTORequest,
  exportPTORequestsCsv,
  listAvailabilityRules,
  listBlockedDates,
  listPTORequests,
  recurringAvailabilityRuleTypes,
  reportSameDayAbsence,
  reviewPTORequest
} from "../services/availabilityRequests.js";
import { getRequestMeta } from "../utils/requestMeta.js";
import { getLocalDateString } from "../utils/localDate.js";

const router = Router();
const tradeStatuses = ["pending_recipient", "recipient_declined", "pending_manager", "approved", "denied", "canceled"] as const;
const ptoStatuses = availabilityRequestStatuses;

const segmentSchema = z.object({
  segment_kind: z.enum(["studio_prep", "travel", "shoot", "studio_wrap", "office", "training", "break", "other"]),
  label: z.string().min(1),
  scheduled_start_at: z.string().min(1),
  scheduled_end_at: z.string().min(1),
  rate_code: z.string().min(1),
  hourly_rate_cents: z.number().int().nonnegative(),
  sort_order: z.number().int().nonnegative().optional()
});

const shiftSchema = z.object({
  shoot_id: z.string().uuid().nullable().optional(),
  studio_id: z.string().uuid().nullable().optional(),
  assigned_user_id: z.string().uuid(),
  manager_user_id: z.string().uuid().nullable().optional(),
  shift_kind: z.enum(["shoot", "studio", "office", "training"]),
  department: z.enum(["executive", "operations", "schools", "sports", "office", "production", "customer_service", "unassigned"]),
  staffing_role: z.enum(["lead_photographer", "senior_photographer", "photographer", "support", "check_in", "assistant", "producer", "custom"]).optional(),
  satisfies_lead_coverage: z.boolean().optional(),
  title: z.string().min(1),
  starts_at: z.string().min(1),
  ends_at: z.string().min(1),
  location_name: z.string().optional(),
  location_address: z.string().optional(),
  location_lat: z.number().nullable().optional(),
  location_lng: z.number().nullable().optional(),
  geofence_radius_meters: z.number().int().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
  segments: z.array(segmentSchema).optional()
});

const availabilityRequestSchema = z.object({
  requested_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  request_unit: z.enum(["half_day", "full_day"]).optional(),
  reason: z.string().nullable().optional(),
  request_type: z.enum(availabilityRequestTypes).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  all_day: z.boolean().optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  reason_category: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  recurring_rule: z
    .object({
      rule_type: z.enum(recurringAvailabilityRuleTypes),
      weekdays: z.array(z.number().int().min(0).max(6)).optional(),
      start_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
      end_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
      season_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      season_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      note: z.string().trim().max(500).nullable().optional()
    })
    .nullable()
    .optional()
});

const availabilityReviewSchema = z.object({
  status: z.enum(["approved", "rejected", "needs_review"]),
  notes: z.string().nullable().optional(),
  live_operational_absence_state: z.enum(["excused", "unexcused", "pending_coverage_review"]).nullable().optional()
});

const availabilityRuleSchema = z.object({
  user_id: z.string().uuid(),
  department: z.enum(["executive", "operations", "schools", "sports", "office", "production", "customer_service", "unassigned"]).nullable().optional(),
  rule_type: z.enum(recurringAvailabilityRuleTypes),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  season_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  season_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional()
});

const blockedDateSchema = z.object({
  target_scope: z.enum(["company", "department", "user"]),
  target_department: z.enum(["executive", "operations", "schools", "sports", "office", "production", "customer_service", "unassigned"]).nullable().optional(),
  target_user_id: z.string().uuid().nullable().optional(),
  block_type: z.enum(blockedDateTypes),
  block_severity: z.enum(["soft", "hard"]).optional(),
  label: z.string().trim().min(1).max(160),
  starts_at: z.string().min(1),
  ends_at: z.string().min(1),
  approval_required: z.boolean().optional(),
  note: z.string().trim().max(1000).nullable().optional()
});

router.get(
  "/",
  requireAuth,
  requireAction("schedule.read"),
  validateQuery(
    z.object({
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      assigned_user_id: z.string().uuid().optional(),
      shoot_id: z.string().uuid().optional(),
      status: z.enum(["draft", "published", "cancelled", "completed"]).optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const rows = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listShifts(client, auth, {
          dateFrom: req.query.date_from ? String(req.query.date_from) : undefined,
          dateTo: req.query.date_to ? String(req.query.date_to) : undefined,
          assignedUserId: req.query.assigned_user_id ? String(req.query.assigned_user_id) : undefined,
          shootId: req.query.shoot_id ? String(req.query.shoot_id) : undefined,
          status: req.query.status as "draft" | "published" | "cancelled" | "completed" | undefined
        })
      );
      return res.json(rows);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/resources/members",
  requireAuth,
  requireAction("schedule.read"),
  validateQuery(z.object({ anchor_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const rows = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listScheduleMembers(client, auth, req.query.anchor_date ? String(req.query.anchor_date) : getLocalDateString())
    );
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
  }
);

router.get("/:id/trade-candidates", requireAuth, requireAction("trade.request"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const rows = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listTradeCandidates(client, auth, String(req.params.id))
    );
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.post("/", requireAuth, requireAction("schedule.manage"), validateBody(shiftSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const shift = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createShift(client, auth, req.body, getRequestMeta(req))
    );
    return res.status(201).json(shift);
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/trade-requests/list",
  requireAuth,
  requireAction("schedule.read"),
  validateQuery(z.object({ status: z.enum(tradeStatuses).optional() })),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const rows = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listTradeRequests(client, auth, (req.query.status as any) ?? null)
      );
      return res.json(rows);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/:id/trade-requests",
  requireAuth,
  requireAction("trade.request"),
  validateBody(z.object({ requested_with_user_id: z.string().uuid(), reason: z.string().min(1) })),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const trade = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        requestShiftTrade(client, auth, String(req.params.id), req.body, getRequestMeta(req))
      );
      return res.status(201).json(trade);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/trade-requests/:id/respond",
  requireAuth,
  validateBody(z.object({ status: z.enum(["accepted", "declined"]), notes: z.string().nullable().optional() })),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        respondToTradeRequest(client, auth, String(req.params.id), req.body, getRequestMeta(req))
      );
      return res.json(result);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/trade-requests/:id/review",
  requireAuth,
  validateBody(z.object({ status: z.enum(["approved", "denied"]), notes: z.string().nullable().optional() })),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        reviewTradeRequest(client, auth, String(req.params.id), req.body, getRequestMeta(req))
      );
      return res.json(result);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/trade-requests/:id/cancel", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      cancelTradeRequest(client, auth, String(req.params.id), getRequestMeta(req))
    );
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/pto-requests/:id/review",
  requireAuth,
  validateBody(availabilityReviewSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        reviewPTORequest(client, auth, String(req.params.id), req.body, getRequestMeta(req))
      );
      return res.json(result);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/pto-requests/list",
  requireAuth,
  validateQuery(z.object({ status: z.enum(ptoStatuses).optional() })),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const rows = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listPTORequests(client, auth, req.query.status ? String(req.query.status) : null)
      );
      return res.json(rows);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/pto-requests",
  requireAuth,
  requireAction("pto.request"),
  validateBody(availabilityRequestSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const row = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createPTORequest(client, auth, req.body, getRequestMeta(req))
      );
      return res.status(201).json(row);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/pto-requests/:id/cancel", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      cancelPTORequest(client, auth, String(req.params.id), getRequestMeta(req))
    );
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/absence-reports",
  requireAuth,
  requireAction("pto.request"),
  validateBody(
    z.object({
      note: z.string().trim().max(1000).nullable().optional(),
      reason_category: z.string().trim().max(120).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const row = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        reportSameDayAbsence(client, auth, req.body, getRequestMeta(req))
      );
      return res.status(201).json(row);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/availability-rules",
  requireAuth,
  validateQuery(z.object({ user_id: z.string().uuid().optional() })),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const rows = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listAvailabilityRules(client, auth, req.query.user_id ? String(req.query.user_id) : null)
      );
      return res.json(rows);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/availability-rules", requireAuth, validateBody(availabilityRuleSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const row = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createAvailabilityRule(client, auth, req.body, getRequestMeta(req))
    );
    return res.status(201).json(row);
  } catch (error) {
    return next(error);
  }
});

router.get("/blocked-dates", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const rows = await withClientTransaction(auth.tenantId, auth.id, (client) => listBlockedDates(client, auth));
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

router.post("/blocked-dates", requireAuth, validateBody(blockedDateSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const row = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createBlockedDate(client, auth, req.body, getRequestMeta(req))
    );
    return res.status(201).json(row);
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/pto-requests/export",
  requireAuth,
  validateQuery(
    z.object({
      status: z.enum(ptoStatuses).optional(),
      date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const csv = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        exportPTORequestsCsv(client, auth, {
          status: req.query.status ? String(req.query.status) : null,
          dateFrom: req.query.date_from ? String(req.query.date_from) : null,
          dateTo: req.query.date_to ? String(req.query.date_to) : null
        })
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=\"pto-export.csv\"");
      return res.send(csv);
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/:id", requireAuth, requireAction("schedule.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const shift = await withClientTransaction(auth.tenantId, auth.id, (client) => getShiftById(client, auth, String(req.params.id)));
    return res.json(shift);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:id", requireAuth, requireAction("schedule.manage"), validateBody(shiftSchema.partial()), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const shift = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateShift(client, auth, String(req.params.id), req.body, getRequestMeta(req))
    );
    return res.json(shift);
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/publish", requireAuth, requireAction("schedule.publish"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const shift = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      publishShift(client, auth, String(req.params.id), getRequestMeta(req))
    );
    return res.json(shift);
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const removed = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      deleteShift(client, auth, String(req.params.id), getRequestMeta(req))
    );
    return res.json({ deleted: removed });
  } catch (error) {
    return next(error);
  }
});

export default router;
