import type { PoolClient } from "pg";
import type { AuthUser } from "../types/auth.js";
import { canViewAttendanceExceptions, canViewLaborCost } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import { shouldRestrictShiftList } from "./shiftAccess.js";
import { getLocalDayBounds } from "../utils/localDate.js";
import { config } from "../config.js";

type DashboardFilters = {
  date: string;
  employeeId?: string;
  department?: string;
  shootId?: string;
  managerId?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type DashboardExportKind = "labor" | "punches" | "exceptions" | "payroll";

function sanitizeDashboardSummary(
  summary: Record<string, number>,
  options: { includeLabor: boolean; includeAttendanceExceptions: boolean }
) {
  const next = { ...summary };

  if (!options.includeAttendanceExceptions) {
    next.late_employees = 0;
    next.no_shows = 0;
    next.excused_exceptions = 0;
    next.unscheduled_punches = 0;
    next.out_of_bounds_punches = 0;
    next.late_warning_count = 0;
    next.missed_punch_count = 0;
    next.missed_clock_out_count = 0;
    next.no_show_suspected_count = 0;
  }

  if (!options.includeLabor) {
    next.scheduled_labor_hours = 0;
    next.actual_labor_hours = 0;
    next.payable_labor_hours = 0;
    next.break_deduction_hours = 0;
    next.break_override_count = 0;
  }

  return next;
}

function sanitizeShiftRows(
  rows: Record<string, unknown>[],
  options: { includeLabor: boolean; includeAttendanceExceptions: boolean }
) {
  return rows.map((row) => ({
    ...row,
    scheduled_hours: options.includeLabor ? row.scheduled_hours : 0,
    actual_hours: options.includeLabor ? row.actual_hours : 0,
    actual_hours_canonical: options.includeLabor ? (row.actual_hours_canonical ?? null) : null,
    hours_source_delta: options.includeLabor ? (row.hours_source_delta ?? null) : null,
    hours_source: options.includeLabor ? (row.hours_source ?? "legacy") : null,
    open_exception_count: options.includeAttendanceExceptions ? row.open_exception_count : 0,
    latest_approval_state: options.includeAttendanceExceptions ? row.latest_approval_state : null
  }));
}

function sanitizeShootMetrics(rows: Record<string, unknown>[], includeLabor: boolean) {
  if (includeLabor) {
    return rows;
  }
  return rows.map((row) => ({
    ...row,
    scheduled_hours: 0,
    actual_hours: 0,
    actual_hours_canonical: null,
    actual_hours_legacy_uncovered: null,
    canonical_covered_shift_count: 0,
    rigorous_shoot_score: 0
  }));
}

function getDashboardDateBounds(filters: DashboardFilters) {
  if (filters.date) {
    return getLocalDayBounds(filters.date);
  }

  return {
    start: filters.dateFrom ? getLocalDayBounds(filters.dateFrom).start : null,
    endExclusive: filters.dateTo ? getLocalDayBounds(filters.dateTo).endExclusive : null
  };
}

function buildShiftFilterSql(auth: AuthUser, filters: DashboardFilters) {
  const values: unknown[] = [];
  const where: string[] = ["ws.cancelled_at IS NULL"];
  const bounds = getDashboardDateBounds(filters);

  if (bounds.start) {
    values.push(bounds.start.toISOString());
    where.push(`ws.ends_at >= $${values.length}::timestamptz`);
  }
  if (bounds.endExclusive) {
    values.push(bounds.endExclusive.toISOString());
    where.push(`ws.starts_at < $${values.length}::timestamptz`);
  }
  if (filters.employeeId) {
    values.push(filters.employeeId);
    where.push(`ws.assigned_user_id = $${values.length}`);
  }
  if (filters.department) {
    values.push(filters.department);
    where.push(`ws.department = $${values.length}::department_code`);
  }
  if (filters.shootId) {
    values.push(filters.shootId);
    where.push(`ws.shoot_id = $${values.length}`);
  }
  if (filters.managerId) {
    values.push(filters.managerId);
    where.push(`ws.manager_user_id = $${values.length}`);
  }
  if (shouldRestrictShiftList(auth)) {
    values.push(auth.id);
    where.push(`ws.assigned_user_id = $${values.length}`);
  }

  return { values, where };
}

export async function getOperationsDashboard(client: PoolClient, auth: AuthUser, filters: DashboardFilters) {
  const includeLabor = canViewLaborCost(auth);
  const includeAttendanceExceptions = canViewAttendanceExceptions(auth);
  const { values, where } = buildShiftFilterSql(auth, filters);
  const sqlWhere = where.join(" AND ");
  const bounds = getDashboardDateBounds(filters);
  const reportStart = bounds.start?.toISOString() ?? null;
  const reportEndExclusive = bounds.endExclusive?.toISOString() ?? null;

  const shifts = await client.query(
    `
      SELECT
        ws.*,
        au.full_name AS assigned_user_name,
        manager.full_name AS manager_name,
        s.shoot_code,
        s.title AS shoot_title,
        s.projected_students,
        latest_punch.direction AS latest_punch_direction,
        latest_punch.client_timestamp AS latest_punch_at,
        latest_punch.geofence_status AS latest_geofence_status,
        latest_punch.gps_confidence AS latest_gps_confidence,
        latest_punch.approval_state AS latest_approval_state,
        COALESCE(
          (
            SELECT SUM(EXTRACT(EPOCH FROM (seg.scheduled_end_at - seg.scheduled_start_at)) / 3600.0)
            FROM shift_segment seg
            WHERE seg.shift_id = ws.id
          ),
          EXTRACT(EPOCH FROM (ws.ends_at - ws.starts_at)) / 3600.0
        ) AS scheduled_hours,
        COALESCE(
          (
            SELECT SUM(COALESCE(te.minutes_worked, 0)) / 60.0
            FROM time_entry te
            WHERE te.shoot_id = ws.shoot_id
              AND te.user_id = ws.assigned_user_id
          ),
          (
            SELECT GREATEST(
              0,
              EXTRACT(
                EPOCH FROM (
                  MAX(CASE WHEN sp.direction = 'out' THEN sp.client_timestamp END) -
                  MIN(CASE WHEN sp.direction = 'in' THEN sp.client_timestamp END)
                )
              ) / 3600.0
            )
            FROM shift_punch sp
            WHERE sp.shift_id = ws.id
          ),
          0
        ) AS actual_hours,
        -- G2 Slice D: canonical payroll-truth hours ALONGSIDE the legacy time_entry-derived
        -- actual_hours above. Source = time_session_payroll_summary.payable_minutes (the
        -- single-writer canonical rollup), linked strictly via time_session.source_shift_id.
        -- NULL (not zero) when no linked session/summary exists — honest unavailable.
        (
          SELECT SUM(ps.payable_minutes) / 60.0
          FROM time_session ts
          JOIN time_session_payroll_summary ps
            ON ps.session_id = ts.id
           AND ps.tenant_id = ts.tenant_id
          WHERE ts.source_shift_id = ws.id
            AND ts.tenant_id = ws.tenant_id
        ) AS actual_hours_canonical,
        (
          SELECT COUNT(*)
          FROM shift_punch sp
          WHERE sp.shift_id = ws.id
            AND sp.direction = 'in'
        ) AS punch_in_count,
        (
          SELECT COUNT(*)
          FROM attendance_exception ae
          WHERE ae.shift_id = ws.id
            AND ae.status = 'open'
        ) AS open_exception_count
      FROM work_shift ws
      JOIN app_user au ON au.id = ws.assigned_user_id
      LEFT JOIN app_user manager ON manager.id = ws.manager_user_id
      LEFT JOIN shoot s ON s.id = ws.shoot_id
      LEFT JOIN LATERAL (
        SELECT sp.direction, sp.client_timestamp, sp.geofence_status, sp.gps_confidence, sp.approval_state
        FROM shift_punch sp
        WHERE sp.shift_id = ws.id
        ORDER BY sp.client_timestamp DESC, sp.created_at DESC
        LIMIT 1
      ) latest_punch ON TRUE
      WHERE ${sqlWhere}
      ORDER BY ws.starts_at ASC
    `,
    values
  );

  const exceptions = await client.query(
    `
      SELECT exception_type, classification, COUNT(*)::int AS total
      FROM attendance_exception ae
      LEFT JOIN work_shift ws ON ws.id = ae.shift_id
      WHERE ${sqlWhere}
      GROUP BY exception_type, classification
    `,
    values
  ).catch(() => ({ rows: [] as any[] }));

  const byShoot = await client.query(
    `
      SELECT
        COALESCE(s.id, ws.id) AS scope_id,
        COALESCE(s.shoot_code, ws.title) AS scope_code,
        COALESCE(s.title, ws.title) AS scope_title,
        COALESCE(s.department::text, ws.department::text) AS department,
        COALESCE(s.projected_students, 0) AS projected_students,
        COALESCE(s.planned_staff_count, 0) AS planned_staff_count,
        COALESCE(s.required_lead_count, 1) AS required_lead_count,
        COUNT(DISTINCT ws.assigned_user_id)::int AS scheduled_employees,
        SUM(COALESCE(
          (
            SELECT SUM(EXTRACT(EPOCH FROM (seg.scheduled_end_at - seg.scheduled_start_at)) / 3600.0)
            FROM shift_segment seg
            WHERE seg.shift_id = ws.id
          ),
          EXTRACT(EPOCH FROM (ws.ends_at - ws.starts_at)) / 3600.0
        )) AS scheduled_hours,
        SUM(COALESCE(
          (
            SELECT SUM(COALESCE(te.minutes_worked, 0)) / 60.0
            FROM time_entry te
            WHERE te.shoot_id = ws.shoot_id
              AND te.user_id = ws.assigned_user_id
          ),
          (
            SELECT GREATEST(
              0,
              EXTRACT(
                EPOCH FROM (
                  MAX(CASE WHEN sp.direction = 'out' THEN sp.client_timestamp END) -
                  MIN(CASE WHEN sp.direction = 'in' THEN sp.client_timestamp END)
                )
              ) / 3600.0
            )
            FROM shift_punch sp
            WHERE sp.shift_id = ws.id
          ),
          0
        )) AS actual_hours,
        -- G2 consumer opt-in: canonical payroll-truth hours alongside legacy, same
        -- source_shift_id join as the per-shift Slice D block. NULL = no shift in
        -- this group has canonical coverage; the covered count keeps partial
        -- coverage honest.
        SUM((
          SELECT SUM(ps.payable_minutes) / 60.0
          FROM time_session ts
          JOIN time_session_payroll_summary ps
            ON ps.session_id = ts.id
           AND ps.tenant_id = ts.tenant_id
          WHERE ts.source_shift_id = ws.id
            AND ts.tenant_id = ws.tenant_id
        )) AS actual_hours_canonical,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1
          FROM time_session ts
          JOIN time_session_payroll_summary ps
            ON ps.session_id = ts.id
           AND ps.tenant_id = ts.tenant_id
          WHERE ts.source_shift_id = ws.id
            AND ts.tenant_id = ws.tenant_id
        ))::int AS canonical_covered_shift_count,
        -- Legacy hours for the UNCOVERED shifts only, so the read-cutover can
        -- display canonical + per-shift legacy fallback with exact group totals.
        SUM(COALESCE(
          (
            SELECT SUM(COALESCE(te.minutes_worked, 0)) / 60.0
            FROM time_entry te
            WHERE te.shoot_id = ws.shoot_id
              AND te.user_id = ws.assigned_user_id
          ),
          (
            SELECT GREATEST(
              0,
              EXTRACT(
                EPOCH FROM (
                  MAX(CASE WHEN sp.direction = 'out' THEN sp.client_timestamp END) -
                  MIN(CASE WHEN sp.direction = 'in' THEN sp.client_timestamp END)
                )
              ) / 3600.0
            )
            FROM shift_punch sp
            WHERE sp.shift_id = ws.id
          ),
          0
        )) FILTER (WHERE NOT EXISTS (
          SELECT 1
          FROM time_session ts
          JOIN time_session_payroll_summary ps
            ON ps.session_id = ts.id
           AND ps.tenant_id = ts.tenant_id
          WHERE ts.source_shift_id = ws.id
            AND ts.tenant_id = ws.tenant_id
        )) AS actual_hours_legacy_uncovered
      FROM work_shift ws
      LEFT JOIN shoot s ON s.id = ws.shoot_id
      WHERE ${sqlWhere}
      GROUP BY
        COALESCE(s.id, ws.id),
        COALESCE(s.shoot_code, ws.title),
        COALESCE(s.title, ws.title),
        COALESCE(s.department::text, ws.department::text),
        COALESCE(s.projected_students, 0),
        COALESCE(s.planned_staff_count, 0),
        COALESCE(s.required_lead_count, 1)
      ORDER BY COALESCE(s.shoot_code, ws.title) ASC
    `,
    values
  );

  const laborReport = await client.query(
    `
      SELECT
        ws.assigned_user_id,
        au.full_name AS assigned_user_name,
        ws.department,
        manager.full_name AS manager_name,
        COUNT(ws.id)::int AS shift_count,
        COUNT(*) FILTER (WHERE latest_punch.direction = 'in')::int AS clocked_in_shift_count,
        SUM(
          COALESCE(
            (
              SELECT SUM(EXTRACT(EPOCH FROM (seg.scheduled_end_at - seg.scheduled_start_at)) / 3600.0)
              FROM shift_segment seg
              WHERE seg.shift_id = ws.id
            ),
            EXTRACT(EPOCH FROM (ws.ends_at - ws.starts_at)) / 3600.0
          )
        ) AS scheduled_hours,
        SUM(
          COALESCE(
            (
              SELECT SUM(COALESCE(te.minutes_worked, 0)) / 60.0
              FROM time_entry te
              WHERE te.shoot_id = ws.shoot_id
                AND te.user_id = ws.assigned_user_id
            ),
            (
              SELECT GREATEST(
                0,
                EXTRACT(
                  EPOCH FROM (
                    MAX(CASE WHEN sp.direction = 'out' THEN sp.client_timestamp END) -
                    MIN(CASE WHEN sp.direction = 'in' THEN sp.client_timestamp END)
                  )
                ) / 3600.0
              )
              FROM shift_punch sp
              WHERE sp.shift_id = ws.id
            ),
            0
          )
        ) AS actual_hours,
        -- G2 consumer opt-in: canonical hours per employee, NULL when none of the
        -- employee's shifts have canonical coverage (never a fake zero).
        SUM((
          SELECT SUM(ps.payable_minutes) / 60.0
          FROM time_session ts
          JOIN time_session_payroll_summary ps
            ON ps.session_id = ts.id
           AND ps.tenant_id = ts.tenant_id
          WHERE ts.source_shift_id = ws.id
            AND ts.tenant_id = ws.tenant_id
        )) AS actual_hours_canonical,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1
          FROM time_session ts
          JOIN time_session_payroll_summary ps
            ON ps.session_id = ts.id
           AND ps.tenant_id = ts.tenant_id
          WHERE ts.source_shift_id = ws.id
            AND ts.tenant_id = ws.tenant_id
        ))::int AS canonical_covered_shift_count,
        SUM(COALESCE(
          (
            SELECT SUM(COALESCE(te.minutes_worked, 0)) / 60.0
            FROM time_entry te
            WHERE te.shoot_id = ws.shoot_id
              AND te.user_id = ws.assigned_user_id
          ),
          (
            SELECT GREATEST(
              0,
              EXTRACT(
                EPOCH FROM (
                  MAX(CASE WHEN sp.direction = 'out' THEN sp.client_timestamp END) -
                  MIN(CASE WHEN sp.direction = 'in' THEN sp.client_timestamp END)
                )
              ) / 3600.0
            )
            FROM shift_punch sp
            WHERE sp.shift_id = ws.id
          ),
          0
        )) FILTER (WHERE NOT EXISTS (
          SELECT 1
          FROM time_session ts
          JOIN time_session_payroll_summary ps
            ON ps.session_id = ts.id
           AND ps.tenant_id = ts.tenant_id
          WHERE ts.source_shift_id = ws.id
            AND ts.tenant_id = ws.tenant_id
        )) AS actual_hours_legacy_uncovered,
        SUM(
          (
            SELECT COUNT(*)
            FROM attendance_exception ae
            WHERE ae.shift_id = ws.id
              AND ae.status = 'open'
          )
        )::int AS open_exception_count
      FROM work_shift ws
      JOIN app_user au ON au.id = ws.assigned_user_id
      LEFT JOIN app_user manager ON manager.id = ws.manager_user_id
      LEFT JOIN LATERAL (
        SELECT sp.direction
        FROM shift_punch sp
        WHERE sp.shift_id = ws.id
        ORDER BY sp.client_timestamp DESC, sp.created_at DESC
        LIMIT 1
      ) latest_punch ON TRUE
      WHERE ${sqlWhere}
      GROUP BY ws.assigned_user_id, au.full_name, ws.department, manager.full_name
      ORDER BY au.full_name ASC
    `,
    values
  );

  const punchReport = await client.query(
    `
      SELECT
        sp.id,
        sp.shift_id,
        sp.direction,
        sp.client_timestamp,
        sp.geofence_status,
        sp.gps_confidence,
        sp.approval_state,
        sp.reason_code,
        sp.notes,
        ws.title AS shift_title,
        ws.department,
        au.full_name AS assigned_user_name,
        manager.full_name AS manager_name,
        s.shoot_code
      FROM shift_punch sp
      JOIN app_user au ON au.id = sp.user_id
      LEFT JOIN work_shift ws ON ws.id = sp.shift_id
      LEFT JOIN app_user manager ON manager.id = ws.manager_user_id
      LEFT JOIN shoot s ON s.id = COALESCE(sp.shoot_id, ws.shoot_id)
      WHERE sp.tenant_id = $1
        AND ($2::timestamptz IS NULL OR sp.client_timestamp >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR sp.client_timestamp < $3::timestamptz)
        AND ($4::uuid IS NULL OR sp.user_id = $4::uuid)
        AND ($5::department_code IS NULL OR ws.department = $5::department_code)
        AND ($6::uuid IS NULL OR COALESCE(sp.shoot_id, ws.shoot_id) = $6::uuid)
        AND ($7::uuid IS NULL OR ws.manager_user_id = $7::uuid)
      ORDER BY sp.client_timestamp DESC, sp.created_at DESC
      LIMIT 80
    `,
    [
      auth.tenantId,
      reportStart,
      reportEndExclusive,
      filters.employeeId ?? null,
      filters.department ?? null,
      filters.shootId ?? null,
      filters.managerId ?? null
    ]
  );

  const exceptionReport = await client.query(
    `
      SELECT
        ae.*,
        ws.title AS shift_title,
        ws.department,
        requester.full_name AS user_name,
        manager.full_name AS manager_name,
        req_approver.full_name AS requested_approver_name,
        approver.full_name AS approved_by_name,
        s.shoot_code
      FROM attendance_exception ae
      JOIN app_user requester ON requester.id = ae.user_id
      LEFT JOIN work_shift ws ON ws.id = ae.shift_id
      LEFT JOIN app_user manager ON manager.id = ws.manager_user_id
      LEFT JOIN app_user req_approver ON req_approver.id = ae.requested_approver_user_id
      LEFT JOIN app_user approver ON approver.id = ae.approved_by_user_id
      LEFT JOIN shoot s ON s.id = COALESCE(ae.shoot_id, ws.shoot_id)
      WHERE ae.tenant_id = $1
        AND ($2::timestamptz IS NULL OR ae.created_at >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR ae.created_at < $3::timestamptz)
        AND ($4::uuid IS NULL OR ae.user_id = $4::uuid)
        AND ($5::department_code IS NULL OR ws.department = $5::department_code)
        AND ($6::uuid IS NULL OR COALESCE(ae.shoot_id, ws.shoot_id) = $6::uuid)
        AND ($7::uuid IS NULL OR ws.manager_user_id = $7::uuid)
      ORDER BY ae.created_at DESC
      LIMIT 80
    `,
    [
      auth.tenantId,
      reportStart,
      reportEndExclusive,
      filters.employeeId ?? null,
      filters.department ?? null,
      filters.shootId ?? null,
      filters.managerId ?? null
    ]
  );

  const payrollReport = await client.query(
    `
      SELECT
        te.id,
        te.shift_id,
        te.clock_in_at,
        te.clock_out_at,
        te.scheduled_minutes,
        te.gross_minutes,
        te.break_deduction_minutes,
        te.break_deduction_applied,
        te.break_deduction_source,
        te.break_deduction_overridden,
        te.break_deduction_override_reason,
        te.payable_minutes,
        te.approved_payable_minutes,
        te.payroll_state,
        te.attendance_state,
        ws.title AS shift_title,
        ws.department,
        ws.location_name,
        au.full_name AS assigned_user_name,
        manager.full_name AS manager_name,
        s.shoot_code
      FROM time_entry te
      JOIN app_user au ON au.id = te.user_id
      LEFT JOIN work_shift ws ON ws.id = te.shift_id
      LEFT JOIN app_user manager ON manager.id = ws.manager_user_id
      LEFT JOIN shoot s ON s.id = te.shoot_id
      WHERE te.tenant_id = $1
        AND ($2::timestamptz IS NULL OR te.clock_in_at >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR te.clock_in_at < $3::timestamptz)
        AND ($4::uuid IS NULL OR te.user_id = $4::uuid)
        AND ($5::department_code IS NULL OR ws.department = $5::department_code)
        AND ($6::uuid IS NULL OR te.shoot_id = $6::uuid)
        AND ($7::uuid IS NULL OR ws.manager_user_id = $7::uuid)
      ORDER BY te.clock_in_at DESC
      LIMIT 80
    `,
    [
      auth.tenantId,
      reportStart,
      reportEndExclusive,
      filters.employeeId ?? null,
      filters.department ?? null,
      filters.shootId ?? null,
      filters.managerId ?? null
    ]
  );

  const tradeReport = await client.query(
    `
      SELECT
        ws.department,
        COUNT(str.id)::int AS total_requests,
        COUNT(*) FILTER (WHERE str.status = 'approved')::int AS approved_requests,
        COUNT(*) FILTER (WHERE str.status = 'pending')::int AS pending_requests
      FROM shift_trade_request str
      JOIN work_shift ws ON ws.id = str.shift_id
      WHERE str.tenant_id = $1
        AND ($2::timestamptz IS NULL OR str.created_at >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR str.created_at < $3::timestamptz)
        AND ($4::department_code IS NULL OR ws.department = $4::department_code)
      GROUP BY ws.department
      ORDER BY ws.department ASC
    `,
    [auth.tenantId, reportStart, reportEndExclusive, filters.department ?? null]
  );

  const setupLagReport = await client.query(
    `
      SELECT
        s.id,
        EXTRACT(
          EPOCH FROM (
            MAX(CASE WHEN se.type = 'SHOOTING_STARTED' THEN se.captured_at END) -
            MAX(CASE WHEN se.type = 'SETUP_COMPLETE' THEN se.captured_at END)
          )
        ) / 60.0 AS lag_minutes
      FROM shoot s
      LEFT JOIN status_event se ON se.shoot_id = s.id
      WHERE s.tenant_id = $1
        AND s.deleted_at IS NULL
        AND ($2::date IS NULL OR s.shoot_date >= $2::date)
        AND ($3::date IS NULL OR s.shoot_date <= $3::date)
        AND ($4::department_code IS NULL OR s.department = $4::department_code)
        AND ($5::uuid IS NULL OR s.id = $5::uuid)
      GROUP BY s.id
    `,
    [
      auth.tenantId,
      filters.dateFrom ?? filters.date ?? null,
      filters.dateTo ?? filters.date ?? null,
      filters.department ?? null,
      filters.shootId ?? null
    ]
  );

  // G2 Slice D: per-shift delta between legacy (time_entry-derived) and canonical
  // (payroll-summary) hours, plus a payload-level reconciliation block. Additive only —
  // legacy actual_hours is untouched; canonical NULL means honestly unavailable (no linked
  // session/summary), never a fabricated zero.
  const rows = shifts.rows.map((row) => {
    const canonical = row.actual_hours_canonical == null ? null : Number(row.actual_hours_canonical);
    return {
      ...row,
      actual_hours_canonical: canonical,
      hours_source_delta:
        canonical == null ? null : Number((Number(row.actual_hours ?? 0) - canonical).toFixed(2))
    };
  });
  const comparableRows = rows.filter((row) => row.actual_hours_canonical != null);
  const hoursReconciliation = {
    legacy_hours_total: Number(rows.reduce((sum, row) => sum + Number(row.actual_hours ?? 0), 0).toFixed(2)),
    canonical_hours_total: Number(
      comparableRows.reduce((sum, row) => sum + Number(row.actual_hours_canonical ?? 0), 0).toFixed(2)
    ),
    comparable_shift_count: comparableRows.length,
    mismatch_shift_count: comparableRows.filter((row) => Math.abs(Number(row.hours_source_delta ?? 0)) > 0.01).length,
    canonical_unavailable_shift_count: rows.length - comparableRows.length,
    status:
      comparableRows.length === 0
        ? ("canonical_unavailable" as const)
        : comparableRows.some((row) => Math.abs(Number(row.hours_source_delta ?? 0)) > 0.01)
          ? ("mismatch" as const)
          : ("matched" as const),
    source: {
      legacy: "time_entry (shift_punch fallback)",
      canonical: "time_session_payroll_summary.payable_minutes"
    }
  };
  // G2 read-cutover (config OPS_DASHBOARD_HOURS_SOURCE): under canonical_preferred
  // the DISPLAYED actual_hours become canonical wherever a time session covers the
  // shift, with per-shift legacy fallback and provenance in hours_source. Group
  // totals stay exact: canonical sum + legacy hours of the uncovered shifts. The
  // reconciliation block above is always computed from the raw truths first.
  const canonicalPreferred = config.OPS_DASHBOARD_HOURS_SOURCE === "canonical_preferred";
  const displayRows = rows.map((row) => ({
    ...row,
    actual_hours:
      canonicalPreferred && row.actual_hours_canonical != null ? row.actual_hours_canonical : row.actual_hours,
    hours_source:
      canonicalPreferred && row.actual_hours_canonical != null ? ("canonical" as const) : ("legacy" as const)
  }));
  const resolveGroupActualHours = (row: {
    actual_hours?: unknown;
    actual_hours_canonical?: unknown;
    actual_hours_legacy_uncovered?: unknown;
  }) =>
    canonicalPreferred && row.actual_hours_canonical != null
      ? Number(row.actual_hours_canonical) + Number(row.actual_hours_legacy_uncovered ?? 0)
      : Number(row.actual_hours ?? 0);
  const laborRows = laborReport.rows.map((row) => ({
    ...row,
    actual_hours: resolveGroupActualHours(row)
  }));
  const shootMetrics = byShoot.rows.map((row) => ({
    ...row,
    actual_hours: resolveGroupActualHours(row),
    rigorous_shoot_score:
      Number(row.projected_students ?? 0) === 0
        ? 0
        : Number((Number(row.projected_students) / Math.max(Number(row.scheduled_hours ?? 0), 1)).toFixed(2))
  }));
  const fillRates = shootMetrics
    .filter((row) => Number(row.planned_staff_count ?? 0) > 0)
    .map((row) => (Number(row.scheduled_employees ?? 0) / Math.max(Number(row.planned_staff_count ?? 0), 1)) * 100);
  const overtimeThresholdHours = filters.date && !filters.dateFrom && !filters.dateTo ? 8 : 40;
  const employeeReliability = laborReport.rows.map((row) => {
    const exceptionRows = exceptionReport.rows.filter((exception) => String(exception.user_id ?? "") === String(row.assigned_user_id));
    const lateCount = exceptionRows.filter((exception) => String(exception.exception_type).includes("LATE")).length;
    const missedPunchCount = exceptionRows.filter((exception) =>
      ["MISSED_CLOCK_IN", "FORGOT_TO_CLOCK_IN", "FORGOT_TO_CLOCK_OUT", "AUTO_CLOSED_SHIFT"].includes(String(exception.exception_type))
    ).length;
    const noShowCount = exceptionRows.filter((exception) => String(exception.exception_type) === "NO_SHOW_SUSPECTED").length;
    const reliabilityScore = Math.max(0, 100 - lateCount * 10 - missedPunchCount * 15 - noShowCount * 25);
    return {
      assigned_user_id: row.assigned_user_id,
      assigned_user_name: row.assigned_user_name,
      department: row.department,
      late_count: lateCount,
      missed_punch_count: missedPunchCount,
      no_show_count: noShowCount,
      open_exception_count: Number(row.open_exception_count ?? 0),
      reliability_score: reliabilityScore
    };
  });
  const exceptionTrend = (() => {
    const buckets = new Map<string, { bucket_label: string; late_count: number; missed_punch_count: number; no_show_count: number; outside_geofence_count: number }>();
    for (const exception of exceptionReport.rows) {
      const bucket = String(exception.created_at).slice(0, 10);
      const current =
        buckets.get(bucket) ??
        { bucket_label: bucket, late_count: 0, missed_punch_count: 0, no_show_count: 0, outside_geofence_count: 0 };
      if (String(exception.exception_type).includes("LATE")) {
        current.late_count += 1;
      }
      if (["MISSED_CLOCK_IN", "FORGOT_TO_CLOCK_IN", "FORGOT_TO_CLOCK_OUT", "AUTO_CLOSED_SHIFT"].includes(String(exception.exception_type))) {
        current.missed_punch_count += 1;
      }
      if (String(exception.exception_type) === "NO_SHOW_SUSPECTED") {
        current.no_show_count += 1;
      }
      if (String(exception.exception_type) === "OUTSIDE_GEOFENCE_PUNCH") {
        current.outside_geofence_count += 1;
      }
      buckets.set(bucket, current);
    }
    return [...buckets.values()].sort((left, right) => left.bucket_label.localeCompare(right.bucket_label));
  })();
  const hoursByDepartment = (() => {
    const totals = new Map<
      string,
      {
        department: string;
        scheduled_hours: number;
        actual_hours: number;
        actual_hours_canonical: number | null;
        shift_count: number;
        canonical_covered_shift_count: number;
        employee_count: number;
      }
    >();
    for (const row of laborRows) {
      const department = String(row.department ?? "unassigned");
      const current =
        totals.get(department) ??
        {
          department,
          scheduled_hours: 0,
          actual_hours: 0,
          actual_hours_canonical: null,
          shift_count: 0,
          canonical_covered_shift_count: 0,
          employee_count: 0
        };
      current.scheduled_hours += Number(row.scheduled_hours ?? 0);
      current.actual_hours += Number(row.actual_hours ?? 0);
      if (row.actual_hours_canonical != null) {
        current.actual_hours_canonical = (current.actual_hours_canonical ?? 0) + Number(row.actual_hours_canonical);
      }
      current.shift_count += Number(row.shift_count ?? 0);
      current.canonical_covered_shift_count += Number(row.canonical_covered_shift_count ?? 0);
      current.employee_count += 1;
      totals.set(department, current);
    }
    return [...totals.values()].sort((left, right) => right.scheduled_hours - left.scheduled_hours);
  })();
  const averageSetupToLiveLagMinutes = (() => {
    const values = setupLagReport.rows
      .map((row) => Number(row.lag_minutes ?? 0))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!values.length) {
      return 0;
    }
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
  })();
  const summary = {
    all_shoots_today: new Set(rows.map((row) => row.shoot_id).filter(Boolean)).size,
    scheduled_employees: new Set(rows.map((row) => row.assigned_user_id)).size,
    clocked_in_employees: new Set(rows.filter((row) => Number(row.punch_in_count) > 0).map((row) => row.assigned_user_id)).size,
    late_employees: rows.filter((row) => Number(row.open_exception_count) > 0).length,
    no_shows: exceptions.rows.filter((row) => row.classification === "no_show").reduce((sum, row) => sum + Number(row.total), 0),
    late_warning_count: exceptions.rows
      .filter((row) => row.exception_type === "LATE_CLOCK_IN_WARNING")
      .reduce((sum, row) => sum + Number(row.total), 0),
    early_clock_in_exception_count: exceptions.rows
      .filter((row) => ["EARLY_CLOCK_IN_APPROVAL", "EARLY_CLOCK_IN_EXCEPTION"].includes(row.exception_type))
      .reduce((sum, row) => sum + Number(row.total), 0),
    missed_punch_count: exceptions.rows
      .filter((row) => ["MISSED_CLOCK_IN", "FORGOT_TO_CLOCK_IN", "FORGOT_TO_CLOCK_OUT", "AUTO_CLOSED_SHIFT"].includes(row.exception_type))
      .reduce((sum, row) => sum + Number(row.total), 0),
    missed_clock_out_count: exceptions.rows
      .filter((row) => ["FORGOT_TO_CLOCK_OUT", "AUTO_CLOSED_SHIFT"].includes(row.exception_type))
      .reduce((sum, row) => sum + Number(row.total), 0),
    no_show_suspected_count: exceptions.rows
      .filter((row) => row.exception_type === "NO_SHOW_SUSPECTED")
      .reduce((sum, row) => sum + Number(row.total), 0),
    break_override_count: payrollReport.rows.filter((row) => Boolean(row.break_deduction_overridden)).length,
    excused_exceptions: exceptions.rows
      .filter((row) => row.classification === "excused late" || row.classification === "manager-approved exception")
      .reduce((sum, row) => sum + Number(row.total), 0),
    unscheduled_punches: exceptions.rows.filter((row) => row.exception_type === "UNSCHEDULED_PUNCH").reduce((sum, row) => sum + Number(row.total), 0),
    out_of_bounds_punches: exceptions.rows.filter((row) => row.exception_type === "OUTSIDE_GEOFENCE_PUNCH").reduce((sum, row) => sum + Number(row.total), 0),
    studio_staff_on_shift: rows.filter((row) => row.shift_kind === "studio").length,
    scheduled_labor_hours: Number(displayRows.reduce((sum, row) => sum + Number(row.scheduled_hours ?? 0), 0).toFixed(2)),
    actual_labor_hours: Number(displayRows.reduce((sum, row) => sum + Number(row.actual_hours ?? 0), 0).toFixed(2)),
    payable_labor_hours: Number((payrollReport.rows.reduce((sum, row) => sum + Number(row.approved_payable_minutes ?? row.payable_minutes ?? 0), 0) / 60).toFixed(2)),
    break_deduction_hours: Number((payrollReport.rows.reduce((sum, row) => sum + Number(row.break_deduction_minutes ?? 0), 0) / 60).toFixed(2)),
    fill_rate_percent: fillRates.length ? Number((fillRates.reduce((sum, value) => sum + value, 0) / fillRates.length).toFixed(1)) : 0,
    overtime_risk_count: laborReport.rows.filter((row) => Number(row.scheduled_hours ?? 0) >= overtimeThresholdHours).length,
    under_staffed_shoot_count: shootMetrics.filter((row) => Number(row.planned_staff_count ?? 0) > Number(row.scheduled_employees ?? 0)).length,
    trade_request_count: tradeReport.rows.reduce((sum, row) => sum + Number(row.total_requests ?? 0), 0),
    average_setup_to_live_lag_minutes: averageSetupToLiveLagMinutes
  };

  return {
    summary: sanitizeDashboardSummary(summary, { includeLabor, includeAttendanceExceptions }),
    // Labor-gated like every other hours field: non-labor viewers get no reconciliation data.
    hours_reconciliation: includeLabor ? hoursReconciliation : null,
    shoots: sanitizeShootMetrics(shootMetrics, includeLabor),
    shifts: sanitizeShiftRows(displayRows, { includeLabor, includeAttendanceExceptions }),
    reporting: {
      labor: includeLabor
        ? laborRows.map((row) => ({
            ...row,
            labor_delta_hours: Number(Number(row.actual_hours ?? 0) - Number(row.scheduled_hours ?? 0)).toFixed(2),
            labor_delta_hours_canonical:
              row.actual_hours_canonical != null
                ? Number(Number(row.actual_hours_canonical) - Number(row.scheduled_hours ?? 0)).toFixed(2)
                : null
          }))
        : [],
      punches: punchReport.rows,
      exceptions: includeAttendanceExceptions ? exceptionReport.rows : [],
      payroll: includeLabor ? payrollReport.rows : []
    },
    insights: {
      hours_by_department: includeLabor ? hoursByDepartment : [],
      hours_by_shoot: includeLabor
        ? shootMetrics.map((row) => ({
            scope_id: row.scope_id,
            scope_code: row.scope_code,
            scope_title: row.scope_title,
            department: row.department,
            scheduled_hours: row.scheduled_hours,
            actual_hours: row.actual_hours,
            actual_hours_canonical: row.actual_hours_canonical ?? null,
            canonical_covered_shift_count: Number(row.canonical_covered_shift_count ?? 0),
            planned_staff_count: row.planned_staff_count,
            scheduled_employees: row.scheduled_employees,
            fill_rate_percent:
              Number(row.planned_staff_count ?? 0) > 0
                ? Number(((Number(row.scheduled_employees ?? 0) / Math.max(Number(row.planned_staff_count ?? 0), 1)) * 100).toFixed(1))
                : 100,
            rigorous_shoot_score: row.rigorous_shoot_score
          }))
        : [],
      attendance_reliability_by_employee: includeAttendanceExceptions ? employeeReliability : [],
      labor_exceptions_trend: includeAttendanceExceptions ? exceptionTrend : [],
      shift_trade_frequency: tradeReport.rows,
      staffing_efficiency_by_shoot_type: includeLabor
        ? hoursByDepartment.map((row) => ({
            department: row.department,
            scheduled_hours: Number(row.scheduled_hours.toFixed(2)),
            actual_hours: Number(row.actual_hours.toFixed(2)),
            fill_rate_percent: (() => {
              const relatedShoots = shootMetrics.filter((shoot) => String(shoot.department) === row.department && Number(shoot.planned_staff_count ?? 0) > 0);
              if (!relatedShoots.length) {
                return 100;
              }
              return Number(
                (
                  relatedShoots.reduce(
                    (sum, shoot) => sum + (Number(shoot.scheduled_employees ?? 0) / Math.max(Number(shoot.planned_staff_count ?? 0), 1)) * 100,
                    0
                  ) / relatedShoots.length
                ).toFixed(1)
              );
            })()
          }))
        : [],
      fill_rate_percent: summary.fill_rate_percent,
      average_setup_to_live_lag_minutes: averageSetupToLiveLagMinutes
    }
  };
}

