import { Router } from "express";
import type { NextFunction, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireOperatingSystemModuleView } from "../middleware/operatingSystemAccess.js";
import { requireAction } from "../middleware/rbac.js";
import { requireElevatedSession } from "../middleware/security.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { withClientTransaction } from "../db/tx.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { config } from "../config.js";
import { loadManagerCockpit } from "../application/dashboard/load-manager-cockpit.action.js";
import { exportLaborCsv, getOperationsDashboard } from "../services/dashboard.js";
import { getHomeDashboard } from "../services/homeDashboard.js";
import { getEmployeesWorkspace } from "../services/employeesWorkspace.js";
import { getOperationsControlRoom } from "../services/operationsControlRoom.js";
import { getAdminWorkspace } from "../services/adminWorkspace.js";
import {
  CANONICAL_LEADERSHIP_REPORT_IDS,
  exportLeadershipReportCsv,
  exportLeadershipReportPdf,
  getLeadershipReport,
  getLeadershipReportsIndex,
  LEGACY_LEADERSHIP_REPORT_ALIASES,
  type LeadershipReportId
} from "../services/leadershipReports.js";
import {
  createLeadershipDeliverySchedule,
  createLeadershipPacketTemplate,
  createReportingSavedView,
  deleteLeadershipPacketTemplate,
  deleteReportingSavedView,
  duplicateLeadershipPacketTemplate,
  duplicateReportingSavedView,
  exportLeadershipPacketRunPdf,
  getLeadershipPacketRun,
  getReportingDeliveryCenter,
  LEADERSHIP_DELIVERY_CADENCES,
  LEADERSHIP_DELIVERY_CHANNELS,
  REPORTING_SAVED_VIEW_SOURCE_MODULES,
  REPORTING_SAVED_VIEW_VISIBILITIES,
  runLeadershipDeliveryScheduleNow,
  runLeadershipPacketTemplateNow,
  runLeadershipSavedViewPacketNow,
  updateLeadershipDeliverySchedule,
  updateLeadershipPacketTemplate,
  updateReportingSavedView
} from "../services/reportingDelivery.js";
import { getOperationalModelReport } from "../services/operationalReporting.js";
import { exportReportsWorkspaceCsv, getReportsWorkspace } from "../services/reportsWorkspace.js";
import { OPERATIONAL_REPORTING_PERIODS, type OperationalReportingPeriod } from "../types/operationalReporting.js";
import { getLocalDateString } from "../utils/localDate.js";

const router = Router();

function logDashboardRequestTiming(input: {
  route: string;
  method: string;
  userId: string | null;
  tenantId: string | null;
  durationMs: number;
  status: "success" | "error";
}) {
  if (config.NODE_ENV === "test") {
    return;
  }

  const payload = JSON.stringify({
    route: input.route,
    method: input.method,
    user_id: input.userId,
    tenant_id: input.tenantId,
    duration_ms: input.durationMs,
    status: input.status
  });

  if (input.status === "error" || input.durationMs > 300) {
    console.warn("[dashboard.request_slow]", payload);
    return;
  }

  console.info("[dashboard.request_timing]", payload);
}

const filtersSchema = z.object({
  date: z.string().optional(),
  employee_id: z.string().uuid().optional(),
  department: z.string().optional(),
  shoot_id: z.string().uuid().optional(),
  manager_id: z.string().uuid().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  report: z.enum(["labor", "punches", "exceptions", "payroll"]).optional()
});

const homeQuerySchema = z.object({
  date: z.string().optional(),
  mode: z.enum(["app", "tv"]).optional()
});
const employeesWorkspaceQuerySchema = z.object({
  date: z.string().optional()
});
const adminWorkspaceQuerySchema = z.object({
  date: z.string().optional()
});

const managerCockpitQuerySchema = z.object({
  date: z.string().optional()
});

const leadershipReportIdValues = [...CANONICAL_LEADERSHIP_REPORT_IDS, ...LEGACY_LEADERSHIP_REPORT_ALIASES] as [
  LeadershipReportId,
  ...LeadershipReportId[]
];
const leadershipReportIdSchema = z.enum(leadershipReportIdValues);

const leadershipReportsQuerySchema = z.object({
  date: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  department: z.string().optional(),
  saved_view_id: z.string().uuid().optional()
});
const operationalModelReportQuerySchema = z.object({
  date: z.string().optional(),
  department: z.string().optional(),
  period: z.enum(OPERATIONAL_REPORTING_PERIODS).optional()
});
const reportsWorkspaceQuerySchema = z.object({
  date: z.string().optional(),
  department: z.string().optional(),
  period: z.enum(OPERATIONAL_REPORTING_PERIODS).optional(),
  focus: z.enum(["all", "watch", "staffing", "attendance", "production", "approvals", "notifications", "audit"]).optional()
});

