// Labor Command Center routes — pay-period lifecycle, payroll self-check, overtime
// warnings, and the QuickBooks export boundary. Employee endpoints are self-scoped
// (own time only, no rates or cost); manager endpoints require team-time review
// access; period lifecycle + export + mappings require payroll admin access. All
// service-level checks re-verify access so routes are a convenience layer only.
import { type NextFunction, type Request, type Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { withClientTransaction } from "../db/tx.js";
import type { AuthenticatedRequest } from "../types/http.js";
import {
  ensurePayrollPeriodForDate,
  getPayrollCalendarConfig,
  listPayrollPeriods,
  listPayrollPeriodEvents,
  transitionPayrollPeriod,
  updatePayrollCalendarConfig,
  updatePayrollPeriodSchedule,
  findPayrollPeriodById
} from "../services/payrollPeriods.js";
import {
  confirmSelfCheck,
  getMySelfCheck,
  getSelfCheckManagerBoard,
  openSelfCheckForPeriod,
  resolveSelfCheckItem,
  submitSelfCheckResponse
} from "../services/payrollSelfCheck.js";
import {
  acknowledgeOvertimeWarning,
  approveOvertimeWarning,
  getMyOvertimeStatus,
  listOvertimePolicies,
  listOvertimeWarnings,
  upsertOvertimePolicy
} from "../services/overtimeEngine.js";
import {
  createPayrollExportBatch,
  getQuickBooksIntegrationStatus,
  listPayCodes,
  listPayrollExportBatches,
  listQuickBooksEmployeeMappings,
  listQuickBooksPayTypeMappings,
  listQuickBooksSyncLog,
  sendApprovedTimeToQuickBooks,
  upsertQuickBooksEmployeeMapping,
  upsertQuickBooksPayTypeMapping
} from "../services/quickbooksIntegration.js";
import { getLaborCommandCenterOverview } from "../services/laborCommandCenter.js";
import { sweepLaborForTenant, type LaborSweepResult } from "../services/laborSweep.js";
import { canManagePayrollPeriods, canReviewTeamTime } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import { pool } from "../db/pool.js";
import { config } from "../config.js";

const router = Router();

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

// ---------------------------------------------------------------------------
// Employee (self-scoped) surface
// ---------------------------------------------------------------------------

router.get("/self-check/current", requireAuth, validateQuery(z.object({ date: dateOnly.optional() })), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const query = req.query as { date?: string };
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getMySelfCheck(client, auth, query.date)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/self-check/responses",
  requireAuth,
  validateBody(
    z.object({
      period_id: z.string().uuid(),
      work_date: dateOnly,
      response: z.enum(["looks_correct", "something_wrong", "missing_punch", "no_break_taken", "wrong_job_location", "worked_extra_time"]),
      note: z.string().max(2000).nullable().optional(),
      manager_approved_claimed: z.boolean().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        submitSelfCheckResponse(client, auth, req.body)
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/self-check/confirm",
  requireAuth,
  validateBody(z.object({ period_id: z.string().uuid() })),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        confirmSelfCheck(client, auth, req.body.period_id)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/overtime/mine", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => getMyOvertimeStatus(client, auth));
    return res.json({ status: payload });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// Manager / leadership surface
// ---------------------------------------------------------------------------

function requireTeamTimeAccess(req: Request, _res: Response, next: NextFunction) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) {
    return next(new ApiError(401, "Authentication required."));
  }
  if (!canReviewTeamTime(auth)) {
    return next(new ApiError(403, "You do not have access to team labor review."));
  }
  return next();
}

function requirePayrollAdminAccess(req: Request, _res: Response, next: NextFunction) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) {
    return next(new ApiError(401, "Authentication required."));
  }
  if (!canManagePayrollPeriods(auth)) {
    return next(new ApiError(403, "You do not have access to payroll administration."));
  }
  return next();
}

router.get("/command-center", requireAuth, requireTeamTimeAccess, validateQuery(z.object({ date: dateOnly.optional() })), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const query = req.query as { date?: string };
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getLaborCommandCenterOverview(client, auth, { anchorDate: query.date })
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/periods/:periodId/self-check-board", requireAuth, requireTeamTimeAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getSelfCheckManagerBoard(client, auth, String(req.params.periodId))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/self-check/items/:itemId/resolve",
  requireAuth,
  requireTeamTimeAccess,
  validateBody(z.object({ resolution: z.enum(["resolved", "dismissed"]), resolution_note: z.string().max(2000).nullable().optional() })),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        resolveSelfCheckItem(client, auth, {
          item_id: String(req.params.itemId),
          resolution: req.body.resolution,
          resolution_note: req.body.resolution_note
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/overtime/warnings",
  requireAuth,
  requireTeamTimeAccess,
  validateQuery(z.object({ include_resolved: z.enum(["true", "false"]).optional() })),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const query = req.query as { include_resolved?: string };
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listOvertimeWarnings(client, auth, { includeResolved: query.include_resolved === "true" })
      );
      return res.json({ warnings: payload });
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/overtime/warnings/:warningId/acknowledge", requireAuth, requireTeamTimeAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      acknowledgeOvertimeWarning(client, auth, String(req.params.warningId))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.post("/overtime/warnings/:warningId/approve", requireAuth, requireTeamTimeAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      approveOvertimeWarning(client, auth, String(req.params.warningId))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// Payroll admin surface — period lifecycle, policies, exports, QuickBooks mappings
// ---------------------------------------------------------------------------

router.get("/periods", requireAuth, requirePayrollAdminAccess, validateQuery(z.object({ limit: z.coerce.number().int().min(1).max(52).optional() })), async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const query = req.query as { limit?: number };
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listPayrollPeriods(client, auth, { limit: query.limit })
    );
    return res.json({ periods: payload });
  } catch (error) {
    return next(error);
  }
});

