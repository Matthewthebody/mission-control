import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { pool } from "../src/db/pool.js";
import { devLogin, elevateSession, getMembershipId } from "./helpers.js";

// Labor Command Center — bi-weekly configurable pay periods, payroll self-check,
// break/no-break claims, 38h overtime engine with scheduled-hour projection,
// owner_review gating, lock enforcement, post-lock edit flagging, pay-code mapped
// QuickBooks scaffolding with duplicate prevention, and the internal sweep.
// Runs against the seeded demo DB; beforeAll clears labor-command state for the
// tenant so the suite is re-runnable.

const app = createApp();
let leadershipToken = "";
let employeeToken = "";
let ownerToken = "";
let tenantId = "";
let employeeId = "";
let leadershipId = "";
let periodStart = "";
let periodEnd = "";
let periodId = "";
let syntheticSessionId = "";
let noBreakExceptionRequestId: string | null = null;
// Pre-existing demo blockers neutralized for the clean-lock step (restored in afterAll):
// the seeded demo tenant carries open exception requests and pending geofence punches
// inside the current period, and the lock CORRECTLY refuses while any exist — the test
// must own the whole window, not just its own fixture.
let parkedExceptionRequests: Array<{ id: string; status: string; reviewed_at: string | null }> = [];
let parkedGeofencePunches: Array<{ id: string; approval_state: string }> = [];

// Mirrors the server-side default calendar (payroll_calendar_config defaults):
// bi-weekly periods anchored at Monday 2026-06-29.
const DEFAULT_REFERENCE_START = "2026-06-29";
const DEFAULT_PERIOD_LENGTH_DAYS = 14;

function parseDateOnly(value: string) {
  return new Date(`${value}T12:00:00`);
}

function formatDateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentBiWeeklyBounds() {
  const anchor = parseDateOnly(formatDateOnly(new Date()));
  const reference = parseDateOnly(DEFAULT_REFERENCE_START);
  const daysSince = Math.floor((anchor.getTime() - reference.getTime()) / 86_400_000);
  const periodIndex = Math.floor(daysSince / DEFAULT_PERIOD_LENGTH_DAYS);
  const start = new Date(reference.getTime());
  start.setDate(start.getDate() + periodIndex * DEFAULT_PERIOD_LENGTH_DAYS);
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + DEFAULT_PERIOD_LENGTH_DAYS - 1);
  return { start: formatDateOnly(start), end: formatDateOnly(end) };
}

function authed(method: "get" | "post" | "put", path: string, token: string) {
  return request(app)[method](path).set("Authorization", `Bearer ${token}`);
}

beforeAll(async () => {
  leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;
  employeeToken = (await devLogin(app, "photo@example.com")).body.token;
  ownerToken = (await devLogin(app, "matthew@example.com")).body.token;
  // Manual time adjustments run through the dangerous-action flow, which requires
  // an elevated session.
  await elevateSession(app, leadershipToken);
  employeeId = (await getMembershipId("photo@example.com")) as string;
  leadershipId = (await getMembershipId("leadership@example.com")) as string;
  const tenantRow = await pool.query<{ tenant_id: string }>(
    "SELECT tenant_id FROM app_user WHERE id = $1 LIMIT 1",
    [employeeId]
  );
  tenantId = tenantRow.rows[0].tenant_id;

  const bounds = currentBiWeeklyBounds();
  periodStart = bounds.start;
  periodEnd = bounds.end;

  // Re-runnable: clear labor-command state for this tenant. payroll_period cascades
  // its events, self-checks, items, and export batches.
  await pool.query("DELETE FROM payroll_period WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM payroll_calendar_config WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM overtime_warning WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM overtime_policy WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM quickbooks_connection WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM quickbooks_employee_mapping WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM quickbooks_pay_type_mapping WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM quickbooks_sync_log WHERE tenant_id = $1", [tenantId]);
  await pool.query("DELETE FROM exception_request WHERE tenant_id = $1 AND 'payroll_self_check' = ANY(reporting_flags)", [tenantId]);
  await pool.query("DELETE FROM work_shift WHERE tenant_id = $1 AND title = 'LCC-TEST-FUTURE-SHIFT'", [tenantId]);
  // The overtime endpoints aggregate the current WORKWEEK, so the synthetic
  // session must land in it — periodStart drifts out of the workweek during the
  // second week of every bi-weekly period. Today is always in both windows.
  const sessionDate = new Date().toLocaleDateString("en-CA");
  await pool.query(
    "DELETE FROM time_session WHERE tenant_id = $1 AND employee_id = $2 AND work_date = $3::date AND source_shift_id IS NULL",
    [tenantId, employeeId, sessionDate]
  );

  // Synthetic canonical labor: one closed 8.5h session inside the current workweek.
  const sessionRow = await pool.query<{ id: string }>(
    `INSERT INTO time_session (tenant_id, employee_id, work_date, status) VALUES ($1, $2, $3::date, 'closed') RETURNING id`,
    [tenantId, employeeId, sessionDate]
  );
  syntheticSessionId = sessionRow.rows[0].id;
  const startTime = new Date(`${sessionDate}T09:00:00`).toISOString();
  const endTime = new Date(`${sessionDate}T17:30:00`).toISOString();
  await pool.query(
    `
      INSERT INTO time_segment (tenant_id, session_id, employee_id, work_state, start_time, end_time, source_type, review_status)
      VALUES ($1, $2, $3, 'photography', $4, $5, 'manual', 'not_required')
    `,
    [tenantId, sessionRow.rows[0].id, employeeId, startTime, endTime]
  );
});

