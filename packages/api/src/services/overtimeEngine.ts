// Labor Command Center — configurable overtime policy + warning engine.
// Replaces the hard-coded weekly-over-40 assumption with layered policies
// (employee > department > tenant default > built-in weekly-over-40 fallback).
// The engine computes actual worked minutes for the policy workweek, projects the
// week using the open session and remaining scheduled shifts, and generates warning
// descriptors. Warnings are persisted (dedupe per employee + workweek + type) so the
// worker can notify once and every surface reads the same truth. No pay math here —
// rates and cost stay behind labor_cost gating elsewhere.
import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { canManagePayrollPeriods, canReviewTeamTime } from "../authz/authority.js";

export type OvertimePolicyScope = "tenant_default" | "department" | "employee";

export type OvertimePolicyRow = {
  id: string;
  scope_type: OvertimePolicyScope;
  department: string | null;
  employee_id: string | null;
  employee_name?: string | null;
  workweek_start_dow: number;
  weekly_overtime_threshold_minutes: number;
  company_warning_threshold_minutes: number;
  daily_overtime_threshold_minutes: number | null;
  warn_approaching_minutes: number;
  exempt_from_overtime: boolean;
  jurisdiction: string | null;
  active_status: boolean;
  effective_date: string;
  notes: string | null;
};

export type ResolvedOvertimePolicy = {
  source: OvertimePolicyScope | "built_in_default";
  policy_id: string | null;
  workweek_start_dow: number;
  weekly_overtime_threshold_minutes: number;
  // Company rule: warn once projected past 38h — distinct from the legal threshold.
  company_warning_threshold_minutes: number;
  daily_overtime_threshold_minutes: number | null;
  warn_approaching_minutes: number;
  exempt_from_overtime: boolean;
  // State-specific policy hook (one employee works out of state). Carried on
  // warnings so payroll can apply jurisdiction rules when they are confirmed.
  jurisdiction: string | null;
};

export type OvertimeWarningType =
  | "approaching_overtime"
  | "projected_overtime"
  | "in_overtime"
  | "unscheduled_overtime_risk"
  | "long_active_session"
  | "schedule_conflict_overtime";

export type OvertimeWarningSeverity = "info" | "warning" | "critical";

export type EmployeeOvertimeStatus = {
  employee_id: string;
  employee_name: string | null;
  department: string | null;
  workweek_start: string;
  workweek_end: string;
  policy: ResolvedOvertimePolicy;
  actual_minutes: number;
  open_session_minutes: number;
  remaining_scheduled_minutes: number;
  projected_minutes: number;
  threshold_minutes: number;
  company_warning_threshold_minutes: number;
  minutes_to_threshold: number;
  minutes_to_company_warning: number;
  in_overtime: boolean;
  warnings: Array<{
    warning_type: OvertimeWarningType;
    severity: OvertimeWarningSeverity;
    message: string;
  }>;
};

export type OvertimeWarningRecord = {
  id: string;
  employee_id: string;
  employee_name: string | null;
  department: string | null;
  workweek_start: string;
  warning_type: OvertimeWarningType;
  severity: OvertimeWarningSeverity;
  status: "active" | "acknowledged" | "approved" | "resolved";
  actual_minutes: number;
  projected_minutes: number;
  threshold_minutes: number;
  details: Record<string, unknown>;
  first_detected_at: string;
  last_evaluated_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
};

const BUILT_IN_DEFAULT: ResolvedOvertimePolicy = {
  source: "built_in_default",
  policy_id: null,
  workweek_start_dow: 1,
  weekly_overtime_threshold_minutes: 2400,
  company_warning_threshold_minutes: 2280, // 38h company warning rule
  daily_overtime_threshold_minutes: null,
  warn_approaching_minutes: 120,
  exempt_from_overtime: false,
  jurisdiction: null
};

// An open segment running past this many minutes raises long_active_session even
// before the weekly threshold is at risk (likely missed clock-out).
const LONG_ACTIVE_SESSION_MINUTES = 12 * 60;

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

export function getWorkweekBounds(anchorDate: string, workweekStartDow: number) {
  const anchor = parseDateOnly(anchorDate);
  const offset = (anchor.getDay() - workweekStartDow + 7) % 7;
  const start = addDays(anchor, -offset);
  return {
    start: formatDateOnly(start),
    end: formatDateOnly(addDays(start, 6))
  };
}

