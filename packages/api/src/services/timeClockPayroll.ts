import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import { canEditHours, hasJobFunctionProfile } from "../authz/authority.js";
import { assertShiftAccess, shouldRestrictShiftList } from "./shiftAccess.js";
import { createAuditLog } from "./audit.js";
import { createTimeClockExceptionRequest } from "./timeClockRuntime.js";
import { findNotificationRecipients, queueNotificationDispatch } from "./opsNotifications.js";
import type { AuthUser } from "../types/auth.js";
import { getLocalDateString, getLocalDayBounds } from "../utils/localDate.js";
import type {
  ExceptionRequestStatus,
  LunchDeductionSource,
  PayrollExportAggregateStatus,
  TimeWorkState
} from "../types/timeClock.js";

type RequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type ShiftContext = {
  id: string;
  tenant_id: string;
  shoot_id: string | null;
  assigned_user_id: string;
  manager_user_id: string | null;
  department: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
};

type TimeSessionRow = {
  id: string;
  tenant_id: string;
  employee_id: string;
  work_date: string;
  source_shift_id: string | null;
  status: "open" | "closed" | "needs_end_of_day_confirmation" | "approved" | "payroll_exported";
  created_at: string;
  updated_at: string;
};

type TimeSegmentRow = {
  id: string;
  session_id: string;
  employee_id: string;
  linked_shift_id: string | null;
  work_state: TimeWorkState;
  linked_shoot_id: string | null;
  linked_location_id: string | null;
  supersedes_segment_id: string | null;
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
  source_type: "manual" | "automatic_transition" | "manual_correction" | "admin_override";
  review_status: "not_required" | "pending_review" | "approved" | "rejected";
  reporting_flags: string[];
};

type ExceptionRequestRow = {
  id: string;
  tenant_id: string;
  employee_id: string;
  request_type:
    | "missing_clock_in"
    | "missing_clock_out"
    | "time_segment_correction"
    | "work_state_change"
    | "lunch_deduction_challenge"
    | "mileage_review"
    | "other";
  linked_shift_id: string | null;
  linked_shoot_id: string | null;
  linked_session_id: string | null;
  linked_segment_id: string | null;
  requested_approver_id: string | null;
  related_attendance_exception_id: string | null;
  requested_state: TimeWorkState | null;
  requested_start_time: string | null;
  requested_end_time: string | null;
  location_context: Record<string, unknown>;
  original_values: Record<string, unknown>;
  resolved_values: Record<string, unknown>;
  reporting_flags: string[];
  note: string;
  status: ExceptionRequestStatus;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

type TimeSessionPayrollSummaryRow = {
  id: string;
  tenant_id: string;
  session_id: string;
  employee_id: string;
  work_date: string;
  office_drive_minutes: number;
  photography_minutes: number;
  total_worked_minutes: number;
  lunch_deduction_minutes: number;
  lunch_deduction_source: LunchDeductionSource;
  lunch_challenge_request_id: string | null;
  lunch_challenge_status: ExceptionRequestStatus | null;
  payable_minutes: number;
  manual_correction_count: number;
  missed_clock_in_approval_count: number;
  exception_request_count: number;
  approval_record_count: number;
  reporting_flags: string[];
  generated_at: string;
  updated_at: string;
};

type EmployeePayProfileRow = {
  office_rate: string;
  photography_rate: string;
  overtime_eligible: boolean;
};

type MileageSummaryRow = {
  total_amount: string;
  review_required_count: number;
  candidate_count: number;
};

type EmployeeMileageSummaryRow = MileageSummaryRow & {
  employee_id: string;
};

type EmployeePayProfileLookupRow = EmployeePayProfileRow & {
  employee_id: string;
};

type SessionCounts = {
  exception_request_count: number;
  missed_clock_in_approval_count: number;
  approval_record_count: number;
};

type SessionCountsRow = SessionCounts & {
  session_id: string;
};

type EmployeePeriodRow = {
  employee_id: string;
  employee_name: string;
  department: string | null;
};

type LegacyPayrollComparisonRow = {
  employee_id: string;
  entry_count: number;
  gross_minutes: number;
  break_deduction_minutes: number;
  payable_minutes: number;
  break_override_count: number;
};

type AggregateSessionRow = {
  id: string;
  session_id: string;
  work_date: string;
  office_drive_minutes: number;
  photography_minutes: number;
  total_worked_minutes: number;
  lunch_deduction_minutes: number;
  payable_minutes: number;
  regular_office_drive_minutes: number;
  regular_photography_minutes: number;
  overtime_minutes: number;
  manual_correction_count: number;
  missed_clock_in_approval_count: number;
  reporting_flags: string[];
  created_at: string;
};

type PayrollAggregateRow = {
  id: string;
  tenant_id: string;
  employee_id: string;
  pay_period_start: string;
  pay_period_end: string;
  regular_office_drive_minutes: number;
  regular_photography_minutes: number;
  overtime_minutes: number;
  overtime_base_rate: string | null;
  overtime_rate: string | null;
  lunch_deduction_minutes: number;
  manual_correction_count: number;
  missed_clock_in_approval_count: number;
  mileage_reimbursement_amount: string;
  exception_request_count: number;
  approval_record_count: number;
  exception_flags: string[];
  approval_flags: string[];
  notes: Record<string, unknown>;
  status: PayrollExportAggregateStatus;
  generated_at: string;
  updated_at: string;
  employee_name?: string | null;
  department?: string | null;
};

export type PayrollSummarySourceOfTruth = {
  primary_model: "canonical_labor_state";
  canonical_records: ["time_session", "time_segment", "time_session_payroll_summary", "payroll_export_aggregate"];
  legacy_compatibility_records: ["time_entry"];
};

export type PayrollSummaryTransition = {
  canonical_break_override_count: number;
  legacy_time_entry_summary: {
    entry_count: number;
    gross_hours: number;
    break_deduction_hours: number;
    payable_hours: number;
    break_override_count: number;
  };
  comparison: {
    mismatch_employee_count: number;
    canonical_only_employee_count: number;
    legacy_only_employee_count: number;
  };
};

export type PayrollSummaryRow = PayrollAggregateRow & {
  sessions: AggregateSessionRow[];
  legacy_comparison: {
    entry_count: number;
    payable_minutes: number;
    payable_minutes_delta: number;
    break_override_count: number;
    amounts_match: boolean;
  };
  transition_flags: string[];
};

export type NoLunchChallengeInput = {
  shift_id?: string | null;
  session_id?: string | null;
  reason: string;
  note?: string | null;
};

export type PayrollSummaryFilters = {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  department?: string | null;
  userId?: string | null;
};

export type PayrollSummaryPayload = {
  source_of_truth: PayrollSummarySourceOfTruth;
  pay_period: {
    start: string;
    end: string;
    overtime_basis: "weekly_over_40";
  };
  summary: {
    employee_count: number;
    regular_office_drive_hours: number;
    regular_photography_hours: number;
    overtime_hours: number;
    lunch_deduction_hours: number;
    break_override_count: number;
    manual_correction_count: number;
    missed_clock_in_approval_count: number;
    mileage_reimbursement_amount: number;
    pending_lunch_challenge_count: number;
    review_required_mileage_count: number;
  };
  transition: PayrollSummaryTransition;
  rows: PayrollSummaryRow[];
};

function parseDateOnly(value: string) {
  return new Date(`${value}T12:00:00`);
}

function formatDateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: Date, days: number) {
  const next = new Date(value.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function getWeekBounds(anchorDate: string) {
  const anchor = parseDateOnly(anchorDate);
  const weekday = anchor.getDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = addDays(anchor, mondayOffset);
  return {
    start: formatDateOnly(monday),
    end: formatDateOnly(addDays(monday, 6))
  };
}

function getPayPeriod(filters: PayrollSummaryFilters) {
  if (filters.dateFrom && filters.dateTo) {
    return { start: filters.dateFrom, end: filters.dateTo };
  }
  if (filters.date) {
    return getWeekBounds(filters.date);
  }
  return getWeekBounds(getLocalDateString());
}

async function loadLegacyTimeEntryPayrollComparison(
  client: PoolClient,
  auth: AuthUser,
  input: {
    payPeriodStart: string;
    payPeriodEnd: string;
    department?: string | null;
    userId?: string | null;
  }
) {
  const effectiveUserId = shouldRestrictShiftList(auth) ? auth.id : input.userId ?? null;
  const startBound = getLocalDayBounds(input.payPeriodStart).start.toISOString();
  const endBound = getLocalDayBounds(input.payPeriodEnd).endExclusive.toISOString();
  const { rows } = await client.query<LegacyPayrollComparisonRow>(
    `
      SELECT
        te.user_id AS employee_id,
        COUNT(*)::int AS entry_count,
        COALESCE(SUM(te.gross_minutes), 0)::int AS gross_minutes,
        COALESCE(SUM(te.break_deduction_minutes), 0)::int AS break_deduction_minutes,
        COALESCE(SUM(COALESCE(te.approved_payable_minutes, te.payable_minutes, 0)), 0)::int AS payable_minutes,
        COUNT(*) FILTER (WHERE te.break_deduction_overridden = true)::int AS break_override_count
      FROM time_entry te
      LEFT JOIN work_shift ws ON ws.id = te.shift_id
      WHERE te.tenant_id = $1
        AND te.clock_in_at >= $2::timestamptz
        AND te.clock_in_at < $3::timestamptz
        AND ($4::department_code IS NULL OR ws.department = $4::department_code)
        AND ($5::uuid IS NULL OR te.user_id = $5::uuid)
      GROUP BY te.user_id
    `,
    [auth.tenantId, startBound, endBound, input.department ?? null, effectiveUserId]
  );
  return rows;
}

function toHours(minutes: number | null | undefined) {
  return Number((Number(minutes ?? 0) / 60).toFixed(2));
}

function resolveClockEventActorType(auth?: AuthUser | null) {
  if (!auth) {
    return "system" as const;
  }
  if (auth.authorityTier === "super_admin") {
    return "admin" as const;
  }
  if (auth.authorityTier === "leadership" || auth.authorityTier === "director_admin") {
    return "leadership" as const;
  }
  if (hasJobFunctionProfile(auth, ["director_of_photography", "director_of_school_photography", "director_of_sports_photography"])) {
    return "manager" as const;
  }
  return "employee" as const;
}

function allocateSessionDeduction(officeDriveMinutes: number, photographyMinutes: number, lunchDeductionMinutes: number) {
  const total = officeDriveMinutes + photographyMinutes;
  if (lunchDeductionMinutes <= 0 || total <= 0) {
    return { officeDriveMinutes, photographyMinutes };
  }
  const officeShare = Math.min(
    officeDriveMinutes,
    Math.round((officeDriveMinutes / total) * lunchDeductionMinutes)
  );
  const photographyShare = Math.min(photographyMinutes, lunchDeductionMinutes - officeShare);
  return {
    officeDriveMinutes: Math.max(officeDriveMinutes - officeShare, 0),
    photographyMinutes: Math.max(photographyMinutes - photographyShare, 0)
  };
}

async function insertClockEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    sessionId: string;
    eventType: "auto_lunch_deduction_applied" | "auto_lunch_deduction_removed";
    eventTimestamp: string;
    actorType: "employee" | "system" | "manager" | "leadership" | "integration" | "admin";
    metadata?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      INSERT INTO clock_event (
        tenant_id,
        employee_id,
        linked_session_id,
        event_type,
        event_timestamp,
        metadata,
        created_by_actor
      )
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
    `,
    [
      input.tenantId,
      input.employeeId,
      input.sessionId,
      input.eventType,
      input.eventTimestamp,
      JSON.stringify(input.metadata ?? {}),
      input.actorType
    ]
  );
}

async function loadShiftContext(client: PoolClient, tenantId: string, shiftId: string) {
  const { rows } = await client.query<ShiftContext>(
    `
      SELECT
        id,
        tenant_id,
        shoot_id,
        assigned_user_id,
        manager_user_id,
        department::text,
        title,
        starts_at::text,
        ends_at::text
      FROM work_shift
      WHERE tenant_id = $1
        AND id = $2
        AND cancelled_at IS NULL
      LIMIT 1
    `,
    [tenantId, shiftId]
  );
  return rows[0] ?? null;
}

async function loadTimeSessionById(client: PoolClient, tenantId: string, sessionId: string) {
  const { rows } = await client.query<TimeSessionRow>(
    `
      SELECT
        id,
        tenant_id,
        employee_id,
        work_date::text,
        source_shift_id,
        status::text,
        created_at::text,
        updated_at::text
      FROM time_session
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, sessionId]
  );
  return rows[0] ?? null;
}

