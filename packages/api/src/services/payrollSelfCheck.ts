// Labor Command Center — employee payroll self-check.
// Three days before payroll lock the window opens: every employee with time in the
// period reviews each day (punches, totals, job/location, break status, manager
// edits) and either confirms or reports a discrepancy. Discrepancy responses never
// edit time — each one creates a canonical exception_request so corrections flow
// through the existing review + approval + audit path.
import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { canReviewTeamTime } from "../authz/authority.js";
import { createTimeClockExceptionRequest } from "./timeClockRuntime.js";
import {
  findPayrollPeriodForDate,
  findPayrollPeriodById,
  logPayrollPeriodEvent,
  type PayrollPeriodRow
} from "./payrollPeriods.js";

export type SelfCheckResponseKind =
  | "looks_correct"
  | "something_wrong"
  | "missing_punch"
  | "no_break_taken"
  | "wrong_job_location"
  | "worked_extra_time";

export type SelfCheckStatus = "pending" | "confirmed" | "discrepancy_reported";

export type SelfCheckDay = {
  work_date: string;
  session_id: string | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  total_worked_minutes: number;
  payable_minutes: number;
  lunch_deduction_minutes: number;
  lunch_deduction_source: string | null;
  shift_title: string | null;
  shoot_title: string | null;
  location_name: string | null;
  manager_edit_count: number;
  open_exception_count: number;
  geofence_exception: boolean;
  responses: Array<{
    id: string;
    response: SelfCheckResponseKind;
    note: string | null;
    resolution_status: "open" | "resolved" | "dismissed";
    linked_exception_request_id: string | null;
    created_at: string;
  }>;
};

export type MySelfCheckPayload = {
  window_state: "not_open" | "open" | "closed";
  period: Pick<PayrollPeriodRow, "id" | "period_start" | "period_end" | "status" | "lock_scheduled_at"> | null;
  self_check: {
    id: string;
    status: SelfCheckStatus;
    confirmed_at: string | null;
  } | null;
  days: SelfCheckDay[];
  open_discrepancy_count: number;
};

export type SelfCheckManagerBoardRow = {
  employee_id: string;
  employee_name: string | null;
  department: string | null;
  self_check_status: SelfCheckStatus | "not_started";
  confirmed_at: string | null;
  open_discrepancy_count: number;
  missing_punch_claims: number;
  no_break_claims: number;
  open_exception_requests: number;
  unresolved_geofence_punches: number;
  total_worked_minutes: number;
  payable_minutes: number;
  // Minutes per pay code (explicit codes plus work-state-derived defaults).
  pay_code_minutes: Record<string, number>;
  // Part-time staff office/drive minutes: pre-shoot drive time is not payable for
  // part-time employees without an override, so these hours are held up for review.
  travel_review_minutes: number;
  is_part_time: boolean;
  edited_after_review: boolean;
  payroll_ready: boolean;
};

export type SelfCheckOpenItem = {
  item_id: string;
  employee_id: string;
  employee_name: string | null;
  work_date: string;
  response: SelfCheckResponseKind;
  note: string | null;
  manager_approved_claimed: boolean;
  linked_exception_request_id: string | null;
  created_at: string;
};

export type SelfCheckManagerBoard = {
  period: Pick<PayrollPeriodRow, "id" | "period_start" | "period_end" | "status" | "lock_scheduled_at">;
  open_items: SelfCheckOpenItem[];
  summary: {
    employee_count: number;
    confirmed_count: number;
    pending_count: number;
    discrepancy_count: number;
    open_discrepancy_items: number;
    no_break_claims: number;
    missing_punch_claims: number;
    unresolved_geofence_punches: number;
    payroll_ready_count: number;
    travel_review_minutes: number;
  };
  rows: SelfCheckManagerBoardRow[];
};