const savedViewSourceModuleSchema = z.enum(REPORTING_SAVED_VIEW_SOURCE_MODULES);
const savedViewVisibilitySchema = z.enum(REPORTING_SAVED_VIEW_VISIBILITIES);
const leadershipDeliveryCadenceSchema = z.enum(LEADERSHIP_DELIVERY_CADENCES);
const leadershipDeliveryChannelSchema = z.enum(LEADERSHIP_DELIVERY_CHANNELS);
const reportingWindowSchema = z.enum([
  "today",
  "yesterday",
  "last_7_days",
  "last_30_days",
  "last_90_days",
  "season_to_date",
  "year_to_date",
  "custom"
]);
const canonicalLeadershipReportIdSchema = z.enum(CANONICAL_LEADERSHIP_REPORT_IDS);
const packetSectionSchema = z.object({
  report_id: canonicalLeadershipReportIdSchema,
  enabled: z.boolean(),
  title: z.string().trim().max(180).optional().nullable()
});
const savedViewBodySchema = z.object({
  source_module: savedViewSourceModuleSchema,
  report_id: canonicalLeadershipReportIdSchema.optional().nullable(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(300).optional().nullable(),
  visibility: savedViewVisibilitySchema,
  window: reportingWindowSchema,
  date_from: z.string().optional().nullable(),
  date_to: z.string().optional().nullable(),
  department: z.string().trim().max(80).optional().nullable(),
  is_default: z.boolean().optional(),
  is_pinned: z.boolean().optional(),
  grouping_state: z.array(z.string().trim().max(120)).optional(),
  sort_state: z.array(z.string().trim().max(120)).optional(),
  column_state: z.array(z.string().trim().max(120)).optional(),
  scope_state: z.record(z.unknown()).optional()
});
const savedViewUpdateSchema = savedViewBodySchema.partial().refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  "Provide at least one saved view field to update"
);
const packetTemplateBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  audience: z.string().trim().min(2).max(160),
  description: z.string().trim().max(300).optional().nullable(),
  visibility: savedViewVisibilitySchema,
  default_window: reportingWindowSchema,
  department: z.string().trim().max(80).optional().nullable(),
  is_pinned: z.boolean().optional(),
  section_config: z.array(packetSectionSchema).min(1)
});
const packetTemplateUpdateSchema = packetTemplateBodySchema.partial().refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  "Provide at least one packet template field to update"
);
const packetRunBodySchema = z.object({
  anchor_date: z.string().optional(),
  date_from: z.string().optional().nullable(),
  date_to: z.string().optional().nullable(),
  recipients: z.array(z.string().uuid()).optional(),
  channel: leadershipDeliveryChannelSchema.optional().nullable()
});
const deliveryScheduleBodySchema = z.object({
  label: z.string().trim().min(2).max(120),
  source_type: z.enum(["packet_template", "saved_view"]),
  template_id: z.string().uuid().optional().nullable(),
  saved_view_id: z.string().uuid().optional().nullable(),
  cadence: leadershipDeliveryCadenceSchema,
  day_of_week: z.number().int().min(0).max(6).optional(),
  hour_local: z.number().int().min(0).max(23),
  minute_local: z.number().int().min(0).max(59),
  timezone: z.string().trim().min(3).max(80),
  delivery_channel: leadershipDeliveryChannelSchema,
  recipient_user_ids: z.array(z.string().uuid()).default([]),
  active_status: z.boolean().optional()
});
const deliveryScheduleUpdateSchema = deliveryScheduleBodySchema.partial().refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  "Provide at least one delivery schedule field to update"
);

router.get("/home", requireAuth, requireOperatingSystemModuleView("home"), validateQuery(homeQuerySchema), async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getHomeDashboard(client, auth, {
        date: req.query.date ? String(req.query.date) : getLocalDateString(),
        mode: req.query.mode ? (String(req.query.mode) as "app" | "tv") : "app"
      })
    );
    logDashboardRequestTiming({
      route: "/api/dashboard/home",
      method: req.method,
      userId: auth.id,
      tenantId: auth.tenantId,
      durationMs: Date.now() - startedAt,
      status: "success"
    });
    return res.json(payload);
  } catch (error) {
    const auth = (req as AuthenticatedRequest).auth;
    logDashboardRequestTiming({
      route: "/api/dashboard/home",
      method: req.method,
      userId: auth?.id ?? null,
      tenantId: auth?.tenantId ?? null,
      durationMs: Date.now() - startedAt,
      status: "error"
    });
    return next(error);
  }
});