afterAll(async () => {
  // Restore the demo blockers parked for the clean-lock step — the seeded demo data
  // must leave this suite exactly as it found it.
  for (const row of parkedExceptionRequests) {
    await pool.query(`UPDATE exception_request SET status = $2, reviewed_at = $3 WHERE id = $1`, [
      row.id,
      row.status,
      row.reviewed_at
    ]);
  }
  for (const row of parkedGeofencePunches) {
    await pool.query(`UPDATE shift_punch SET approval_state = $2 WHERE id = $1`, [row.id, row.approval_state]);
  }
  await pool.query("DELETE FROM work_shift WHERE tenant_id = $1 AND title = 'LCC-TEST-FUTURE-SHIFT'", [tenantId]);
});

describe("Labor Command Center", () => {
  it("employee sees an honest not-open state before any period exists", async () => {
    const res = await authed("get", "/api/labor/self-check/current", employeeToken);
    expect(res.status).toBe(200);
    expect(res.body.window_state).toBe("not_open");
    expect(res.body.period).toBeNull();
  });

  it("internal sweep creates the current BI-WEEKLY period with an auto-scheduled close", async () => {
    const denied = await request(app).post("/api/labor/internal/sweep").send({ tenant_id: tenantId });
    expect(denied.status).toBe(403);

    const swept = await request(app)
      .post("/api/labor/internal/sweep")
      .set("X-PMC-Internal-Secret", config.INTERNAL_SOCKET_SECRET)
      .send({ tenant_id: tenantId });
    expect(swept.status).toBe(200);
    expect(swept.body.tenant_count).toBe(1);

    const periods = await authed("get", "/api/labor/periods", leadershipToken);
    expect(periods.status).toBe(200);
    const current = periods.body.periods.find(
      (period: { period_start: string }) => period.period_start === periodStart
    );
    expect(current).toBeTruthy();
    // Bi-weekly window derived from the configurable calendar (default anchor).
    expect(current.period_end).toBe(periodEnd);
    expect(current.status).toBe("open");
    // Close is auto-scheduled from the configurable close rule — no manual scheduling.
    expect(current.lock_scheduled_at).toBeTruthy();
    expect(current.session_count).toBeGreaterThanOrEqual(1);
    periodId = current.id;
  });

  it("payroll calendar config is readable and configurable (close rule flagged for business verification)", async () => {
    const initial = await authed("get", "/api/labor/calendar-config", leadershipToken);
    expect(initial.status).toBe(200);
    expect(initial.body.config.period_length_days).toBe(14);
    expect(initial.body.config.self_check_window_hours).toBe(24);
    expect(initial.body.config.is_default).toBe(true);

    const updated = await authed("put", "/api/labor/calendar-config", leadershipToken).send({
      self_check_window_hours: 24,
      close_offset_hours: 60
    });
    expect(updated.status).toBe(200);
    expect(updated.body.config.is_default).toBe(false);

    expect((await authed("get", "/api/labor/calendar-config", employeeToken)).status).toBe(403);
  });

  it("employees cannot reach payroll admin or manager surfaces", async () => {
    expect((await authed("get", "/api/labor/periods", employeeToken)).status).toBe(403);
    expect((await authed("get", "/api/labor/quickbooks/status", employeeToken)).status).toBe(403);
    expect((await authed("get", "/api/labor/command-center", employeeToken)).status).toBe(403);
    expect(
      (
        await authed("post", `/api/labor/periods/${periodId}/transition`, employeeToken).send({ to_status: "locked" })
      ).status
    ).toBe(403);
    expect((await request(app).get("/api/labor/self-check/current")).status).toBe(401);
  });

  it("opening the self-check window seeds attestations and shows the employee their days", async () => {
    const opened = await authed("post", `/api/labor/periods/${periodId}/open-self-check`, leadershipToken).send({});
    expect(opened.status).toBe(200);
    expect(opened.body.seeded_employee_count).toBeGreaterThanOrEqual(1);

    const mine = await authed("get", "/api/labor/self-check/current", employeeToken);
    expect(mine.status).toBe(200);
    expect(mine.body.window_state).toBe("open");
    expect(mine.body.period.id).toBe(periodId);
    // Locate THIS suite's synthetic session by id — the shared demo DB (punch
    // bridge, labor seed, other suites) legitimately holds other sessions for
    // this employee on the same date, so first-row-for-the-date is not stable.
    const day = mine.body.days.find((entry: { session_id: string }) => entry.session_id === syntheticSessionId);
    expect(day).toBeTruthy();
    expect(day.total_worked_minutes).toBeGreaterThanOrEqual(500);
    expect(day.clock_in_at).toBeTruthy();
    expect(day.clock_out_at).toBeTruthy();
  });

  it("no-break claims are one-tap (note optional, manager-approved variant recorded); other reports need a note", async () => {
    const missingNote = await authed("post", "/api/labor/self-check/responses", employeeToken).send({
      period_id: periodId,
      work_date: periodStart,
      response: "something_wrong"
    });
    expect(missingNote.status).toBe(400);

    const filed = await authed("post", "/api/labor/self-check/responses", employeeToken).send({
      period_id: periodId,
      work_date: periodStart,
      response: "no_break_taken",
      manager_approved_claimed: true
    });
    expect(filed.status).toBe(201);
    expect(filed.body.linked_exception_request_id).toBeTruthy();
    noBreakExceptionRequestId = filed.body.linked_exception_request_id;

    const requestRow = await pool.query<{ request_type: string; status: string; reporting_flags: string[] }>(
      "SELECT request_type::text, status::text, reporting_flags FROM exception_request WHERE id = $1",
      [noBreakExceptionRequestId]
    );
    expect(requestRow.rows[0].request_type).toBe("lunch_deduction_challenge");
    expect(requestRow.rows[0].status).toBe("submitted");
    expect(requestRow.rows[0].reporting_flags).toContain("manager_approved_claimed");
  });

  it("confirmation is blocked while a report is open; manager resolve unblocks it", async () => {
    const blocked = await authed("post", "/api/labor/self-check/confirm", employeeToken).send({ period_id: periodId });
    expect(blocked.status).toBe(409);

    const board = await authed("get", `/api/labor/periods/${periodId}/self-check-board`, leadershipToken);
    expect(board.status).toBe(200);
    expect(board.body.summary.no_break_claims).toBeGreaterThanOrEqual(1);
    const openItem = board.body.open_items.find((item: { response: string }) => item.response === "no_break_taken");
    expect(openItem).toBeTruthy();
    expect(openItem.manager_approved_claimed).toBe(true);

    const employeeResolve = await authed("post", `/api/labor/self-check/items/${openItem.item_id}/resolve`, employeeToken).send({
      resolution: "resolved"
    });
    expect(employeeResolve.status).toBe(403); // employees cannot resolve their own reports

    const resolved = await authed("post", `/api/labor/self-check/items/${openItem.item_id}/resolve`, leadershipToken).send({
      resolution: "resolved",
      resolution_note: "Break repaid on the time record."
    });
    expect(resolved.status).toBe(200);

    const confirmed = await authed("post", "/api/labor/self-check/confirm", employeeToken).send({ period_id: periodId });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe("confirmed");

    const boardAfter = await authed("get", `/api/labor/periods/${periodId}/self-check-board`, leadershipToken);
    expect(boardAfter.body.summary.confirmed_count).toBeGreaterThanOrEqual(1);
    const row = boardAfter.body.rows.find((entry: { employee_id: string }) => entry.employee_id === employeeId);
    // Pay-code hours roll up per employee (derived from work state when unset).
    expect(row.pay_code_minutes.session_labor).toBeGreaterThanOrEqual(500);
  });

  it("38h company warning fires below the legal threshold and projection includes scheduled hours", async () => {
    // Company warning at 8h, legal threshold at 10h: the 8.5h worked day trips the
    // warning line without crossing the legal threshold.
    const policy = await authed("put", "/api/labor/overtime/policies", leadershipToken).send({
      scope_type: "tenant_default",
      weekly_overtime_threshold_minutes: 600,
      company_warning_threshold_minutes: 480,
      warn_approaching_minutes: 60,
      jurisdiction: "MN"
    });
    expect(policy.status).toBe(200);

    // Future published shift inside the workweek → included in projection.
    const shiftStart = new Date(Date.now() + 60 * 60 * 1000);
    const shiftEnd = new Date(shiftStart.getTime() + 3 * 60 * 60 * 1000);
    await pool.query(
      `
        INSERT INTO work_shift (tenant_id, assigned_user_id, created_by_user_id, shift_kind, status, department, title, starts_at, ends_at, location_name, location_address)
        VALUES ($1, $2, $3, 'studio', 'published', 'operations', 'LCC-TEST-FUTURE-SHIFT', $4, $5, 'Studio', 'Studio HQ')
      `,
      [tenantId, employeeId, leadershipId, shiftStart.toISOString(), shiftEnd.toISOString()]
    );

    const mine = await authed("get", "/api/labor/overtime/mine", employeeToken);
    expect(mine.status).toBe(200);
    expect(mine.body.status.threshold_minutes).toBe(600);
    expect(mine.body.status.company_warning_threshold_minutes).toBe(480);
    expect(mine.body.status.actual_minutes).toBeGreaterThanOrEqual(500);
    expect(mine.body.status.in_overtime).toBe(true);
    expect(mine.body.status.remaining_scheduled_minutes).toBeGreaterThanOrEqual(150);
    expect(mine.body.status.projected_minutes).toBeGreaterThan(mine.body.status.actual_minutes);
    expect(mine.body.status.warnings.some((warning: { warning_type: string }) => warning.warning_type === "in_overtime")).toBe(true);

    const swept = await request(app)
      .post("/api/labor/internal/sweep")
      .set("X-PMC-Internal-Secret", config.INTERNAL_SOCKET_SECRET)
      .send({ tenant_id: tenantId });
    expect(swept.status).toBe(200);

    const warnings = await authed("get", "/api/labor/overtime/warnings", leadershipToken);
    expect(warnings.status).toBe(200);
    const mineWarning = warnings.body.warnings.find(
      (warning: { employee_id: string; warning_type: string }) =>
        warning.employee_id === employeeId && warning.warning_type === "in_overtime"
    );
    expect(mineWarning).toBeTruthy();

    const employeeDenied = await authed("get", "/api/labor/overtime/warnings", employeeToken);
    expect(employeeDenied.status).toBe(403);

    // Manager approves the OT directly — the employee is never hard-blocked.
    const approved = await authed("post", `/api/labor/overtime/warnings/${mineWarning.id}/approve`, leadershipToken).send({});
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");
  });

  it("QuickBooks mappings are pay-code keyed, validated, and duplicate-safe", async () => {
    const payCodes = await authed("get", "/api/labor/pay-codes", leadershipToken);
    expect(payCodes.status).toBe(200);
    const codes = payCodes.body.pay_codes.map((entry: { code: string }) => entry.code);
    for (const expected of [
      "session_labor",
      "travel_post_session",
      "travel_pre_session",
      "studio_admin",
      "training_meeting",
      "manager_adjustment",
      "no_break_adjustment",
      "overtime_candidate"
    ]) {
      expect(codes).toContain(expected);
    }

    const mapped = await authed("put", "/api/labor/quickbooks/employee-mappings", leadershipToken).send({
      employee_id: employeeId,
      quickbooks_employee_id: "QB-EMP-001",
      quickbooks_display_name: "Demo Photographer"
    });
    expect(mapped.status).toBe(200);

    const duplicate = await authed("put", "/api/labor/quickbooks/employee-mappings", leadershipToken).send({
      employee_id: leadershipId,
      quickbooks_employee_id: "QB-EMP-001"
    });
    expect(duplicate.status).toBe(409);

    const badPayCode = await authed("put", "/api/labor/quickbooks/pay-type-mappings", leadershipToken).send({
      pay_code: "not_a_real_code",
      quickbooks_pay_item: "Nope"
    });
    expect(badPayCode.status).toBe(400);

    const payType = await authed("put", "/api/labor/quickbooks/pay-type-mappings", leadershipToken).send({
      pay_code: "session_labor",
      quickbooks_pay_item: "Photography Hourly"
    });
    expect(payType.status).toBe(200);

    const status = await authed("get", "/api/labor/quickbooks/status", leadershipToken);
    expect(status.status).toBe(200);
    expect(status.body.connection.connection_status).toBe("not_connected");
    expect(status.body.employee_mappings.mapped_count).toBeGreaterThanOrEqual(1);
    expect(status.body.pay_type_mappings.mapped_categories).toContain("session_labor");
    expect(status.body.pay_type_mappings.missing_categories).toContain("overtime_candidate");
    expect(status.body.quickbooks_ready).toBe(false); // honest: nothing is connected
  });

  it("owner_review gates the lock: payroll admins prepare, only the owner locks", async () => {
    const toManager = await authed("post", `/api/labor/periods/${periodId}/transition`, leadershipToken).send({
      to_status: "manager_review"
    });
    expect(toManager.status).toBe(200);
    const toPayroll = await authed("post", `/api/labor/periods/${periodId}/transition`, leadershipToken).send({
      to_status: "payroll_review"
    });
    expect(toPayroll.status).toBe(200);

    const earlyExport = await authed("get", `/api/labor/periods/${periodId}/export.csv`, leadershipToken);
    expect(earlyExport.status).toBe(409);

    // Straight payroll_review → locked is no longer a legal transition.
    const skipOwner = await authed("post", `/api/labor/periods/${periodId}/transition`, leadershipToken).send({
      to_status: "locked"
    });
    expect(skipOwner.status).toBe(409);

    const toOwner = await authed("post", `/api/labor/periods/${periodId}/transition`, leadershipToken).send({
      to_status: "owner_review"
    });
    expect(toOwner.status).toBe(200);

    // Leadership (non-owner) cannot lock even from owner_review.
    const leadershipLock = await authed("post", `/api/labor/periods/${periodId}/transition`, leadershipToken).send({
      to_status: "locked"
    });
    expect(leadershipLock.status).toBe(403);

    // The owner's lock is refused while blockers exist (the employee's no-break
    // correction request is still open).
    const blockedLock = await authed("post", `/api/labor/periods/${periodId}/transition`, ownerToken).send({
      to_status: "locked"
    });
    expect(blockedLock.status).toBe(409);
    expect(blockedLock.body.details?.code ?? blockedLock.body.code).toBeDefined();

    await pool.query("UPDATE exception_request SET status = 'approved', reviewed_at = now() WHERE id = $1", [
      noBreakExceptionRequestId
    ]);

    // Neutralize the tenant's PRE-EXISTING demo blockers in this window so the clean-lock
    // assertion tests the lifecycle, not the demo seed. Originals are restored in afterAll.
    const openExceptions = await pool.query<{ id: string; status: string; reviewed_at: string | null }>(
      `SELECT er.id, er.status, er.reviewed_at::text AS reviewed_at
         FROM exception_request er
         LEFT JOIN time_session ts ON ts.id = er.linked_session_id
        WHERE er.tenant_id = $1
          AND er.status IN ('submitted', 'under_review')
          AND COALESCE(ts.work_date, er.submitted_at::date) BETWEEN $2::date AND $3::date`,
      [tenantId, periodStart, periodEnd]
    );
    parkedExceptionRequests = openExceptions.rows;
    if (parkedExceptionRequests.length) {
      await pool.query(
        `UPDATE exception_request SET status = 'approved', reviewed_at = now() WHERE id = ANY($1::uuid[])`,
        [parkedExceptionRequests.map((row) => row.id)]
      );
    }
    const pendingPunches = await pool.query<{ id: string; approval_state: string }>(
      `SELECT id, approval_state FROM shift_punch
        WHERE tenant_id = $1
          AND received_at::date BETWEEN $2::date AND $3::date
          AND geofence_status IN ('outside', 'unknown')
          AND approval_state = 'pending'`,
      [tenantId, periodStart, periodEnd]
    );
    parkedGeofencePunches = pendingPunches.rows;
    if (parkedGeofencePunches.length) {
      await pool.query(`UPDATE shift_punch SET approval_state = 'approved' WHERE id = ANY($1::uuid[])`, [
        parkedGeofencePunches.map((row) => row.id)
      ]);
    }

    const locked = await authed("post", `/api/labor/periods/${periodId}/transition`, ownerToken).send({
      to_status: "locked"
    });
    expect(locked.status).toBe(200);
    expect(locked.body.period.status).toBe("locked");
    expect(locked.body.period.locked_at).toBeTruthy();

    const csv = await authed("get", `/api/labor/periods/${periodId}/export.csv`, leadershipToken);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text.split("\n")[0]).toContain("pay_period_start");

    const batch = await authed("post", `/api/labor/periods/${periodId}/export-batches`, leadershipToken).send({});
    expect(batch.status).toBe(201);
    expect(batch.body.batch.file_name).toContain(periodStart);
    expect(typeof batch.body.csv).toBe("string");

    const batches = await authed("get", `/api/labor/periods/${periodId}/export-batches`, leadershipToken);
    expect(batches.status).toBe(200);
    expect(batches.body.batches.length).toBeGreaterThanOrEqual(1);
  });

  it("QuickBooks sync is owner-only, refuses honestly when not connected, and prevents duplicates", async () => {
    // Not the owner → refused outright.
    const leadershipSync = await authed("post", `/api/labor/periods/${periodId}/quickbooks-sync`, leadershipToken).send({});
    expect(leadershipSync.status).toBe(403);

    // Owner, but QuickBooks is not connected → honest refusal, CSV stays the path.
    const notConnected = await authed("post", `/api/labor/periods/${periodId}/quickbooks-sync`, ownerToken).send({});
    expect(notConnected.status).toBe(409);
    expect(notConnected.body.details?.code).toBe("quickbooks_not_connected");

    // Force a "connected" placeholder + full mappings to exercise the scaffold path.
    await pool.query(
      `INSERT INTO quickbooks_connection (tenant_id, environment, connection_status) VALUES ($1, 'sandbox', 'connected')`,
      [tenantId]
    );
    // Map every employee that has sessions in this period + every pay code so
    // mapping validation passes.
    await pool.query(
      `
        INSERT INTO quickbooks_employee_mapping (tenant_id, employee_id, quickbooks_employee_id)
        SELECT DISTINCT ts.tenant_id, ts.employee_id, 'QB-AUTO-' || ts.employee_id
        FROM time_session ts
        WHERE ts.tenant_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM quickbooks_employee_mapping m
            WHERE m.tenant_id = ts.tenant_id AND m.employee_id = ts.employee_id AND m.active_status = true
          )
      `,
      [tenantId]
    );
    await pool.query(
      `
        INSERT INTO quickbooks_pay_type_mapping (tenant_id, pay_code, quickbooks_pay_item)
        SELECT pc.tenant_id, pc.code, 'QB Item ' || pc.code
        FROM pay_code pc
        WHERE pc.tenant_id = $1 AND pc.active_status = true
          AND NOT EXISTS (
            SELECT 1 FROM quickbooks_pay_type_mapping m
            WHERE m.tenant_id = pc.tenant_id AND m.pay_code = pc.code AND m.active_status = true
          )
      `,
      [tenantId]
    );

    // Scaffold transport: every line fails loudly (transport not implemented) and is
    // logged — nothing pretends to sync.
    const attempt = await authed("post", `/api/labor/periods/${periodId}/quickbooks-sync`, ownerToken).send({});
    expect(attempt.status).toBe(200);
    expect(attempt.body.line_count).toBeGreaterThanOrEqual(1);
    expect(attempt.body.error_count).toBe(attempt.body.line_count);
    expect(attempt.body.success_count).toBe(0);
    expect(attempt.body.results[0].sync_error).toContain("not implemented");

    // Duplicate prevention: simulate one line having succeeded previously — the next
    // send skips it as a duplicate instead of re-sending.
    const firstLine = attempt.body.results[0];
    await pool.query(
      `
        INSERT INTO quickbooks_sync_log (tenant_id, payroll_period_id, employee_id, quickbooks_time_activity_id, sync_status, payload)
        VALUES ($1, $2, $3, 'QB-TA-0001', 'success', $4::jsonb)
      `,
      [
        tenantId,
        periodId,
        firstLine.employee_id,
        JSON.stringify({ external_ref: `mc:${periodId}:${firstLine.employee_id}:${firstLine.pay_code}` })
      ]
    );
    const second = await authed("post", `/api/labor/periods/${periodId}/quickbooks-sync`, ownerToken).send({});
    expect(second.status).toBe(200);
    expect(second.body.duplicate_count).toBeGreaterThanOrEqual(1);

    const log = await authed("get", `/api/labor/periods/${periodId}/quickbooks-sync-log`, leadershipToken);
    expect(log.status).toBe(200);
    expect(log.body.log.length).toBeGreaterThanOrEqual(2);

    // Leave the tenant honestly disconnected again.
    await pool.query(`UPDATE quickbooks_connection SET connection_status = 'not_connected' WHERE tenant_id = $1`, [tenantId]);
  });

  it("locked periods refuse time edits; corrections reopen and flag the session", async () => {
    const adjustment = {
      employee_id: employeeId,
      requested_work_state: "office_drive",
      requested_start_time: new Date(`${periodStart}T10:00:00`).toISOString(),
      requested_end_time: new Date(`${periodStart}T11:00:00`).toISOString(),
      note: "Test adjustment against a locked payroll period."
    };
    const refused = await authed("post", "/api/attendance/time-clock/manual-adjustments", leadershipToken).send(adjustment);
    expect(refused.status).toBe(409);

    const noReason = await authed("post", `/api/labor/periods/${periodId}/transition`, leadershipToken).send({
      to_status: "correction_needed"
    });
    expect(noReason.status).toBe(400);

    const correction = await authed("post", `/api/labor/periods/${periodId}/transition`, leadershipToken).send({
      to_status: "correction_needed",
      reason: "Missing hour discovered after lock."
    });
    expect(correction.status).toBe(200);

    const reopened = await authed("post", `/api/labor/periods/${periodId}/transition`, leadershipToken).send({
      to_status: "payroll_review"
    });
    expect(reopened.status).toBe(200);

    // In payroll_review the edit is allowed but must flag the session honestly.
    const applied = await authed("post", "/api/attendance/time-clock/manual-adjustments", leadershipToken).send(adjustment);
    expect(applied.status).toBeLessThan(300);

    const flagged = await pool.query<{ edited_after_payroll_review: boolean }>(
      `SELECT BOOL_OR(edited_after_payroll_review) AS edited_after_payroll_review
       FROM time_session WHERE tenant_id = $1 AND employee_id = $2 AND payroll_period_id = $3`,
      [tenantId, employeeId, periodId]
    );
    expect(flagged.rows[0].edited_after_payroll_review).toBe(true);

    const board = await authed("get", `/api/labor/periods/${periodId}/self-check-board`, leadershipToken);
    const row = board.body.rows.find((entry: { employee_id: string }) => entry.employee_id === employeeId);
    expect(row.edited_after_review).toBe(true);
  });

  it("command center overview reports the period, blockers, owner access, and export readiness", async () => {
    const overview = await authed("get", "/api/labor/command-center", ownerToken);
    expect(overview.status).toBe(200);
    expect(overview.body.period.id).toBe(periodId);
    expect(overview.body.access.can_manage_periods).toBe(true);
    expect(overview.body.access.can_finalize_payroll).toBe(true);
    expect(overview.body.self_check.employee_count).toBeGreaterThanOrEqual(1);
    expect(overview.body.blockers).toHaveProperty("unresolved_geofence_punches");
    expect(overview.body.blockers.edited_after_review_count).toBeGreaterThanOrEqual(1);
    expect(overview.body.export_readiness.export_batch_count).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(overview.body.recent_events)).toBe(true);
    expect(overview.body.recent_events.length).toBeGreaterThan(0);

    const leadershipView = await authed("get", "/api/labor/command-center", leadershipToken);
    expect(leadershipView.status).toBe(200);
    expect(leadershipView.body.access.can_finalize_payroll).toBe(false);
  });
});