const DISCREPANCY_EXCEPTION_TYPE: Record<Exclude<SelfCheckResponseKind, "looks_correct">, "missing_clock_in" | "missing_clock_out" | "time_segment_correction" | "lunch_deduction_challenge" | "other"> = {
  something_wrong: "other",
  missing_punch: "missing_clock_out",
  no_break_taken: "lunch_deduction_challenge",
  wrong_job_location: "time_segment_correction",
  worked_extra_time: "time_segment_correction"
};

function periodPreview(period: PayrollPeriodRow) {
  return {
    id: period.id,
    period_start: period.period_start,
    period_end: period.period_end,
    status: period.status,
    lock_scheduled_at: period.lock_scheduled_at
  };
}

function isWindowOpen(period: PayrollPeriodRow) {
  return period.status === "self_check_open" || period.status === "manager_review";
}

// Open the self-check window: transition the period and seed one pending attestation
// row per employee with recorded time. Idempotent — safe for worker retries.
export async function openSelfCheckForPeriod(
  client: PoolClient,
  tenantId: string,
  periodId: string,
  actorUserId: string | null
) {
  const period = await findPayrollPeriodById(client, tenantId, periodId);
  if (!period) {
    throw new ApiError(404, "Payroll period not found.");
  }
  if (period.status !== "open" && period.status !== "self_check_open") {
    throw new ApiError(409, `Self-check can only open from an open period (current: ${period.status}).`);
  }

  if (period.status === "open") {
    await client.query(
      `UPDATE payroll_period SET status = 'self_check_open', self_check_opened_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, periodId]
    );
    await logPayrollPeriodEvent(client, {
      tenantId,
      periodId,
      eventType: "transition",
      fromStatus: "open",
      toStatus: "self_check_open",
      reason: "self_check_window_opened",
      actorUserId
    });
  }

  const { rowCount } = await client.query(
    `
      INSERT INTO payroll_self_check (tenant_id, payroll_period_id, employee_id)
      SELECT DISTINCT ts.tenant_id, $2::uuid, ts.employee_id
      FROM time_session ts
      WHERE ts.tenant_id = $1
        AND ts.work_date >= $3::date
        AND ts.work_date <= $4::date
      ON CONFLICT (tenant_id, payroll_period_id, employee_id) DO NOTHING
    `,
    [tenantId, periodId, period.period_start, period.period_end]
  );

  return { period_id: periodId, seeded_employee_count: rowCount ?? 0 };
}

async function loadSelfCheckDays(
  client: PoolClient,
  tenantId: string,
  employeeId: string,
  period: PayrollPeriodRow,
  selfCheckId: string | null
): Promise<SelfCheckDay[]> {
  const { rows: dayRows } = await client.query<{
    work_date: string;
    session_id: string;
    clock_in_at: string | null;
    clock_out_at: string | null;
    total_worked_minutes: number;
    payable_minutes: number;
    lunch_deduction_minutes: number;
    lunch_deduction_source: string | null;
    shift_title: string | null;
    shoot_title: string | null;
    location_name: string | null;
    manager_edit_count: number;
    open_exception_count: number;
    geofence_exception: boolean;
  }>(
    `
      SELECT
        ts.work_date::text,
        ts.id AS session_id,
        MIN(seg.start_time)::text AS clock_in_at,
        CASE WHEN BOOL_OR(seg.end_time IS NULL) THEN NULL ELSE MAX(seg.end_time)::text END AS clock_out_at,
        COALESCE(ps.total_worked_minutes, COALESCE(SUM(seg.duration_minutes), 0))::int AS total_worked_minutes,
        COALESCE(ps.payable_minutes, COALESCE(SUM(seg.duration_minutes), 0))::int AS payable_minutes,
        COALESCE(ps.lunch_deduction_minutes, 0)::int AS lunch_deduction_minutes,
        ps.lunch_deduction_source::text AS lunch_deduction_source,
        MAX(ws.title) AS shift_title,
        MAX(sh.title) AS shoot_title,
        MAX(COALESCE(loc.name, ws.location_name, sh.location_name)) AS location_name,
        COUNT(*) FILTER (WHERE seg.source_type IN ('manual_correction', 'admin_override'))::int AS manager_edit_count,
        (
          SELECT COUNT(*)::int FROM exception_request er
          WHERE er.tenant_id = ts.tenant_id
            AND er.linked_session_id = ts.id
            AND er.status IN ('submitted', 'under_review')
        ) AS open_exception_count,
        EXISTS (
          SELECT 1 FROM shift_punch sp
          WHERE sp.tenant_id = ts.tenant_id
            AND sp.user_id = ts.employee_id
            AND sp.received_at::date = ts.work_date
            AND sp.geofence_status IN ('outside', 'unknown')
        ) AS geofence_exception
      FROM time_session ts
      LEFT JOIN time_segment seg ON seg.session_id = ts.id
      LEFT JOIN time_session_payroll_summary ps ON ps.session_id = ts.id
      LEFT JOIN work_shift ws ON ws.id = ts.source_shift_id
      LEFT JOIN shoot sh ON sh.id = ws.shoot_id
      LEFT JOIN shoot_location loc ON loc.id = (
        SELECT seg2.linked_location_id FROM time_segment seg2
        WHERE seg2.session_id = ts.id AND seg2.linked_location_id IS NOT NULL
        ORDER BY seg2.start_time DESC LIMIT 1
      )
      WHERE ts.tenant_id = $1
        AND ts.employee_id = $2
        AND ts.work_date >= $3::date
        AND ts.work_date <= $4::date
      GROUP BY ts.id, ts.work_date, ps.total_worked_minutes, ps.payable_minutes, ps.lunch_deduction_minutes, ps.lunch_deduction_source
      ORDER BY ts.work_date ASC
    `,
    [tenantId, employeeId, period.period_start, period.period_end]
  );

  const responsesBySessionDate = new Map<string, SelfCheckDay["responses"]>();
  if (selfCheckId) {
    const { rows: responseRows } = await client.query<{
      id: string;
      work_date: string;
      response: SelfCheckResponseKind;
      note: string | null;
      resolution_status: "open" | "resolved" | "dismissed";
      linked_exception_request_id: string | null;
      created_at: string;
    }>(
      `
        SELECT id, work_date::text, response, note, resolution_status, linked_exception_request_id, created_at::text
        FROM payroll_self_check_item
        WHERE tenant_id = $1 AND self_check_id = $2
        ORDER BY created_at ASC
      `,
      [tenantId, selfCheckId]
    );
    for (const row of responseRows) {
      const list = responsesBySessionDate.get(row.work_date) ?? [];
      list.push({
        id: row.id,
        response: row.response,
        note: row.note,
        resolution_status: row.resolution_status,
        linked_exception_request_id: row.linked_exception_request_id,
        created_at: row.created_at
      });
      responsesBySessionDate.set(row.work_date, list);
    }
  }

  return dayRows.map((row) => ({
    ...row,
    responses: responsesBySessionDate.get(row.work_date) ?? []
  }));
}

export async function getMySelfCheck(client: PoolClient, auth: AuthUser, anchorDate?: string): Promise<MySelfCheckPayload> {
  // Read-only: the current period is created by the labor sweep (worker) or a
  // payroll admin action — never as a side effect of an employee GET.
  const period = await findPayrollPeriodForDate(client, auth.tenantId, anchorDate ?? new Date().toISOString().slice(0, 10));
  if (!period) {
    return {
      window_state: "not_open",
      period: null,
      self_check: null,
      days: [],
      open_discrepancy_count: 0
    };
  }

  const { rows: selfCheckRows } = await client.query<{
    id: string;
    status: SelfCheckStatus;
    confirmed_at: string | null;
  }>(
    `SELECT id, status, confirmed_at::text FROM payroll_self_check WHERE tenant_id = $1 AND payroll_period_id = $2 AND employee_id = $3 LIMIT 1`,
    [auth.tenantId, period.id, auth.id]
  );
  const selfCheck = selfCheckRows[0] ?? null;

  const days = await loadSelfCheckDays(client, auth.tenantId, auth.id, period, selfCheck?.id ?? null);
  const openDiscrepancies = days.reduce(
    (sum, day) =>
      sum + day.responses.filter((response) => response.response !== "looks_correct" && response.resolution_status === "open").length,
    0
  );

  return {
    window_state: isWindowOpen(period) ? "open" : period.status === "open" ? "not_open" : "closed",
    period: periodPreview(period),
    self_check: selfCheck,
    days,
    open_discrepancy_count: openDiscrepancies
  };
}

export async function submitSelfCheckResponse(
  client: PoolClient,
  auth: AuthUser,
  input: {
    period_id: string;
    work_date: string;
    response: SelfCheckResponseKind;
    note?: string | null;
    // For no-break claims: the employee says a manager approved working through
    // the break. Recorded verbatim and routed to the manager for confirmation.
    manager_approved_claimed?: boolean;
  }
) {
  const period = await findPayrollPeriodById(client, auth.tenantId, input.period_id);
  if (!period) {
    throw new ApiError(404, "Payroll period not found.");
  }
  if (!isWindowOpen(period)) {
    throw new ApiError(409, "The payroll self-check window is not open for this period.");
  }
  if (input.work_date < period.period_start || input.work_date > period.period_end) {
    throw new ApiError(400, "The reviewed day is outside this payroll period.");
  }
  // No-break claims are one-tap by design (the "Add note" button is optional);
  // every other problem type needs a short note to be reviewable.
  if (input.response !== "looks_correct" && input.response !== "no_break_taken" && !input.note?.trim()) {
    throw new ApiError(400, "Reporting a problem requires a short note so it can be reviewed.");
  }

  const { rows: selfCheckRows } = await client.query<{ id: string; status: SelfCheckStatus }>(
    `
      INSERT INTO payroll_self_check (tenant_id, payroll_period_id, employee_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (tenant_id, payroll_period_id, employee_id)
      DO UPDATE SET updated_at = now()
      RETURNING id, status
    `,
    [auth.tenantId, input.period_id, auth.id]
  );
  const selfCheck = selfCheckRows[0];

  const { rows: sessionRows } = await client.query<{ id: string; source_shift_id: string | null }>(
    `SELECT id, source_shift_id FROM time_session WHERE tenant_id = $1 AND employee_id = $2 AND work_date = $3::date ORDER BY created_at DESC LIMIT 1`,
    [auth.tenantId, auth.id, input.work_date]
  );
  const session = sessionRows[0] ?? null;

  // A discrepancy spawns a canonical exception request so it enters the existing
  // manager/payroll review path with full audit history.
  let linkedExceptionRequestId: string | null = null;
  if (input.response !== "looks_correct") {
    const requestType = input.response === "missing_punch" && !session ? "missing_clock_in" : DISCREPANCY_EXCEPTION_TYPE[input.response];
    const managerApprovedPrefix =
      input.response === "no_break_taken" && input.manager_approved_claimed ? "[employee says manager approved no break] " : "";
    linkedExceptionRequestId = await createTimeClockExceptionRequest(client, {
      tenantId: auth.tenantId,
      employeeId: auth.id,
      requestType,
      shiftId: session?.source_shift_id ?? null,
      sessionId: session?.id ?? null,
      reportingFlags: input.manager_approved_claimed
        ? ["payroll_self_check", "manager_approved_claimed"]
        : ["payroll_self_check"],
      note: `[Payroll self-check ${input.work_date}] ${managerApprovedPrefix}${input.note?.trim() ?? ""}`
    });
  }

  const { rows: itemRows } = await client.query<{ id: string }>(
    `
      INSERT INTO payroll_self_check_item (
        tenant_id, self_check_id, work_date, session_id, response, note, manager_approved_claimed,
        linked_exception_request_id, resolution_status
      ) VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, CASE WHEN $5 = 'looks_correct' THEN 'resolved' ELSE 'open' END)
      ON CONFLICT (tenant_id, self_check_id, work_date, response)
      DO UPDATE SET note = EXCLUDED.note, session_id = EXCLUDED.session_id, manager_approved_claimed = EXCLUDED.manager_approved_claimed
      RETURNING id
    `,
    [
      auth.tenantId,
      selfCheck.id,
      input.work_date,
      session?.id ?? null,
      input.response,
      input.note ?? null,
      input.manager_approved_claimed ?? false,
      linkedExceptionRequestId
    ]
  );

  if (input.response !== "looks_correct" && selfCheck.status !== "discrepancy_reported") {
    await client.query(
      `UPDATE payroll_self_check SET status = 'discrepancy_reported', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [auth.tenantId, selfCheck.id]
    );
  }

  return {
    item_id: itemRows[0].id,
    linked_exception_request_id: linkedExceptionRequestId,
    self_check_status: input.response !== "looks_correct" ? ("discrepancy_reported" as const) : selfCheck.status
  };
}