const POLICY_SELECT = `
  op.id,
  op.scope_type,
  op.department::text,
  op.employee_id,
  op.workweek_start_dow,
  op.weekly_overtime_threshold_minutes,
  op.company_warning_threshold_minutes,
  op.daily_overtime_threshold_minutes,
  op.warn_approaching_minutes,
  op.exempt_from_overtime,
  op.jurisdiction,
  op.active_status,
  op.effective_date::text,
  op.notes
`;

export async function listOvertimePolicies(client: PoolClient, auth: AuthUser) {
  if (!canManagePayrollPeriods(auth)) {
    throw new ApiError(403, "You do not have access to overtime policy configuration.");
  }
  const { rows } = await client.query<OvertimePolicyRow>(
    `
      SELECT ${POLICY_SELECT}, emp.full_name AS employee_name
      FROM overtime_policy op
      LEFT JOIN app_user emp ON emp.id = op.employee_id
      WHERE op.tenant_id = $1 AND op.active_status = true
      ORDER BY op.scope_type, op.department NULLS FIRST, emp.full_name NULLS FIRST
    `,
    [auth.tenantId]
  );
  return rows;
}

export async function upsertOvertimePolicy(
  client: PoolClient,
  auth: AuthUser,
  input: {
    scope_type: OvertimePolicyScope;
    department?: string | null;
    employee_id?: string | null;
    workweek_start_dow?: number;
    weekly_overtime_threshold_minutes?: number;
    company_warning_threshold_minutes?: number;
    daily_overtime_threshold_minutes?: number | null;
    warn_approaching_minutes?: number;
    exempt_from_overtime?: boolean;
    jurisdiction?: string | null;
    notes?: string | null;
  }
) {
  if (!canManagePayrollPeriods(auth)) {
    throw new ApiError(403, "You do not have access to overtime policy configuration.");
  }
  if (input.scope_type === "department" && !input.department) {
    throw new ApiError(400, "Department-scoped overtime policies require a department.");
  }
  if (input.scope_type === "employee" && !input.employee_id) {
    throw new ApiError(400, "Employee-scoped overtime policies require an employee.");
  }

  // Retire the previous active policy for this scope target, then insert the new one —
  // policy history is preserved, never overwritten.
  await client.query(
    `
      UPDATE overtime_policy
      SET active_status = false, updated_by_user_id = $2, updated_at = now()
      WHERE tenant_id = $1
        AND active_status = true
        AND scope_type = $3
        AND department IS NOT DISTINCT FROM $4
        AND employee_id IS NOT DISTINCT FROM $5
    `,
    [
      auth.tenantId,
      auth.id,
      input.scope_type,
      input.scope_type === "department" ? input.department : null,
      input.scope_type === "employee" ? input.employee_id : null
    ]
  );

  const { rows } = await client.query<OvertimePolicyRow>(
    `
      INSERT INTO overtime_policy (
        tenant_id, scope_type, department, employee_id,
        workweek_start_dow, weekly_overtime_threshold_minutes, company_warning_threshold_minutes,
        daily_overtime_threshold_minutes, warn_approaching_minutes, exempt_from_overtime,
        jurisdiction, notes, created_by_user_id, updated_by_user_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
      RETURNING ${POLICY_SELECT.replace(/op\./g, "")}
    `,
    [
      auth.tenantId,
      input.scope_type,
      input.scope_type === "department" ? input.department : null,
      input.scope_type === "employee" ? input.employee_id : null,
      input.workweek_start_dow ?? BUILT_IN_DEFAULT.workweek_start_dow,
      input.weekly_overtime_threshold_minutes ?? BUILT_IN_DEFAULT.weekly_overtime_threshold_minutes,
      input.company_warning_threshold_minutes ?? BUILT_IN_DEFAULT.company_warning_threshold_minutes,
      input.daily_overtime_threshold_minutes ?? null,
      input.warn_approaching_minutes ?? BUILT_IN_DEFAULT.warn_approaching_minutes,
      input.exempt_from_overtime ?? false,
      input.jurisdiction ?? null,
      input.notes ?? null,
      auth.id
    ]
  );
  return rows[0];
}

