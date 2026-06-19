import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireAction } from "../middleware/rbac.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { withClientTransaction } from "../db/tx.js";
import type { AuthenticatedRequest } from "../types/http.js";
import {
  acknowledgeScheduleIntegrationReview,
  applyStaffingTemplateToShoot,
  createScheduleEvent,
  createStaffingTemplate,
  getScheduleEventById,
  listStaffingTemplates,
  listUnifiedScheduleBoard,
  listUnifiedScheduleCalendar,
  moveScheduleItem,
  pushScheduleItemToOutlook,
  triggerScheduleItemOutlookResync,
  updateScheduleEvent
} from "../services/schedule.js";
import {
  assignShootStaffingSlot,
  getShootStaffingSnapshot,
  getStaffingDashboardOverview,
  publishShootStaffing,
  removeShootStaffingAssignment
} from "../services/scheduleStaffing.js";
import { getStaffingCapacityPlan, type CapacityWindow } from "../services/staffingCapacity.js";
import { STAFFING_CAPACITY_TIMEZONE } from "../domain/staffing/staffing-capacity.js";
import { getRequestMeta } from "../utils/requestMeta.js";
import { getLocalDateString } from "../utils/localDate.js";

const router = Router();

const filtersSchema = z.object({
  anchor_date: z.string().optional(),
  window: z.enum(["today", "3day", "week", "30day"]).optional(),
  department: z.enum(["executive", "operations", "schools", "sports", "office", "production", "customer_service", "unassigned"]).optional(),
  lead_user_id: z.string().uuid().optional(),
  employee_id: z.string().uuid().optional(),
  location_query: z.string().optional(),
  status: z.string().optional()
});

const capacityQuerySchema = z.object({
  window: z.enum(["day", "week", "month"]).optional(),
  anchor_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  department: z
    .enum(["executive", "operations", "schools", "sports", "office", "production", "customer_service", "unassigned"])
    .optional(),
  role: z
    .enum(["lead_photographer", "senior_photographer", "photographer", "support", "check_in", "assistant", "producer", "custom"])
    .optional(),
  employee_id: z.string().uuid().optional(),
  location: z.string().optional(),
  status: z.enum(["draft", "published", "completed"]).optional(),
  ack: z.enum(["pending", "acknowledged", "declined", "none"]).optional(),
  warning: z.enum(["overlap", "availability", "any"]).optional()
});

const scheduleEventSchema = z.object({
  studio_id: z.string().uuid().nullable().optional(),
  department: z.enum(["executive", "operations", "schools", "sports", "office", "production", "customer_service", "unassigned"]),
  event_kind: z.enum(["meeting", "operations", "travel", "other"]),
  status: z.enum(["scheduled", "tentative", "cancelled", "completed"]).optional(),
  title: z.string().min(1),
  starts_at: z.string().min(1),
  ends_at: z.string().min(1),
  location_name: z.string().nullable().optional(),
  location_address: z.string().nullable().optional(),
  location_lat: z.number().nullable().optional(),
  location_lng: z.number().nullable().optional(),
  lead_user_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  linked_shoot_id: z.string().uuid().nullable().optional()
});

const staffingTemplateSchema = z.object({
  department: z.enum(["executive", "operations", "schools", "sports", "office", "production", "customer_service", "unassigned"]),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  planned_staff_count: z.number().int().nonnegative(),
  minimum_staff_count: z.number().int().nonnegative().optional(),
  required_lead_count: z.number().int().positive(),
  roles: z.array(
    z.object({
      staffing_role: z.enum(["lead_photographer", "senior_photographer", "photographer", "support", "check_in", "assistant", "producer", "custom"]),
      label: z.string().min(1),
      headcount: z.number().int().positive(),
      satisfies_lead_coverage: z.boolean().optional(),
      minimum_count: z.number().int().nonnegative().optional(),
      ideal_count: z.number().int().nonnegative().optional(),
      required_for_ready: z.boolean().optional(),
      lead_eligible: z.boolean().optional(),
      lead_required: z.boolean().optional(),
      call_offset_minutes: z.number().int().optional(),
      start_offset_minutes: z.number().int().optional(),
      end_offset_minutes: z.number().int().optional(),
      location_name_override: z.string().nullable().optional(),
      location_address_override: z.string().nullable().optional(),
      required_qualification_tags: z.array(z.string().min(1)).optional(),
      role_notes: z.string().nullable().optional()
    })
  )
});