async function loadLatestTimeSessionForEmployeeDate(client: PoolClient, tenantId: string, employeeId: string, workDate: string) {
  const { rows } = await client.query<TimeSessionRow>(
    `
      SELECT
        id,
        tenant_id,
        employee_id,
        work_date::text,
        source_shift_id,
        status::text,
        created_at::text,
        updated_at::text
      FROM time_session
      WHERE tenant_id = $1
        AND employee_id = $2
        AND work_date = $3::date
      ORDER BY
        CASE WHEN status IN ('approved', 'payroll_exported') THEN 0 WHEN status = 'closed' THEN 1 ELSE 2 END,
        updated_at DESC,
        created_at DESC
      LIMIT 1
    `,
    [tenantId, employeeId, workDate]
  );
  return rows[0] ?? null;
}

async function listEffectiveSegmentsForSession(client: PoolClient, tenantId: string, sessionId: string) {
  const { rows } = await client.query<TimeSegmentRow>(
    `
      SELECT
        seg.id,
        seg.session_id,
        seg.employee_id,
        seg.linked_shift_id,
        seg.work_state::text,
        seg.linked_shoot_id,
        seg.linked_location_id,
        seg.supersedes_segment_id,
        seg.start_time::text,
        seg.end_time::text,
        seg.duration_minutes,
        seg.source_type::text,
        seg.review_status::text,
        seg.reporting_flags
      FROM time_segment seg
      WHERE seg.tenant_id = $1
        AND seg.session_id = $2
        AND seg.duration_minutes IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM time_segment replacement
          WHERE replacement.tenant_id = seg.tenant_id
            AND replacement.session_id = seg.session_id
            AND replacement.supersedes_segment_id = seg.id
        )
      ORDER BY COALESCE(seg.end_time, seg.start_time) ASC, seg.start_time ASC
    `,
    [tenantId, sessionId]
  );
  return rows;
}

async function listEffectiveSegmentsForSessions(client: PoolClient, tenantId: string, sessionIds: string[]) {
  const segmentsBySession = new Map<string, TimeSegmentRow[]>();
  if (sessionIds.length === 0) {
    return segmentsBySession;
  }

  const { rows } = await client.query<TimeSegmentRow>(
    `
      SELECT
        seg.id,
        seg.session_id,
        seg.employee_id,
        seg.linked_shift_id,
        seg.work_state::text,
        seg.linked_shoot_id,
        seg.linked_location_id,
        seg.supersedes_segment_id,
        seg.start_time::text,
        seg.end_time::text,
        seg.duration_minutes,
        seg.source_type::text,
        seg.review_status::text,
        seg.reporting_flags
      FROM time_segment seg
      WHERE seg.tenant_id = $1
        AND seg.session_id = ANY($2::uuid[])
        AND seg.duration_minutes IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM time_segment replacement
          WHERE replacement.tenant_id = seg.tenant_id
            AND replacement.session_id = seg.session_id
            AND replacement.supersedes_segment_id = seg.id
        )
      ORDER BY seg.session_id ASC, COALESCE(seg.end_time, seg.start_time) ASC, seg.start_time ASC
    `,
    [tenantId, sessionIds]
  );

  for (const row of rows) {
    const sessionRows = segmentsBySession.get(row.session_id) ?? [];
    sessionRows.push(row);
    segmentsBySession.set(row.session_id, sessionRows);
  }

  return segmentsBySession;
}

async function loadLatestLunchChallengeForSession(client: PoolClient, tenantId: string, sessionId: string) {
  const { rows } = await client.query<ExceptionRequestRow>(
    `
      SELECT
        id,
        tenant_id,
        employee_id,
        request_type::text,
        linked_shift_id,
        linked_shoot_id,
        linked_session_id,
        linked_segment_id,
        requested_approver_id,
        related_attendance_exception_id,
        requested_state::text,
        requested_start_time::text,
        requested_end_time::text,
        location_context,
        original_values,
        resolved_values,
        reporting_flags,
        note,
        status::text,
        submitted_at::text,
        reviewed_at::text,
        reviewed_by
      FROM exception_request
      WHERE tenant_id = $1
        AND linked_session_id = $2
        AND request_type = 'lunch_deduction_challenge'
        AND status <> 'cancelled'
      ORDER BY submitted_at DESC, id DESC
      LIMIT 1
    `,
    [tenantId, sessionId]
  );
  return rows[0] ?? null;
}

async function loadLatestLunchChallengesForSessions(client: PoolClient, tenantId: string, sessionIds: string[]) {
  const challengesBySession = new Map<string, ExceptionRequestRow>();
  if (sessionIds.length === 0) {
    return challengesBySession;
  }

  const { rows } = await client.query<ExceptionRequestRow>(
    `
      SELECT DISTINCT ON (linked_session_id)
        id,
        tenant_id,
        employee_id,
        request_type::text,
        linked_shift_id,
        linked_shoot_id,
        linked_session_id,
        linked_segment_id,
        requested_approver_id,
        related_attendance_exception_id,
        requested_state::text,
        requested_start_time::text,
        requested_end_time::text,
        location_context,
        original_values,
        resolved_values,
        reporting_flags,
        note,
        status::text,
        submitted_at::text,
        reviewed_at::text,
        reviewed_by
      FROM exception_request
      WHERE tenant_id = $1
        AND linked_session_id = ANY($2::uuid[])
        AND request_type = 'lunch_deduction_challenge'
        AND status <> 'cancelled'
      ORDER BY linked_session_id ASC, submitted_at DESC, id DESC
    `,
    [tenantId, sessionIds]
  );

  for (const row of rows) {
    if (row.linked_session_id) {
      challengesBySession.set(row.linked_session_id, row);
    }
  }

  return challengesBySession;
}

async function loadSessionCounts(client: PoolClient, tenantId: string, sessionId: string) {
  const { rows } = await client.query<SessionCounts>(
    `
      WITH requests AS (
        SELECT *
        FROM exception_request
        WHERE tenant_id = $1
          AND linked_session_id = $2
          AND status <> 'cancelled'
      )
      SELECT
        COUNT(*)::int AS exception_request_count,
        COUNT(*) FILTER (
          WHERE request_type = 'missing_clock_in'
            AND status = 'approved'
        )::int AS missed_clock_in_approval_count,
        COALESCE((
          SELECT COUNT(*)::int
          FROM approval_record ar
          JOIN requests req
            ON req.id = ar.request_id
        ), 0) AS approval_record_count
      FROM requests
    `,
    [tenantId, sessionId]
  );
  return rows[0] ?? {
    exception_request_count: 0,
    missed_clock_in_approval_count: 0,
    approval_record_count: 0
  };
}