export async function resolveOvertimePolicy(
  client: PoolClient,
  tenantId: string,
  employeeId: string,
  department: string | null
): Promise<ResolvedOvertimePolicy> {
  const { rows } = await client.query<OvertimePolicyRow>(
    `
      SELECT ${POLICY_SELECT}
      FROM overtime_policy op
      WHERE op.tenant_id = $1
        AND op.active_status = true
        AND (
          (op.scope_type = 'employee' AND op.employee_id = $2)
          OR (op.scope_type = 'department' AND op.department::text = $3)
          OR op.scope_type = 'tenant_default'
        )
      ORDER BY CASE op.scope_type WHEN 'employee' THEN 0 WHEN 'department' THEN 1 ELSE 2 END
      LIMIT 1
    `,
    [tenantId, employeeId, department]
  );
  const match = rows[0];
  if (!match) {
    return BUILT_IN_DEFAULT;
  }
  return {
    source: match.scope_type,
    policy_id: match.id,
    workweek_start_dow: match.workweek_start_dow,
    weekly_overtime_threshold_minutes: match.weekly_overtime_threshold_minutes,
    company_warning_threshold_minutes: match.company_warning_threshold_minutes,
    daily_overtime_threshold_minutes: match.daily_overtime_threshold_minutes,
    warn_approaching_minutes: match.warn_approaching_minutes,
    exempt_from_overtime: match.exempt_from_overtime,
    jurisdiction: match.jurisdiction
  };
}

type EmployeeWeekRow = {
  employee_id: string;
  employee_name: string | null;
  department: string | null;
  worked_minutes: number;
  open_session_minutes: number;
  has_open_session: boolean;
  open_segment_started_at: string | null;
  open_segment_unscheduled: boolean;
};

type ScheduledRow = {
  employee_id: string;
  remaining_scheduled_minutes: number;
  overlapping_shift_count: number;
};

async function loadWorkedMinutesForWindow(
  client: PoolClient,
  tenantId: string,
  windowStart: string,
  windowEnd: string,
  employeeId?: string | null
) {
  // Closed segments come from generated duration_minutes; the open segment counts
  // live minutes so an active clock-in is never invisible to overtime math.
  const { rows } = await client.query<EmployeeWeekRow>(
    `
      SELECT
        u.id AS employee_id,
        u.full_name AS employee_name,
        u.department::text AS department,
        COALESCE(SUM(seg.duration_minutes) FILTER (WHERE seg.end_time IS NOT NULL), 0)::int AS worked_minutes,
        COALESCE(
          SUM(
            GREATEST(FLOOR(EXTRACT(EPOCH FROM (now() - seg.start_time)) / 60), 0)
          ) FILTER (WHERE seg.end_time IS NULL),
          0
        )::int AS open_session_minutes,
        BOOL_OR(seg.end_time IS NULL) AS has_open_session,
        MIN(seg.start_time::text) FILTER (WHERE seg.end_time IS NULL) AS open_segment_started_at,
        BOOL_OR(seg.end_time IS NULL AND seg.linked_shift_id IS NULL) AS open_segment_unscheduled
      FROM time_segment seg
      JOIN time_session ts ON ts.id = seg.session_id
      JOIN app_user u ON u.id = seg.employee_id
      WHERE seg.tenant_id = $1
        AND ts.work_date >= $2::date
        AND ts.work_date <= $3::date
        AND ($4::uuid IS NULL OR seg.employee_id = $4::uuid)
      GROUP BY u.id, u.full_name, u.department
    `,
    [tenantId, windowStart, windowEnd, employeeId ?? null]
  );
  return rows;
}

