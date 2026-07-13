import type { PoolClient } from "pg";
import { ensurePayrollPeriodForDate } from "../src/services/payrollPeriods.js";
import { openSelfCheckForPeriod } from "../src/services/payrollSelfCheck.js";
import { syncTimeSessionPayrollSummary } from "../src/services/timeClockPayroll.js";

// MC-AUDIT-017 — the migration-165/166 labor stack had zero seed data, so the
// Labor Command Center, Payroll Self-Check, Payroll Review, and the operations
// dashboard's canonical-hours reconciliation all demoed as empty shells while the
// seeds wrote only legacy shift_punch/time_entry rows.
//
// This seed writes CANONICAL labor truth only (time_session/time_segment +
// payroll summaries via the single-writer service) and drives the payroll-period
// and self-check lifecycle through the real services, never by hand-writing
// lifecycle state. It never touches legacy tables.
//
// Idempotent by construction: sessions are derived from work shifts that do not
// already have one; every direct INSERT is guarded by NOT EXISTS / ON CONFLICT.
// Safe to run against a fresh reset AND against a long-lived dev database.

type SeedSummary = {
  sessions_created: number;
  employees_covered: number;
  payroll_period_id: string | null;
  payroll_period_status: string | null;
  self_check_seeded: number;
  discrepancy_stories: number;
  mileage_rows: number;
  overtime_warnings: number;
};

const MAX_EMPLOYEES = 8;
const MAX_SESSIONS_PER_EMPLOYEE = 4;

