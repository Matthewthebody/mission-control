// Labor Command Center — leadership/payroll command overview.
// One exception-first read model over the canonical labor state: current pay period
// lifecycle, self-check progress, overtime risk, geofence exceptions, pending
// approvals, and export/QuickBooks readiness. Counts are computed server-side so the
// UI never fabricates numbers. Pay rates and labor cost stay out of this payload —
// cost-bearing views remain behind the existing labor_cost gating.
import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { canFinalizePayroll, canReviewTeamTime, canManagePayrollPeriods } from "../authz/authority.js";
import { findPayrollPeriodForDate, listPayrollPeriodEvents, type PayrollPeriodRow } from "./payrollPeriods.js";
import { getSelfCheckManagerBoard, type SelfCheckManagerBoard } from "./payrollSelfCheck.js";
import { listOvertimeWarnings, type OvertimeWarningRecord } from "./overtimeEngine.js";
import { getQuickBooksIntegrationStatus, listPayrollExportBatches } from "./quickbooksIntegration.js";

export type LaborCommandCenterOverview = {
  generated_at: string;
  access: { can_manage_periods: boolean; can_finalize_payroll: boolean };
  period: Pick<
    PayrollPeriodRow,
    | "id"
    | "period_start"
    | "period_end"
    | "status"
    | "lock_scheduled_at"
    | "self_check_opened_at"
    | "locked_at"
    | "exported_at"
    | "synced_at"
    | "correction_reason"
  >;
  self_check: SelfCheckManagerBoard["summary"];
  overtime: {
    active_warning_count: number;
    critical_warning_count: number;
    warnings: OvertimeWarningRecord[];
  };
  blockers: {
    open_exception_requests: number;
    unresolved_geofence_punches: number;
    open_self_check_items: number;
    missing_manager_approvals: number;
    edited_after_review_count: number;
  };
  export_readiness: {
    can_lock: boolean;
    can_export: boolean;
    quickbooks_ready: boolean;
    export_batch_count: number;
    last_export_at: string | null;
  };
  recent_events: Awaited<ReturnType<typeof listPayrollPeriodEvents>>;
};

export async function getLaborCommandCenterOverview(
  client: PoolClient,
  auth: AuthUser,
  options: { anchorDate?: string } = {}
): Promise<LaborCommandCenterOverview> {
  if (!canReviewTeamTime(auth)) {
    throw new ApiError(403, "You do not have access to the Labor Command Center.");
  }

  const anchor = options.anchorDate ?? new Date().toISOString().slice(0, 10);
  // Read-only: the sweep/worker (or POST /periods/ensure-current) creates the period.
  const period = await findPayrollPeriodForDate(client, auth.tenantId, anchor);
  if (!period) {
    throw new ApiError(
      404,
      "No payroll period exists for this week yet. The labor monitor creates one automatically within a minute, or use Ensure Current Period.",
      { code: "payroll_period_missing" }
    );
  }
  const board = await getSelfCheckManagerBoard(client, auth, period.id);
  const warnings = await listOvertimeWarnings(client, auth, { includeResolved: false });

  const { rows: blockerRows } = await client.query<{
    open_exception_requests: number;
    unresolved_geofence_punches: number;
    missing_manager_approvals: number;
    edited_after_review_count: number;
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
          SELECT COUNT(*)::int FROM time_session ts
          WHERE ts.tenant_id = $1
            AND ts.work_date BETWEEN $2::date AND $3::date
            AND ts.status IN ('closed', 'needs_end_of_day_confirmation')
        ) AS missing_manager_approvals,
        (
          SELECT COUNT(*)::int FROM time_session ts
          WHERE ts.tenant_id = $1
            AND ts.payroll_period_id = $4
            AND ts.edited_after_payroll_review = true
        ) AS edited_after_review_count
    `,
    [auth.tenantId, period.period_start, period.period_end, period.id]
  );
  const blockers = blockerRows[0];

  const canManage = canManagePayrollPeriods(auth);
  let quickbooksReady = false;
  let exportBatchCount = 0;
  let lastExportAt: string | null = null;
  if (canManage) {
    const qbStatus = await getQuickBooksIntegrationStatus(client, auth);
    quickbooksReady = qbStatus.quickbooks_ready;
    const batches = (await listPayrollExportBatches(client, auth, period.id)) as Array<{ generated_at: string }>;
    exportBatchCount = batches.length;
    lastExportAt = batches[0]?.generated_at ?? null;
  }

  const hasLockBlockers =
    blockers.open_exception_requests > 0 ||
    blockers.unresolved_geofence_punches > 0 ||
    board.summary.open_discrepancy_items > 0;

  return {
    generated_at: new Date().toISOString(),
    access: { can_manage_periods: canManage, can_finalize_payroll: canFinalizePayroll(auth) },
    period: {
      id: period.id,
      period_start: period.period_start,
      period_end: period.period_end,
      status: period.status,
      lock_scheduled_at: period.lock_scheduled_at,
      self_check_opened_at: period.self_check_opened_at,
      locked_at: period.locked_at,
      exported_at: period.exported_at,
      synced_at: period.synced_at,
      correction_reason: period.correction_reason
    },
    self_check: board.summary,
    overtime: {
      active_warning_count: warnings.length,
      critical_warning_count: warnings.filter((warning) => warning.severity === "critical").length,
      warnings: warnings.slice(0, 25)
    },
    blockers: {
      open_exception_requests: blockers.open_exception_requests,
      unresolved_geofence_punches: blockers.unresolved_geofence_punches,
      open_self_check_items: board.summary.open_discrepancy_items,
      missing_manager_approvals: blockers.missing_manager_approvals,
      edited_after_review_count: blockers.edited_after_review_count
    },
    export_readiness: {
      can_lock: period.status === "payroll_review" && !hasLockBlockers,
      can_export: period.status === "locked" || period.status === "exported",
      quickbooks_ready: quickbooksReady,
      export_batch_count: exportBatchCount,
      last_export_at: lastExportAt
    },
    recent_events: await listPayrollPeriodEvents(client, auth.tenantId, period.id)
  };
}