async function loadRemainingScheduledMinutes(
  client: PoolClient,
  tenantId: string,
  windowEnd: string,
  employeeId?: string | null
) {
  const { rows } = await client.query<ScheduledRow>(
    `
      SELECT
        ws.assigned_user_id AS employee_id,
        COALESCE(
          SUM(GREATEST(FLOOR(EXTRACT(EPOCH FROM (ws.ends_at - GREATEST(ws.starts_at, now()))) / 60), 0)),
          0
        )::int AS remaining_scheduled_minutes,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM work_shift other
            WHERE other.tenant_id = ws.tenant_id
              AND other.assigned_user_id = ws.assigned_user_id
              AND other.id <> ws.id
              AND other.status = 'published'
              AND tstzrange(other.starts_at, other.ends_at) && tstzrange(ws.starts_at, ws.ends_at)
          )
        )::int AS overlapping_shift_count
      FROM work_shift ws
      WHERE ws.tenant_id = $1
        AND ws.status = 'published'
        AND ws.ends_at > now()
        AND ws.starts_at::date <= $2::date
        AND ($3::uuid IS NULL OR ws.assigned_user_id = $3::uuid)
      GROUP BY ws.assigned_user_id
    `,
    [tenantId, windowEnd, employeeId ?? null]
  );
  return new Map(rows.map((row) => [row.employee_id, row]));
}

function buildWarnings(
  status: Omit<EmployeeOvertimeStatus, "warnings">,
  weekRow: EmployeeWeekRow,
  scheduled: ScheduledRow | undefined
): EmployeeOvertimeStatus["warnings"] {
  const warnings: EmployeeOvertimeStatus["warnings"] = [];
  if (status.policy.exempt_from_overtime) {
    return warnings;
  }

  // Company rule: warn at 38h projected/actual. Legal threshold (default 40h) is
  // separate — crossing it escalates severity to critical.
  const companyThreshold = status.policy.company_warning_threshold_minutes;
  const legalThreshold = status.threshold_minutes;
  const totalActual = status.actual_minutes + status.open_session_minutes;

  if (totalActual >= companyThreshold) {
    const pastLegal = totalActual >= legalThreshold;
    warnings.push({
      warning_type: "in_overtime",
      severity: pastLegal ? "critical" : "warning",
      message: pastLegal
        ? `Already at ${(totalActual / 60).toFixed(1)}h this workweek — past the ${(legalThreshold / 60).toFixed(1)}h legal overtime threshold.`
        : `Already at ${(totalActual / 60).toFixed(1)}h this workweek — over the ${(companyThreshold / 60).toFixed(1)}h company warning line.`
    });
  } else if (status.projected_minutes >= companyThreshold) {
    // Projection = actual worked + open session + remaining scheduled hours.
    warnings.push({
      warning_type: "projected_overtime",
      severity: status.projected_minutes >= legalThreshold ? "critical" : "warning",
      message: `Projected ${(status.projected_minutes / 60).toFixed(1)}h this workweek — actual plus remaining scheduled hours passes the ${(companyThreshold / 60).toFixed(1)}h warning line${status.projected_minutes >= legalThreshold ? ` and the ${(legalThreshold / 60).toFixed(1)}h legal threshold` : ""}.`
    });
  } else if (companyThreshold - totalActual <= status.policy.warn_approaching_minutes) {
    warnings.push({
      warning_type: "approaching_overtime",
      severity: "info",
      message: `Within ${Math.max(companyThreshold - totalActual, 0)} minutes of the ${(companyThreshold / 60).toFixed(1)}h company warning line.`
    });
  }

  if (weekRow.has_open_session && status.open_session_minutes >= LONG_ACTIVE_SESSION_MINUTES) {
    warnings.push({
      warning_type: "long_active_session",
      severity: "critical",
      message: `Active clock-in has been running ${(status.open_session_minutes / 60).toFixed(1)}h — likely a missed clock-out.`
    });
  }

  if (
    weekRow.open_segment_unscheduled &&
    totalActual + status.remaining_scheduled_minutes >= companyThreshold - status.policy.warn_approaching_minutes
  ) {
    warnings.push({
      warning_type: "unscheduled_overtime_risk",
      severity: "warning",
      message: "Current active session has no matching scheduled shift and this week is near the overtime threshold."
    });
  }

  if ((scheduled?.overlapping_shift_count ?? 0) > 0 && status.projected_minutes >= companyThreshold) {
    warnings.push({
      warning_type: "schedule_conflict_overtime",
      severity: "warning",
      message: "Overlapping published shifts this week contribute to a projected-overtime schedule conflict."
    });
  }

  return warnings;
}