export async function exportLaborCsv(client: PoolClient, auth: AuthUser, filters: DashboardFilters, kind: DashboardExportKind = "labor") {
  if ((kind === "labor" || kind === "payroll") && !canViewLaborCost(auth)) {
    throw new ApiError(403, "Forbidden");
  }
  if (kind === "exceptions" && !canViewAttendanceExceptions(auth)) {
    throw new ApiError(403, "Forbidden");
  }

  const dashboard = await getOperationsDashboard(client, auth, filters);
  let lines: string[] = [];

  if (kind === "punches") {
    lines = ["employee,manager,department,shift_title,shoot_code,direction,client_timestamp,geofence_status,gps_confidence,approval_state,reason_code"];
    for (const row of dashboard.reporting.punches) {
      lines.push(
        [
          row.assigned_user_name,
          row.manager_name ?? "",
          row.department ?? "",
          row.shift_title ?? "",
          row.shoot_code ?? "",
          row.direction,
          row.client_timestamp,
          row.geofence_status,
          row.gps_confidence,
          row.approval_state,
          row.reason_code ?? ""
        ]
          .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
          .join(",")
      );
    }
    return lines.join("\n");
  }

  if (kind === "exceptions") {
    lines = ["employee,manager,department,shift_title,shoot_code,exception_type,status,severity,classification,reason_code,requested_approver,approved_by,created_at"];
    for (const row of dashboard.reporting.exceptions) {
      lines.push(
        [
          row.user_name ?? "",
          row.manager_name ?? "",
          row.department ?? "",
          row.shift_title ?? "",
          row.shoot_code ?? "",
          row.exception_type,
          row.status,
          row.severity,
          row.classification ?? "",
          row.reason_code ?? "",
          row.requested_approver_name ?? "",
          row.approved_by_name ?? "",
          row.created_at
        ]
          .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
          .join(",")
      );
    }
    return lines.join("\n");
  }

  if (kind === "payroll") {
    lines = [
      "employee,manager,department,shift_title,shoot_code,clock_in_at,clock_out_at,scheduled_minutes,gross_minutes,break_deduction_minutes,payable_minutes,approved_payable_minutes,payroll_state,attendance_state,break_overridden"
    ];
    for (const row of dashboard.reporting.payroll) {
      lines.push(
        [
          row.assigned_user_name ?? "",
          row.manager_name ?? "",
          row.department ?? "",
          row.shift_title ?? "",
          row.shoot_code ?? "",
          row.clock_in_at ?? "",
          row.clock_out_at ?? "",
          row.scheduled_minutes ?? "",
          row.gross_minutes ?? "",
          row.break_deduction_minutes ?? "",
          row.payable_minutes ?? "",
          row.approved_payable_minutes ?? "",
          row.payroll_state ?? "",
          row.attendance_state ?? "",
          row.break_deduction_overridden ? "yes" : "no"
        ]
          .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
          .join(",")
      );
    }
    return lines.join("\n");
  }

  lines = ["employee,department,manager,shift_count,clocked_in_shift_count,scheduled_hours,actual_hours,labor_delta_hours,open_exceptions"];
  for (const row of dashboard.reporting.labor) {
    lines.push(
      [
        row.assigned_user_name,
        row.department,
        row.manager_name ?? "",
        Number(row.shift_count ?? 0),
        Number(row.clocked_in_shift_count ?? 0),
        Number(row.scheduled_hours ?? 0).toFixed(2),
        Number(row.actual_hours ?? 0).toFixed(2),
        Number(row.labor_delta_hours ?? 0).toFixed(2),
        Number(row.open_exception_count ?? 0)
      ]
        .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
        .join(",")
    );
  }
  return lines.join("\n");
}
