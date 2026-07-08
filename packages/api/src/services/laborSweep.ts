// Labor Command Center — system sweep (invoked by the worker every minute per tenant).
// Responsibilities:
//   1. Ensure the current payroll period row exists.
//   2. Open the self-check window automatically 72h before the scheduled lock.
//   3. Send the 72h / 48h / 24h / morning-of reminder ladder to employees who have
//      not completed their self-check, plus a board summary to leadership. Reminder
//      stages are tracked on the period row (cooldown precedent, migration 157) so a
//      60-second sweep cadence never duplicates a stage.
//   4. Evaluate overtime warnings and notify on newly created ones (employee always;
//      leadership additionally for critical severity).
// Everything here is idempotent — safe to re-run on worker retries.
import type { PoolClient } from "pg";
import { queueNotificationDispatch } from "./opsNotifications.js";
import { evaluateAndPersistOvertimeWarnings } from "./overtimeEngine.js";
import { openSelfCheckForPeriod } from "./payrollSelfCheck.js";
import { queueOwnerPayrollAlert } from "./payrollAlerts.js";
import {
  ensurePayrollPeriodForDate,
  getPayrollCalendarConfig,
  logPayrollPeriodEvent,
  type PayrollPeriodReminderStage,
  type PayrollPeriodRow
} from "./payrollPeriods.js";

export type LaborSweepResult = {
  tenant_id: string;
  period_id: string | null;
  self_check_opened: boolean;
  reminder_stage_sent: PayrollPeriodReminderStage | null;
  reminder_recipient_count: number;
  overtime_evaluated: number;
  overtime_warnings_created: number;
};

const STAGE_RANK: Record<PayrollPeriodReminderStage, number> = {
  hours_72: 1,
  hours_48: 2,
  hours_24: 3,
  morning_of: 4
};

const STAGE_LABEL: Record<PayrollPeriodReminderStage, string> = {
  hours_72: "3 days",
  hours_48: "2 days",
  hours_24: "1 day",
  morning_of: "today"
};

// Reminder stage relative to the scheduled close, capped by the configurable
// self-check window (default 24h → only hours_24 + morning_of ever fire).
function resolveDueStage(lockScheduledAt: string, now: Date, windowHours: number): PayrollPeriodReminderStage | null {
  const hoursUntilLock = (new Date(lockScheduledAt).getTime() - now.getTime()) / 3_600_000;
  if (hoursUntilLock > windowHours) {
    return null;
  }
  if (hoursUntilLock <= 6) {
    // Includes past-the-close: the morning-of stage is still the right final nudge.
    return "morning_of";
  }
  if (hoursUntilLock <= 24) {
    return "hours_24";
  }
  if (hoursUntilLock <= 48) {
    return "hours_48";
  }
  return "hours_72";
}

async function loadLeadershipRecipients(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<{ user_id: string }>(
    `
      SELECT uaa.user_id
      FROM user_authority_assignment uaa
      JOIN app_user u ON u.id = uaa.user_id
      WHERE uaa.tenant_id = $1
        AND uaa.authority_tier IN ('super_admin', 'leadership', 'director_admin')
        AND u.is_active = true
    `,
    [tenantId]
  );
  return rows.map((row) => row.user_id);
}