async function loadSessionCountsForSessions(client: PoolClient, tenantId: string, sessionIds: string[]) {
  const countsBySession = new Map<string, SessionCounts>();
  if (sessionIds.length === 0) {
    return countsBySession;
  }

  const { rows } = await client.query<SessionCountsRow>(
    `
      WITH requests AS (
        SELECT id, linked_session_id, request_type, status
        FROM exception_request
        WHERE tenant_id = $1
          AND linked_session_id = ANY($2::uuid[])
          AND status <> 'cancelled'
      ),
      approval_counts AS (
        SELECT req.linked_session_id AS session_id, COUNT(*)::int AS approval_record_count
        FROM requests req
        JOIN approval_record ar
          ON ar.request_id = req.id
        GROUP BY req.linked_session_id
      )
      SELECT
        req.linked_session_id AS session_id,
        COUNT(*)::int AS exception_request_count,
        COUNT(*) FILTER (
          WHERE req.request_type = 'missing_clock_in'
            AND req.status = 'approved'
        )::int AS missed_clock_in_approval_count,
        COALESCE(MAX(ac.approval_record_count), 0)::int AS approval_record_count
      FROM requests req
      LEFT JOIN approval_counts ac
        ON ac.session_id = req.linked_session_id
      GROUP BY req.linked_session_id
    `,
    [tenantId, sessionIds]
  );

  for (const row of rows) {
    countsBySession.set(row.session_id, {
      exception_request_count: row.exception_request_count,
      missed_clock_in_approval_count: row.missed_clock_in_approval_count,
      approval_record_count: row.approval_record_count
    });
  }

  return countsBySession;
}

function defaultSessionCounts(): SessionCounts {
  return {
    exception_request_count: 0,
    missed_clock_in_approval_count: 0,
    approval_record_count: 0
  };
}

async function loadExistingTimeSessionPayrollSummary(client: PoolClient, tenantId: string, sessionId: string) {
  const { rows } = await client.query<TimeSessionPayrollSummaryRow>(
    `
      SELECT
        id,
        tenant_id,
        session_id,
        employee_id,
        work_date::text,
        office_drive_minutes,
        photography_minutes,
        total_worked_minutes,
        lunch_deduction_minutes,
        lunch_deduction_source::text,
        lunch_challenge_request_id,
        lunch_challenge_status::text,
        payable_minutes,
        manual_correction_count,
        missed_clock_in_approval_count,
        exception_request_count,
        approval_record_count,
        reporting_flags,
        generated_at::text,
        updated_at::text
      FROM time_session_payroll_summary
      WHERE tenant_id = $1
        AND session_id = $2
      LIMIT 1
    `,
    [tenantId, sessionId]
  );
  return rows[0] ?? null;
}

async function upsertTimeSessionPayrollSummary(
  client: PoolClient,
  input: Omit<TimeSessionPayrollSummaryRow, "id" | "generated_at" | "updated_at">
) {
  const { rows } = await client.query<TimeSessionPayrollSummaryRow>(
    `
      INSERT INTO time_session_payroll_summary (
        tenant_id,
        session_id,
        employee_id,
        work_date,
        office_drive_minutes,
        photography_minutes,
        total_worked_minutes,
        lunch_deduction_minutes,
        lunch_deduction_source,
        lunch_challenge_request_id,
        lunch_challenge_status,
        payable_minutes,
        manual_correction_count,
        missed_clock_in_approval_count,
        exception_request_count,
        approval_record_count,
        reporting_flags
      )
      VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (tenant_id, session_id)
      DO UPDATE SET
        employee_id = EXCLUDED.employee_id,
        work_date = EXCLUDED.work_date,
        office_drive_minutes = EXCLUDED.office_drive_minutes,
        photography_minutes = EXCLUDED.photography_minutes,
        total_worked_minutes = EXCLUDED.total_worked_minutes,
        lunch_deduction_minutes = EXCLUDED.lunch_deduction_minutes,
        lunch_deduction_source = EXCLUDED.lunch_deduction_source,
        lunch_challenge_request_id = EXCLUDED.lunch_challenge_request_id,
        lunch_challenge_status = EXCLUDED.lunch_challenge_status,
        payable_minutes = EXCLUDED.payable_minutes,
        manual_correction_count = EXCLUDED.manual_correction_count,
        missed_clock_in_approval_count = EXCLUDED.missed_clock_in_approval_count,
        exception_request_count = EXCLUDED.exception_request_count,
        approval_record_count = EXCLUDED.approval_record_count,
        reporting_flags = EXCLUDED.reporting_flags,
        updated_at = now()
      RETURNING
        id,
        tenant_id,
        session_id,
        employee_id,
        work_date::text,
        office_drive_minutes,
        photography_minutes,
        total_worked_minutes,
        lunch_deduction_minutes,
        lunch_deduction_source::text,
        lunch_challenge_request_id,
        lunch_challenge_status::text,
        payable_minutes,
        manual_correction_count,
        missed_clock_in_approval_count,
        exception_request_count,
        approval_record_count,
        reporting_flags,
        generated_at::text,
        updated_at::text
    `,
    [
      input.tenant_id,
      input.session_id,
      input.employee_id,
      input.work_date,
      input.office_drive_minutes,
      input.photography_minutes,
      input.total_worked_minutes,
      input.lunch_deduction_minutes,
      input.lunch_deduction_source,
      input.lunch_challenge_request_id,
      input.lunch_challenge_status,
      input.payable_minutes,
      input.manual_correction_count,
      input.missed_clock_in_approval_count,
      input.exception_request_count,
      input.approval_record_count,
      input.reporting_flags
    ]
  );
  return rows[0];
}

function computeLunchDeduction(input: {
  totalWorkedMinutes: number;
  latestLunchChallenge: ExceptionRequestRow | null;
}) {
  if (input.totalWorkedMinutes <= 300) {
    return {
      lunchDeductionMinutes: 0,
      lunchDeductionSource: "not_applicable" as LunchDeductionSource
    };
  }
  if (!input.latestLunchChallenge) {
    return {
      lunchDeductionMinutes: 30,
      lunchDeductionSource: "auto_deducted" as LunchDeductionSource
    };
  }
  if (input.latestLunchChallenge.status === "approved") {
    return {
      lunchDeductionMinutes: 0,
      lunchDeductionSource: "challenge_approved" as LunchDeductionSource
    };
  }
  if (input.latestLunchChallenge.status === "rejected") {
    return {
      lunchDeductionMinutes: 30,
      lunchDeductionSource: "challenge_rejected" as LunchDeductionSource
    };
  }
  return {
    lunchDeductionMinutes: 30,
    lunchDeductionSource: "challenge_pending" as LunchDeductionSource
  };
}

function buildSessionReportingFlags(input: {
  summary: {
    lunchDeductionSource: LunchDeductionSource;
    manualCorrectionCount: number;
    missedClockInApprovalCount: number;
    exceptionRequestCount: number;
    approvalRecordCount: number;
  };
  segmentFlags: string[];
}) {
  const flags = new Set<string>(input.segmentFlags);
  if (input.summary.lunchDeductionSource !== "not_applicable") {
    flags.add("lunch_deduction");
  }
  if (input.summary.lunchDeductionSource === "challenge_pending") {
    flags.add("lunch_challenge_pending");
  }
  if (input.summary.lunchDeductionSource === "challenge_approved") {
    flags.add("no_lunch_approved");
  }
  if (input.summary.manualCorrectionCount > 0) {
    flags.add("manual_adjustment");
  }
  if (input.summary.missedClockInApprovalCount > 0) {
    flags.add("missed_clock_in_approved");
  }
  if (input.summary.exceptionRequestCount > 0) {
    flags.add("has_exception_requests");
  }
  if (input.summary.approvalRecordCount > 0) {
    flags.add("has_approval_records");
  }
  return [...flags];
}