router.get("/employees/workspace", requireAuth, validateQuery(employeesWorkspaceQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getEmployeesWorkspace(client, auth, {
        anchorDate: req.query.date ? String(req.query.date) : getLocalDateString()
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/admin/workspace", requireAuth, validateQuery(adminWorkspaceQuerySchema), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getAdminWorkspace(client, auth, {
        date: req.query.date ? String(req.query.date) : getLocalDateString()
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/operations/control-room",
  requireAuth,
  requireOperatingSystemModuleView("operations"),
  requireAction("dashboard.read"),
  validateQuery(managerCockpitQuerySchema),
  async (req, res, next) => {
    const startedAt = Date.now();
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getOperationsControlRoom(client, auth, {
          date: req.query.date ? String(req.query.date) : getLocalDateString()
        })
      );
      logDashboardRequestTiming({
        route: "/api/dashboard/operations/control-room",
        method: req.method,
        userId: auth.id,
        tenantId: auth.tenantId,
        durationMs: Date.now() - startedAt,
        status: "success"
      });
      return res.json(payload);
    } catch (error) {
      const auth = (req as AuthenticatedRequest).auth;
      logDashboardRequestTiming({
        route: "/api/dashboard/operations/control-room",
        method: req.method,
        userId: auth?.id ?? null,
        tenantId: auth?.tenantId ?? null,
        durationMs: Date.now() - startedAt,
        status: "error"
      });
      return next(error);
    }
  }
);

async function handleManagerCockpitRoute(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
  routePath: string
) {
  const startedAt = Date.now();
  try {
    const auth = req.auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      loadManagerCockpit(client, auth, {
        date: req.query.date ? String(req.query.date) : getLocalDateString()
      })
    );
    logDashboardRequestTiming({
      route: routePath,
      method: req.method,
      userId: auth.id,
      tenantId: auth.tenantId,
      durationMs: Date.now() - startedAt,
      status: "success"
    });
    return res.json(payload);
  } catch (error) {
    const auth = req.auth;
    logDashboardRequestTiming({
      route: routePath,
      method: req.method,
      userId: auth?.id ?? null,
      tenantId: auth?.tenantId ?? null,
      durationMs: Date.now() - startedAt,
      status: "error"
    });
    return next(error);
  }
}

router.get("/manager-cockpit", requireAuth, requireAction("dashboard.read"), validateQuery(managerCockpitQuerySchema), async (req, res, next) => {
  return handleManagerCockpitRoute(req as AuthenticatedRequest, res, next, "/api/dashboard/manager-cockpit");
});

router.get("/owner-command", requireAuth, requireAction("dashboard.read"), validateQuery(managerCockpitQuerySchema), async (req, res, next) => {
  return handleManagerCockpitRoute(req as AuthenticatedRequest, res, next, "/api/dashboard/owner-command");
});