async function sendSelfCheckReminders(
  client: PoolClient,
  tenantId: string,
  period: PayrollPeriodRow,
  stage: PayrollPeriodReminderStage
) {
  const { rows: pendingRows } = await client.query<{ employee_id: string }>(
    `
      SELECT sc.employee_id
      FROM payroll_self_check sc
      JOIN app_user u ON u.id = sc.employee_id
      WHERE sc.tenant_id = $1
        AND sc.payroll_period_id = $2
        AND sc.status = 'pending'
        AND u.is_active = true
    `,
    [tenantId, period.id]
  );

  const stageLabel = STAGE_LABEL[stage];
  const lockLabel = period.lock_scheduled_at ? new Date(period.lock_scheduled_at).toLocaleString() : "soon";

  if (pendingRows.length) {
    await queueNotificationDispatch(client, {
      tenantId,
      recipientUserIds: pendingRows.map((row) => row.employee_id),
      notificationType: "payroll_self_check_reminder",
      title:
        stage === "morning_of"
          ? "Payroll locks today — confirm your time now"
          : `Payroll self-check: ${stageLabel} left to review your time`,
      body: `These are the days and hours Mission Control has recorded for you for ${period.period_start} – ${period.period_end}. Payroll closes ${lockLabel} — reviewing is encouraged (not required), and reporting a problem before close keeps your pay right.`,
      priority: stage === "morning_of" ? "high" : "normal",
      deepLink: "#my-work/payroll-self-check",
      // Self-check is strongly encouraged but NOT required; nothing punitive follows.
      actionRequired: false,
      metadata: { payroll_period_id: period.id, reminder_stage: stage },
      appEventDedupeKey: `labor:self-check:${period.id}:${stage}`
    });
  }

  const leadership = await loadLeadershipRecipients(client, tenantId);
  if (leadership.length) {
    await queueNotificationDispatch(client, {
      tenantId,
      recipientUserIds: leadership,
      notificationType: "payroll_self_check_board",
      title: `Payroll ${period.period_start} – ${period.period_end}: ${pendingRows.length} employee(s) still unconfirmed (${stageLabel} to lock)`,
      body: "Open the Labor Command Center to see who has not confirmed, unresolved discrepancy reports, and geofence exceptions before payroll lock.",
      priority: stage === "morning_of" ? "high" : "normal",
      deepLink: "#labor/command-center",
      metadata: { payroll_period_id: period.id, reminder_stage: stage, pending_count: pendingRows.length },
      appEventDedupeKey: `labor:self-check-board:${period.id}:${stage}`
    });
  }

  await client.query(
    `
      UPDATE payroll_period
      SET last_reminder_stage = $3, last_reminder_at = now(), reminder_count = reminder_count + 1, updated_at = now()
      WHERE tenant_id = $1 AND id = $2
    `,
    [tenantId, period.id, stage]
  );
  await client.query(
    `
      UPDATE payroll_self_check
      SET last_reminder_stage = $3, last_reminder_at = now(), reminder_count = reminder_count + 1, updated_at = now()
      WHERE tenant_id = $1 AND payroll_period_id = $2 AND status = 'pending'
    `,
    [tenantId, period.id, stage]
  );
  await logPayrollPeriodEvent(client, {
    tenantId,
    periodId: period.id,
    eventType: "reminder",
    fromStatus: period.status,
    toStatus: period.status,
    reason: `self_check_reminder_${stage}`,
    metadata: { pending_count: pendingRows.length, stage }
  });

  return pendingRows.length;
}

async function notifyNewOvertimeWarnings(
  client: PoolClient,
  tenantId: string,
  created: Awaited<ReturnType<typeof evaluateAndPersistOvertimeWarnings>>["created"]
) {
  if (!created.length) {
    return;
  }
  const leadership = await loadLeadershipRecipients(client, tenantId);
  for (const warning of created) {
    await queueNotificationDispatch(client, {
      tenantId,
      recipientUserIds: [warning.employee_id],
      relatedUserId: warning.employee_id,
      notificationType: "overtime_warning",
      title:
        warning.warning_type === "in_overtime"
          ? "You are in overtime this week"
          : warning.warning_type === "long_active_session"
            ? "Your time clock has been running a long time"
            : "Overtime heads-up for this week",
      body: "Open My Work to see your hours this week and what is driving the warning.",
      priority: warning.severity === "critical" ? "high" : "normal",
      deepLink: "#my-work",
      metadata: { warning_type: warning.warning_type, severity: warning.severity },
      appEventDedupeKey: `labor:ot:${warning.employee_id}:${warning.warning_type}`
    });

    if (warning.severity === "critical" && leadership.length) {
      await queueNotificationDispatch(client, {
        tenantId,
        recipientUserIds: leadership,
        relatedUserId: warning.employee_id,
        notificationType: "overtime_warning_leadership",
        title: `Critical overtime warning: ${warning.warning_type.replace(/_/g, " ")}`,
        body: "An employee crossed a critical overtime signal. Open the Labor Command Center to review.",
        priority: "high",
        deepLink: "#labor/command-center",
        metadata: { employee_id: warning.employee_id, warning_type: warning.warning_type },
        appEventDedupeKey: `labor:ot-leadership:${warning.employee_id}:${warning.warning_type}`
      });
    }
  }
}