// Explicit period creation for the current week (worker sweep also does this
// automatically every minute; this exists so the admin UI never dead-ends).
router.post("/periods/ensure-current", requireAuth, requirePayrollAdminAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      ensurePayrollPeriodForDate(client, auth.tenantId, new Date().toISOString().slice(0, 10), { actorUserId: auth.id })
    );
    return res.json({ period: payload });
  } catch (error) {
    return next(error);
  }
});

router.get("/periods/:periodId/events", requireAuth, requirePayrollAdminAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, async (client) => {
      const period = await findPayrollPeriodById(client, auth.tenantId, String(req.params.periodId));
      if (!period) {
        throw new ApiError(404, "Payroll period not found.");
      }
      return listPayrollPeriodEvents(client, auth.tenantId, String(req.params.periodId));
    });
    return res.json({ events: payload });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/periods/:periodId/transition",
  requireAuth,
  requirePayrollAdminAccess,
  validateBody(
    z.object({
      to_status: z.enum(["open", "self_check_open", "manager_review", "payroll_review", "owner_review", "locked", "exported", "synced", "correction_needed"]),
      reason: z.string().max(2000).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        transitionPayrollPeriod(client, auth, String(req.params.periodId), {
          toStatus: req.body.to_status,
          reason: req.body.reason
        })
      );
      return res.json({ period: payload });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/periods/:periodId/schedule",
  requireAuth,
  requirePayrollAdminAccess,
  validateBody(z.object({ lock_scheduled_at: z.string().datetime({ offset: true }).nullable() })),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updatePayrollPeriodSchedule(client, auth, String(req.params.periodId), {
          lockScheduledAt: req.body.lock_scheduled_at
        })
      );
      return res.json({ period: payload });
    } catch (error) {
      return next(error);
    }
  }
);

router.post("/periods/:periodId/open-self-check", requireAuth, requirePayrollAdminAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      openSelfCheckForPeriod(client, auth.tenantId, String(req.params.periodId), auth.id)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/overtime/policies", requireAuth, requirePayrollAdminAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => listOvertimePolicies(client, auth));
    return res.json({ policies: payload });
  } catch (error) {
    return next(error);
  }
});

router.put(
  "/overtime/policies",
  requireAuth,
  requirePayrollAdminAccess,
  validateBody(
    z.object({
      scope_type: z.enum(["tenant_default", "department", "employee"]),
      department: z.string().min(1).nullable().optional(),
      employee_id: z.string().uuid().nullable().optional(),
      workweek_start_dow: z.number().int().min(0).max(6).optional(),
      weekly_overtime_threshold_minutes: z.number().int().min(60).max(10080).optional(),
      company_warning_threshold_minutes: z.number().int().min(60).max(10080).optional(),
      daily_overtime_threshold_minutes: z.number().int().min(60).max(1440).nullable().optional(),
      warn_approaching_minutes: z.number().int().min(0).max(2400).optional(),
      exempt_from_overtime: z.boolean().optional(),
      jurisdiction: z.string().max(60).nullable().optional(),
      notes: z.string().max(2000).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        upsertOvertimePolicy(client, auth, req.body)
      );
      return res.json({ policy: payload });
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/quickbooks/status", requireAuth, requirePayrollAdminAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getQuickBooksIntegrationStatus(client, auth)
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/quickbooks/employee-mappings", requireAuth, requirePayrollAdminAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listQuickBooksEmployeeMappings(client, auth)
    );
    return res.json({ mappings: payload });
  } catch (error) {
    return next(error);
  }
});

router.put(
  "/quickbooks/employee-mappings",
  requireAuth,
  requirePayrollAdminAccess,
  validateBody(
    z.object({
      employee_id: z.string().uuid(),
      quickbooks_employee_id: z.string().min(1).max(120),
      quickbooks_display_name: z.string().max(200).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        upsertQuickBooksEmployeeMapping(client, auth, req.body)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/quickbooks/pay-type-mappings", requireAuth, requirePayrollAdminAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listQuickBooksPayTypeMappings(client, auth)
    );
    return res.json({ mappings: payload });
  } catch (error) {
    return next(error);
  }
});