function buildComputedTimeSessionPayrollSummary(input: {
  tenantId: string;
  session: TimeSessionRow;
  segments: TimeSegmentRow[];
  latestLunchChallenge: ExceptionRequestRow | null;
  sessionCounts: SessionCounts;
}): TimeSessionPayrollSummaryRow {
  const officeDriveMinutes = input.segments
    .filter((segment) => segment.work_state === "office_drive")
    .reduce((sum, segment) => sum + Number(segment.duration_minutes ?? 0), 0);
  const photographyMinutes = input.segments
    .filter((segment) => segment.work_state === "photography")
    .reduce((sum, segment) => sum + Number(segment.duration_minutes ?? 0), 0);
  const totalWorkedMinutes = officeDriveMinutes + photographyMinutes;
  const manualCorrectionCount = input.segments.filter(
    (segment) => segment.source_type === "manual_correction" || segment.source_type === "admin_override"
  ).length;
  const lunchDeduction = computeLunchDeduction({
    totalWorkedMinutes,
    latestLunchChallenge: input.latestLunchChallenge
  });
  const reportingFlags = buildSessionReportingFlags({
    summary: {
      lunchDeductionSource: lunchDeduction.lunchDeductionSource,
      manualCorrectionCount,
      missedClockInApprovalCount: input.sessionCounts.missed_clock_in_approval_count,
      exceptionRequestCount: input.sessionCounts.exception_request_count,
      approvalRecordCount: input.sessionCounts.approval_record_count
    },
    segmentFlags: input.segments.flatMap((segment) => segment.reporting_flags ?? [])
  });
  const generatedAt = new Date().toISOString();

  return {
    id: `computed:${input.session.id}`,
    tenant_id: input.tenantId,
    session_id: input.session.id,
    employee_id: input.session.employee_id,
    work_date: input.session.work_date,
    office_drive_minutes: officeDriveMinutes,
    photography_minutes: photographyMinutes,
    total_worked_minutes: totalWorkedMinutes,
    lunch_deduction_minutes: lunchDeduction.lunchDeductionMinutes,
    lunch_deduction_source: lunchDeduction.lunchDeductionSource,
    lunch_challenge_request_id: input.latestLunchChallenge?.id ?? null,
    lunch_challenge_status: input.latestLunchChallenge?.status ?? null,
    payable_minutes: Math.max(totalWorkedMinutes - lunchDeduction.lunchDeductionMinutes, 0),
    manual_correction_count: manualCorrectionCount,
    missed_clock_in_approval_count: input.sessionCounts.missed_clock_in_approval_count,
    exception_request_count: input.sessionCounts.exception_request_count,
    approval_record_count: input.sessionCounts.approval_record_count,
    reporting_flags: reportingFlags,
    generated_at: generatedAt,
    updated_at: generatedAt
  };
}

async function computeTimeSessionPayrollSummary(
  client: PoolClient,
  input: {
    tenantId: string;
    sessionId: string;
  }
): Promise<TimeSessionPayrollSummaryRow> {
  const session = await loadTimeSessionById(client, input.tenantId, input.sessionId);
  if (!session) {
    throw new ApiError(404, "Time Session not found");
  }

  const segments = await listEffectiveSegmentsForSession(client, input.tenantId, input.sessionId);
  const latestLunchChallenge = await loadLatestLunchChallengeForSession(client, input.tenantId, input.sessionId);
  const sessionCounts = await loadSessionCounts(client, input.tenantId, input.sessionId);

  return buildComputedTimeSessionPayrollSummary({
    tenantId: input.tenantId,
    session,
    segments,
    latestLunchChallenge,
    sessionCounts
  });
}

export async function syncTimeSessionPayrollSummary(
  client: PoolClient,
  input: {
    tenantId: string;
    sessionId: string;
    actorUserId?: string | null;
    auth?: AuthUser | null;
    emitTransitionEvents?: boolean;
    reasonComment?: string | null;
  }
) {
  const previous = await loadExistingTimeSessionPayrollSummary(client, input.tenantId, input.sessionId);
  const computed = await computeTimeSessionPayrollSummary(client, input);

  const summary = await upsertTimeSessionPayrollSummary(client, {
    tenant_id: computed.tenant_id,
    session_id: computed.session_id,
    employee_id: computed.employee_id,
    work_date: computed.work_date,
    office_drive_minutes: computed.office_drive_minutes,
    photography_minutes: computed.photography_minutes,
    total_worked_minutes: computed.total_worked_minutes,
    lunch_deduction_minutes: computed.lunch_deduction_minutes,
    lunch_deduction_source: computed.lunch_deduction_source,
    lunch_challenge_request_id: computed.lunch_challenge_request_id,
    lunch_challenge_status: computed.lunch_challenge_status,
    payable_minutes: computed.payable_minutes,
    manual_correction_count: computed.manual_correction_count,
    missed_clock_in_approval_count: computed.missed_clock_in_approval_count,
    exception_request_count: computed.exception_request_count,
    approval_record_count: computed.approval_record_count,
    reporting_flags: computed.reporting_flags
  });

  if (
    input.emitTransitionEvents &&
    previous &&
    (previous.lunch_deduction_minutes !== summary.lunch_deduction_minutes ||
      previous.lunch_deduction_source !== summary.lunch_deduction_source)
  ) {
    const eventType =
      summary.lunch_deduction_minutes > 0
        ? "auto_lunch_deduction_applied"
        : "auto_lunch_deduction_removed";
    await insertClockEvent(client, {
      tenantId: input.tenantId,
      employeeId: summary.employee_id,
      sessionId: summary.session_id,
      eventType,
      eventTimestamp: new Date().toISOString(),
      actorType: resolveClockEventActorType(input.auth),
      metadata: {
        previous_lunch_deduction_minutes: previous.lunch_deduction_minutes,
        new_lunch_deduction_minutes: summary.lunch_deduction_minutes,
        previous_lunch_deduction_source: previous.lunch_deduction_source,
        new_lunch_deduction_source: summary.lunch_deduction_source
      }
    });

    await createAuditLog(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      targetUserId: summary.employee_id,
      action: "time_clock.payroll_session.recalculated",
      entityType: "time_session_payroll_summary",
      entityId: summary.id,
      previousValues: {
        lunch_deduction_minutes: previous.lunch_deduction_minutes,
        lunch_deduction_source: previous.lunch_deduction_source,
        payable_minutes: previous.payable_minutes
      },
      newValues: {
        lunch_deduction_minutes: summary.lunch_deduction_minutes,
        lunch_deduction_source: summary.lunch_deduction_source,
        payable_minutes: summary.payable_minutes
      },
      reasonComment: input.reasonComment ?? null,
      metadata: {
        session_id: summary.session_id,
        work_date: summary.work_date
      }
    });
  }

  return summary;
}

function getWeekStartForDate(value: string) {
  return getWeekBounds(value).start;
}

function computeWeeklyAllocation(sessionSummaries: TimeSessionPayrollSummaryRow[]) {
  const sessionsByWeek = new Map<
    string,
    Array<
      TimeSessionPayrollSummaryRow & {
        adjusted_office_drive_minutes: number;
        adjusted_photography_minutes: number;
      }
    >
  >();

  for (const session of sessionSummaries) {
    const adjusted = allocateSessionDeduction(
      session.office_drive_minutes,
      session.photography_minutes,
      session.lunch_deduction_minutes
    );
    const weekStart = getWeekStartForDate(session.work_date);
    const rows = sessionsByWeek.get(weekStart) ?? [];
    rows.push({
      ...session,
      adjusted_office_drive_minutes: adjusted.officeDriveMinutes,
      adjusted_photography_minutes: adjusted.photographyMinutes
    });
    sessionsByWeek.set(weekStart, rows);
  }

  const allocationBySession = new Map<
    string,
    {
      regularOfficeDriveMinutes: number;
      regularPhotographyMinutes: number;
      overtimeMinutes: number;
    }
  >();

  for (const sessions of sessionsByWeek.values()) {
    const totalAdjustedMinutes = sessions.reduce(
      (sum, session) => sum + session.adjusted_office_drive_minutes + session.adjusted_photography_minutes,
      0
    );
    const overtimeMinutes = Math.max(totalAdjustedMinutes - 2400, 0);
    const regularMinutes = Math.max(totalAdjustedMinutes - overtimeMinutes, 0);
    let allocatedRegularMinutes = 0;

    for (let index = 0; index < sessions.length; index += 1) {
      const session = sessions[index];
      const sessionAdjustedTotal = session.adjusted_office_drive_minutes + session.adjusted_photography_minutes;
      if (sessionAdjustedTotal <= 0 || regularMinutes <= 0) {
        allocationBySession.set(session.session_id, {
          regularOfficeDriveMinutes: 0,
          regularPhotographyMinutes: 0,
          overtimeMinutes: 0
        });
        continue;
      }

      const remainingRegular = Math.max(regularMinutes - allocatedRegularMinutes, 0);
      const proportionalRegularTotal =
        index === sessions.length - 1
          ? remainingRegular
          : Math.min(
              sessionAdjustedTotal,
              Math.round((sessionAdjustedTotal / totalAdjustedMinutes) * regularMinutes)
            );
      const regularOfficeDriveMinutes = Math.min(
        session.adjusted_office_drive_minutes,
        Math.round(
          proportionalRegularTotal *
            (session.adjusted_office_drive_minutes / Math.max(sessionAdjustedTotal, 1))
        )
      );
      const regularPhotographyMinutes = Math.max(
        proportionalRegularTotal - regularOfficeDriveMinutes,
        0
      );
      const sessionOvertimeMinutes = Math.max(sessionAdjustedTotal - proportionalRegularTotal, 0);
      allocatedRegularMinutes += proportionalRegularTotal;

      allocationBySession.set(session.session_id, {
        regularOfficeDriveMinutes,
        regularPhotographyMinutes,
        overtimeMinutes: sessionOvertimeMinutes
      });
    }
  }

  return allocationBySession;
}

async function loadActivePayProfile(client: PoolClient, tenantId: string, employeeId: string, effectiveDate: string) {
  const { rows } = await client.query<EmployeePayProfileRow>(
    `
      SELECT office_rate::text, photography_rate::text, overtime_eligible
      FROM employee_pay_profile
      WHERE tenant_id = $1
        AND employee_id = $2
        AND effective_date <= $3::date
      ORDER BY effective_date DESC, created_at DESC
      LIMIT 1
    `,
    [tenantId, employeeId, effectiveDate]
  );
  return rows[0] ?? null;
}