export async function confirmSelfCheck(client: PoolClient, auth: AuthUser, periodId: string) {
  const period = await findPayrollPeriodById(client, auth.tenantId, periodId);
  if (!period) {
    throw new ApiError(404, "Payroll period not found.");
  }
  if (!isWindowOpen(period)) {
    throw new ApiError(409, "The payroll self-check window is not open for this period.");
  }

  const { rows: openItems } = await client.query<{ count: number }>(
    `
      SELECT COUNT(*)::int AS count
      FROM payroll_self_check_item item
      JOIN payroll_self_check sc ON sc.id = item.self_check_id
      WHERE item.tenant_id = $1
        AND sc.payroll_period_id = $2
        AND sc.employee_id = $3
        AND item.resolution_status = 'open'
        AND item.response <> 'looks_correct'
    `,
    [auth.tenantId, periodId, auth.id]
  );
  if ((openItems[0]?.count ?? 0) > 0) {
    throw new ApiError(409, "You still have an unresolved problem report for this pay period. It must be resolved before you confirm.", {
      code: "self_check_open_discrepancies"
    });
  }

  const { rows } = await client.query<{ id: string; confirmed_at: string }>(
    `
      INSERT INTO payroll_self_check (tenant_id, payroll_period_id, employee_id, status, confirmed_at)
      VALUES ($1, $2, $3, 'confirmed', now())
      ON CONFLICT (tenant_id, payroll_period_id, employee_id)
      DO UPDATE SET status = 'confirmed', confirmed_at = now(), updated_at = now()
      RETURNING id, confirmed_at::text
    `,
    [auth.tenantId, periodId, auth.id]
  );
  return { self_check_id: rows[0].id, status: "confirmed" as const, confirmed_at: rows[0].confirmed_at };
}

