// Labor Command Center — canonical payroll period lifecycle.
// A payroll_period gives the previously ad-hoc Monday–Sunday payroll window a durable
// identity, a reviewable lifecycle (open → self_check_open → manager_review →
// payroll_review → locked → exported → synced, with correction_needed as the honest
// escape hatch), and an append-only event log. Mission Control owns operational labor
// truth only; export hands locked totals to the payroll system of record.
import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { canFinalizePayroll, canManagePayrollPeriods } from "../authz/authority.js";

export type PayrollPeriodStatus =
  | "open"
  | "self_check_open"
  | "manager_review"
  | "payroll_review"
  | "owner_review"
  | "locked"
  | "exported"
  | "synced"
  | "correction_needed";

export type PayrollCalendarConfig = {
  period_length_days: number;
  reference_period_start: string;
  close_offset_hours: number;
  self_check_window_hours: number;
  travel_policy: Record<string, unknown>;
  is_default: boolean;
};

// Bi-weekly, paid every other Friday. The exact close rule is NOT yet verified with
// the owner — these defaults are configurable per tenant via payroll_calendar_config
// and flagged for business verification in the UI.
const DEFAULT_CALENDAR_CONFIG: PayrollCalendarConfig = {
  period_length_days: 14,
  reference_period_start: "2026-06-29",
  close_offset_hours: 60,
  self_check_window_hours: 24,
  travel_policy: {},
  is_default: true
};

export type PayrollPeriodReminderStage = "hours_72" | "hours_48" | "hours_24" | "morning_of";

export type PayrollPeriodRow = {
  id: string;
  period_start: string;
  period_end: string;
  status: PayrollPeriodStatus;
  lock_scheduled_at: string | null;
  self_check_opened_at: string | null;
  locked_at: string | null;
  locked_by_user_id: string | null;
  exported_at: string | null;
  exported_by_user_id: string | null;
  synced_at: string | null;
  correction_reason: string | null;
  last_reminder_stage: PayrollPeriodReminderStage | null;
  last_reminder_at: string | null;
  reminder_count: number;
  created_at: string;
  updated_at: string;
};

export type PayrollPeriodEventRow = {
  id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  actor_user_id: string | null;
  actor_name: string | null;
  created_at: string;
};

export type PayrollPeriodSummary = PayrollPeriodRow & {
  session_count: number;
  employee_count: number;
  self_check_total: number;
  self_check_confirmed: number;
  self_check_discrepancy: number;
  open_self_check_items: number;
  open_exception_requests: number;
  unresolved_geofence_punches: number;
  edited_after_review_count: number;
  export_batch_count: number;
};

const PERIOD_SELECT = `
  id,
  period_start::text,
  period_end::text,
  status,
  lock_scheduled_at::text,
  self_check_opened_at::text,
  locked_at::text,
  locked_by_user_id,
  exported_at::text,
  exported_by_user_id,
  synced_at::text,
  correction_reason,
  last_reminder_stage,
  last_reminder_at::text,
  reminder_count,
  created_at::text,
  updated_at::text
`;

// The full lifecycle. The owner (owner_admin/super_admin) must pass owner_review
// before anything can lock — payroll never reaches QuickBooks without Matthew's
// final approval. correction_needed is reachable from every post-review state so a
// real problem is never trapped behind a lock; leaving it re-enters payroll_review.
const ALLOWED_TRANSITIONS: Record<PayrollPeriodStatus, PayrollPeriodStatus[]> = {
  open: ["self_check_open", "manager_review"],
  self_check_open: ["manager_review", "open"],
  manager_review: ["payroll_review", "self_check_open"],
  payroll_review: ["owner_review", "manager_review", "correction_needed"],
  owner_review: ["locked", "payroll_review", "correction_needed"],
  locked: ["exported", "correction_needed"],
  exported: ["synced", "correction_needed"],
  synced: ["correction_needed"],
  correction_needed: ["payroll_review"]
};