const staffingDashboardSchema = z.object({
  anchor_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

const assignStaffingSchema = z.object({
  slot_key: z.string().min(1),
  assigned_user_id: z.string().uuid(),
  override_conflict: z.boolean().optional(),
  approval_reason: z.string().trim().max(500).optional()
});

const removeStaffingSchema = z.object({
  slot_key: z.string().min(1),
  approval_reason: z.string().trim().max(500).optional()
});

const publishStaffingSchema = z.object({
  override_warnings: z.boolean().optional(),
  approval_reason: z.string().trim().max(500).optional()
});

const scheduleIntegrationItemParamsSchema = z.object({
  kind: z.enum(["shoot", "event"]),
  id: z.string().uuid()
});

router.get("/calendar", requireAuth, requireAction("schedule.read"), validateQuery(filtersSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listUnifiedScheduleCalendar(client, auth, {
        anchorDate: req.query.anchor_date ? String(req.query.anchor_date) : getLocalDateString(),
        window: req.query.window ? (String(req.query.window) as "today" | "3day" | "week" | "30day") : "today",
        department: req.query.department ? String(req.query.department) : undefined,
        leadUserId: req.query.lead_user_id ? String(req.query.lead_user_id) : undefined,
        employeeId: req.query.employee_id ? String(req.query.employee_id) : undefined,
        locationQuery: req.query.location_query ? String(req.query.location_query) : undefined,
        status: req.query.status ? String(req.query.status) : undefined
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/board",
  requireAuth,
  requireAction("schedule.read"),
  validateQuery(filtersSchema.extend({ group_by: z.enum(["status", "department", "lead_photographer", "day_part"]).optional() })),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listUnifiedScheduleBoard(
          client,
          auth,
          {
            anchorDate: req.query.anchor_date ? String(req.query.anchor_date) : getLocalDateString(),
            window: req.query.window ? (String(req.query.window) as "today" | "3day" | "week" | "30day") : "today",
            department: req.query.department ? String(req.query.department) : undefined,
            leadUserId: req.query.lead_user_id ? String(req.query.lead_user_id) : undefined,
            employeeId: req.query.employee_id ? String(req.query.employee_id) : undefined,
            locationQuery: req.query.location_query ? String(req.query.location_query) : undefined,
            status: req.query.status ? String(req.query.status) : undefined
          },
          req.query.group_by ? (String(req.query.group_by) as "status" | "department" | "lead_photographer" | "day_part") : "status"
        )
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/events/:id", requireAuth, requireAction("schedule.read"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getScheduleEventById(client, auth, String(req.params.id))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/events", requireAuth, requireAction("schedule.manage"), validateBody(scheduleEventSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createScheduleEvent(client, auth, req.body, getRequestMeta(req))
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.patch("/events/:id", requireAuth, requireAction("schedule.manage"), validateBody(scheduleEventSchema.partial()), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateScheduleEvent(client, auth, String(req.params.id), req.body, getRequestMeta(req))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/items/:kind/:id/move",
  requireAuth,
  requireAction("schedule.manage"),
  validateBody(z.object({ target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const kind = String(req.params.kind);
      if (kind !== "shoot" && kind !== "event") {
        return res.status(400).json({ error: "Invalid item kind" });
      }
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        moveScheduleItem(
          client,
          auth,
          {
            itemKind: kind,
            id: String(req.params.id),
            targetDate: String(req.body.target_date)
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

router.post("/items/:kind/:id/outlook-push", requireAuth, requireAction("schedule.manage"), async (req, res, next) => {
  try {
    const parsed = scheduleIntegrationItemParamsSchema.parse(req.params);
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      pushScheduleItemToOutlook(
        client,
        auth,
        {
          itemKind: parsed.kind,
          id: parsed.id
        },
        getRequestMeta(req)
      )
    );
    return res.status(202).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/items/:kind/:id/outlook-resync", requireAuth, requireAction("schedule.manage"), async (req, res, next) => {
  try {
    const parsed = scheduleIntegrationItemParamsSchema.parse(req.params);
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      triggerScheduleItemOutlookResync(
        client,
        auth,
        {
          itemKind: parsed.kind,
          id: parsed.id
        },
        getRequestMeta(req)
      )
    );
    return res.status(202).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/items/:kind/:id/outlook-review/acknowledge",
  requireAuth,
  requireAction("schedule.manage"),
  async (req, res, next) => {
    try {
      const parsed = scheduleIntegrationItemParamsSchema.parse(req.params);
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        acknowledgeScheduleIntegrationReview(
          client,
          auth,
          {
            itemKind: parsed.kind,
            id: parsed.id
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
  "/staffing-dashboard",
  requireAuth,
  requireAction("schedule.manage"),
  validateQuery(staffingDashboardSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getStaffingDashboardOverview(client, auth, req.query.anchor_date ? String(req.query.anchor_date) : getLocalDateString())
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/capacity",
  requireAuth,
  requireAction("schedule.manage"),
  validateQuery(capacityQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const query = req.query as Record<string, string | undefined>;
      const window = (query.window as CapacityWindow | undefined) ?? "week";
      const anchorDate =
        query.anchor_date && /^\d{4}-\d{2}-\d{2}$/.test(query.anchor_date)
          ? query.anchor_date
          : getLocalDateString(new Date(), { timeZone: STAFFING_CAPACITY_TIMEZONE });
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getStaffingCapacityPlan(client, auth, {
          window,
          anchorDate,
          filters: {
            department: query.department ?? null,
            staffingRole: query.role ?? null,
            employeeUserId: query.employee_id ?? null,
            locationName: query.location ?? null,
            assignmentState: (query.status as "draft" | "published" | "completed" | undefined) ?? null,
            acknowledgmentState:
              (query.ack as "pending" | "acknowledged" | "declined" | "none" | undefined) ?? null,
            warningState: (query.warning as "overlap" | "availability" | "any" | undefined) ?? null
          }
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/shoots/:id/staffing", requireAuth, requireAction("schedule.manage"), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getShootStaffingSnapshot(client, auth, String(req.params.id))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/shoots/:id/staffing/assign",
  requireAuth,
  requireAction("schedule.manage"),
  validateBody(assignStaffingSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        assignShootStaffingSlot(
          client,
          auth,
          {
            shootId: String(req.params.id),
            slotKey: String(req.body.slot_key),
            assignedUserId: String(req.body.assigned_user_id),
            overrideConflict: Boolean(req.body.override_conflict),
            approvalReason: req.body.approval_reason ? String(req.body.approval_reason) : null
          },
          getRequestMeta(req)
        )
      );
      return res.status("approval_required" in payload ? 202 : 200).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/shoots/:id/staffing/publish",
  requireAuth,
  requireAction("schedule.publish"),
  validateBody(publishStaffingSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        publishShootStaffing(
          client,
          auth,
          {
            shootId: String(req.params.id),
            overrideWarnings: Boolean(req.body.override_warnings),
            approvalReason: req.body.approval_reason ? String(req.body.approval_reason) : null
          },
          getRequestMeta(req)
        )
      );
      return res.status("approval_required" in payload ? 202 : 200).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/shoots/:id/staffing/remove",
  requireAuth,
  requireAction("schedule.manage"),
  validateBody(removeStaffingSchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        removeShootStaffingAssignment(
          client,
          auth,
          {
            shootId: String(req.params.id),
            slotKey: String(req.body.slot_key),
            approvalReason: req.body.approval_reason ? String(req.body.approval_reason) : null
          },
          getRequestMeta(req)
        )
      );
      return res.status("approval_required" in payload ? 202 : 200).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/staffing-templates",
  requireAuth,
  requireAction("schedule.read"),
  validateQuery(z.object({ department: z.enum(["executive", "operations", "schools", "sports", "office", "production", "customer_service", "unassigned"]).optional() })),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listStaffingTemplates(client, auth, req.query.department ? (String(req.query.department) as any) : null)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/staffing-templates", requireAuth, requireAction("schedule.manage"), validateBody(staffingTemplateSchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createStaffingTemplate(client, auth, req.body, getRequestMeta(req))
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/shoots/:id/apply-template",
  requireAuth,
  requireAction("schedule.manage"),
  validateBody(z.object({ template_id: z.string().uuid() })),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        applyStaffingTemplateToShoot(client, auth, String(req.params.id), String(req.body.template_id), getRequestMeta(req))
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