async function loadActivePayProfilesForEmployees(
  client: PoolClient,
  tenantId: string,
  employeeIds: string[],
  effectiveDate: string
) {
  const profilesByEmployee = new Map<string, EmployeePayProfileRow>();
  if (employeeIds.length === 0) {
    return profilesByEmployee;
  }

  const { rows } = await client.query<EmployeePayProfileLookupRow>(
    `
      SELECT DISTINCT ON (employee_id)
        employee_id,
        office_rate::text,
        photography_rate::text,
        overtime_eligible
      FROM employee_pay_profile
      WHERE tenant_id = $1
        AND employee_id = ANY($2::uuid[])
        AND effective_date <= $3::date
      ORDER BY employee_id ASC, effective_date DESC, created_at DESC
    `,
    [tenantId, employeeIds, effectiveDate]
  );

  for (const row of rows) {
    profilesByEmployee.set(row.employee_id, row);
  }

  return profilesByEmployee;
}

async function loadEmployeeSessionsForPeriod(
  client: PoolClient,
  tenantId: string,
  employeeId: string,
  payPeriodStart: string,
  payPeriodEnd: string
) {
  const { rows } = await client.query<TimeSessionRow>(
    `
      SELECT
        id,
        tenant_id,
        employee_id,
        work_date::text,
        source_shift_id,
        status::text,
        created_at::text,
        updated_at::text
      FROM time_session
      WHERE tenant_id = $1
        AND employee_id = $2
        AND work_date >= $3::date
        AND work_date <= $4::date
      ORDER BY work_date ASC, created_at ASC
    `,
    [tenantId, employeeId, payPeriodStart, payPeriodEnd]
  );
  return rows;
}

async function loadEmployeeSessionsForPeriodBatch(
  client: PoolClient,
  tenantId: string,
  employeeIds: string[],
  payPeriodStart: string,
  payPeriodEnd: string
) {
  const sessionsByEmployee = new Map<string, TimeSessionRow[]>();
  if (employeeIds.length === 0) {
    return sessionsByEmployee;
  }

  const { rows } = await client.query<TimeSessionRow>(
    `
      SELECT
        id,
        tenant_id,
        employee_id,
        work_date::text,
        source_shift_id,
        status::text,
        created_at::text,
        updated_at::text
      FROM time_session
      WHERE tenant_id = $1
        AND employee_id = ANY($2::uuid[])
        AND work_date >= $3::date
        AND work_date <= $4::date
      ORDER BY employee_id ASC, work_date ASC, created_at ASC
    `,
    [tenantId, employeeIds, payPeriodStart, payPeriodEnd]
  );

  for (const row of rows) {
    const employeeRows = sessionsByEmployee.get(row.employee_id) ?? [];
    employeeRows.push(row);
    sessionsByEmployee.set(row.employee_id, employeeRows);
  }

  return sessionsByEmployee;
}

async function loadMileageSummaryForEmployeePeriod(
  client: PoolClient,
  tenantId: string,
  employeeId: string,
  payPeriodStart: string,
  payPeriodEnd: string
) {
  const { rows } = await client.query<MileageSummaryRow>(
    `
      SELECT
        COALESCE(SUM(CASE WHEN status IN ('candidate', 'approved', 'exported') THEN reimbursement_amount ELSE 0 END), 0)::text AS total_amount,
        COUNT(*) FILTER (WHERE status = 'review_required')::int AS review_required_count,
        COUNT(*) FILTER (WHERE status IN ('candidate', 'approved', 'exported'))::int AS candidate_count
      FROM mileage_reimbursement
      WHERE tenant_id = $1
        AND employee_id = $2
        AND work_date >= $3::date
        AND work_date <= $4::date
    `,
    [tenantId, employeeId, payPeriodStart, payPeriodEnd]
  );
  return rows[0] ?? { total_amount: "0.00", review_required_count: 0, candidate_count: 0 };
}

function defaultMileageSummary(): MileageSummaryRow {
  return { total_amount: "0.00", review_required_count: 0, candidate_count: 0 };
}

async function loadMileageSummaryForEmployeePeriodBatch(
  client: PoolClient,
  tenantId: string,
  employeeIds: string[],
  payPeriodStart: string,
  payPeriodEnd: string
) {
  const summariesByEmployee = new Map<string, MileageSummaryRow>();
  if (employeeIds.length === 0) {
    return summariesByEmployee;
  }

  const { rows } = await client.query<EmployeeMileageSummaryRow>(
    `
      SELECT
        employee_id,
        COALESCE(SUM(CASE WHEN status IN ('candidate', 'approved', 'exported') THEN reimbursement_amount ELSE 0 END), 0)::text AS total_amount,
        COUNT(*) FILTER (WHERE status = 'review_required')::int AS review_required_count,
        COUNT(*) FILTER (WHERE status IN ('candidate', 'approved', 'exported'))::int AS candidate_count
      FROM mileage_reimbursement
      WHERE tenant_id = $1
        AND employee_id = ANY($2::uuid[])
        AND work_date >= $3::date
        AND work_date <= $4::date
      GROUP BY employee_id
    `,
    [tenantId, employeeIds, payPeriodStart, payPeriodEnd]
  );

  for (const row of rows) {
    summariesByEmployee.set(row.employee_id, row);
  }

  return summariesByEmployee;
}

async function upsertPayrollAggregate(
  client: PoolClient,
  input: Omit<PayrollAggregateRow, "id" | "generated_at" | "updated_at" | "employee_name" | "department">
) {
  const { rows } = await client.query<PayrollAggregateRow>(
    `
      INSERT INTO payroll_export_aggregate (
        tenant_id,
        employee_id,
        pay_period_start,
        pay_period_end,
        regular_office_drive_minutes,
        regular_photography_minutes,
        overtime_minutes,
        overtime_base_rate,
        overtime_rate,
        lunch_deduction_minutes,
        manual_correction_count,
        missed_clock_in_approval_count,
        mileage_reimbursement_amount,
        exception_request_count,
        approval_record_count,
        exception_flags,
        approval_flags,
        notes,
        status
      )
      VALUES ($1,$2,$3::date,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19)
      ON CONFLICT (tenant_id, employee_id, pay_period_start, pay_period_end)
      DO UPDATE SET
        regular_office_drive_minutes = EXCLUDED.regular_office_drive_minutes,
        regular_photography_minutes = EXCLUDED.regular_photography_minutes,
        overtime_minutes = EXCLUDED.overtime_minutes,
        overtime_base_rate = EXCLUDED.overtime_base_rate,
        overtime_rate = EXCLUDED.overtime_rate,
        lunch_deduction_minutes = EXCLUDED.lunch_deduction_minutes,
        manual_correction_count = EXCLUDED.manual_correction_count,
        missed_clock_in_approval_count = EXCLUDED.missed_clock_in_approval_count,
        mileage_reimbursement_amount = EXCLUDED.mileage_reimbursement_amount,
        exception_request_count = EXCLUDED.exception_request_count,
        approval_record_count = EXCLUDED.approval_record_count,
        exception_flags = EXCLUDED.exception_flags,
        approval_flags = EXCLUDED.approval_flags,
        notes = EXCLUDED.notes,
        status = EXCLUDED.status,
        updated_at = now()
      RETURNING
        id,
        tenant_id,
        employee_id,
        pay_period_start::text,
        pay_period_end::text,
        regular_office_drive_minutes,
        regular_photography_minutes,
        overtime_minutes,
        overtime_base_rate::text,
        overtime_rate::text,
        lunch_deduction_minutes,
        manual_correction_count,
        missed_clock_in_approval_count,
        mileage_reimbursement_amount::text,
        exception_request_count,
        approval_record_count,
        exception_flags,
        approval_flags,
        notes,
        status::text,
        generated_at::text,
        updated_at::text
    `,
    [
      input.tenant_id,
      input.employee_id,
      input.pay_period_start,
      input.pay_period_end,
      input.regular_office_drive_minutes,
      input.regular_photography_minutes,
      input.overtime_minutes,
      input.overtime_base_rate,
      input.overtime_rate,
      input.lunch_deduction_minutes,
      input.manual_correction_count,
      input.missed_clock_in_approval_count,
      input.mileage_reimbursement_amount,
      input.exception_request_count,
      input.approval_record_count,
      input.exception_flags,
      input.approval_flags,
      JSON.stringify(input.notes ?? {}),
      input.status
    ]
  );
  return rows[0];
}

async function replaceAggregateSessions(
  client: PoolClient,
  input: {
    tenantId: string;
    aggregateId: string;
    rows: Array<{
      sessionId: string;
      workDate: string;
      officeDriveMinutes: number;
      photographyMinutes: number;
      totalWorkedMinutes: number;
      lunchDeductionMinutes: number;
      payableMinutes: number;
      regularOfficeDriveMinutes: number;
      regularPhotographyMinutes: number;
      overtimeMinutes: number;
      manualCorrectionCount: number;
      missedClockInApprovalCount: number;
      reportingFlags: string[];
    }>;
  }
) {
  await client.query(
    `
      DELETE FROM payroll_export_aggregate_session
      WHERE tenant_id = $1
        AND aggregate_id = $2
    `,
    [input.tenantId, input.aggregateId]
  );

  for (const row of input.rows) {
    await client.query(
      `
        INSERT INTO payroll_export_aggregate_session (
          tenant_id,
          aggregate_id,
          session_id,
          work_date,
          office_drive_minutes,
          photography_minutes,
          total_worked_minutes,
          lunch_deduction_minutes,
          payable_minutes,
          regular_office_drive_minutes,
          regular_photography_minutes,
          overtime_minutes,
          manual_correction_count,
          missed_clock_in_approval_count,
          reporting_flags
        )
        VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      `,
      [
        input.tenantId,
        input.aggregateId,
        row.sessionId,
        row.workDate,
        row.officeDriveMinutes,
        row.photographyMinutes,
        row.totalWorkedMinutes,
        row.lunchDeductionMinutes,
        row.payableMinutes,
        row.regularOfficeDriveMinutes,
        row.regularPhotographyMinutes,
        row.overtimeMinutes,
        row.manualCorrectionCount,
        row.missedClockInApprovalCount,
        row.reportingFlags
      ]
    );
  }
}