// Transitions only the owner may perform (final approval + everything after it).
const OWNER_ONLY_TRANSITIONS = new Set<PayrollPeriodStatus>(["locked", "exported", "synced"]);

// Statuses where employee time has already been reviewed: edits past this point must
// be flagged, never silent.
const REVIEWED_STATUSES: PayrollPeriodStatus[] = ["payroll_review", "owner_review", "locked", "exported", "synced"];
// Statuses where direct time mutation is refused outright (corrections must reopen the
// period through correction_needed first).
const LOCKED_STATUSES: PayrollPeriodStatus[] = ["locked", "exported", "synced"];

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

export function getPayrollWeekBounds(anchorDate: string) {
  const anchor = parseDateOnly(anchorDate);
  const weekday = anchor.getDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = addDays(anchor, mondayOffset);
  return {
    start: formatDateOnly(monday),
    end: formatDateOnly(addDays(monday, 6))
  };
}

export async function getPayrollCalendarConfig(client: PoolClient, tenantId: string): Promise<PayrollCalendarConfig> {
  const { rows } = await client.query<{
    period_length_days: number;
    reference_period_start: string;
    close_offset_hours: number;
    self_check_window_hours: number;
    travel_policy: Record<string, unknown>;
  }>(
    `
      SELECT period_length_days, reference_period_start::text, close_offset_hours, self_check_window_hours, travel_policy
      FROM payroll_calendar_config
      WHERE tenant_id = $1
      LIMIT 1
    `,
    [tenantId]
  );
  if (!rows[0]) {
    return DEFAULT_CALENDAR_CONFIG;
  }
  return { ...rows[0], is_default: false };
}

export async function updatePayrollCalendarConfig(
  client: PoolClient,
  auth: AuthUser,
  input: {
    period_length_days?: number;
    reference_period_start?: string;
    close_offset_hours?: number;
    self_check_window_hours?: number;
    travel_policy?: Record<string, unknown>;
  }
) {
  if (!canManagePayrollPeriods(auth)) {
    throw new ApiError(403, "You do not have access to payroll calendar configuration.");
  }
  const current = await getPayrollCalendarConfig(client, auth.tenantId);
  const next = {
    period_length_days: input.period_length_days ?? current.period_length_days,
    reference_period_start: input.reference_period_start ?? current.reference_period_start,
    close_offset_hours: input.close_offset_hours ?? current.close_offset_hours,
    self_check_window_hours: input.self_check_window_hours ?? current.self_check_window_hours,
    travel_policy: input.travel_policy ?? current.travel_policy
  };
  await client.query(
    `
      INSERT INTO payroll_calendar_config (
        tenant_id, period_length_days, reference_period_start, close_offset_hours,
        self_check_window_hours, travel_policy, updated_by_user_id
      ) VALUES ($1, $2, $3::date, $4, $5, $6::jsonb, $7)
      ON CONFLICT (tenant_id) DO UPDATE SET
        period_length_days = EXCLUDED.period_length_days,
        reference_period_start = EXCLUDED.reference_period_start,
        close_offset_hours = EXCLUDED.close_offset_hours,
        self_check_window_hours = EXCLUDED.self_check_window_hours,
        travel_policy = EXCLUDED.travel_policy,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
    `,
    [
      auth.tenantId,
      next.period_length_days,
      next.reference_period_start,
      next.close_offset_hours,
      next.self_check_window_hours,
      JSON.stringify(next.travel_policy),
      auth.id
    ]
  );
  return { ...next, is_default: false };
}