export async function getOvertimeStatuses(
  client: PoolClient,
  tenantId: string,
  options: { anchorDate?: string; employeeId?: string | null } = {}
): Promise<EmployeeOvertimeStatus[]> {
  const anchor = options.anchorDate ?? formatDateOnly(new Date());
  // Policies can disagree on workweek start; compute per-employee windows from a
  // widened superset window, then filter to each employee's own workweek.
  const widest = getWorkweekBounds(anchor, 0);
  const widestStart = formatDateOnly(addDays(parseDateOnly(widest.start), -1));
  const widestEnd = formatDateOnly(addDays(parseDateOnly(widest.end), 1));

  const weekRows = await loadWorkedMinutesForWindow(client, tenantId, widestStart, widestEnd, options.employeeId);
  if (!weekRows.length) {
    return [];
  }
  const scheduledMap = await loadRemainingScheduledMinutes(client, tenantId, widestEnd, options.employeeId);

  const statuses: EmployeeOvertimeStatus[] = [];
  for (const weekRow of weekRows) {
    const policy = await resolveOvertimePolicy(client, tenantId, weekRow.employee_id, weekRow.department);
    const bounds = getWorkweekBounds(anchor, policy.workweek_start_dow);

    // Re-query exact minutes for this employee's actual workweek window when it
    // differs from the widened superset (different workweek start).
    let workedMinutes = weekRow.worked_minutes;
    let openMinutes = weekRow.open_session_minutes;
    if (bounds.start !== widestStart || bounds.end !== widestEnd) {
      const exact = await loadWorkedMinutesForWindow(client, tenantId, bounds.start, bounds.end, weekRow.employee_id);
      workedMinutes = exact[0]?.worked_minutes ?? 0;
      openMinutes = exact[0]?.open_session_minutes ?? 0;
    }

    const scheduled = scheduledMap.get(weekRow.employee_id);
    const remainingScheduled = scheduled?.remaining_scheduled_minutes ?? 0;
    const projected = workedMinutes + openMinutes + remainingScheduled;
    const threshold = policy.weekly_overtime_threshold_minutes;

    const base: Omit<EmployeeOvertimeStatus, "warnings"> = {
      employee_id: weekRow.employee_id,
      employee_name: weekRow.employee_name,
      department: weekRow.department,
      workweek_start: bounds.start,
      workweek_end: bounds.end,
      policy,
      actual_minutes: workedMinutes,
      open_session_minutes: openMinutes,
      remaining_scheduled_minutes: remainingScheduled,
      projected_minutes: projected,
      threshold_minutes: threshold,
      company_warning_threshold_minutes: policy.company_warning_threshold_minutes,
      minutes_to_threshold: Math.max(threshold - workedMinutes - openMinutes, 0),
      minutes_to_company_warning: Math.max(policy.company_warning_threshold_minutes - workedMinutes - openMinutes, 0),
      in_overtime: workedMinutes + openMinutes >= policy.company_warning_threshold_minutes && !policy.exempt_from_overtime
    };

    statuses.push({ ...base, warnings: buildWarnings(base, weekRow, scheduled) });
  }

  return statuses;
}

// Worker entrypoint: evaluate every employee with activity this week, upsert active
// warnings (dedupe on employee + workweek + type), resolve warnings that no longer
// apply. Returns newly created warnings so the caller can notify exactly once.
export async function evaluateAndPersistOvertimeWarnings(client: PoolClient, tenantId: string) {
  const statuses = await getOvertimeStatuses(client, tenantId);
  const created: Array<{ employee_id: string; warning_type: OvertimeWarningType; severity: OvertimeWarningSeverity }> = [];

  for (const status of statuses) {
    const activeTypes = new Set(status.warnings.map((warning) => warning.warning_type));

    for (const warning of status.warnings) {
      const { rows } = await client.query<{ id: string; inserted: boolean }>(
        `
          INSERT INTO overtime_warning (
            tenant_id, employee_id, workweek_start, warning_type, severity, status,
            actual_minutes, projected_minutes, threshold_minutes, details, last_evaluated_at
          ) VALUES ($1, $2, $3::date, $4, $5, 'active', $6, $7, $8, $9::jsonb, now())
          ON CONFLICT (tenant_id, employee_id, workweek_start, warning_type) WHERE status <> 'resolved'
          DO UPDATE SET
            severity = EXCLUDED.severity,
            actual_minutes = EXCLUDED.actual_minutes,
            projected_minutes = EXCLUDED.projected_minutes,
            threshold_minutes = EXCLUDED.threshold_minutes,
            details = EXCLUDED.details,
            last_evaluated_at = now(),
            updated_at = now()
          RETURNING id, (xmax = 0) AS inserted
        `,
        [
          tenantId,
          status.employee_id,
          status.workweek_start,
          warning.warning_type,
          warning.severity,
          status.actual_minutes + status.open_session_minutes,
          status.projected_minutes,
          status.threshold_minutes,
          JSON.stringify({ message: warning.message, department: status.department })
        ]
      );
      if (rows[0]?.inserted) {
        created.push({
          employee_id: status.employee_id,
          warning_type: warning.warning_type,
          severity: warning.severity
        });
      }
    }

    // Resolve stale warnings for this employee's current workweek.
    await client.query(
      `
        UPDATE overtime_warning
        SET status = 'resolved', resolved_at = now(), updated_at = now()
        WHERE tenant_id = $1
          AND employee_id = $2
          AND workweek_start = $3::date
          AND status <> 'resolved'
          AND NOT (warning_type = ANY($4::text[]))
      `,
      [tenantId, status.employee_id, status.workweek_start, Array.from(activeTypes)]
    );
  }

  return { evaluated: statuses.length, created };
}

