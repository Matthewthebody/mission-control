// Labor Command Center — QuickBooks integration boundary (scaffolding phase).
// Contract: Mission Control owns operational labor truth; QuickBooks owns payroll,
// taxes, direct deposit, and final payroll processing. This module holds the mapping
// configuration (employee / pay-type), connection placeholder, and the CSV export
// batch pipeline for approved + locked periods. There is NO live QuickBooks API call
// anywhere in this phase — connection_status stays honest ("not_connected") and the
// sync log exists so a later API phase can dedupe on quickbooks_time_activity_id.
import type { PoolClient } from "pg";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser } from "../types/auth.js";
import { canFinalizePayroll, canManagePayrollPeriods } from "../authz/authority.js";
import { buildPayrollExportPayload, renderPayrollExportCsv } from "./payrollReview.js";
import { findPayrollPeriodById, logPayrollPeriodEvent } from "./payrollPeriods.js";
import { queueOwnerPayrollAlert } from "./payrollAlerts.js";

export type QuickBooksPayCategory = "regular_office_drive" | "regular_photography" | "overtime" | "mileage_reimbursement";

export type QuickBooksIntegrationStatus = {
  connection: {
    environment: "sandbox" | "production";
    connection_status: "not_connected" | "connected" | "error" | "expired";
    realm_id: string | null;
    last_connected_at: string | null;
    last_error: string | null;
  };
  employee_mappings: {
    mapped_count: number;
    active_employee_count: number;
    unmapped_employees: Array<{ employee_id: string; employee_name: string | null; department: string | null }>;
  };
  pay_type_mappings: {
    mapped_categories: string[];
    missing_categories: string[];
  };
  quickbooks_ready: boolean;
};

const ALL_PAY_CATEGORIES: QuickBooksPayCategory[] = [
  "regular_office_drive",
  "regular_photography",
  "overtime",
  "mileage_reimbursement"
];

function requirePayrollAdmin(auth: AuthUser) {
  if (!canManagePayrollPeriods(auth)) {
    throw new ApiError(403, "You do not have access to payroll export configuration.");
  }
}

export async function getQuickBooksIntegrationStatus(client: PoolClient, auth: AuthUser): Promise<QuickBooksIntegrationStatus> {
  requirePayrollAdmin(auth);

  const { rows: connectionRows } = await client.query<{
    environment: "sandbox" | "production";
    connection_status: "not_connected" | "connected" | "error" | "expired";
    realm_id: string | null;
    last_connected_at: string | null;
    last_error: string | null;
  }>(
    `SELECT environment, connection_status, realm_id, last_connected_at::text, last_error FROM quickbooks_connection WHERE tenant_id = $1 LIMIT 1`,
    [auth.tenantId]
  );
  const connection = connectionRows[0] ?? {
    environment: "sandbox" as const,
    connection_status: "not_connected" as const,
    realm_id: null,
    last_connected_at: null,
    last_error: null
  };

  const { rows: unmappedRows } = await client.query<{
    employee_id: string;
    employee_name: string | null;
    department: string | null;
  }>(
    `
      SELECT u.id AS employee_id, u.full_name AS employee_name, u.department::text AS department
      FROM app_user u
      WHERE u.tenant_id = $1
        AND u.is_active = true
        AND EXISTS (SELECT 1 FROM time_session ts WHERE ts.tenant_id = u.tenant_id AND ts.employee_id = u.id)
        AND NOT EXISTS (
          SELECT 1 FROM quickbooks_employee_mapping m
          WHERE m.tenant_id = u.tenant_id AND m.employee_id = u.id AND m.active_status = true
        )
      ORDER BY u.full_name
    `,
    [auth.tenantId]
  );

  const { rows: countRows } = await client.query<{ mapped_count: number; active_employee_count: number }>(
    `
      SELECT
        (SELECT COUNT(*)::int FROM quickbooks_employee_mapping m WHERE m.tenant_id = $1 AND m.active_status = true) AS mapped_count,
        (
          SELECT COUNT(*)::int FROM app_user u
          WHERE u.tenant_id = $1 AND u.is_active = true
            AND EXISTS (SELECT 1 FROM time_session ts WHERE ts.tenant_id = u.tenant_id AND ts.employee_id = u.id)
        ) AS active_employee_count
    `,
    [auth.tenantId]
  );

  // Pay-type readiness is keyed by Mission Control pay codes (the company has at
  // least two pay rates): every active pay code needs a QuickBooks pay-type mapping.
  const { rows: payCodeRows } = await client.query<{ code: string; mapped: boolean }>(
    `
      SELECT
        pc.code,
        EXISTS (
          SELECT 1 FROM quickbooks_pay_type_mapping m
          WHERE m.tenant_id = pc.tenant_id AND m.pay_code = pc.code AND m.active_status = true
        ) AS mapped
      FROM pay_code pc
      WHERE pc.tenant_id = $1 AND pc.active_status = true
      ORDER BY pc.sort_order
    `,
    [auth.tenantId]
  );
  const mappedCategories = payCodeRows.filter((row) => row.mapped).map((row) => row.code);
  const missingCategories = payCodeRows.filter((row) => !row.mapped).map((row) => row.code);

  return {
    connection,
    employee_mappings: {
      mapped_count: countRows[0]?.mapped_count ?? 0,
      active_employee_count: countRows[0]?.active_employee_count ?? 0,
      unmapped_employees: unmappedRows
    },
    pay_type_mappings: {
      mapped_categories: mappedCategories,
      missing_categories: missingCategories
    },
    quickbooks_ready:
      connection.connection_status === "connected" && unmappedRows.length === 0 && missingCategories.length === 0
  };
}

