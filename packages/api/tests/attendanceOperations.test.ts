import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";

const app = createApp();

let leadershipToken = "";
let seniorToken = "";
let photoToken = "";
let newHireToken = "";
let tenantId = "";
let leadershipId = "";
let seniorId = "";
let photoId = "";
let newHireId = "";

const createdShiftIds: string[] = [];
const createdSettingIds: string[] = [];

function todayString() {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  return value.toISOString().slice(0, 10);
}

function dateStringFor(value: Date) {
  const normalized = new Date(value);
  normalized.setHours(12, 0, 0, 0);
  return normalized.toISOString().slice(0, 10);
}

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60_000);
}

async function insertShift(options: {
  shootId?: string | null;
  assignedUserId: string;
  managerUserId?: string | null;
  department: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  shiftKind?: "shoot" | "studio" | "office" | "training";
  status?: "draft" | "published" | "completed" | "cancelled";
  staffingRole?: string | null;
  satisfiesLeadCoverage?: boolean;
}) {
  const shift = (
    await pool.query(
      `
        INSERT INTO work_shift (
          tenant_id, shoot_id, assigned_user_id, manager_user_id, created_by_user_id, published_by_user_id,
          shift_kind, status, department, title, starts_at, ends_at, location_name, location_address,
          staffing_role, satisfies_lead_coverage, published_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7::work_shift_kind,$8::work_shift_status,$9,$10,$11,$12,'Attendance Test','123 Test Street',
          $13::staffing_role_code,$14,
          CASE WHEN $8::work_shift_status = 'published' THEN now() ELSE NULL END
        )
        RETURNING id, assigned_user_id
      `,
      [
        tenantId,
        options.shootId ?? null,
        options.assignedUserId,
        options.managerUserId ?? null,
        leadershipId,
        leadershipId,
        options.shiftKind ?? "shoot",
        options.status ?? "published",
        options.department,
        `${options.title}-${randomUUID().slice(0, 8)}`,
        options.startsAt,
        options.endsAt,
        options.staffingRole ?? "photographer",
        options.satisfiesLeadCoverage ?? false
      ]
    )
  ).rows[0];

  await pool.query(
    `
      INSERT INTO shift_segment (
        tenant_id, shift_id, segment_kind, label, scheduled_start_at, scheduled_end_at, rate_code, hourly_rate_cents, sort_order
      )
      VALUES ($1,$2,'shoot','Primary coverage',$3,$4,'shoot',2500,0)
    `,
    [tenantId, shift.id, options.startsAt, options.endsAt]
  );

  createdShiftIds.push(shift.id);
  return shift;
}

async function insertAttendanceTimingSetting(options: {
  department: string;
  settingKey: string;
  value: number;
  requestedByUserId?: string;
}) {
  const setting = await pool.query<{ id: string }>(
    `
      INSERT INTO admin_setting_value (
        tenant_id,
        setting_key,
        setting_category,
        scope_type,
        scope_id,
        scope_label,
        value,
        value_type,
        status,
        requires_approval,
        is_override,
        effective_at,
        requested_by_user_id,
        approved_by_user_id,
        approved_at,
        reason,
        impact_snapshot,
        metadata
      )
      VALUES (
        $1,
        $2,
        'attendance_time_rules'::admin_setting_category,
        'department'::admin_setting_scope_type,
        $3,
        $4,
        $5::jsonb,
        'number',
        'approved'::admin_setting_status,
        false,
        true,
        now() - interval '1 minute',
        $6,
        $6,
        now() - interval '1 minute',
        $7,
        '{}'::jsonb,
        '{}'::jsonb
      )
      RETURNING id
    `,
    [
      tenantId,
      options.settingKey,
      options.department,
      `${options.department} Department`,
      JSON.stringify(options.value),
      options.requestedByUserId ?? leadershipId,
      `Attendance operations test override for ${options.settingKey}.`
    ]
  );
  createdSettingIds.push(setting.rows[0].id);
}

async function insertTimeClockStart(options: {
  shiftId: string;
  employeeId: string;
  shootId?: string | null;
  startedAt: Date;
}) {
  const workDate = dateStringFor(options.startedAt);
  await pool.query(
    `
      UPDATE time_session
      SET status = 'closed'::time_session_status,
          updated_at = now()
      WHERE tenant_id = $1
        AND employee_id = $2
        AND work_date = $3::date
        AND status = 'open'::time_session_status
    `,
    [tenantId, options.employeeId, workDate]
  );

  const session = await pool.query<{ id: string }>(
    `
      INSERT INTO time_session (tenant_id, employee_id, work_date, source_shift_id, status)
      VALUES ($1,$2,$3::date,$4,'open'::time_session_status)
      RETURNING id
    `,
    [tenantId, options.employeeId, workDate, options.shiftId]
  );

  await pool.query(
    `
      INSERT INTO time_segment (
        tenant_id,
        session_id,
        employee_id,
        work_state,
        linked_shift_id,
        linked_shoot_id,
        start_time,
        source_type,
        review_status
      )
      VALUES (
        $1,$2,$3,
        'photography'::time_work_state,
        $4,$5,$6,
        'manual'::time_segment_source_type,
        'not_required'::time_segment_review_status
      )
    `,
    [tenantId, session.rows[0].id, options.employeeId, options.shiftId, options.shootId ?? null, options.startedAt]
  );
}