async function listAggregateSessions(client: PoolClient, tenantId: string, aggregateId: string) {
  const { rows } = await client.query<AggregateSessionRow>(
    `
      SELECT
        id,
        session_id,
        work_date::text,
        office_drive_minutes,
        photography_minutes,
        total_worked_minutes,
        lunch_deduction_minutes,
        payable_minutes,
        regular_office_drive_minutes,
        regular_photography_minutes,
        overtime_minutes,
        manual_correction_count,
        missed_clock_in_approval_count,
        reporting_flags,
        created_at::text
      FROM payroll_export_aggregate_session
      WHERE tenant_id = $1
        AND aggregate_id = $2
      ORDER BY work_date ASC, created_at ASC
    `,
    [tenantId, aggregateId]
  );
  return rows;
}

async function syncEmployeePayrollAggregate(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    payPeriodStart: string;
    payPeriodEnd: string;
  }
) {
  const sessions = await loadEmployeeSessionsForPeriod(
    client,
    input.tenantId,
    input.employeeId,
    input.payPeriodStart,
    input.payPeriodEnd
  );
  const sessionSummaries: TimeSessionPayrollSummaryRow[] = [];
  for (const session of sessions) {
    sessionSummaries.push(
      await syncTimeSessionPayrollSummary(client, {
        tenantId: input.tenantId,
        sessionId: session.id
      })
    );
  }
  return computeEmployeePayrollAggregate(client, input, sessionSummaries, true);
}

async function computeEmployeePayrollAggregate(
  client: PoolClient,
  input: {
    tenantId: string;
    employeeId: string;
    payPeriodStart: string;
    payPeriodEnd: string;
  },
  sessionSummaries: TimeSessionPayrollSummaryRow[],
  persistAggregate: boolean,
  sources: {
    payProfile?: EmployeePayProfileRow | null;
    mileageSummary?: MileageSummaryRow;
  } = {}
) {
  const allocation = computeWeeklyAllocation(sessionSummaries);
  const payProfile =
    "payProfile" in sources ? sources.payProfile ?? null : await loadActivePayProfile(client, input.tenantId, input.employeeId, input.payPeriodEnd);
  const mileageSummary =
    sources.mileageSummary ??
    (await loadMileageSummaryForEmployeePeriod(client, input.tenantId, input.employeeId, input.payPeriodStart, input.payPeriodEnd));

  const aggregateSessionRows = sessionSummaries.map((summary) => {
    const allocated = allocation.get(summary.session_id) ?? {
      regularOfficeDriveMinutes: 0,
      regularPhotographyMinutes: 0,
      overtimeMinutes: 0
    };
    return {
      sessionId: summary.session_id,
      workDate: summary.work_date,
      officeDriveMinutes: summary.office_drive_minutes,
      photographyMinutes: summary.photography_minutes,
      totalWorkedMinutes: summary.total_worked_minutes,
      lunchDeductionMinutes: summary.lunch_deduction_minutes,
      payableMinutes: summary.payable_minutes,
      regularOfficeDriveMinutes: allocated.regularOfficeDriveMinutes,
      regularPhotographyMinutes: allocated.regularPhotographyMinutes,
      overtimeMinutes: allocated.overtimeMinutes,
      manualCorrectionCount: summary.manual_correction_count,
      missedClockInApprovalCount: summary.missed_clock_in_approval_count,
      reportingFlags: summary.reporting_flags
    };
  });

  const regularOfficeDriveMinutes = aggregateSessionRows.reduce((sum, row) => sum + row.regularOfficeDriveMinutes, 0);
  const regularPhotographyMinutes = aggregateSessionRows.reduce((sum, row) => sum + row.regularPhotographyMinutes, 0);
  const overtimeMinutes = aggregateSessionRows.reduce((sum, row) => sum + row.overtimeMinutes, 0);
  const lunchDeductionMinutes = sessionSummaries.reduce((sum, summary) => sum + summary.lunch_deduction_minutes, 0);
  const manualCorrectionCount = sessionSummaries.reduce((sum, summary) => sum + summary.manual_correction_count, 0);
  const missedClockInApprovalCount = sessionSummaries.reduce((sum, summary) => sum + summary.missed_clock_in_approval_count, 0);
  const exceptionRequestCount = sessionSummaries.reduce((sum, summary) => sum + summary.exception_request_count, 0);
  const approvalRecordCount = sessionSummaries.reduce((sum, summary) => sum + summary.approval_record_count, 0);
  const exceptionFlags = [...new Set(sessionSummaries.flatMap((summary) => summary.reporting_flags ?? []))];
  const approvalFlags = [
    ...new Set(
      [
        manualCorrectionCount > 0 ? "manual_adjustment" : null,
        missedClockInApprovalCount > 0 ? "missed_clock_in_approval" : null,
        sessionSummaries.some((summary) => summary.lunch_deduction_source === "challenge_approved") ? "approved_no_lunch_challenge" : null,
        sessionSummaries.some((summary) => summary.lunch_deduction_source === "challenge_pending") ? "pending_no_lunch_challenge" : null
      ].filter((value): value is string => Boolean(value))
    )
  ];
  const overtimeBaseRate =
    payProfile && payProfile.overtime_eligible
      ? ((Number(payProfile.office_rate) + Number(payProfile.photography_rate)) / 2).toFixed(2)
      : null;
  const overtimeRate = overtimeBaseRate != null ? (Number(overtimeBaseRate) * 1.5).toFixed(2) : null;
  const notes = {
    pay_period_start: input.payPeriodStart,
    pay_period_end: input.payPeriodEnd,
    session_count: sessionSummaries.length,
    canonical_break_override_count: sessionSummaries.filter(
      (summary) =>
        summary.lunch_deduction_source === "challenge_approved" ||
        summary.lunch_deduction_source === "manual_override" ||
        summary.reporting_flags.includes("break_override")
    ).length,
    pending_lunch_challenge_count: sessionSummaries.filter((summary) => summary.lunch_deduction_source === "challenge_pending").length,
    review_required_mileage_count: mileageSummary.review_required_count,
    candidate_mileage_count: mileageSummary.candidate_count
  };
  const status: PayrollExportAggregateStatus =
    notes.pending_lunch_challenge_count > 0 || mileageSummary.review_required_count > 0 ? "draft" : "ready";
  if (persistAggregate) {
    const aggregate = await upsertPayrollAggregate(client, {
      tenant_id: input.tenantId,
      employee_id: input.employeeId,
      pay_period_start: input.payPeriodStart,
      pay_period_end: input.payPeriodEnd,
      regular_office_drive_minutes: regularOfficeDriveMinutes,
      regular_photography_minutes: regularPhotographyMinutes,
      overtime_minutes: overtimeMinutes,
      overtime_base_rate: overtimeBaseRate,
      overtime_rate: overtimeRate,
      lunch_deduction_minutes: lunchDeductionMinutes,
      manual_correction_count: manualCorrectionCount,
      missed_clock_in_approval_count: missedClockInApprovalCount,
      mileage_reimbursement_amount: mileageSummary.total_amount,
      exception_request_count: exceptionRequestCount,
      approval_record_count: approvalRecordCount,
      exception_flags: exceptionFlags,
      approval_flags: approvalFlags,
      notes,
      status
    });

    await replaceAggregateSessions(client, {
      tenantId: input.tenantId,
      aggregateId: aggregate.id,
      rows: aggregateSessionRows
    });

    return {
      aggregate,
      sessions: await listAggregateSessions(client, input.tenantId, aggregate.id)
    };
  }

  const generatedAt = new Date().toISOString();
  return {
    aggregate: {
      id: `computed:${input.employeeId}:${input.payPeriodStart}:${input.payPeriodEnd}`,
      tenant_id: input.tenantId,
      employee_id: input.employeeId,
      pay_period_start: input.payPeriodStart,
      pay_period_end: input.payPeriodEnd,
      regular_office_drive_minutes: regularOfficeDriveMinutes,
      regular_photography_minutes: regularPhotographyMinutes,
      overtime_minutes: overtimeMinutes,
      overtime_base_rate: overtimeBaseRate,
      overtime_rate: overtimeRate,
      lunch_deduction_minutes: lunchDeductionMinutes,
      manual_correction_count: manualCorrectionCount,
      missed_clock_in_approval_count: missedClockInApprovalCount,
      mileage_reimbursement_amount: mileageSummary.total_amount,
      exception_request_count: exceptionRequestCount,
      approval_record_count: approvalRecordCount,
      exception_flags: exceptionFlags,
      approval_flags: approvalFlags,
      notes,
      status,
      generated_at: generatedAt,
      updated_at: generatedAt
    },
    sessions: aggregateSessionRows.map((row, index) => ({
      id: `computed:${input.employeeId}:${row.sessionId}:${index}`,
      session_id: row.sessionId,
      work_date: row.workDate,
      office_drive_minutes: row.officeDriveMinutes,
      photography_minutes: row.photographyMinutes,
      total_worked_minutes: row.totalWorkedMinutes,
      lunch_deduction_minutes: row.lunchDeductionMinutes,
      payable_minutes: row.payableMinutes,
      regular_office_drive_minutes: row.regularOfficeDriveMinutes,
      regular_photography_minutes: row.regularPhotographyMinutes,
      overtime_minutes: row.overtimeMinutes,
      manual_correction_count: row.manualCorrectionCount,
      missed_clock_in_approval_count: row.missedClockInApprovalCount,
      reporting_flags: row.reportingFlags,
      created_at: generatedAt
    }))
  };
}