export async function seedLaborCommandCenter(client: PoolClient, tenantId: string): Promise<SeedSummary> {
  const summary: SeedSummary = {
    sessions_created: 0,
    employees_covered: 0,
    payroll_period_id: null,
    payroll_period_status: null,
    self_check_seeded: 0,
    discrepancy_stories: 0,
    mileage_rows: 0,
    overtime_warnings: 0
  };

  // 1. Real shifts from the current week that have no canonical session yet.
  //    Linking sessions to their shift (source_shift_id) is what makes the
  //    operations dashboard's hours reconciliation comparable instead of
  //    canonical_unavailable.
  const { rows: candidateShifts } = await client.query<{
    id: string;
    assigned_user_id: string;
    starts_at: string;
    ends_at: string;
    work_date: string;
  }>(
    `
      SELECT ws.id, ws.assigned_user_id, ws.starts_at, ws.ends_at, ws.starts_at::date::text AS work_date
      FROM work_shift ws
      WHERE ws.tenant_id = $1
        AND ws.starts_at::date BETWEEN CURRENT_DATE - 6 AND CURRENT_DATE
        AND ws.status <> 'cancelled'
        AND NOT EXISTS (
          SELECT 1 FROM time_session ts
          WHERE ts.tenant_id = ws.tenant_id AND ts.source_shift_id = ws.id
        )
      ORDER BY ws.assigned_user_id, ws.starts_at
    `,
    [tenantId]
  );

  const byEmployee = new Map<string, typeof candidateShifts>();
  for (const shift of candidateShifts) {
    const list = byEmployee.get(shift.assigned_user_id) ?? [];
    if (byEmployee.size >= MAX_EMPLOYEES && !byEmployee.has(shift.assigned_user_id)) continue;
    if (list.length >= MAX_SESSIONS_PER_EMPLOYEE) continue;
    list.push(shift);
    byEmployee.set(shift.assigned_user_id, list);
  }

  const sessionDates = new Map<string, string[]>(); // employee -> work_dates seeded
  const createdSessionIds: string[] = [];

  for (const [employeeId, shifts] of byEmployee) {
    for (const shift of shifts) {
      const session = await client.query<{ id: string }>(
        `
          INSERT INTO time_session (tenant_id, employee_id, work_date, source_shift_id, status)
          VALUES ($1, $2, $3::date, $4, 'closed')
          RETURNING id
        `,
        [tenantId, employeeId, shift.work_date, shift.id]
      );
      const sessionId = session.rows[0].id;
      createdSessionIds.push(sessionId);
      // Pre-session drive, then the session itself — the two segment shapes the
      // self-check day view and payroll summaries are built to read.
      await client.query(
        `
          INSERT INTO time_segment (tenant_id, session_id, employee_id, work_state, start_time, end_time, pay_code)
          VALUES
            ($1, $2, $3, 'office_drive', $4::timestamptz - interval '25 minutes', $4::timestamptz, 'travel_pre_session'),
            ($1, $2, $3, 'photography', $4::timestamptz, $5::timestamptz, 'session_labor')
        `,
        [tenantId, sessionId, employeeId, shift.starts_at, shift.ends_at]
      );
      await syncTimeSessionPayrollSummary(client, { tenantId, sessionId });
      summary.sessions_created += 1;
      const dates = sessionDates.get(employeeId) ?? [];
      dates.push(shift.work_date);
      sessionDates.set(employeeId, dates);
    }
  }
  summary.employees_covered = byEmployee.size;

  // 2. One payroll period covering today, sessions attached, self-check window open.
  const period = await ensurePayrollPeriodForDate(client, tenantId, new Date().toISOString().slice(0, 10));
  summary.payroll_period_id = period.id;
  await client.query(
    `
      UPDATE time_session SET payroll_period_id = $2, updated_at = now()
      WHERE tenant_id = $1 AND payroll_period_id IS NULL
        AND work_date BETWEEN $3::date AND $4::date
    `,
    [tenantId, period.id, period.period_start, period.period_end]
  );
  try {
    const opened = await openSelfCheckForPeriod(client, tenantId, period.id, null);
    summary.self_check_seeded = opened.seeded_employee_count;
  } catch {
    // The period has already advanced past self_check_open in this database —
    // an honest state; never force the lifecycle backwards from a seed.
  }
  const periodStatus = await client.query<{ status: string }>(
    `SELECT status FROM payroll_period WHERE tenant_id = $1 AND id = $2`,
    [tenantId, period.id]
  );
  summary.payroll_period_status = periodStatus.rows[0]?.status ?? null;

  // 3. Two self-check discrepancy stories so the manager board has real work.
  const employees = [...sessionDates.keys()];
  const discrepancyPlans = [
    { employee: employees[0], response: "missing_punch" },
    { employee: employees[1], response: "no_break_taken" }
  ].filter((plan): plan is { employee: string; response: string } => Boolean(plan.employee));
  for (const plan of discrepancyPlans) {
    const workDate = sessionDates.get(plan.employee)?.[0];
    if (!workDate) continue;
    const selfCheck = await client.query<{ id: string }>(
      `SELECT id FROM payroll_self_check WHERE tenant_id = $1 AND payroll_period_id = $2 AND employee_id = $3`,
      [tenantId, period.id, plan.employee]
    );
    const selfCheckId = selfCheck.rows[0]?.id;
    if (!selfCheckId) continue;
    const inserted = await client.query(
      `
        INSERT INTO payroll_self_check_item (tenant_id, self_check_id, work_date, response, note)
        SELECT $1, $2, $3::date, $4, 'Seeded demo discrepancy — review from the Labor Command Center.'
        WHERE NOT EXISTS (
          SELECT 1 FROM payroll_self_check_item
          WHERE tenant_id = $1 AND self_check_id = $2 AND work_date = $3::date AND response = $4
        )
      `,
      [tenantId, selfCheckId, workDate, plan.response]
    );
    if ((inserted.rowCount ?? 0) > 0) {
      await client.query(
        `UPDATE payroll_self_check SET status = 'discrepancy_reported', updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, selfCheckId]
      );
      summary.discrepancy_stories += 1;
    }
  }

  // 4. Mileage rows in mixed, honest states (unique per employee+date).
  const mileagePlans = [
    { employee: employees[0], status: "candidate", vehicle: "personal_vehicle", reason: null, miles: 18.4, amount: 12.88 },
    { employee: employees[1], status: "review_required", vehicle: null, reason: "missing_post_shoot_evaluation", miles: 22.6, amount: 0 },
    { employee: employees[2], status: "ineligible", vehicle: "company_vehicle", reason: "company_vehicle", miles: 15.1, amount: 0 }
  ].filter((plan) => Boolean(plan.employee));
  for (const plan of mileagePlans) {
    const workDate = sessionDates.get(plan.employee as string)?.[0];
    if (!workDate) continue;
    const inserted = await client.query(
      `
        INSERT INTO mileage_reimbursement
          (tenant_id, employee_id, work_date, studio_distance_miles, reimbursement_amount, vehicle_type, status, review_reason_code)
        VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8)
        ON CONFLICT (tenant_id, employee_id, work_date) DO NOTHING
      `,
      [tenantId, plan.employee, workDate, plan.miles, plan.amount, plan.vehicle, plan.status, plan.reason]
    );
    summary.mileage_rows += inserted.rowCount ?? 0;
  }

  // 5. Two live overtime warnings for the current workweek.
  const warningPlans = [
    { employee: employees[0], type: "approaching_overtime", severity: "warning", actual: 2130, projected: 2340, threshold: 2280 },
    { employee: employees[1], type: "in_overtime", severity: "critical", actual: 2520, projected: 2580, threshold: 2400 }
  ].filter((plan) => Boolean(plan.employee));
  for (const plan of warningPlans) {
    const inserted = await client.query(
      `
        INSERT INTO overtime_warning
          (tenant_id, employee_id, workweek_start, warning_type, severity, status, actual_minutes, projected_minutes, threshold_minutes, details)
        SELECT $1, $2, date_trunc('week', CURRENT_DATE)::date, $3, $4, 'active', $5, $6, $7,
               '{"source":"seed-labor-command-center"}'::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM overtime_warning
          WHERE tenant_id = $1 AND employee_id = $2 AND workweek_start = date_trunc('week', CURRENT_DATE)::date
            AND warning_type = $3 AND status <> 'resolved'
        )
      `,
      [tenantId, plan.employee, plan.type, plan.severity, plan.actual, plan.projected, plan.threshold]
    );
    summary.overtime_warnings += inserted.rowCount ?? 0;
  }

  return summary;
}

// Standalone entry point: enrich the CURRENT database without a destructive
// reset (the full reset path also runs this via scripts/seed.ts).
async function main() {
  const { pool } = await import("../src/db/pool.js");
  const client = await pool.connect();
  try {
    const tenant = await client.query(`SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1`);
    if (tenant.rows.length === 0) {
      throw new Error("Demo Studio tenant not found — run the base seed first.");
    }
    const tenantId = tenant.rows[0].id as string;
    await client.query("BEGIN");
    await client.query("SELECT app.set_context($1::uuid, NULL::uuid)", [tenantId]);
    const summary = await seedLaborCommandCenter(client, tenantId);
    await client.query("COMMIT");
    console.log(JSON.stringify({ labor_command_center_seed: summary }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const isDirectRun = process.argv[1]?.replace(/\\/g, "/").endsWith("seed-labor-command-center.ts");
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