router.get(
  "/reports",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  validateQuery(leadershipReportsQuerySchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const filters = {
      anchorDate: req.query.date ? String(req.query.date) : getLocalDateString(),
      dateFrom: req.query.date_from ? String(req.query.date_from) : null,
      dateTo: req.query.date_to ? String(req.query.date_to) : null,
      department: req.query.department ? String(req.query.department) : null
    };
    const payload = await withClientTransaction(auth.tenantId, auth.id, async (client) => {
      const index = await getLeadershipReportsIndex(client, auth, filters);
      const deliveryCenter = await getReportingDeliveryCenter(client, auth, filters);
      return {
        ...index,
        saved_views: deliveryCenter.saved_views,
        scheduled_summaries: deliveryCenter.delivery_schedules.slice(0, 5).map((schedule) => ({
          id: schedule.id,
          label: schedule.label,
          cadence: schedule.cadence,
          audience: schedule.template_name ?? schedule.saved_view_name ?? "Reporting audience"
        }))
      };
    });
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.get(
  "/reports/delivery-center",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  validateQuery(leadershipReportsQuerySchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getReportingDeliveryCenter(client, auth, {
        anchorDate: req.query.date ? String(req.query.date) : getLocalDateString(),
        dateFrom: req.query.date_from ? String(req.query.date_from) : null,
        dateTo: req.query.date_to ? String(req.query.date_to) : null,
        department: req.query.department ? String(req.query.department) : null
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.get(
  "/reports/operating-model",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  validateQuery(operationalModelReportQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getOperationalModelReport(client, auth, {
          anchorDate: req.query.date ? String(req.query.date) : getLocalDateString(),
          department: req.query.department ? String(req.query.department) : null,
          period: req.query.period ? (String(req.query.period) as OperationalReportingPeriod) : "monthly"
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/reports/workspace",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  validateQuery(reportsWorkspaceQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getReportsWorkspace(client, auth, {
          anchorDate: req.query.date ? String(req.query.date) : getLocalDateString(),
          department: req.query.department ? String(req.query.department) : null,
          period: req.query.period ? (String(req.query.period) as OperationalReportingPeriod) : "monthly",
          historyFocus: req.query.focus ? (String(req.query.focus) as "all" | "watch" | "staffing" | "attendance" | "production" | "approvals" | "notifications" | "audit") : null
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/reports/workspace/export.csv",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  validateQuery(reportsWorkspaceQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const csv = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        exportReportsWorkspaceCsv(client, auth, {
          anchorDate: req.query.date ? String(req.query.date) : getLocalDateString(),
          department: req.query.department ? String(req.query.department) : null,
          period: req.query.period ? (String(req.query.period) as OperationalReportingPeriod) : "monthly"
        })
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=\"reports-workspace-${Date.now()}.csv\"`);
      return res.send(csv);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/reports/saved-views",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  validateBody(savedViewBodySchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => createReportingSavedView(client, auth, req.body));
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.patch(
  "/reports/saved-views/:id",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  validateBody(savedViewUpdateSchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateReportingSavedView(client, auth, String(req.params.id), req.body)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.post(
  "/reports/saved-views/:id/duplicate",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      duplicateReportingSavedView(client, auth, String(req.params.id))
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.delete(
  "/reports/saved-views/:id",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    await withClientTransaction(auth.tenantId, auth.id, (client) => deleteReportingSavedView(client, auth, String(req.params.id)));
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
  }
);

router.post(
  "/reports/packet-templates",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  validateBody(packetTemplateBodySchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => createLeadershipPacketTemplate(client, auth, req.body));
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.patch(
  "/reports/packet-templates/:id",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  validateBody(packetTemplateUpdateSchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateLeadershipPacketTemplate(client, auth, String(req.params.id), req.body)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.post(
  "/reports/packet-templates/:id/duplicate",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      duplicateLeadershipPacketTemplate(client, auth, String(req.params.id))
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.delete(
  "/reports/packet-templates/:id",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    await withClientTransaction(auth.tenantId, auth.id, (client) => deleteLeadershipPacketTemplate(client, auth, String(req.params.id)));
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
  }
);

router.post(
  "/reports/packet-templates/:id/run",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  validateBody(packetRunBodySchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      runLeadershipPacketTemplateNow(client, auth, String(req.params.id), {
        anchorDate: req.body.anchor_date ? String(req.body.anchor_date) : getLocalDateString(),
        dateFrom: req.body.date_from ? String(req.body.date_from) : null,
        dateTo: req.body.date_to ? String(req.body.date_to) : null,
        recipients: Array.isArray(req.body.recipients) ? req.body.recipients : undefined,
        channel: req.body.channel ?? null
      })
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.post(
  "/reports/saved-views/:id/run",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  validateBody(packetRunBodySchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      runLeadershipSavedViewPacketNow(client, auth, String(req.params.id), {
        anchorDate: req.body.anchor_date ? String(req.body.anchor_date) : getLocalDateString(),
        recipients: Array.isArray(req.body.recipients) ? req.body.recipients : undefined,
        channel: req.body.channel ?? null
      })
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.get(
  "/reports/packet-runs/:id",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => getLeadershipPacketRun(client, auth, String(req.params.id)));
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.get(
  "/reports/packet-runs/:id/export.pdf",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  requireElevatedSession,
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const pdf = await withClientTransaction(auth.tenantId, auth.id, (client) => exportLeadershipPacketRunPdf(client, auth, String(req.params.id)));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="leadership-packet-${String(req.params.id)}.pdf"`);
    return res.send(pdf);
  } catch (error) {
    return next(error);
  }
  }
);

router.post(
  "/reports/delivery-schedules",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  validateBody(deliveryScheduleBodySchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => createLeadershipDeliverySchedule(client, auth, req.body));
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.patch(
  "/reports/delivery-schedules/:id",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  validateBody(deliveryScheduleUpdateSchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      updateLeadershipDeliverySchedule(client, auth, String(req.params.id), req.body)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.post(
  "/reports/delivery-schedules/:id/run",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      runLeadershipDeliveryScheduleNow(client, auth, String(req.params.id))
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.get(
  "/reports/:id",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  validateQuery(leadershipReportsQuerySchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const reportId = leadershipReportIdSchema.parse(req.params.id) as LeadershipReportId;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getLeadershipReport(client, auth, reportId, {
        anchorDate: req.query.date ? String(req.query.date) : getLocalDateString(),
        dateFrom: req.query.date_from ? String(req.query.date_from) : null,
        dateTo: req.query.date_to ? String(req.query.date_to) : null,
        department: req.query.department ? String(req.query.department) : null
      })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
  }
);

router.get(
  "/reports/:id/export.csv",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  requireElevatedSession,
  validateQuery(leadershipReportsQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const reportId = leadershipReportIdSchema.parse(req.params.id) as LeadershipReportId;
      const csv = await withClientTransaction(auth.tenantId, auth.id, async (client) => {
        return exportLeadershipReportCsv(client, auth, reportId, {
          anchorDate: req.query.date ? String(req.query.date) : getLocalDateString(),
          dateFrom: req.query.date_from ? String(req.query.date_from) : null,
          dateTo: req.query.date_to ? String(req.query.date_to) : null,
          department: req.query.department ? String(req.query.department) : null
        });
      });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${reportId}.csv"`);
    return res.send(csv);
  } catch (error) {
    return next(error);
  }
  }
);

router.get(
  "/reports/:id/export.pdf",
  requireAuth,
  requireOperatingSystemModuleView("reports"),
  requireAction("dashboard.read"),
  requireElevatedSession,
  validateQuery(leadershipReportsQuerySchema),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const reportId = leadershipReportIdSchema.parse(req.params.id) as LeadershipReportId;
      const pdf = await withClientTransaction(auth.tenantId, auth.id, async (client) => {
        return exportLeadershipReportPdf(client, auth, reportId, {
          anchorDate: req.query.date ? String(req.query.date) : getLocalDateString(),
          dateFrom: req.query.date_from ? String(req.query.date_from) : null,
          dateTo: req.query.date_to ? String(req.query.date_to) : null,
          department: req.query.department ? String(req.query.department) : null
        });
      });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${reportId}.pdf"`);
    return res.send(pdf);
  } catch (error) {
    return next(error);
  }
  }
);

router.get(
  "/operations",
  requireAuth,
  requireOperatingSystemModuleView("operations"),
  requireAction("dashboard.read"),
  validateQuery(filtersSchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const dashboard = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getOperationsDashboard(client, auth, {
        date: req.query.date ? String(req.query.date) : getLocalDateString(),
        employeeId: req.query.employee_id ? String(req.query.employee_id) : undefined,
        department: req.query.department ? String(req.query.department) : undefined,
        shootId: req.query.shoot_id ? String(req.query.shoot_id) : undefined,
        managerId: req.query.manager_id ? String(req.query.manager_id) : undefined,
        dateFrom: req.query.date_from ? String(req.query.date_from) : undefined,
        dateTo: req.query.date_to ? String(req.query.date_to) : undefined
      })
    );
    return res.json(dashboard);
  } catch (error) {
    return next(error);
  }
  }
);

router.get(
  "/operations/export.csv",
  requireAuth,
  requireOperatingSystemModuleView("operations"),
  requireAction("dashboard.read"),
  requireElevatedSession,
  validateQuery(filtersSchema),
  async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const csv = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      exportLaborCsv(client, auth, {
        date: req.query.date ? String(req.query.date) : getLocalDateString(),
        employeeId: req.query.employee_id ? String(req.query.employee_id) : undefined,
        department: req.query.department ? String(req.query.department) : undefined,
        shootId: req.query.shoot_id ? String(req.query.shoot_id) : undefined,
        managerId: req.query.manager_id ? String(req.query.manager_id) : undefined,
        dateFrom: req.query.date_from ? String(req.query.date_from) : undefined,
        dateTo: req.query.date_to ? String(req.query.date_to) : undefined
      }, req.query.report ? (String(req.query.report) as "labor" | "punches" | "exceptions" | "payroll") : "labor")
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    return res.send(csv);
  } catch (error) {
    return next(error);
  }
  }
);

export default router;
