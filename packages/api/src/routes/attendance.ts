import { type NextFunction, type Request, type Response, Router } from "express";
import { z } from "zod";
import { canViewComplianceWorkspace } from "../authz/authority.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAction, requirePermission } from "../middleware/rbac.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { withClientTransaction } from "../db/tx.js";
import type { AuthenticatedRequest } from "../types/http.js";
import {
  createLeadershipTimeAdjustment,
  createPunch,
  listAttendanceExceptions,
  listMissedPunchRequests,
  overrideTimeEntryBreakDeduction,
  reviewMissedPunchRequest,
  reviewAttendanceException,
  submitMissedPunchRequest,
  submitAttendanceExceptionRequest,
  transitionShiftSegment
} from "../services/attendance.js";
import {
  applyAttendanceOperationAction,
  getAttendanceOperationDetail,
  getAttendanceOperationsWorkspace
} from "../services/attendanceOperations.js";
import {
  getComplianceWorkspaceItemDetail,
  listComplianceWorkspaceItems
} from "../services/complianceWorkspace.js";
import {
  confirmEndOfDayState,
  evaluateTimeClockLocation,
  getTimeClockShellControlState
} from "../services/timeClockRuntime.js";
import { listTimeClockComplianceFlags } from "../services/timeClockCompliance.js";
import { listMileageReimbursements } from "../services/timeClockMileage.js";
import { getPayrollSummary, submitNoLunchChallenge } from "../services/timeClockPayroll.js";
import {
  buildPayrollExportPayload,
  getPayrollReview,
  getPayrollReviewDetail,
  renderPayrollExportCsv
} from "../services/payrollReview.js";
import { getRequestMeta } from "../utils/requestMeta.js";

const router = Router();

function applyComplianceWorkspaceAliasHeaders(res: { setHeader: (name: string, value: string) => void }) {
  res.setHeader("X-PMC-Canonical-Route", "/api/compliance/workspace");
  res.setHeader("X-PMC-Deprecated-Route", "true");
}

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