export async function resolveSelfCheckItem(
  client: PoolClient,
  auth: AuthUser,
  input: { item_id: string; resolution: "resolved" | "dismissed"; resolution_note?: string | null }
) {
  if (!canReviewTeamTime(auth)) {
    throw new ApiError(403, "You do not have access to resolve payroll self-check reports.");
  }
  const { rows } = await client.query<{ id: string }>(
    `
      UPDATE payroll_self_check_item
      SET resolution_status = $3, resolved_by_user_id = $4, resolved_at = now(), resolution_note = $5
      WHERE tenant_id = $1 AND id = $2 AND resolution_status = 'open'
      RETURNING id
    `,
    [auth.tenantId, input.item_id, input.resolution, auth.id, input.resolution_note ?? null]
  );
  if (!rows[0]) {
    throw new ApiError(404, "Open self-check report not found.");
  }
  return { item_id: rows[0].id, resolution_status: input.resolution };
}

export async function getSelfCheckManagerBoard(
  client: PoolClient,
  auth: AuthUser,
  periodId: string
): Promise<SelfCheckManagerBoard> {
  if (!canReviewTeamTime(auth)) {
    throw new ApiError(403, "You do not have access to the payroll self-check board.");
  }
  const period = await findPayrollPeriodById(client, auth.tenantId, periodId);
  if (!period) {
    throw new ApiError(404, "Payroll period not found.");
  }

  const { rows } = await client.query<SelfCheckManagerBoardRow>(
    `
      SELECT
        emp.id AS employee_id,
        emp.full_name AS employee_name,
        emp.department::text AS department,
        COALESCE(sc.status, 'not_started') AS self_check_status,
        sc.confirmed_at::text,
        COALESCE(items.open_count, 0)::int AS open_discrepancy_count,
        COALESCE(items.missing_punch_count, 0)::int AS missing_punch_claims,
        COALESCE(items.no_break_count, 0)::int AS no_break_claims,
        COALESCE(er.open_count, 0)::int AS open_exception_requests,
        COALESCE(geo.pending_count, 0)::int AS unresolved_geofence_punches,
        COALESCE(mins.total_worked_minutes, 0)::int AS total_worked_minutes,
        COALESCE(mins.payable_minutes, 0)::int AS payable_minutes,
        COALESCE(paycodes.pay_code_minutes, '{}'::jsonb) AS pay_code_minutes,
        COALESCE(travel.travel_review_minutes, 0)::int AS travel_review_minutes,
        COALESCE(travel.is_part_time, false) AS is_part_time,
        COALESCE(mins.edited_after_review, false) AS edited_after_review,
        (
          COALESCE(sc.status, 'not_started') = 'confirmed'
          AND COALESCE(items.open_count, 0) = 0
          AND COALESCE(er.open_count, 0) = 0
          AND COALESCE(geo.pending_count, 0) = 0
        ) AS payroll_ready
      FROM (
        SELECT DISTINCT ts.employee_id
        FROM time_session ts
        WHERE ts.tenant_id = $1 AND ts.work_date BETWEEN $2::date AND $3::date
      ) active
      JOIN app_user emp ON emp.id = active.employee_id
      LEFT JOIN payroll_self_check sc
        ON sc.tenant_id = $1 AND sc.payroll_period_id = $4 AND sc.employee_id = emp.id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE item.resolution_status = 'open' AND item.response <> 'looks_correct') AS open_count,
          COUNT(*) FILTER (WHERE item.response = 'missing_punch') AS missing_punch_count,
          COUNT(*) FILTER (WHERE item.response = 'no_break_taken') AS no_break_count
        FROM payroll_self_check_item item
        WHERE item.tenant_id = $1 AND item.self_check_id = sc.id
      ) items ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS open_count
        FROM exception_request er2
        LEFT JOIN time_session ts2 ON ts2.id = er2.linked_session_id
        WHERE er2.tenant_id = $1
          AND er2.employee_id = emp.id
          AND er2.status IN ('submitted', 'under_review')
          AND COALESCE(ts2.work_date, er2.submitted_at::date) BETWEEN $2::date AND $3::date
      ) er ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS pending_count
        FROM shift_punch sp
        WHERE sp.tenant_id = $1
          AND sp.user_id = emp.id
          AND sp.received_at::date BETWEEN $2::date AND $3::date
          AND sp.geofence_status IN ('outside', 'unknown')
          AND sp.approval_state = 'pending'
      ) geo ON true
      LEFT JOIN LATERAL (
        SELECT
          SUM(COALESCE(ps.total_worked_minutes, 0)) AS total_worked_minutes,
          SUM(COALESCE(ps.payable_minutes, 0)) AS payable_minutes,
          BOOL_OR(ts3.edited_after_payroll_review) AS edited_after_review
        FROM time_session ts3
        LEFT JOIN time_session_payroll_summary ps ON ps.session_id = ts3.id
        WHERE ts3.tenant_id = $1 AND ts3.employee_id = emp.id AND ts3.work_date BETWEEN $2::date AND $3::date
      ) mins ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_object_agg(pay.code, pay.minutes) AS pay_code_minutes
        FROM (
          SELECT
            COALESCE(seg.pay_code, CASE seg.work_state::text WHEN 'photography' THEN 'session_labor' ELSE 'studio_admin' END) AS code,
            SUM(seg.duration_minutes)::int AS minutes
          FROM time_segment seg
          JOIN time_session ts4 ON ts4.id = seg.session_id
          WHERE seg.tenant_id = $1 AND ts4.employee_id = emp.id
            AND ts4.work_date BETWEEN $2::date AND $3::date AND seg.end_time IS NOT NULL
          GROUP BY 1
        ) pay
      ) paycodes ON true
      LEFT JOIN LATERAL (
        SELECT
          EXISTS (
            SELECT 1 FROM user_job_function_profile p
            WHERE p.tenant_id = $1 AND p.user_id = emp.id
              AND p.job_function_profile IN ('part_time_photographer', 'seasonal_photographer')
          ) AS is_part_time,
          (
            SELECT COALESCE(SUM(seg.duration_minutes), 0)::int
            FROM time_segment seg
            JOIN time_session ts5 ON ts5.id = seg.session_id
            WHERE seg.tenant_id = $1 AND ts5.employee_id = emp.id
              AND ts5.work_date BETWEEN $2::date AND $3::date
              AND seg.end_time IS NOT NULL
              AND seg.work_state::text = 'office_drive'
              AND EXISTS (
                SELECT 1 FROM user_job_function_profile p
                WHERE p.tenant_id = $1 AND p.user_id = emp.id
                  AND p.job_function_profile IN ('part_time_photographer', 'seasonal_photographer')
              )
          ) AS travel_review_minutes
      ) travel ON true
      ORDER BY payroll_ready ASC, open_discrepancy_count DESC, emp.full_name ASC
    `,
    [auth.tenantId, period.period_start, period.period_end, period.id]
  );

  const { rows: openItemRows } = await client.query<SelfCheckOpenItem>(
    `
      SELECT
        item.id AS item_id,
        sc.employee_id,
        emp.full_name AS employee_name,
        item.work_date::text,
        item.response,
        item.note,
        item.manager_approved_claimed,
        item.linked_exception_request_id,
        item.created_at::text
      FROM payroll_self_check_item item
      JOIN payroll_self_check sc ON sc.id = item.self_check_id
      LEFT JOIN app_user emp ON emp.id = sc.employee_id
      WHERE item.tenant_id = $1
        AND sc.payroll_period_id = $2
        AND item.resolution_status = 'open'
        AND item.response <> 'looks_correct'
      ORDER BY item.created_at ASC
    `,
    [auth.tenantId, period.id]
  );

  return {
    period: periodPreview(period),
    open_items: openItemRows,
    summary: {
      employee_count: rows.length,
      confirmed_count: rows.filter((row) => row.self_check_status === "confirmed").length,
      pending_count: rows.filter((row) => row.self_check_status === "pending" || row.self_check_status === "not_started").length,
      discrepancy_count: rows.filter((row) => row.self_check_status === "discrepancy_reported").length,
      open_discrepancy_items: rows.reduce((sum, row) => sum + row.open_discrepancy_count, 0),
      no_break_claims: rows.reduce((sum, row) => sum + row.no_break_claims, 0),
      missing_punch_claims: rows.reduce((sum, row) => sum + row.missing_punch_claims, 0),
      unresolved_geofence_punches: rows.reduce((sum, row) => sum + row.unresolved_geofence_punches, 0),
      payroll_ready_count: rows.filter((row) => row.payroll_ready).length,
      travel_review_minutes: rows.reduce((sum, row) => sum + row.travel_review_minutes, 0)
    },
    rows
  };
}