export async function listQuickBooksEmployeeMappings(client: PoolClient, auth: AuthUser) {
  requirePayrollAdmin(auth);
  const { rows } = await client.query(
    `
      SELECT
        m.id,
        m.employee_id,
        emp.full_name AS employee_name,
        emp.department::text AS department,
        m.quickbooks_employee_id,
        m.quickbooks_display_name,
        m.sync_status,
        m.last_synced_at::text,
        m.sync_error,
        m.updated_at::text
      FROM quickbooks_employee_mapping m
      JOIN app_user emp ON emp.id = m.employee_id
      WHERE m.tenant_id = $1 AND m.active_status = true
      ORDER BY emp.full_name
    `,
    [auth.tenantId]
  );
  return rows;
}

export async function upsertQuickBooksEmployeeMapping(
  client: PoolClient,
  auth: AuthUser,
  input: { employee_id: string; quickbooks_employee_id: string; quickbooks_display_name?: string | null }
) {
  requirePayrollAdmin(auth);
  const quickbooksEmployeeId = input.quickbooks_employee_id.trim();
  if (!quickbooksEmployeeId) {
    throw new ApiError(400, "A QuickBooks employee id is required.");
  }

  const { rows: employeeRows } = await client.query<{ id: string }>(
    `SELECT id FROM app_user WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [auth.tenantId, input.employee_id]
  );
  if (!employeeRows[0]) {
    throw new ApiError(404, "Employee not found.");
  }

  const { rows: duplicateRows } = await client.query<{ employee_id: string }>(
    `
      SELECT employee_id FROM quickbooks_employee_mapping
      WHERE tenant_id = $1 AND quickbooks_employee_id = $2 AND active_status = true AND employee_id <> $3
      LIMIT 1
    `,
    [auth.tenantId, quickbooksEmployeeId, input.employee_id]
  );
  if (duplicateRows[0]) {
    throw new ApiError(409, "That QuickBooks employee id is already mapped to another employee.", {
      code: "quickbooks_employee_id_in_use"
    });
  }

  await client.query(
    `
      UPDATE quickbooks_employee_mapping
      SET active_status = false, updated_at = now()
      WHERE tenant_id = $1 AND employee_id = $2 AND active_status = true
    `,
    [auth.tenantId, input.employee_id]
  );

  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO quickbooks_employee_mapping (
        tenant_id, employee_id, quickbooks_employee_id, quickbooks_display_name, sync_status, created_by_user_id
      ) VALUES ($1, $2, $3, $4, 'mapped', $5)
      RETURNING id
    `,
    [auth.tenantId, input.employee_id, quickbooksEmployeeId, input.quickbooks_display_name ?? null, auth.id]
  );
  return { id: rows[0].id };
}