router.get(
  "/operations",
  requireAuth,
  validateQuery(
    z.object({
      date: z.string().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getAttendanceOperationsWorkspace(client, auth, {
          date: req.query.date ? String(req.query.date) : null
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/operations/:shiftId",
  requireAuth,
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getAttendanceOperationDetail(client, auth, String(req.params.shiftId))
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/operations/:shiftId/actions",
  requireAuth,
  validateBody(
    z.object({
      action: z.enum([
        "mark_present",
        "acknowledge_late",
        "mark_called_out",
        "request_replacement",
        "mark_no_show",
        "excuse"
      ]),
      note: z.string().nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        applyAttendanceOperationAction(client, auth, {
          shiftId: String(req.params.shiftId),
          action: req.body.action,
          note: req.body.note ?? null
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/time-clock/state",
  requireAuth,
  requireAction("time.clock"),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getTimeClockShellControlState(client, auth)
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/punches",
  requireAuth,
  requireAction("time.clock"),
  validateBody(
    z.object({
      shift_id: z.string().uuid().nullable().optional(),
      shoot_id: z.string().uuid().nullable().optional(),
      direction: z.enum(["in", "out"]),
      client_timestamp: z.string().min(1),
      latitude: z.number().nullable().optional(),
      longitude: z.number().nullable().optional(),
      accuracy_meters: z.number().nullable().optional(),
      client_event_id: z.string().uuid().nullable().optional(),
      attested_approved: z.boolean().optional(),
      approver_user_id: z.string().uuid().nullable().optional(),
      reason_code: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      source: z.string().nullable().optional(),
      work_state: z.enum(["office_drive", "photography"]).nullable().optional(),
      confirmed_outside_context: z.boolean().optional(),
      confirmed_permission: z.boolean().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const result = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createPunch(
          client,
          auth,
          {
            shiftId: req.body.shift_id ?? null,
            shootId: req.body.shoot_id ?? null,
            direction: req.body.direction,
            clientTimestamp: req.body.client_timestamp,
            latitude: req.body.latitude ?? null,
            longitude: req.body.longitude ?? null,
            accuracyMeters: req.body.accuracy_meters ?? null,
            clientEventId: req.body.client_event_id ?? null,
            idempotencyKey: req.header("Idempotency-Key") ?? null,
            attestedApproved: req.body.attested_approved ?? false,
            approverUserId: req.body.approver_user_id ?? null,
            reasonCode: req.body.reason_code ?? null,
            notes: req.body.notes ?? null,
            source: req.body.source ?? null,
            workState: req.body.work_state ?? null,
            confirmedOutsideContext: req.body.confirmed_outside_context ?? false,
            confirmedPermission: req.body.confirmed_permission ?? false
          },
          getRequestMeta(req)
        )
      );
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/exceptions",
  requireAuth,
  requirePermission("attendance_exceptions.view"),
  validateQuery(
    z.object({
      status: z.enum(["open", "approved", "rejected", "resolved"]).optional(),
      user_id: z.string().uuid().optional(),
      shift_id: z.string().uuid().optional(),
      date: z.string().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const rows = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listAttendanceExceptions(client, auth, {
          status: req.query.status ? String(req.query.status) : undefined,
          userId: req.query.user_id ? String(req.query.user_id) : undefined,
          shiftId: req.query.shift_id ? String(req.query.shift_id) : undefined,
          date: req.query.date ? String(req.query.date) : undefined
        })
      );
      return res.json(rows);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/time-clock/location-check",
  requireAuth,
  requireAction("time.clock"),
  validateBody(
    z.object({
      captured_at: z.string().min(1),
      latitude: z.number(),
      longitude: z.number(),
      accuracy_meters: z.number().nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        evaluateTimeClockLocation(client, auth, {
          capturedAt: req.body.captured_at,
          latitude: req.body.latitude,
          longitude: req.body.longitude,
          accuracyMeters: req.body.accuracy_meters ?? null
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/time-clock/end-of-day-confirmation",
  requireAuth,
  requireAction("time.clock"),
  validateBody(
    z.object({
      session_id: z.string().uuid().nullable().optional(),
      decision: z.enum(["returning_to_studio", "done_for_day", "correction_needed"]),
      captured_at: z.string().min(1),
      note: z.string().nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        confirmEndOfDayState(client, auth, {
          sessionId: req.body.session_id ?? null,
          decision: req.body.decision,
          capturedAt: req.body.captured_at,
          note: req.body.note ?? null
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/no-lunch-challenges",
  requireAuth,
  requirePermission("attendance_exceptions.create"),
  validateBody(
    z.object({
      shift_id: z.string().uuid().nullable().optional(),
      session_id: z.string().uuid().nullable().optional(),
      reason: z.string().min(1).max(120),
      note: z.string().nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        submitNoLunchChallenge(
          client,
          auth,
          {
            shift_id: req.body.shift_id ?? null,
            session_id: req.body.session_id ?? null,
            reason: req.body.reason,
            note: req.body.note ?? null
          },
          getRequestMeta(req)
        )
      );
      return res.status(201).json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/exceptions",
  requireAuth,
  requirePermission("attendance_exceptions.create"),
  validateBody(
    z.object({
      shift_id: z.string().uuid().nullable().optional(),
      punch_id: z.string().uuid().nullable().optional(),
      exception_type: z.string().min(1),
      reason_code: z.string().min(1),
      notes: z.string().nullable().optional(),
      requested_value: z.record(z.any()).optional(),
      original_value: z.record(z.any()).optional(),
      requested_approver_user_id: z.string().uuid().nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const row = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        submitAttendanceExceptionRequest(client, auth, req.body, getRequestMeta(req))
      );
      return res.status(201).json(row);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/missed-punches",
  requireAuth,
  requirePermission("missed_punches.view"),
  validateQuery(
    z.object({
      status: z.enum(["open", "approved", "rejected", "resolved"]).optional(),
      date: z.string().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const rows = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listMissedPunchRequests(client, auth, {
          status: req.query.status ? String(req.query.status) : undefined,
          date: req.query.date ? String(req.query.date) : undefined
        })
      );
      return res.json(rows);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/missed-punches",
  requireAuth,
  requirePermission("missed_punches.create"),
  validateBody(
    z.object({
      shift_id: z.string().uuid(),
      missing_direction: z.enum(["in", "out"]),
      employee_submitted_explanation: z.string().min(1),
      requested_approver_user_id: z.string().uuid().nullable().optional(),
      corrected_time: z.string().nullable().optional(),
      requested_work_state: z.enum(["office_drive", "photography"]).nullable().optional(),
      requested_start_time: z.string().nullable().optional(),
      requested_end_time: z.string().nullable().optional(),
      location_context: z.record(z.any()).nullable().optional(),
      notes: z.string().nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const row = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        submitMissedPunchRequest(client, auth, req.body, getRequestMeta(req))
      );
      return res.status(201).json(row);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/time-clock/manual-adjustments",
  requireAuth,
  requirePermission("time_edits.override"),
  validateBody(
    z.object({
      employee_id: z.string().uuid(),
      shift_id: z.string().uuid().nullable().optional(),
      segment_id: z.string().uuid().nullable().optional(),
      requested_work_state: z.enum(["office_drive", "photography"]),
      requested_start_time: z.string().min(1),
      requested_end_time: z.string().nullable().optional(),
      note: z.string().min(1)
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const row = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        createLeadershipTimeAdjustment(client, auth, req.body, getRequestMeta(req))
      );
      return res.status(201).json(row);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/exceptions/:id/review",
  requireAuth,
  requirePermission("attendance_exceptions.approve"),
  validateBody(
    z.object({
      status: z.enum(["approved", "rejected", "resolved"]),
      notes: z.string().nullable().optional(),
      classification: z.string().nullable().optional(),
      resolved_value: z.record(z.any()).optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const row = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        reviewAttendanceException(client, auth, String(req.params.id), req.body, getRequestMeta(req))
      );
      return res.json(row);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/missed-punches/:id/review",
  requireAuth,
  requirePermission("missed_punches.approve"),
  validateBody(
    z.object({
      status: z.enum(["approved", "rejected", "resolved"]),
      corrected_time: z.string().nullable().optional(),
      notes: z.string().nullable().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const row = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        reviewMissedPunchRequest(client, auth, String(req.params.id), req.body, getRequestMeta(req))
      );
      return res.json(row);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/time-entries/:id/break-override",
  requireAuth,
  requirePermission("time_edits.override"),
  validateBody(
    z.object({
      break_deduction_minutes: z.number().int().min(0).max(240),
      reason: z.string().min(1)
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const row = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        overrideTimeEntryBreakDeduction(client, auth, String(req.params.id), req.body, getRequestMeta(req))
      );
      return res.json(row);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/compliance-review",
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
          "assigned_but_missing"
        ])
        .optional()
    })
  ),
  async (req, res, next) => {
    try {
      applyComplianceWorkspaceAliasHeaders(res);
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
                | "assigned_but_missing")
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
  "/compliance-review/:sourceKind/:sourceId",
  requireAuth,
  requireComplianceWorkspaceView,
  async (req, res, next) => {
    try {
      applyComplianceWorkspaceAliasHeaders(res);
      const auth = (req as AuthenticatedRequest).auth;
      const sourceKind = String(req.params.sourceKind);
      const sourceId = String(req.params.sourceId);
      if (!["compliance_flag", "attendance_exception", "presence_incident"].includes(sourceKind)) {
        return res.status(400).json({ error: "Unsupported compliance source kind." });
      }
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getComplianceWorkspaceItemDetail(client, auth, {
          sourceKind: sourceKind as "compliance_flag" | "attendance_exception" | "presence_incident",
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

router.get(
  "/compliance-flags",
  requireAuth,
  requireAction("attendance.read"),
  validateQuery(
    z.object({
      date: z.string().optional(),
      status: z.enum(["open", "resolved", "all"]).optional(),
      user_id: z.string().uuid().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listTimeClockComplianceFlags(client, auth, {
          date: req.query.date ? String(req.query.date) : undefined,
          status: req.query.status ? (String(req.query.status) as "open" | "resolved" | "all") : undefined,
          userId: req.query.user_id ? String(req.query.user_id) : undefined
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/mileage-reimbursements",
  requireAuth,
  requireAction("attendance.read"),
  validateQuery(
    z.object({
      date: z.string().optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      status: z.enum(["candidate", "review_required", "ineligible", "approved", "exported", "cancelled", "all"]).optional(),
      user_id: z.string().uuid().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        listMileageReimbursements(client, auth, {
          date: req.query.date ? String(req.query.date) : undefined,
          dateFrom: req.query.date_from ? String(req.query.date_from) : undefined,
          dateTo: req.query.date_to ? String(req.query.date_to) : undefined,
          status: req.query.status ? (String(req.query.status) as any) : undefined,
          userId: req.query.user_id ? String(req.query.user_id) : undefined
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/payroll-summary",
  requireAuth,
  requireAction("attendance.read"),
  validateQuery(
    z.object({
      date: z.string().optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      department: z.string().optional(),
      user_id: z.string().uuid().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getPayrollSummary(client, auth, {
          date: req.query.date ? String(req.query.date) : undefined,
          dateFrom: req.query.date_from ? String(req.query.date_from) : undefined,
          dateTo: req.query.date_to ? String(req.query.date_to) : undefined,
          department: req.query.department ? String(req.query.department) : undefined,
          userId: req.query.user_id ? String(req.query.user_id) : undefined
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/payroll-review",
  requireAuth,
  requireAction("attendance.read"),
  validateQuery(
    z.object({
      date: z.string().optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      department: z.string().optional(),
      user_id: z.string().uuid().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getPayrollReview(client, auth, {
          date: req.query.date ? String(req.query.date) : undefined,
          dateFrom: req.query.date_from ? String(req.query.date_from) : undefined,
          dateTo: req.query.date_to ? String(req.query.date_to) : undefined,
          department: req.query.department ? String(req.query.department) : undefined,
          userId: req.query.user_id ? String(req.query.user_id) : undefined
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/payroll-review/export-payload",
  requireAuth,
  requireAction("attendance.read"),
  validateQuery(
    z.object({
      date: z.string().optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      department: z.string().optional(),
      user_id: z.string().uuid().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        buildPayrollExportPayload(client, auth, {
          date: req.query.date ? String(req.query.date) : undefined,
          dateFrom: req.query.date_from ? String(req.query.date_from) : undefined,
          dateTo: req.query.date_to ? String(req.query.date_to) : undefined,
          department: req.query.department ? String(req.query.department) : undefined,
          userId: req.query.user_id ? String(req.query.user_id) : undefined
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/payroll-review/export.csv",
  requireAuth,
  requireAction("attendance.read"),
  validateQuery(
    z.object({
      date: z.string().optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      department: z.string().optional(),
      user_id: z.string().uuid().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        buildPayrollExportPayload(client, auth, {
          date: req.query.date ? String(req.query.date) : undefined,
          dateFrom: req.query.date_from ? String(req.query.date_from) : undefined,
          dateTo: req.query.date_to ? String(req.query.date_to) : undefined,
          department: req.query.department ? String(req.query.department) : undefined,
          userId: req.query.user_id ? String(req.query.user_id) : undefined
        })
      );
      const csv = renderPayrollExportCsv(payload);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="mission-control-payroll-${payload.pay_period.start}-to-${payload.pay_period.end}.csv"`
      );
      res.type("text/csv");
      return res.send(csv);
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  "/payroll-review/:employeeId",
  requireAuth,
  requireAction("attendance.read"),
  validateQuery(
    z.object({
      date: z.string().optional(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      department: z.string().optional()
    })
  ),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const payload = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        getPayrollReviewDetail(client, auth, {
          employeeId: String(req.params.employeeId),
          date: req.query.date ? String(req.query.date) : undefined,
          dateFrom: req.query.date_from ? String(req.query.date_from) : undefined,
          dateTo: req.query.date_to ? String(req.query.date_to) : undefined,
          department: req.query.department ? String(req.query.department) : undefined
        })
      );
      return res.json(payload);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/shifts/:shiftId/segments/:segmentId/transition",
  requireAuth,
  requireAction("time.clock"),
  validateBody(z.object({ captured_at: z.string().min(1) })),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const shift = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        transitionShiftSegment(client, auth, String(req.params.shiftId), String(req.params.segmentId), req.body, getRequestMeta(req))
      );
      return res.json(shift);
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  "/shifts/:shiftId/running-late",
  requireAuth,
  requirePermission("attendance_exceptions.create"),
  validateBody(z.object({ notes: z.string().nullable().optional(), requested_approver_user_id: z.string().uuid().nullable().optional() })),
  async (req, res, next) => {
    try {
      const auth = (req as AuthenticatedRequest).auth;
      const row = await withClientTransaction(auth.tenantId, auth.id, (client) =>
        submitAttendanceExceptionRequest(
          client,
          auth,
          {
            shift_id: String(req.params.shiftId),
            exception_type: "RUNNING_LATE_NOTICE",
            reason_code: "running_late",
            notes: req.body.notes ?? null,
            requested_approver_user_id: req.body.requested_approver_user_id ?? null
          },
          getRequestMeta(req)
        )
      );
      return res.status(201).json(row);
    } catch (error) {
      return next(error);
    }
  }
);

export default router;