async function listEmployeesForPayrollPeriod(
  client: PoolClient,
  auth: AuthUser,
  input: {
    payPeriodStart: string;
    payPeriodEnd: string;
    department?: string | null;
    userId?: string | null;
  }
) {
  const effectiveUserId = shouldRestrictShiftList(auth) ? auth.id : input.userId ?? null;
  const { rows } = await client.query<EmployeePeriodRow>(
    `
      WITH employee_source AS (
        SELECT DISTINCT employee_id
        FROM time_session
        WHERE tenant_id = $1
          AND work_date >= $2::date
          AND work_date <= $3::date
        UNION
        SELECT DISTINCT employee_id
        FROM mileage_reimbursement
        WHERE tenant_id = $1
          AND work_date >= $2::date
          AND work_date <= $3::date
      )
      SELECT
        au.id AS employee_id,
        au.full_name AS employee_name,
        au.department::text
      FROM employee_source src
      JOIN app_user au
        ON au.id = src.employee_id
      WHERE au.tenant_id = $1
        AND ($4::department_code IS NULL OR au.department = $4::department_code)
        AND ($5::uuid IS NULL OR au.id = $5::uuid)
      ORDER BY au.full_name ASC
    `,
    [auth.tenantId, input.payPeriodStart, input.payPeriodEnd, input.department ?? null, effectiveUserId]
  );
  return rows;
}

function assertLunchChallengeReviewer(auth: AuthUser) {
  if (
    canEditHours(auth) ||
    hasJobFunctionProfile(auth, [
      "director_of_photography",
      "director_of_school_photography",
      "director_of_sports_photography"
    ])
  ) {
    return;
  }
  throw new ApiError(403, "No-lunch challenges require Director of Photography review or leadership override.");
}

async function findLunchChallengeRecipients(
  client: PoolClient,
  input: {
    tenantId: string;
    shiftId?: string | null;
    department?: string | null;
    excludeUserIds?: string[];
  }
) {
  const reviewerProfiles =
    input.department === "sports"
      ? ["director_of_photography", "director_of_sports_photography"]
      : input.department === "schools"
        ? ["director_of_photography", "director_of_school_photography"]
        : ["director_of_photography", "director_of_school_photography", "director_of_sports_photography"];

  const { rows } = await client.query<{ user_id: string }>(
    `
      SELECT DISTINCT ujfp.user_id
      FROM user_job_function_profile ujfp
      JOIN app_user au
        ON au.id = ujfp.user_id
       AND au.tenant_id = ujfp.tenant_id
      WHERE ujfp.tenant_id = $1
        AND au.status = 'active'
        AND ujfp.job_function_profile = ANY($2::job_function_profile[])
    `,
    [input.tenantId, reviewerProfiles]
  );

  const recipientSet = new Set(rows.map((row) => String(row.user_id)));
  const leadershipRows = await client.query<{ user_id: string }>(
    `
      SELECT DISTINCT uaa.user_id
      FROM user_authority_assignment uaa
      JOIN app_user au
        ON au.id = uaa.user_id
       AND au.tenant_id = uaa.tenant_id
      WHERE uaa.tenant_id = $1
        AND au.status = 'active'
        AND uaa.authority_tier = ANY($2::authority_tier[])
    `,
    [input.tenantId, ["leadership", "director_admin", "super_admin"]]
  );
  for (const row of leadershipRows.rows) {
    recipientSet.add(String(row.user_id));
  }

  const recipientUserIds = await findNotificationRecipients(client, {
    tenantId: input.tenantId,
    eventCode: "attendance.exception_requested",
    shiftId: input.shiftId ?? null,
    directUserIds: [...recipientSet],
    excludeUserIds: input.excludeUserIds ?? []
  });

  return {
    requestedApproverId: rows[0]?.user_id ?? leadershipRows.rows[0]?.user_id ?? null,
    recipientUserIds
  };
}