export async function listQuickBooksPayTypeMappings(client: PoolClient, auth: AuthUser) {
  requirePayrollAdmin(auth);
  const { rows } = await client.query(
    `
      SELECT m.id, m.pay_code, pc.label AS pay_code_label, m.quickbooks_pay_item, m.quickbooks_pay_item_id, m.updated_at::text
      FROM quickbooks_pay_type_mapping m
      LEFT JOIN pay_code pc ON pc.tenant_id = m.tenant_id AND pc.code = m.pay_code
      WHERE m.tenant_id = $1 AND m.active_status = true AND m.pay_code IS NOT NULL
      ORDER BY pc.sort_order NULLS LAST, m.pay_code
    `,
    [auth.tenantId]
  );
  return rows;
}

export async function listPayCodes(client: PoolClient, auth: AuthUser) {
  requirePayrollAdmin(auth);
  const { rows } = await client.query(
    `
      SELECT code, label, description, payable_default, requires_review, sort_order
      FROM pay_code
      WHERE tenant_id = $1 AND active_status = true
      ORDER BY sort_order
    `,
    [auth.tenantId]
  );
  return rows;
}

export async function upsertQuickBooksPayTypeMapping(
  client: PoolClient,
  auth: AuthUser,
  input: { pay_code: string; quickbooks_pay_item: string; quickbooks_pay_item_id?: string | null }
) {
  requirePayrollAdmin(auth);
  const { rows: payCodeRows } = await client.query<{ code: string }>(
    `SELECT code FROM pay_code WHERE tenant_id = $1 AND code = $2 AND active_status = true LIMIT 1`,
    [auth.tenantId, input.pay_code]
  );
  if (!payCodeRows[0]) {
    throw new ApiError(400, "Unknown pay code.");
  }
  const payItem = input.quickbooks_pay_item.trim();
  if (!payItem) {
    throw new ApiError(400, "A QuickBooks pay item name is required.");
  }

  await client.query(
    `
      UPDATE quickbooks_pay_type_mapping
      SET active_status = false, updated_at = now()
      WHERE tenant_id = $1 AND pay_code = $2 AND active_status = true
    `,
    [auth.tenantId, input.pay_code]
  );
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO quickbooks_pay_type_mapping (tenant_id, pay_code, quickbooks_pay_item, quickbooks_pay_item_id, created_by_user_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `,
    [auth.tenantId, input.pay_code, payItem, input.quickbooks_pay_item_id ?? null, auth.id]
  );
  return { id: rows[0].id };
}

// CSV export for a LOCKED period only. Every export creates a durable batch record;
// the CSV itself is returned for download (no file storage in this phase).
export async function createPayrollExportBatch(client: PoolClient, auth: AuthUser, periodId: string) {
  requirePayrollAdmin(auth);
  const period = await findPayrollPeriodById(client, auth.tenantId, periodId);
  if (!period) {
    throw new ApiError(404, "Payroll period not found.");
  }
  if (period.status !== "locked" && period.status !== "exported" && period.status !== "synced") {
    throw new ApiError(409, "Only a locked payroll period can be exported. Lock the period first.", {
      code: "payroll_period_not_locked",
      period_status: period.status
    });
  }

  const payload = await buildPayrollExportPayload(client, auth, {
    dateFrom: period.period_start,
    dateTo: period.period_end
  });
  const csv = renderPayrollExportCsv(payload);
  const fileName = `mission-control-payroll-${period.period_start}-to-${period.period_end}.csv`;

  const totalRegularMinutes = payload.rows.reduce(
    (sum, row) => sum + Math.round((row.regular_office_drive_hours + row.regular_photography_hours) * 60),
    0
  );
  const totalOvertimeMinutes = payload.rows.reduce((sum, row) => sum + Math.round(row.overtime_hours * 60), 0);
  const totalMileage = payload.rows.reduce((sum, row) => sum + row.mileage_reimbursement_amount, 0);

  const { rows: batchRows } = await client.query<{ id: string; generated_at: string }>(
    `
      INSERT INTO payroll_export_batch (
        tenant_id, payroll_period_id, export_kind, status, row_count,
        total_regular_minutes, total_overtime_minutes, total_mileage_amount,
        file_name, generated_by_user_id, metadata
      ) VALUES ($1, $2, 'csv', 'generated', $3, $4, $5, $6, $7, $8, $9::jsonb)
      RETURNING id, generated_at::text
    `,
    [
      auth.tenantId,
      periodId,
      payload.rows.length,
      totalRegularMinutes,
      totalOvertimeMinutes,
      Number(totalMileage.toFixed(2)),
      fileName,
      auth.id,
      JSON.stringify({ summary: payload.summary })
    ]
  );

  await logPayrollPeriodEvent(client, {
    tenantId: auth.tenantId,
    periodId,
    eventType: "export",
    fromStatus: period.status,
    toStatus: period.status,
    reason: "csv_export_batch_generated",
    metadata: { batch_id: batchRows[0].id, row_count: payload.rows.length, file_name: fileName },
    actorUserId: auth.id
  });

  return {
    batch: {
      id: batchRows[0].id,
      file_name: fileName,
      row_count: payload.rows.length,
      generated_at: batchRows[0].generated_at
    },
    csv
  };
}

// ---------------------------------------------------------------------------
// "Send Approved Time to QuickBooks" — owner-only, explicit, never automatic.
// SCAFFOLDING STATUS: the transport is NOT implemented (no OAuth credentials exist
// in this phase), so a real dispatch cannot happen yet. Everything around it is
// real: owner gating, locked-period gating, mapping validation, per-line dedupe on
// a deterministic external ref, sync_log rows, and owner failure alerts. When the
// QuickBooks OAuth transport lands, only dispatchQuickBooksTimeActivity changes.
// This never runs payroll — it only records approved time in QuickBooks.
// ---------------------------------------------------------------------------

type QuickBooksTimeLine = {
  employee_id: string;
  employee_name: string | null;
  quickbooks_employee_id: string;
  pay_code: string;
  quickbooks_pay_item: string;
  minutes: number;
  external_ref: string;
};

async function dispatchQuickBooksTimeActivity(_line: QuickBooksTimeLine): Promise<{ time_activity_id: string }> {
  // Deliberate scaffold: fails loudly until the OAuth transport phase.
  throw new Error("QuickBooks API transport is not implemented yet (scaffolding phase). Use the CSV export.");
}

export async function sendApprovedTimeToQuickBooks(client: PoolClient, auth: AuthUser, periodId: string) {
  if (!canFinalizePayroll(auth)) {
    throw new ApiError(403, "Only the owner can send approved time to QuickBooks.", { code: "owner_approval_required" });
  }
  const period = await findPayrollPeriodById(client, auth.tenantId, periodId);
  if (!period) {
    throw new ApiError(404, "Payroll period not found.");
  }
  if (period.status !== "locked" && period.status !== "exported") {
    throw new ApiError(409, "Only an owner-approved, locked payroll period can be sent to QuickBooks.", {
      code: "payroll_period_not_locked",
      period_status: period.status
    });
  }

  const status = await getQuickBooksIntegrationStatus(client, auth);
  if (status.connection.connection_status !== "connected") {
    throw new ApiError(409, "QuickBooks Online is not connected. Connect it under payroll settings, or use the CSV export.", {
      code: "quickbooks_not_connected"
    });
  }
  if (status.employee_mappings.unmapped_employees.length > 0 || status.pay_type_mappings.missing_categories.length > 0) {
    throw new ApiError(409, "QuickBooks mappings are incomplete. Every employee and pay code must be mapped before sync.", {
      code: "quickbooks_mappings_incomplete",
      unmapped_employees: status.employee_mappings.unmapped_employees.map((employee) => employee.employee_name ?? employee.employee_id),
      missing_pay_codes: status.pay_type_mappings.missing_categories
    });
  }

  // Approved hours per employee × pay code for the locked period. Segments without
  // an explicit pay code derive from work_state (photography → session_labor,
  // office_drive → studio_admin).
  const { rows: lines } = await client.query<QuickBooksTimeLine & { minutes: number }>(
    `
      SELECT
        ts.employee_id,
        emp.full_name AS employee_name,
        qem.quickbooks_employee_id,
        COALESCE(seg.pay_code, CASE seg.work_state::text WHEN 'photography' THEN 'session_labor' ELSE 'studio_admin' END) AS pay_code,
        qptm.quickbooks_pay_item,
        COALESCE(SUM(seg.duration_minutes), 0)::int AS minutes,
        '' AS external_ref
      FROM time_segment seg
      JOIN time_session ts ON ts.id = seg.session_id
      JOIN app_user emp ON emp.id = ts.employee_id
      JOIN quickbooks_employee_mapping qem
        ON qem.tenant_id = ts.tenant_id AND qem.employee_id = ts.employee_id AND qem.active_status = true
      LEFT JOIN quickbooks_pay_type_mapping qptm
        ON qptm.tenant_id = ts.tenant_id AND qptm.active_status = true
        AND qptm.pay_code = COALESCE(seg.pay_code, CASE seg.work_state::text WHEN 'photography' THEN 'session_labor' ELSE 'studio_admin' END)
      WHERE ts.tenant_id = $1
        AND ts.payroll_period_id = $2
        AND seg.end_time IS NOT NULL
      GROUP BY ts.employee_id, emp.full_name, qem.quickbooks_employee_id, 4, qptm.quickbooks_pay_item
      HAVING COALESCE(SUM(seg.duration_minutes), 0) > 0
      ORDER BY emp.full_name, 4
    `,
    [auth.tenantId, periodId]
  );

  const results: Array<{ employee_id: string; pay_code: string; minutes: number; sync_status: string; sync_error: string | null }> = [];
  let successCount = 0;
  let duplicateCount = 0;
  let errorCount = 0;

  for (const rawLine of lines) {
    const line: QuickBooksTimeLine = { ...rawLine, external_ref: `mc:${periodId}:${rawLine.employee_id}:${rawLine.pay_code}` };

    // Duplicate prevention: a successful sync_log row with the same deterministic
    // external ref means this line already exists in QuickBooks — never resend.
    const { rows: existing } = await client.query<{ id: string }>(
      `
        SELECT id FROM quickbooks_sync_log
        WHERE tenant_id = $1 AND sync_status = 'success' AND payload->>'external_ref' = $2
        LIMIT 1
      `,
      [auth.tenantId, line.external_ref]
    );
    if (existing[0]) {
      duplicateCount += 1;
      await client.query(
        `
          INSERT INTO quickbooks_sync_log (tenant_id, payroll_period_id, employee_id, sync_status, payload)
          VALUES ($1, $2, $3, 'skipped_duplicate', $4::jsonb)
        `,
        [auth.tenantId, periodId, line.employee_id, JSON.stringify({ external_ref: line.external_ref, pay_code: line.pay_code })]
      );
      results.push({ employee_id: line.employee_id, pay_code: line.pay_code, minutes: line.minutes, sync_status: "skipped_duplicate", sync_error: null });
      continue;
    }

    try {
      const dispatched = await dispatchQuickBooksTimeActivity(line);
      successCount += 1;
      await client.query(
        `
          INSERT INTO quickbooks_sync_log (tenant_id, payroll_period_id, employee_id, quickbooks_time_activity_id, sync_status, payload)
          VALUES ($1, $2, $3, $4, 'success', $5::jsonb)
        `,
        [
          auth.tenantId,
          periodId,
          line.employee_id,
          dispatched.time_activity_id,
          JSON.stringify({ external_ref: line.external_ref, pay_code: line.pay_code, minutes: line.minutes })
        ]
      );
      results.push({ employee_id: line.employee_id, pay_code: line.pay_code, minutes: line.minutes, sync_status: "success", sync_error: null });
    } catch (error) {
      errorCount += 1;
      const message = error instanceof Error ? error.message : "Unknown QuickBooks sync error.";
      await client.query(
        `
          INSERT INTO quickbooks_sync_log (tenant_id, payroll_period_id, employee_id, sync_status, sync_error, payload)
          VALUES ($1, $2, $3, 'error', $4, $5::jsonb)
        `,
        [
          auth.tenantId,
          periodId,
          line.employee_id,
          message,
          JSON.stringify({ external_ref: line.external_ref, pay_code: line.pay_code, minutes: line.minutes })
        ]
      );
      results.push({ employee_id: line.employee_id, pay_code: line.pay_code, minutes: line.minutes, sync_status: "error", sync_error: message });
    }
  }

  await logPayrollPeriodEvent(client, {
    tenantId: auth.tenantId,
    periodId,
    eventType: "sync",
    fromStatus: period.status,
    toStatus: period.status,
    reason: "quickbooks_sync_attempted",
    metadata: { line_count: lines.length, success_count: successCount, duplicate_count: duplicateCount, error_count: errorCount },
    actorUserId: auth.id
  });

  if (errorCount > 0) {
    await queueOwnerPayrollAlert(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      alertKind: "quickbooks_sync_failed",
      severity: "high",
      title: `QuickBooks sync: ${errorCount} of ${lines.length} line(s) failed for ${period.period_start} – ${period.period_end}`,
      body: "Review the sync log in the Labor Command Center. The CSV export remains available as the fallback.",
      periodId,
      dedupeKey: `payroll:quickbooks_sync_failed:${periodId}:${Date.now()}`
    });
  }

  return {
    period_id: periodId,
    line_count: lines.length,
    success_count: successCount,
    duplicate_count: duplicateCount,
    error_count: errorCount,
    results
  };
}

export async function listQuickBooksSyncLog(client: PoolClient, auth: AuthUser, periodId: string) {
  if (!canFinalizePayroll(auth) && !canManagePayrollPeriods(auth)) {
    throw new ApiError(403, "You do not have access to the QuickBooks sync log.");
  }
  const { rows } = await client.query(
    `
      SELECT
        l.id,
        l.employee_id,
        emp.full_name AS employee_name,
        l.quickbooks_time_activity_id,
        l.sync_status,
        l.sync_error,
        l.attempted_at::text,
        l.payload
      FROM quickbooks_sync_log l
      LEFT JOIN app_user emp ON emp.id = l.employee_id
      WHERE l.tenant_id = $1 AND l.payroll_period_id = $2
      ORDER BY l.attempted_at DESC
      LIMIT 200
    `,
    [auth.tenantId, periodId]
  );
  return rows;
}

export async function listPayrollExportBatches(client: PoolClient, auth: AuthUser, periodId: string) {
  requirePayrollAdmin(auth);
  const { rows } = await client.query(
    `
      SELECT
        b.id,
        b.export_kind,
        b.status,
        b.row_count,
        b.total_regular_minutes,
        b.total_overtime_minutes,
        b.total_mileage_amount::text,
        b.file_name,
        b.generated_at::text,
        generator.full_name AS generated_by_name
      FROM payroll_export_batch b
      LEFT JOIN app_user generator ON generator.id = b.generated_by_user_id
      WHERE b.tenant_id = $1 AND b.payroll_period_id = $2
      ORDER BY b.generated_at DESC
    `,
    [auth.tenantId, periodId]
  );
  return rows;
}