beforeAll(async () => {
  const tenant = await pool.query("SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
  tenantId = tenant.rows[0].id;

  const people = await pool.query(
    `
      SELECT email, id
      FROM app_user
      WHERE tenant_id = $1
        AND email IN ('leadership@example.com', 'senior@example.com', 'photo@example.com', 'newhire@example.com')
    `,
    [tenantId]
  );

  leadershipId = people.rows.find((row) => row.email === "leadership@example.com")?.id;
  seniorId = people.rows.find((row) => row.email === "senior@example.com")?.id;
  photoId = people.rows.find((row) => row.email === "photo@example.com")?.id;
  newHireId = people.rows.find((row) => row.email === "newhire@example.com")?.id;

  leadershipToken = (await request(app).post("/auth/login").send({ email: "leadership@example.com", password: "LocalDemo123!" })).body.token;
  seniorToken = (await request(app).post("/auth/login").send({ email: "senior@example.com", password: "LocalDemo123!" })).body.token;
  photoToken = (await request(app).post("/auth/login").send({ email: "photo@example.com", password: "LocalDemo123!" })).body.token;
  newHireToken = (await request(app).post("/auth/login").send({ email: "newhire@example.com", password: "LocalDemo123!" })).body.token;
});

afterAll(async () => {
  if (createdShiftIds.length) {
    await pool.query("DELETE FROM attendance_exception WHERE shift_id = ANY($1::uuid[])", [createdShiftIds]);
    await pool.query("DELETE FROM shift_attendance_history WHERE shift_id = ANY($1::uuid[])", [createdShiftIds]);
    await pool.query("DELETE FROM shift_attendance_runtime WHERE shift_id = ANY($1::uuid[])", [createdShiftIds]);
    await pool.query("DELETE FROM shift_punch WHERE shift_id = ANY($1::uuid[])", [createdShiftIds]);
    await pool.query("DELETE FROM time_segment WHERE linked_shift_id = ANY($1::uuid[])", [createdShiftIds]);
    await pool.query("DELETE FROM time_session WHERE source_shift_id = ANY($1::uuid[])", [createdShiftIds]);
    await pool.query("DELETE FROM shift_segment WHERE shift_id = ANY($1::uuid[])", [createdShiftIds]);
    await pool.query("DELETE FROM app_event WHERE aggregate_id = ANY($1::uuid[])", [createdShiftIds]);
    await pool.query("DELETE FROM work_shift WHERE id = ANY($1::uuid[])", [createdShiftIds]);
  }

  if (createdSettingIds.length) {
    await pool.query("DELETE FROM admin_setting_value WHERE id = ANY($1::uuid[])", [createdSettingIds]);
  }
});

describe("attendance operations", () => {
  it("respects department timing rules when evaluating scheduled assignments", async () => {
    const department = "sports";
    await insertAttendanceTimingSetting({
      department,
      settingKey: "attendance_time.awareness_window_minutes",
      value: 10
    });

    const startsAt = addMinutes(new Date(), 15);
    const shift = await insertShift({
      shootId: null,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department,
      title: "AttendanceTimingRule",
      startsAt,
      endsAt: addMinutes(startsAt, 120),
      staffingRole: "photographer"
    });

    const detailResponse = await request(app)
      .get(`/api/attendance/operations/${shift.id}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.item.current_state).toBe("scheduled");
  });

  it("derives live attendance state, escalation, staffing impact, and scheduling deep links from shifts", async () => {
    const startsAt = addMinutes(new Date(), -26);
    const endsAt = addMinutes(startsAt, 120);
    const shift = await insertShift({
      shootId: null,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "schools",
      title: "AttendanceCoverageRisk",
      startsAt,
      endsAt,
      staffingRole: "lead_photographer",
      satisfiesLeadCoverage: true
    });

    const workspaceResponse = await request(app)
      .get(`/api/attendance/operations?date=${todayString()}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(workspaceResponse.status).toBe(200);
    const workspace = workspaceResponse.body as {
      home_ready_summary: { visible: boolean; items: Array<{ shift_id: string }> };
      sections: Array<{ items: Array<{ shift_id: string; current_state: string; escalation_level: number; coverage_impact: boolean; critical_role_missing: boolean; scheduling_hash: string | null; alert_labels: string[] }> }>;
    };

    const item = workspace.sections.flatMap((section) => section.items).find((row) => row.shift_id === shift.id);
    expect(item).toBeTruthy();
    expect(item?.current_state).toBe("no_show");
    expect(item?.escalation_level).toBeGreaterThanOrEqual(3);
    expect(item?.coverage_impact).toBe(true);
    expect(item?.critical_role_missing).toBe(true);
    expect(item?.scheduling_hash).toContain("#scheduling?");
    expect(item?.alert_labels).toContain("No Show");
    expect(workspace.home_ready_summary.visible).toBe(true);
    expect(workspace.home_ready_summary.staffing_risk_count).toBeGreaterThan(0);
    expect(workspace.home_ready_summary.urgent_count).toBeGreaterThan(0);

    const detailResponse = await request(app)
      .get(`/api/attendance/operations/${shift.id}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.staffing_impact.coverage_impact).toBe(true);
    expect(detailResponse.body.staffing_impact.scheduling_hash).toContain("#scheduling?");
  });

  it("accepts punch signals and manager actions while persisting live attendance history", async () => {
    const checkInShift = await insertShift({
      shootId: null,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "schools",
      title: "AttendanceCheckIn",
      startsAt: addMinutes(new Date(), 3),
      endsAt: addMinutes(new Date(), 123),
      staffingRole: "photographer"
    });

    const punchResponse = await request(app)
      .post("/api/attendance/punches")
      .set("Authorization", `Bearer ${photoToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({
        shift_id: checkInShift.id,
        direction: "in",
        client_timestamp: new Date().toISOString(),
        latitude: 44.9778,
        longitude: -93.2649,
        accuracy_meters: 5,
        client_event_id: randomUUID(),
        confirmed_outside_context: true,
        reason_code: "gps_issue",
        notes: "Attendance operations test confirms the isolated non-shoot context."
      });

    expect(punchResponse.status).toBe(201);

    const checkedInDetail = await request(app)
      .get(`/api/attendance/operations/${checkInShift.id}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(checkedInDetail.status).toBe(200);
    expect(checkedInDetail.body.item.current_state).toBe("checked_in");
      expect(checkedInDetail.body.item.signal_source).toBe("time_clock_start");

    const replacementShift = await insertShift({
      shootId: null,
      assignedUserId: newHireId,
      managerUserId: seniorId,
      department: "schools",
      title: "AttendanceReplacement",
      startsAt: addMinutes(new Date(), -18),
      endsAt: addMinutes(new Date(), 102),
      staffingRole: "check_in"
    });

    const actionResponse = await request(app)
      .post(`/api/attendance/operations/${replacementShift.id}/actions`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        action: "request_replacement",
        note: "Coverage is now at risk and needs a same-day fill."
      });

    expect(actionResponse.status).toBe(200);
    expect(actionResponse.body.item.current_state).toBe("replacement_needed");
    expect(actionResponse.body.staffing_impact.coverage_impact).toBe(true);
    expect(
      actionResponse.body.history.some(
        (event: { event_type: string; note: string | null }) =>
          event.event_type === "replacement_requested" && String(event.note ?? "").includes("Coverage is now at risk")
      )
    ).toBe(true);
  });

  it("derives time-clock start signals without mutating history on read", async () => {
    const startsAt = addMinutes(new Date(), -8);
    const shift = await insertShift({
      shootId: null,
      assignedUserId: newHireId,
      managerUserId: seniorId,
      department: "schools",
      title: "AttendanceTimeClockSignal",
      startsAt,
      endsAt: addMinutes(startsAt, 120),
      staffingRole: "photographer"
    });

    await insertTimeClockStart({
      shiftId: shift.id,
      employeeId: newHireId,
      shootId: null,
      startedAt: addMinutes(startsAt, 7)
    });

    const detailResponse = await request(app)
      .get(`/api/attendance/operations/${shift.id}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.item.current_state).toBe("late");
    expect(detailResponse.body.item.signal_source).toBe("time_clock_start");
    expect(detailResponse.body.item.latest_time_clock_start_at).toBeTruthy();
    expect(detailResponse.body.item.alert_labels).toContain("Late");
  });

  it("scopes attendance operations to own assignments for standard employees", async () => {
    const visibleShift = await insertShift({
      shootId: null,
      assignedUserId: photoId,
      managerUserId: seniorId,
      department: "schools",
      title: "AttendanceOwnScopeVisible",
      startsAt: addMinutes(new Date(), -18),
      endsAt: addMinutes(new Date(), 102)
    });
    const hiddenShift = await insertShift({
      shootId: null,
      assignedUserId: newHireId,
      managerUserId: seniorId,
      department: "schools",
      title: "AttendanceOwnScopeHidden",
      startsAt: addMinutes(new Date(), -18),
      endsAt: addMinutes(new Date(), 102)
    });

    const response = await request(app)
      .get(`/api/attendance/operations?date=${todayString()}`)
      .set("Authorization", `Bearer ${photoToken}`);

    expect(response.status).toBe(200);
    const items = response.body.sections.flatMap((section: { items: Array<{ shift_id: string }> }) => section.items);
    expect(items.some((item: { shift_id: string }) => item.shift_id === visibleShift.id)).toBe(true);
    expect(items.some((item: { shift_id: string }) => item.shift_id === hiddenShift.id)).toBe(false);
  });
});