// Bi-weekly (configurable) period containing a date, derived from the reference
// anchor by modular arithmetic. Works for dates before the reference too.
export function getPayrollPeriodBounds(config: PayrollCalendarConfig, anchorDate: string) {
  const anchor = parseDateOnly(anchorDate);
  const reference = parseDateOnly(config.reference_period_start);
  const daysSinceReference = Math.floor((anchor.getTime() - reference.getTime()) / 86_400_000);
  const periodIndex = Math.floor(daysSinceReference / config.period_length_days);
  const start = addDays(reference, periodIndex * config.period_length_days);
  const end = addDays(start, config.period_length_days - 1);
  return { start: formatDateOnly(start), end: formatDateOnly(end) };
}

// Payroll close = start of the day after the period ends + close_offset_hours.
export function getScheduledCloseForPeriod(config: PayrollCalendarConfig, periodEnd: string) {
  const dayAfterEnd = addDays(parseDateOnly(periodEnd), 1);
  const midnight = new Date(`${formatDateOnly(dayAfterEnd)}T00:00:00`);
  return new Date(midnight.getTime() + config.close_offset_hours * 3_600_000).toISOString();
}

export async function logPayrollPeriodEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    periodId: string;
    eventType: "created" | "transition" | "reminder" | "lock" | "unlock" | "export" | "sync" | "correction";
    fromStatus?: string | null;
    toStatus?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown>;
    actorUserId?: string | null;
  }
) {
  await client.query(
    `
      INSERT INTO payroll_period_event (
        tenant_id, period_id, event_type, from_status, to_status, reason, metadata, actor_user_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
    `,
    [
      input.tenantId,
      input.periodId,
      input.eventType,
      input.fromStatus ?? null,
      input.toStatus ?? null,
      input.reason ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.actorUserId ?? null
    ]
  );
}

async function attachSessionsToPeriod(
  client: PoolClient,
  tenantId: string,
  periodId: string,
  periodStart: string,
  periodEnd: string
) {
  await client.query(
    `
      UPDATE time_session
      SET payroll_period_id = $2, updated_at = now()
      WHERE tenant_id = $1
        AND payroll_period_id IS DISTINCT FROM $2
        AND work_date >= $3::date
        AND work_date <= $4::date
    `,
    [tenantId, periodId, periodStart, periodEnd]
  );
}