export async function sweepLaborForTenant(client: PoolClient, tenantId: string): Promise<LaborSweepResult> {
  const now = new Date();
  const config = await getPayrollCalendarConfig(client, tenantId);
  const period = await ensurePayrollPeriodForDate(client, tenantId, now.toISOString().slice(0, 10));

  let selfCheckOpened = false;
  let reminderStageSent: PayrollPeriodReminderStage | null = null;
  let reminderRecipientCount = 0;

  if (period.lock_scheduled_at) {
    const dueStage = resolveDueStage(period.lock_scheduled_at, now, config.self_check_window_hours);

    if (dueStage && period.status === "open") {
      await openSelfCheckForPeriod(client, tenantId, period.id, null);
      period.status = "self_check_open";
      selfCheckOpened = true;
    }

    const canRemind = period.status === "self_check_open" || period.status === "manager_review";
    const lastRank = period.last_reminder_stage ? STAGE_RANK[period.last_reminder_stage] : 0;
    if (dueStage && canRemind && STAGE_RANK[dueStage] > lastRank) {
      reminderRecipientCount = await sendSelfCheckReminders(client, tenantId, period, dueStage);
      reminderStageSent = dueStage;
    }
  }

  // Owner heads-up: when a period sits in payroll_review, tell the owner whether it
  // is ready for final review or what still blocks it. Stable dedupe key per period
  // + state so the sweep cadence never spams.
  if (period.status === "payroll_review") {
    const { rows: blockerRows } = await client.query<{ open_exceptions: number; open_items: number; pending_geofence: number }>(
      `
        SELECT
          (
            SELECT COUNT(*)::int FROM exception_request er
            LEFT JOIN time_session ts ON ts.id = er.linked_session_id
            WHERE er.tenant_id = $1 AND er.status IN ('submitted', 'under_review')
              AND COALESCE(ts.work_date, er.submitted_at::date) BETWEEN $2::date AND $3::date
          ) AS open_exceptions,
          (
            SELECT COUNT(*)::int FROM payroll_self_check_item item
            JOIN payroll_self_check sc ON sc.id = item.self_check_id
            WHERE item.tenant_id = $1 AND sc.payroll_period_id = $4
              AND item.resolution_status = 'open' AND item.response <> 'looks_correct'
          ) AS open_items,
          (
            SELECT COUNT(*)::int FROM shift_punch sp
            WHERE sp.tenant_id = $1 AND sp.received_at::date BETWEEN $2::date AND $3::date
              AND sp.geofence_status IN ('outside', 'unknown') AND sp.approval_state = 'pending'
          ) AS pending_geofence
      `,
      [tenantId, period.period_start, period.period_end, period.id]
    );
    const blockers = blockerRows[0];
    const blockerTotal = blockers.open_exceptions + blockers.open_items + blockers.pending_geofence;
    if (blockerTotal === 0) {
      await queueOwnerPayrollAlert(client, {
        tenantId,
        alertKind: "payroll_ready_for_owner_review",
        severity: "medium",
        title: `Payroll ${period.period_start} – ${period.period_end} is ready for your final review`,
        body: "Manager and payroll review are complete with no open blockers. Move the period to Owner Review, then lock it to enable export and QuickBooks send.",
        periodId: period.id,
        dedupeKey: `payroll:ready:${period.id}`
      });
    } else {
      await queueOwnerPayrollAlert(client, {
        tenantId,
        alertKind: "payroll_blockers",
        severity: "high",
        title: `Payroll ${period.period_start} – ${period.period_end} has ${blockerTotal} unresolved blocker(s)`,
        body: `${blockers.open_exceptions} open time exception(s), ${blockers.open_items} self-check report(s), ${blockers.pending_geofence} geofence exception(s). These must be resolved before lock.`,
        periodId: period.id,
        dedupeKey: `payroll:blockers:${period.id}:${blockerTotal}`
      });
    }
  }

  const overtime = await evaluateAndPersistOvertimeWarnings(client, tenantId);
  await notifyNewOvertimeWarnings(client, tenantId, overtime.created);

  return {
    tenant_id: tenantId,
    period_id: period.id,
    self_check_opened: selfCheckOpened,
    reminder_stage_sent: reminderStageSent,
    reminder_recipient_count: reminderRecipientCount,
    overtime_evaluated: overtime.evaluated,
    overtime_warnings_created: overtime.created.length
  };
}