export async function submitNoLunchChallenge(
  client: PoolClient,
  auth: AuthUser,
  input: NoLunchChallengeInput,
  meta: RequestMeta
) {
  let session: TimeSessionRow | null = null;
  let shift: ShiftContext | null = null;

  if (input.shift_id) {
    await assertShiftAccess(client, auth, input.shift_id);
    shift = await loadShiftContext(client, auth.tenantId, input.shift_id);
    if (!shift) {
      throw new ApiError(404, "Shift not found");
    }
    if (shift.assigned_user_id !== auth.id && !canEditHours(auth)) {
      throw new ApiError(403, "No-lunch challenges are limited to your assigned shifts.");
    }
    session = await loadLatestTimeSessionForEmployeeDate(client, auth.tenantId, auth.id, getLocalDateString(shift.starts_at));
  }

  if (!session && input.session_id) {
    session = await loadTimeSessionById(client, auth.tenantId, input.session_id);
    if (!session) {
      throw new ApiError(404, "Time Session not found");
    }
    if (session.employee_id !== auth.id && !canEditHours(auth)) {
      throw new ApiError(403, "No-lunch challenges are limited to your own Time Session.");
    }
  }

  if (!session) {
    throw new ApiError(400, "No-lunch challenges require a linked shift or Time Session.");
  }

  const existingChallenge = await loadLatestLunchChallengeForSession(client, auth.tenantId, session.id);
  if (existingChallenge && ["submitted", "under_review"].includes(existingChallenge.status)) {
    throw new ApiError(409, "A no-lunch challenge is already open for this Time Session.");
  }

  const sessionSummary = await syncTimeSessionPayrollSummary(client, {
    tenantId: auth.tenantId,
    sessionId: session.id
  });
  if (sessionSummary.total_worked_minutes <= 300) {
    throw new ApiError(409, "This Time Session is not long enough for the automatic lunch deduction rule.");
  }

  const recipients = await findLunchChallengeRecipients(client, {
    tenantId: auth.tenantId,
    shiftId: shift?.id ?? session.source_shift_id ?? null,
    department: shift?.department ?? null,
    excludeUserIds: [auth.id]
  });

  const { rows: attendanceExceptionRows } = await client.query<{ id: string }>(
    `
      INSERT INTO attendance_exception (
        tenant_id,
        shift_id,
        shoot_id,
        user_id,
        exception_type,
        severity,
        reason_code,
        notes,
        requested_approver_user_id,
        requested_value,
        original_value,
        workflow_kind
      )
      VALUES ($1,$2,$3,$4,'NO_LUNCH_CHALLENGE','high',$5,$6,$7,$8::jsonb,$9::jsonb,'exception')
      RETURNING id
    `,
    [
      auth.tenantId,
      shift?.id ?? session.source_shift_id ?? null,
      shift?.shoot_id ?? null,
      auth.id,
      input.reason,
      input.note ?? null,
      recipients.requestedApproverId,
      JSON.stringify({
        session_id: session.id,
        work_date: session.work_date,
        requested_reason: input.reason,
        requested_note: input.note ?? null
      }),
      JSON.stringify({
        total_worked_minutes: sessionSummary.total_worked_minutes,
        lunch_deduction_minutes: sessionSummary.lunch_deduction_minutes,
        lunch_deduction_source: sessionSummary.lunch_deduction_source
      })
    ]
  );

  const attendanceExceptionId = attendanceExceptionRows[0].id;
  const exceptionRequestId = await createTimeClockExceptionRequest(client, {
    tenantId: auth.tenantId,
    employeeId: auth.id,
    requestType: "lunch_deduction_challenge",
    shiftId: shift?.id ?? session.source_shift_id ?? null,
    shootId: shift?.shoot_id ?? null,
    sessionId: session.id,
    requestedApproverId: recipients.requestedApproverId,
    relatedAttendanceExceptionId: attendanceExceptionId,
    locationContext: {
      shift_id: shift?.id ?? session.source_shift_id ?? null
    },
    originalValues: {
      total_worked_minutes: sessionSummary.total_worked_minutes,
      lunch_deduction_minutes: sessionSummary.lunch_deduction_minutes,
      lunch_deduction_source: sessionSummary.lunch_deduction_source
    },
    resolvedValues: {},
    reportingFlags: ["manual_adjustment", "lunch_challenge_pending"],
    note: input.note?.trim() ? `${input.reason}: ${input.note.trim()}` : input.reason
  });

  const refreshedSummary = await syncTimeSessionPayrollSummary(client, {
    tenantId: auth.tenantId,
    sessionId: session.id,
    actorUserId: auth.id,
    auth,
    emitTransitionEvents: true,
    reasonComment: input.note ?? `No-lunch challenge submitted: ${input.reason}`
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    targetUserId: auth.id,
    action: "time_clock.no_lunch_challenge.submitted",
    entityType: "exception_request",
    entityId: exceptionRequestId,
    previousValues: {
      lunch_deduction_minutes: sessionSummary.lunch_deduction_minutes,
      lunch_deduction_source: sessionSummary.lunch_deduction_source
    },
    newValues: {
      lunch_deduction_minutes: refreshedSummary.lunch_deduction_minutes,
      lunch_deduction_source: refreshedSummary.lunch_deduction_source
    },
    reasonComment: input.note ?? input.reason,
    metadata: {
      attendance_exception_id: attendanceExceptionId,
      session_id: session.id,
      work_date: session.work_date
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  if (recipients.recipientUserIds.length) {
    await queueNotificationDispatch(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      recipientUserIds: recipients.recipientUserIds,
      notificationType: "attendance.no_lunch_challenge_submitted",
      title: "No Lunch Challenge submitted",
      body: `${auth.fullName} challenged the automatic lunch deduction for ${session.work_date}.`,
      priority: "high",
      deepLink: shift?.id ? `/attendance/shifts/${shift.id}` : "/attendance",
      shiftId: shift?.id ?? session.source_shift_id ?? null,
      shootId: shift?.shoot_id ?? null,
      attendanceExceptionId,
      relatedUserId: auth.id,
      channels: ["in_app", "push"],
      metadata: { dedupe: attendanceExceptionId }
    });
  }

  return {
    attendance_exception_id: attendanceExceptionId,
    exception_request_id: exceptionRequestId,
    session_payroll_summary: refreshedSummary
  };
}

export async function getPayrollSummary(
  client: PoolClient,
  auth: AuthUser,
  filters: PayrollSummaryFilters = {}
): Promise<PayrollSummaryPayload> {
  const payPeriod = getPayPeriod(filters);
  const legacyComparisonRows = await loadLegacyTimeEntryPayrollComparison(client, auth, {
    payPeriodStart: payPeriod.start,
    payPeriodEnd: payPeriod.end,
    department: filters.department ?? null,
    userId: filters.userId ?? null
  });
  const employees = await listEmployeesForPayrollPeriod(client, auth, {
    payPeriodStart: payPeriod.start,
    payPeriodEnd: payPeriod.end,
    department: filters.department ?? null,
    userId: filters.userId ?? null
  });

  const legacyComparisonByEmployee = new Map(legacyComparisonRows.map((row) => [row.employee_id, row]));
  const employeeIds = employees.map((employee) => employee.employee_id);
  const sessionsByEmployee = await loadEmployeeSessionsForPeriodBatch(
    client,
    auth.tenantId,
    employeeIds,
    payPeriod.start,
    payPeriod.end
  );
  const allSessions = [...sessionsByEmployee.values()].flat();
  const allSessionIds = allSessions.map((session) => session.id);
  const segmentsBySession = await listEffectiveSegmentsForSessions(client, auth.tenantId, allSessionIds);
  const lunchChallengesBySession = await loadLatestLunchChallengesForSessions(client, auth.tenantId, allSessionIds);
  const sessionCountsBySession = await loadSessionCountsForSessions(client, auth.tenantId, allSessionIds);
  const payProfilesByEmployee = await loadActivePayProfilesForEmployees(client, auth.tenantId, employeeIds, payPeriod.end);
  const mileageSummariesByEmployee = await loadMileageSummaryForEmployeePeriodBatch(
    client,
    auth.tenantId,
    employeeIds,
    payPeriod.start,
    payPeriod.end
  );

  const rows: PayrollSummaryRow[] = [];
  for (const employee of employees) {
    const employeeSessions = sessionsByEmployee.get(employee.employee_id) ?? [];
    const sessionSummaries = employeeSessions.map((session) =>
      buildComputedTimeSessionPayrollSummary({
        tenantId: auth.tenantId,
        session,
        segments: segmentsBySession.get(session.id) ?? [],
        latestLunchChallenge: lunchChallengesBySession.get(session.id) ?? null,
        sessionCounts: sessionCountsBySession.get(session.id) ?? defaultSessionCounts()
      })
    );
    const synced = await computeEmployeePayrollAggregate(
      client,
      {
        tenantId: auth.tenantId,
        employeeId: employee.employee_id,
        payPeriodStart: payPeriod.start,
        payPeriodEnd: payPeriod.end
      },
      sessionSummaries,
      false,
      {
        payProfile: payProfilesByEmployee.get(employee.employee_id) ?? null,
        mileageSummary: mileageSummariesByEmployee.get(employee.employee_id) ?? defaultMileageSummary()
      }
    );
    const legacyComparison = legacyComparisonByEmployee.get(employee.employee_id) ?? {
      employee_id: employee.employee_id,
      entry_count: 0,
      gross_minutes: 0,
      break_deduction_minutes: 0,
      payable_minutes: 0,
      break_override_count: 0
    };
    const canonicalPayableMinutes = synced.sessions.reduce((sum, session) => sum + Number(session.payable_minutes ?? 0), 0);
    const payableMinutesDelta = canonicalPayableMinutes - Number(legacyComparison.payable_minutes ?? 0);
    const transitionFlags = [
      ...(legacyComparison.entry_count === 0 && canonicalPayableMinutes > 0 ? ["legacy_time_entry_missing"] : []),
      ...(legacyComparison.entry_count > 0 && payableMinutesDelta !== 0 ? ["legacy_payable_minutes_mismatch"] : []),
      ...(Number(legacyComparison.break_override_count ?? 0) > 0 &&
      Number(typeof synced.aggregate.notes?.canonical_break_override_count === "number" ? synced.aggregate.notes.canonical_break_override_count : 0) === 0
        ? ["legacy_break_override_mismatch"]
        : [])
    ];
    rows.push({
      ...synced.aggregate,
      employee_name: employee.employee_name,
      department: employee.department,
      sessions: synced.sessions,
      legacy_comparison: {
        entry_count: Number(legacyComparison.entry_count ?? 0),
        payable_minutes: Number(legacyComparison.payable_minutes ?? 0),
        payable_minutes_delta: payableMinutesDelta,
        break_override_count: Number(legacyComparison.break_override_count ?? 0),
        amounts_match: payableMinutesDelta === 0
      },
      transition_flags: transitionFlags
    });
  }

  const canonicalEmployeeIds = new Set(rows.map((row) => row.employee_id));
  const mismatchEmployeeCount = rows.filter((row) => row.transition_flags.length > 0).length;
  const canonicalBreakOverrideCount = rows.reduce(
    (sum, row) =>
      sum + Number(typeof row.notes?.canonical_break_override_count === "number" ? row.notes.canonical_break_override_count : 0),
    0
  );
  const legacyEntryCount = legacyComparisonRows.reduce((sum, row) => sum + Number(row.entry_count ?? 0), 0);
  const legacyGrossMinutes = legacyComparisonRows.reduce((sum, row) => sum + Number(row.gross_minutes ?? 0), 0);
  const legacyBreakDeductionMinutes = legacyComparisonRows.reduce((sum, row) => sum + Number(row.break_deduction_minutes ?? 0), 0);
  const legacyPayableMinutes = legacyComparisonRows.reduce((sum, row) => sum + Number(row.payable_minutes ?? 0), 0);
  const legacyBreakOverrideCount = legacyComparisonRows.reduce((sum, row) => sum + Number(row.break_override_count ?? 0), 0);

  return {
    source_of_truth: {
      primary_model: "canonical_labor_state",
      canonical_records: ["time_session", "time_segment", "time_session_payroll_summary", "payroll_export_aggregate"],
      legacy_compatibility_records: ["time_entry"]
    },
    pay_period: {
      start: payPeriod.start,
      end: payPeriod.end,
      overtime_basis: "weekly_over_40"
    },
    summary: {
      employee_count: rows.length,
      regular_office_drive_hours: toHours(rows.reduce((sum, row) => sum + row.regular_office_drive_minutes, 0)),
      regular_photography_hours: toHours(rows.reduce((sum, row) => sum + row.regular_photography_minutes, 0)),
      overtime_hours: toHours(rows.reduce((sum, row) => sum + row.overtime_minutes, 0)),
      lunch_deduction_hours: toHours(rows.reduce((sum, row) => sum + row.lunch_deduction_minutes, 0)),
      break_override_count: canonicalBreakOverrideCount,
      manual_correction_count: rows.reduce((sum, row) => sum + row.manual_correction_count, 0),
      missed_clock_in_approval_count: rows.reduce((sum, row) => sum + row.missed_clock_in_approval_count, 0),
      mileage_reimbursement_amount: Number(
        rows.reduce((sum, row) => sum + Number(row.mileage_reimbursement_amount ?? 0), 0).toFixed(2)
      ),
      pending_lunch_challenge_count: rows.reduce(
        (sum, row) => sum + Number(typeof row.notes?.pending_lunch_challenge_count === "number" ? row.notes.pending_lunch_challenge_count : 0),
        0
      ),
      review_required_mileage_count: rows.reduce(
        (sum, row) => sum + Number(typeof row.notes?.review_required_mileage_count === "number" ? row.notes.review_required_mileage_count : 0),
        0
      )
    },
    transition: {
      canonical_break_override_count: canonicalBreakOverrideCount,
      legacy_time_entry_summary: {
        entry_count: legacyEntryCount,
        gross_hours: toHours(legacyGrossMinutes),
        break_deduction_hours: toHours(legacyBreakDeductionMinutes),
        payable_hours: toHours(legacyPayableMinutes),
        break_override_count: legacyBreakOverrideCount
      },
      comparison: {
        mismatch_employee_count: mismatchEmployeeCount,
        canonical_only_employee_count: rows.filter((row) => row.legacy_comparison.entry_count === 0).length,
        legacy_only_employee_count: legacyComparisonRows.filter((row) => !canonicalEmployeeIds.has(row.employee_id)).length
      }
    },
    rows
  };
}

export function isNoLunchChallengeException(exceptionType: string) {
  return exceptionType === "NO_LUNCH_CHALLENGE";
}

export { assertLunchChallengeReviewer };