export async function findPayrollPeriodById(client: PoolClient, tenantId: string, periodId: string) {
  const { rows } = await client.query<PayrollPeriodRow>(
    `SELECT ${PERIOD_SELECT} FROM payroll_period WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, periodId]
  );
  return rows[0] ?? null;
}

export async function findPayrollPeriodForDate(client: PoolClient, tenantId: string, date: string) {
  const { rows } = await client.query<PayrollPeriodRow>(
    `
      SELECT ${PERIOD_SELECT}
      FROM payroll_period
      WHERE tenant_id = $1
        AND period_start <= $2::date
        AND period_end >= $2::date
      ORDER BY period_start DESC
      LIMIT 1
    `,
    [tenantId, date]
  );
  return rows[0] ?? null;
}

// Create-or-get the canonical period covering a date. System callers (worker, punch
// bridge) pass actorUserId null; the default window matches the existing Monday–Sunday
// payroll convention so canonical summaries and periods always agree.
export async function ensurePayrollPeriodForDate(
  client: PoolClient,
  tenantId: string,
  date: string,
  options: { actorUserId?: string | null; lockScheduledAt?: string | null } = {}
) {
  const existing = await findPayrollPeriodForDate(client, tenantId, date);
  if (existing) {
    return existing;
  }

  const config = await getPayrollCalendarConfig(client, tenantId);
  const bounds = getPayrollPeriodBounds(config, date);
  // The close moment is derived from the configurable calendar so the self-check
  // window and reminder ladder run without manual scheduling. Admins can override
  // per period via the schedule endpoint.
  const lockScheduledAt = options.lockScheduledAt ?? getScheduledCloseForPeriod(config, bounds.end);
  const { rows } = await client.query<PayrollPeriodRow>(
    `
      INSERT INTO payroll_period (tenant_id, period_start, period_end, lock_scheduled_at, created_by_user_id)
      VALUES ($1, $2::date, $3::date, $4, $5)
      ON CONFLICT (tenant_id, period_start, period_end)
      DO UPDATE SET updated_at = now()
      RETURNING ${PERIOD_SELECT}
    `,
    [tenantId, bounds.start, bounds.end, lockScheduledAt, options.actorUserId ?? null]
  );
  const period = rows[0];
  await logPayrollPeriodEvent(client, {
    tenantId,
    periodId: period.id,
    eventType: "created",
    toStatus: period.status,
    actorUserId: options.actorUserId ?? null,
    metadata: { period_start: period.period_start, period_end: period.period_end }
  });
  await attachSessionsToPeriod(client, tenantId, period.id, period.period_start, period.period_end);
  return period;
}

export async function updatePayrollPeriodSchedule(
  client: PoolClient,
  auth: AuthUser,
  periodId: string,
  input: { lockScheduledAt: string | null }
) {
  if (!canManagePayrollPeriods(auth)) {
    throw new ApiError(403, "You do not have access to manage payroll periods.");
  }
  const period = await findPayrollPeriodById(client, auth.tenantId, periodId);
  if (!period) {
    throw new ApiError(404, "Payroll period not found.");
  }
  if (LOCKED_STATUSES.includes(period.status)) {
    throw new ApiError(409, "This payroll period is locked; its schedule can no longer change.");
  }
  const { rows } = await client.query<PayrollPeriodRow>(
    `
      UPDATE payroll_period
      SET lock_scheduled_at = $3, updated_by_user_id = $4, updated_at = now()
      WHERE tenant_id = $1 AND id = $2
      RETURNING ${PERIOD_SELECT}
    `,
    [auth.tenantId, periodId, input.lockScheduledAt, auth.id]
  );
  await logPayrollPeriodEvent(client, {
    tenantId: auth.tenantId,
    periodId,
    eventType: "transition",
    fromStatus: period.status,
    toStatus: period.status,
    reason: "lock_schedule_updated",
    metadata: { lock_scheduled_at: input.lockScheduledAt },
    actorUserId: auth.id
  });
  return rows[0];
}

async function loadPeriodBlockerCounts(client: PoolClient, tenantId: string, period: PayrollPeriodRow) {
  const { rows } = await client.query<{
    open_exception_requests: number;
    unresolved_geofence_punches: number;
    open_self_check_items: number;
    self_check_pending: number;
  }>(
    `
      SELECT
        (
          SELECT COUNT(*)::int FROM exception_request er
          LEFT JOIN time_session ts ON ts.id = er.linked_session_id
          WHERE er.tenant_id = $1
            AND er.status IN ('submitted', 'under_review')
            AND COALESCE(ts.work_date, er.submitted_at::date) BETWEEN $2::date AND $3::date
        ) AS open_exception_requests,
        (
          SELECT COUNT(*)::int FROM shift_punch sp
          WHERE sp.tenant_id = $1
            AND sp.received_at::date BETWEEN $2::date AND $3::date
            AND sp.geofence_status IN ('outside', 'unknown')
            AND sp.approval_state = 'pending'
        ) AS unresolved_geofence_punches,
        (
          SELECT COUNT(*)::int FROM payroll_self_check_item item
          JOIN payroll_self_check sc ON sc.id = item.self_check_id
          WHERE item.tenant_id = $1
            AND sc.payroll_period_id = $4
            AND item.resolution_status = 'open'
            AND item.response <> 'looks_correct'
        ) AS open_self_check_items,
        (
          SELECT COUNT(*)::int FROM payroll_self_check sc
          WHERE sc.tenant_id = $1
            AND sc.payroll_period_id = $4
            AND sc.status = 'pending'
        ) AS self_check_pending
    `,
    [tenantId, period.period_start, period.period_end, period.id]
  );
  return rows[0];
}

export async function transitionPayrollPeriod(
  client: PoolClient,
  auth: AuthUser,
  periodId: string,
  input: { toStatus: PayrollPeriodStatus; reason?: string | null }
) {
  if (!canManagePayrollPeriods(auth)) {
    throw new ApiError(403, "You do not have access to manage payroll periods.");
  }

  const period = await findPayrollPeriodById(client, auth.tenantId, periodId);
  if (!period) {
    throw new ApiError(404, "Payroll period not found.");
  }

  const allowed = ALLOWED_TRANSITIONS[period.status] ?? [];
  if (!allowed.includes(input.toStatus)) {
    throw new ApiError(
      409,
      `Payroll period cannot move from ${period.status} to ${input.toStatus}. Allowed next steps: ${allowed.join(", ") || "none"}.`
    );
  }

  // Final approval and everything after it is owner-only: locking, exporting, and
  // marking synced all require the owner (Matthew) — payroll admins prepare, the
  // owner approves.
  if (OWNER_ONLY_TRANSITIONS.has(input.toStatus) && !canFinalizePayroll(auth)) {
    throw new ApiError(403, "Only the owner can give final payroll approval for this step.", {
      code: "owner_approval_required"
    });
  }

  if (input.toStatus === "correction_needed" && !input.reason?.trim()) {
    throw new ApiError(400, "Moving a payroll period to correction_needed requires a reason.");
  }

  const blockers = await loadPeriodBlockerCounts(client, auth.tenantId, period);
  if (input.toStatus === "locked") {
    // Locking with unresolved blockers is refused — payroll must see and resolve
    // (or explicitly dismiss) every exception before the period freezes.
    const blockerMessages: string[] = [];
    if (blockers.open_exception_requests > 0) {
      blockerMessages.push(`${blockers.open_exception_requests} open time exception request(s)`);
    }
    if (blockers.unresolved_geofence_punches > 0) {
      blockerMessages.push(`${blockers.unresolved_geofence_punches} unresolved geofence punch exception(s)`);
    }
    if (blockers.open_self_check_items > 0) {
      blockerMessages.push(`${blockers.open_self_check_items} unresolved payroll self-check report(s)`);
    }
    if (blockerMessages.length) {
      throw new ApiError(409, `Cannot lock this payroll period yet: ${blockerMessages.join(", ")}.`, {
        code: "payroll_lock_blocked",
        blockers
      });
    }
  }

  const now = new Date().toISOString();
  const statusTimestamps: Record<string, { column: string; actorColumn?: string }> = {
    self_check_open: { column: "self_check_opened_at" },
    locked: { column: "locked_at", actorColumn: "locked_by_user_id" },
    exported: { column: "exported_at", actorColumn: "exported_by_user_id" },
    synced: { column: "synced_at" }
  };

  const extra = statusTimestamps[input.toStatus];
  const setClauses = ["status = $3", "updated_by_user_id = $4", "updated_at = now()"];
  const params: unknown[] = [auth.tenantId, periodId, input.toStatus, auth.id];
  if (extra) {
    params.push(now);
    setClauses.push(`${extra.column} = $${params.length}`);
    if (extra.actorColumn) {
      setClauses.push(`${extra.actorColumn} = $4`);
    }
  }
  if (input.toStatus === "locked" && period.status === "owner_review") {
    // Locking out of owner_review IS the owner's final approval — record it.
    params.push(now);
    setClauses.push(`owner_reviewed_at = $${params.length}`);
    setClauses.push("owner_reviewed_by_user_id = $4");
  }
  if (input.toStatus === "correction_needed") {
    params.push(input.reason ?? null);
    setClauses.push(`correction_reason = $${params.length}`);
  }

  const { rows } = await client.query<PayrollPeriodRow>(
    `
      UPDATE payroll_period
      SET ${setClauses.join(", ")}
      WHERE tenant_id = $1 AND id = $2
      RETURNING ${PERIOD_SELECT}
    `,
    params
  );

  const eventType =
    input.toStatus === "locked"
      ? "lock"
      : input.toStatus === "exported"
        ? "export"
        : input.toStatus === "synced"
          ? "sync"
          : input.toStatus === "correction_needed"
            ? "correction"
            : "transition";

  await logPayrollPeriodEvent(client, {
    tenantId: auth.tenantId,
    periodId,
    eventType,
    fromStatus: period.status,
    toStatus: input.toStatus,
    reason: input.reason ?? null,
    metadata: { blockers },
    actorUserId: auth.id
  });

  // Re-attach any sessions created since the period row appeared, so lock/export
  // always covers the full window.
  await attachSessionsToPeriod(client, auth.tenantId, periodId, period.period_start, period.period_end);

  // Post-lock/post-sync corrections are an owner-level event: the owner approved
  // this period and must know it is being reopened.
  if (input.toStatus === "correction_needed" && LOCKED_STATUSES.includes(period.status)) {
    const { queueOwnerPayrollAlert } = await import("./payrollAlerts.js");
    await queueOwnerPayrollAlert(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      alertKind: "post_lock_correction",
      severity: "high",
      title: `Payroll ${period.period_start} – ${period.period_end} reopened after ${period.status}`,
      body: `Reason: ${input.reason ?? "not provided"}. The period requires payroll and owner review again before it can be re-locked or re-synced.`,
      periodId,
      dedupeKey: `payroll:post_lock_correction:${periodId}:${Date.now()}`
    });
  }

  return rows[0];
}

export async function listPayrollPeriods(client: PoolClient, auth: AuthUser, options: { limit?: number } = {}) {
  if (!canManagePayrollPeriods(auth)) {
    throw new ApiError(403, "You do not have access to payroll periods.");
  }
  const limit = Math.min(Math.max(options.limit ?? 12, 1), 52);
  const { rows } = await client.query<PayrollPeriodSummary>(
    `
      SELECT
        ${PERIOD_SELECT},
        (SELECT COUNT(*)::int FROM time_session ts WHERE ts.tenant_id = p.tenant_id AND ts.payroll_period_id = p.id) AS session_count,
        (SELECT COUNT(DISTINCT ts.employee_id)::int FROM time_session ts WHERE ts.tenant_id = p.tenant_id AND ts.payroll_period_id = p.id) AS employee_count,
        (SELECT COUNT(*)::int FROM payroll_self_check sc WHERE sc.tenant_id = p.tenant_id AND sc.payroll_period_id = p.id) AS self_check_total,
        (SELECT COUNT(*)::int FROM payroll_self_check sc WHERE sc.tenant_id = p.tenant_id AND sc.payroll_period_id = p.id AND sc.status = 'confirmed') AS self_check_confirmed,
        (SELECT COUNT(*)::int FROM payroll_self_check sc WHERE sc.tenant_id = p.tenant_id AND sc.payroll_period_id = p.id AND sc.status = 'discrepancy_reported') AS self_check_discrepancy,
        (
          SELECT COUNT(*)::int FROM payroll_self_check_item item
          JOIN payroll_self_check sc ON sc.id = item.self_check_id
          WHERE item.tenant_id = p.tenant_id AND sc.payroll_period_id = p.id
            AND item.resolution_status = 'open' AND item.response <> 'looks_correct'
        ) AS open_self_check_items,
        (
          SELECT COUNT(*)::int FROM exception_request er
          LEFT JOIN time_session ts ON ts.id = er.linked_session_id
          WHERE er.tenant_id = p.tenant_id
            AND er.status IN ('submitted', 'under_review')
            AND COALESCE(ts.work_date, er.submitted_at::date) BETWEEN p.period_start AND p.period_end
        ) AS open_exception_requests,
        (
          SELECT COUNT(*)::int FROM shift_punch sp
          WHERE sp.tenant_id = p.tenant_id
            AND sp.received_at::date BETWEEN p.period_start AND p.period_end
            AND sp.geofence_status IN ('outside', 'unknown')
            AND sp.approval_state = 'pending'
        ) AS unresolved_geofence_punches,
        (SELECT COUNT(*)::int FROM time_session ts WHERE ts.tenant_id = p.tenant_id AND ts.payroll_period_id = p.id AND ts.edited_after_payroll_review = true) AS edited_after_review_count,
        (SELECT COUNT(*)::int FROM payroll_export_batch b WHERE b.tenant_id = p.tenant_id AND b.payroll_period_id = p.id) AS export_batch_count
      FROM payroll_period p
      WHERE p.tenant_id = $1
      ORDER BY p.period_start DESC
      LIMIT $2
    `,
    [auth.tenantId, limit]
  );
  return rows;
}

export async function listPayrollPeriodEvents(client: PoolClient, tenantId: string, periodId: string) {
  const { rows } = await client.query<PayrollPeriodEventRow>(
    `
      SELECT
        e.id,
        e.event_type,
        e.from_status,
        e.to_status,
        e.reason,
        e.metadata,
        e.actor_user_id,
        actor.full_name AS actor_name,
        e.created_at::text
      FROM payroll_period_event e
      LEFT JOIN app_user actor ON actor.id = e.actor_user_id
      WHERE e.tenant_id = $1 AND e.period_id = $2
      ORDER BY e.created_at DESC
      LIMIT 100
    `,
    [tenantId, periodId]
  );
  return rows;
}

// Guard used by time-mutation paths. Locked periods refuse direct edits; reviewed but
// unlocked periods accept the edit and flag it (edited_after_payroll_review) plus log
// a correction event — history is never silently rewritten.
export async function guardSessionMutationForPayroll(
  client: PoolClient,
  tenantId: string,
  input: { sessionId?: string | null; employeeId?: string | null; workDate?: string | null; actorUserId?: string | null; reason?: string | null }
) {
  let sessionRow: { id: string; payroll_period_id: string | null } | null = null;
  if (input.sessionId) {
    const { rows } = await client.query<{ id: string; payroll_period_id: string | null }>(
      `SELECT id, payroll_period_id FROM time_session WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenantId, input.sessionId]
    );
    sessionRow = rows[0] ?? null;
  } else if (input.employeeId && input.workDate) {
    const { rows } = await client.query<{ id: string; payroll_period_id: string | null }>(
      `SELECT id, payroll_period_id FROM time_session WHERE tenant_id = $1 AND employee_id = $2 AND work_date = $3::date ORDER BY created_at DESC LIMIT 1`,
      [tenantId, input.employeeId, input.workDate]
    );
    sessionRow = rows[0] ?? null;
  }
  if (!sessionRow?.payroll_period_id) {
    return { flagged: false as const, periodStatus: null };
  }

  const period = await findPayrollPeriodById(client, tenantId, sessionRow.payroll_period_id);
  if (!period) {
    return { flagged: false as const, periodStatus: null };
  }

  if (LOCKED_STATUSES.includes(period.status)) {
    throw new ApiError(
      409,
      `This time record belongs to a ${period.status} payroll period. Move the period to correction_needed before adjusting time.`,
      { code: "payroll_period_locked", period_id: period.id, period_status: period.status }
    );
  }

  if (REVIEWED_STATUSES.includes(period.status)) {
    await client.query(
      `UPDATE time_session SET edited_after_payroll_review = true, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, sessionRow.id]
    );
    await logPayrollPeriodEvent(client, {
      tenantId,
      periodId: period.id,
      eventType: "correction",
      fromStatus: period.status,
      toStatus: period.status,
      reason: input.reason ?? "time_adjusted_after_payroll_review",
      metadata: { session_id: sessionRow.id },
      actorUserId: input.actorUserId ?? null
    });
    return { flagged: true as const, periodStatus: period.status };
  }

  return { flagged: false as const, periodStatus: period.status };
}