export async function listOvertimeWarnings(
  client: PoolClient,
  auth: AuthUser,
  options: { includeResolved?: boolean } = {}
): Promise<OvertimeWarningRecord[]> {
  if (!canReviewTeamTime(auth)) {
    throw new ApiError(403, "You do not have access to team overtime warnings.");
  }
  const { rows } = await client.query<OvertimeWarningRecord>(
    `
      SELECT
        w.id,
        w.employee_id,
        emp.full_name AS employee_name,
        emp.department::text AS department,
        w.workweek_start::text,
        w.warning_type,
        w.severity,
        w.status,
        w.actual_minutes,
        w.projected_minutes,
        w.threshold_minutes,
        w.details,
        w.first_detected_at::text,
        w.last_evaluated_at::text,
        w.acknowledged_at::text,
        w.resolved_at::text
      FROM overtime_warning w
      LEFT JOIN app_user emp ON emp.id = w.employee_id
      WHERE w.tenant_id = $1
        AND ($2::boolean OR w.status <> 'resolved')
      ORDER BY
        CASE w.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
        w.last_evaluated_at DESC
      LIMIT 200
    `,
    [auth.tenantId, options.includeResolved ?? false]
  );
  return rows;
}

// Employee-facing: own hours + warnings only. Never includes rates or cost.
export async function getMyOvertimeStatus(client: PoolClient, auth: AuthUser) {
  const statuses = await getOvertimeStatuses(client, auth.tenantId, { employeeId: auth.id });
  return statuses[0] ?? null;
}

export async function acknowledgeOvertimeWarning(client: PoolClient, auth: AuthUser, warningId: string) {
  if (!canReviewTeamTime(auth)) {
    throw new ApiError(403, "You do not have access to acknowledge overtime warnings.");
  }
  const { rows } = await client.query<{ id: string }>(
    `
      UPDATE overtime_warning
      SET status = 'acknowledged', acknowledged_by_user_id = $3, acknowledged_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status = 'active'
      RETURNING id
    `,
    [auth.tenantId, warningId, auth.id]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Active overtime warning not found.");
  }
  return { id: rows[0].id, status: "acknowledged" as const };
}

// Manager OT approval: the manager explicitly approves the overtime this warning
// describes. The employee is never hard-blocked from working; approval records who
// signed off. The warning stays visible (status approved) until the week resolves.
export async function approveOvertimeWarning(client: PoolClient, auth: AuthUser, warningId: string) {
  if (!canReviewTeamTime(auth)) {
    throw new ApiError(403, "You do not have access to approve overtime.");
  }
  const { rows } = await client.query<{ id: string; employee_id: string }>(
    `
      UPDATE overtime_warning
      SET status = 'approved', acknowledged_by_user_id = $3, acknowledged_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND id = $2 AND status IN ('active', 'acknowledged')
      RETURNING id, employee_id
    `,
    [auth.tenantId, warningId, auth.id]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Approvable overtime warning not found.");
  }
  return { id: rows[0].id, employee_id: rows[0].employee_id, status: "approved" as const };
}