router.get("/pay-codes", requireAuth, requirePayrollAdminAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) => listPayCodes(client, auth));
    return res.json({ pay_codes: payload });
  } catch (error) {
    return next(error);
  }
});

router.get("/calendar-config", requireAuth, requirePayrollAdminAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      getPayrollCalendarConfig(client, auth.tenantId)
    );
    return res.json({ config: payload });
  } catch (error) {
    return next(error);
  }
});

router.put(
  "/calendar-config",
  requireAuth,
  requirePayrollAdminAccess,
  validateBody(
    z.object({
      period_length_days: z.number().int().min(7).max(31).optional(),
      reference_period_start: dateOnly.optional(),
      close_offset_hours: z.number().int().min(0).max(336).optional(),
      self_check_window_hours: z.number().int().min(1).max(168).optional(),
      travel_policy: z.record(z.unknown()).optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        updatePayrollCalendarConfig(client, auth, req.body)
      );
      return res.json({ config: payload });
    } catch (error) {
      return next(error);
    }
  }
);

router.put(
  "/quickbooks/pay-type-mappings",
  requireAuth,
  requirePayrollAdminAccess,
  validateBody(
    z.object({
      pay_code: z.string().min(1).max(60),
      quickbooks_pay_item: z.string().min(1).max(200),
      quickbooks_pay_item_id: z.string().max(120).nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        upsertQuickBooksPayTypeMapping(client, auth, req.body)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

// Owner-only: explicit "Send Approved Time to QuickBooks". Never automatic, never
// runs payroll — records approved locked hours only. Refuses honestly while the
// QuickBooks connection/transport is not implemented; CSV export stays available.
router.post("/periods/:periodId/quickbooks-sync", requireAuth, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      sendApprovedTimeToQuickBooks(client, auth, String(req.params.periodId))
    );
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/periods/:periodId/quickbooks-sync-log", requireAuth, requirePayrollAdminAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listQuickBooksSyncLog(client, auth, String(req.params.periodId))
    );
    return res.json({ log: payload });
  } catch (error) {
    return next(error);
  }
});

router.get("/periods/:periodId/export-batches", requireAuth, requirePayrollAdminAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      listPayrollExportBatches(client, auth, String(req.params.periodId))
    );
    return res.json({ batches: payload });
  } catch (error) {
    return next(error);
  }
});

router.post("/periods/:periodId/export-batches", requireAuth, requirePayrollAdminAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
      createPayrollExportBatch(client, auth, String(req.params.periodId))
    );
    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/periods/:periodId/export.csv", requireAuth, requirePayrollAdminAccess, async (req, res, next) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    // GET must stay read-only (guarded pool enforces this): render the CSV without
    // writing a batch row. POST /export-batches is the durable, logged export action.
    const payload = await withClientTransaction(auth.tenantId, auth.id, async (client) => {
      const period = await findPayrollPeriodById(client, auth.tenantId, String(req.params.periodId));
      if (!period) {
        throw new ApiError(404, "Payroll period not found.");
      }
      if (period.status !== "locked" && period.status !== "exported" && period.status !== "synced") {
        throw new ApiError(409, "Only a locked payroll period can be exported. Lock the period first.");
      }
      const { buildPayrollExportPayload, renderPayrollExportCsv } = await import("../services/payrollReview.js");
      const exportPayload = await buildPayrollExportPayload(client, auth, {
        dateFrom: period.period_start,
        dateTo: period.period_end
      });
      return {
        csv: renderPayrollExportCsv(exportPayload),
        fileName: `mission-control-payroll-${period.period_start}-to-${period.period_end}.csv`
      };
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${payload.fileName}"`);
    return res.send(payload.csv);
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// Internal worker sweep — reminder ladder + overtime evaluation (secret-gated,
// same pattern as /api/checklists/internal/reminders/sweep).
// ---------------------------------------------------------------------------

router.post(
  "/internal/sweep",
  validateBody(z.object({ tenant_id: z.string().uuid().optional() })),
  async (req, res, next) => {
    try {
      if (req.header("X-PMC-Internal-Secret") !== config.INTERNAL_SOCKET_SECRET) {
        throw new ApiError(403, "Forbidden");
      }
      const tenantIds =
        typeof req.body.tenant_id === "string"
          ? [req.body.tenant_id]
          : (
              await pool.query<{ id: string }>(`SELECT id::text AS id FROM tenant ORDER BY created_at ASC`)
            ).rows.map((row) => row.id);

      const results: LaborSweepResult[] = [];
      for (const tenantId of tenantIds) {
        results.push(await withClientTransaction(tenantId, null, (client) => sweepLaborForTenant(client, tenantId)));
      }

      return res.json({
        tenant_count: tenantIds.length,
        reminder_recipient_count: results.reduce((sum, entry) => sum + entry.reminder_recipient_count, 0),
        overtime_warnings_created: results.reduce((sum, entry) => sum + entry.overtime_warnings_created, 0),
        results
      });
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
