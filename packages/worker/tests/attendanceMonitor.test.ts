import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db.js";
import { monitorAttendanceForTenant } from "../src/jobs/attendanceMonitor.js";

let tenantId = "";
let demoShootId = "";
let leadershipId = "";
let seniorId = "";
let photoId = "";
let studioId = "";

const TEST_TENANT_NAME = "Attendance Monitor Worker Test Tenant";
const TEST_STUDIO_NAME = "Attendance Monitor Worker Test Studio";
const TEST_BASE_SHOOT_CODE = "ATTNMON-BASE";
const TEST_LEADERSHIP_EMAIL = "attendance-monitor-leadership@example.com";
const TEST_SENIOR_EMAIL = "attendance-monitor-senior@example.com";
const TEST_PHOTO_EMAIL = "attendance-monitor-photo@example.com";

const TEST_SHIFT_TITLES = [
  "PreShiftAndRiskCoverage",
  "LateReminderCoverage",
  "LikelyPresentCoverage",
  "SetupReminderCoverage",
  "NoShowEscalation",
  "AutoCloseCoverage",
  "ReadyToShootReminderCoverage",
  "ReadyToShootMissingCoverage"
] as const;

const TEST_SHOOT_TITLES = [
  "Soon staffing risk",
  "Setup Reminder Shoot",
  "Ready To Shoot Reminder",
  "Ready To Shoot Missing"
] as const;

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60000);
}

async function insertPublishedShift(input: {
  shootId?: string | null;
  assignedUserId: string;
  managerUserId?: string | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  staffingRole?: string | null;
  satisfiesLeadCoverage?: boolean;
}) {
  const result = await pool.query(
    `
      INSERT INTO work_shift (
        tenant_id, shoot_id, assigned_user_id, manager_user_id, created_by_user_id, published_by_user_id,
        shift_kind, status, department, staffing_role, satisfies_lead_coverage, title, starts_at, ends_at, location_name, location_address,
        location_lat, location_lng, geofence_radius_meters, published_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$5,'shoot','published','schools',$6,$7,$8,$9,$10,'Test Location','123 Test Street',
        44.9778,-93.2649,200,now()
      )
      RETURNING *
    `,
    [
      tenantId,
      input.shootId ?? null,
      input.assignedUserId,
      input.managerUserId ?? null,
      leadershipId,
      input.staffingRole ?? "photographer",
      Boolean(input.satisfiesLeadCoverage),
      `${input.title}-${randomUUID().slice(0, 8)}`,
      input.startsAt,
      input.endsAt
    ]
  );
  return result.rows[0];
}

async function insertTestShoot(input: {
  title: string;
  showtime: Date;
  startTime: Date;
  endTime: Date;
}) {
  const result = await pool.query(
    `
      INSERT INTO shoot (
        tenant_id,
        studio_id,
        shoot_code,
        title,
        shoot_date,
        location_name,
        location_address,
        location_lat,
        location_lng,
        geofence_radius_meters,
        navigation_url,
        arrival_time,
        showtime,
        start_time,
        end_time_est,
        projected_students,
        created_by
      )
      VALUES (
        $1,$2,$3,$4,CURRENT_DATE,
        'Reminder Test Venue','200 Reminder Avenue',
        44.9778,-93.2649,200,NULL,$5,$6,$7,$8,24,$9
      )
      RETURNING *
    `,
    [
      tenantId,
      studioId,
      `TEST-${randomUUID().slice(0, 8)}`,
      input.title,
      input.showtime,
      input.showtime,
      input.startTime,
      input.endTime,
      leadershipId
    ]
  );
  return result.rows[0];
}

async function insertOpenComplianceFlag(input: {
  employeeId: string;
  itemType:
    | "missing_setup_photo"
    | "missing_post_shoot_evaluation"
    | "mileage_blocked_missing_post_shoot_evaluation"
    | "upload_while_off_clock"
    | "unresolved_end_of_day_confirmation";
  sessionId?: string | null;
  shiftId?: string | null;
  shootId?: string | null;
  ageMinutes?: number;
}) {
  await pool.query(
    `
      INSERT INTO time_clock_compliance_flag (
        tenant_id,
        employee_id,
        shift_id,
        session_id,
        shoot_id,
        linked_exception_request_id,
        item_type,
        severity,
        status,
        dedupe_key,
        metadata,
        first_detected_at,
        last_detected_at
      )
      VALUES (
        $1,$2,$3,$4,$5,NULL,$6::time_clock_compliance_item,$7::time_clock_compliance_severity,'open',$8,$9::jsonb,
        now() - ($10 || ' minutes')::interval,
        now() - ($10 || ' minutes')::interval
      )
    `,
    [
      tenantId,
      input.employeeId,
      input.shiftId ?? null,
      input.sessionId ?? null,
      input.shootId ?? null,
      input.itemType,
      input.itemType === "unresolved_end_of_day_confirmation" ? "high" : "warning",
      `attendance-monitor-test:${input.itemType}:${randomUUID()}`,
      JSON.stringify({ source: "attendance-monitor-test" }),
      input.ageMinutes ?? 180
    ]
  );
}

async function ensureClonedUser(input: {
  sourceUserId: string;
  email: string;
  fullName: string;
}) {
  const existing = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM app_user
      WHERE tenant_id = $1
        AND email = $2
      LIMIT 1
    `,
    [tenantId, input.email]
  );
  if (existing.rows[0]) {
    return existing.rows[0].id;
  }

  const inserted = await pool.query<{ id: string }>(
    `
      INSERT INTO app_user (
        tenant_id,
        email,
        full_name,
        is_active,
        department,
        status,
        approved_at
      )
      SELECT
        $1,
        $2,
        $3,
        true,
        department,
        'active',
        now()
      FROM app_user
      WHERE id = $4
      RETURNING id
    `,
    [tenantId, input.email, input.fullName, input.sourceUserId]
  );
  const userId = inserted.rows[0].id;

  await pool.query(
    `
      INSERT INTO user_authority_assignment (
        tenant_id,
        user_id,
        authority_tier,
        primary_job_function_profile,
        scope_department,
        scope_overrides,
        assigned_by_user_id
      )
      SELECT
        $1,
        $2,
        authority_tier,
        primary_job_function_profile,
        scope_department,
        scope_overrides,
        NULL
      FROM user_authority_assignment
      WHERE user_id = $3
    `,
    [tenantId, userId, input.sourceUserId]
  );

  await pool.query(
    `
      INSERT INTO user_job_function_profile (tenant_id, user_id, job_function_profile)
      SELECT $1, $2, job_function_profile
      FROM user_job_function_profile
      WHERE user_id = $3
    `,
    [tenantId, userId, input.sourceUserId]
  );

  await pool.query(
    `
      INSERT INTO user_role (tenant_id, user_id, role_id)
      SELECT $1, $2, role_id
      FROM user_role
      WHERE user_id = $3
      ON CONFLICT DO NOTHING
    `,
    [tenantId, userId, input.sourceUserId]
  );

  return userId;
}

beforeAll(async () => {
  const demoTenant = await pool.query("SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
  const demoTenantId = demoTenant.rows[0].id;
  const demoPeople = await pool.query(
    `
      SELECT email, id
      FROM app_user
      WHERE tenant_id = $1
        AND email IN ('leadership@example.com', 'senior@example.com', 'photo@example.com')
    `,
    [demoTenantId]
  );
  const leadershipTemplateId = demoPeople.rows.find((row) => row.email === "leadership@example.com")?.id;
  const seniorTemplateId = demoPeople.rows.find((row) => row.email === "senior@example.com")?.id;
  const photoTemplateId = demoPeople.rows.find((row) => row.email === "photo@example.com")?.id;
  if (!leadershipTemplateId || !seniorTemplateId || !photoTemplateId) {
    throw new Error("Attendance monitor tests could not load the Demo Studio user templates.");
  }

  const existingTenant = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM tenant
      WHERE name = $1
      LIMIT 1
    `,
    [TEST_TENANT_NAME]
  );
  if (existingTenant.rows[0]) {
    tenantId = existingTenant.rows[0].id;
  } else {
    const createdTenant = await pool.query<{ id: string }>(
      `
        INSERT INTO tenant (name)
        VALUES ($1)
        RETURNING id
      `,
      [TEST_TENANT_NAME]
    );
    tenantId = createdTenant.rows[0].id;
  }

  const existingStudio = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM studio
      WHERE tenant_id = $1
        AND name = $2
      LIMIT 1
    `,
    [tenantId, TEST_STUDIO_NAME]
  );
  if (existingStudio.rows[0]) {
    studioId = existingStudio.rows[0].id;
  } else {
    const createdStudio = await pool.query<{ id: string }>(
      `
        INSERT INTO studio (tenant_id, name, latitude, longitude)
        VALUES ($1,$2,44.9778,-93.2649)
        RETURNING id
      `,
      [tenantId, TEST_STUDIO_NAME]
    );
    studioId = createdStudio.rows[0].id;
  }

  leadershipId = await ensureClonedUser({
    sourceUserId: leadershipTemplateId,
    email: TEST_LEADERSHIP_EMAIL,
    fullName: "Attendance Monitor Leadership"
  });
  seniorId = await ensureClonedUser({
    sourceUserId: seniorTemplateId,
    email: TEST_SENIOR_EMAIL,
    fullName: "Attendance Monitor Senior"
  });
  photoId = await ensureClonedUser({
    sourceUserId: photoTemplateId,
    email: TEST_PHOTO_EMAIL,
    fullName: "Attendance Monitor Photographer"
  });

  const baseShoot = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM shoot
      WHERE tenant_id = $1
        AND shoot_code = $2
      LIMIT 1
    `,
    [tenantId, TEST_BASE_SHOOT_CODE]
  );
  if (baseShoot.rows[0]) {
    demoShootId = baseShoot.rows[0].id;
  } else {
    const startAt = addMinutes(new Date(), 5);
    const createdBaseShoot = await pool.query<{ id: string }>(
      `
        INSERT INTO shoot (
          tenant_id,
          studio_id,
          shoot_code,
          title,
          shoot_date,
          location_name,
          location_address,
          location_lat,
          location_lng,
          geofence_radius_meters,
          navigation_url,
          arrival_time,
          showtime,
          start_time,
          end_time_est,
          projected_students,
          created_by
        )
        VALUES (
          $1,$2,$3,'Attendance Monitor Base',CURRENT_DATE,
          'Base Test Venue','100 Base Avenue',44.9778,-93.2649,200,NULL,$4,$4,$4,$5,24,$6
        )
        RETURNING id
      `,
      [tenantId, studioId, TEST_BASE_SHOOT_CODE, startAt, addMinutes(startAt, 120), leadershipId]
    );
    demoShootId = createdBaseShoot.rows[0].id;
  }
});

beforeEach(async () => {
  await pool.query(
    `
      DELETE FROM app_event
      WHERE tenant_id = $1
        AND event_type = 'notification.dispatch'
        AND payload->>'notification_type' IN (
          'attendance.pre_shift_reminder',
          'attendance.staffing_risk_prestart',
          'attendance.clock_in_reminder',
          'attendance.assigned_but_missing',
          'attendance.likely_present_missing_clock_in',
          'attendance.late_clock_in_warning',
          'attendance.late_clock_in',
          'attendance.no_show_suspected',
          'shoot.setup_photo_reminder',
          'shoot.ready_to_shoot_reminder',
          'shoot.ready_to_shoot_missing',
          'attendance.end_of_day_confirmation_escalation',
          'attendance.compliance_digest'
        )
    `,
    [tenantId]
  );

  const shiftTitlePatterns = TEST_SHIFT_TITLES.map((title) => `${title}-%`);
  const shiftIds = (
    await pool.query(
      `
        SELECT id
        FROM work_shift
        WHERE tenant_id = $1
          AND (
            title = ANY($2::text[])
            OR title LIKE ANY($3::text[])
          )
      `,
      [tenantId, TEST_SHIFT_TITLES, shiftTitlePatterns]
    )
  ).rows.map((row) => row.id);

  const shootIds = (
    await pool.query(
      `
        SELECT id
        FROM shoot
        WHERE tenant_id = $1
          AND (
            title = ANY($2::text[])
            OR shoot_code LIKE 'SOON-%'
            OR shoot_code LIKE 'TEST-%'
          )
      `,
      [tenantId, TEST_SHOOT_TITLES]
    )
  ).rows.map((row) => row.id);

  await pool.query(
    `
      DELETE FROM time_clock_compliance_flag
      WHERE tenant_id = $1
        AND (
          dedupe_key LIKE 'attendance-monitor-test:%'
          OR metadata->>'source' = 'during_shoot_reminder'
          OR (cardinality($2::uuid[]) > 0 AND shift_id = ANY($2::uuid[]))
          OR (cardinality($3::uuid[]) > 0 AND shoot_id = ANY($3::uuid[]))
        )
    `,
    [tenantId, shiftIds, shootIds]
  );
  await pool.query(
    `
      DELETE FROM time_clock_presence_incident
      WHERE tenant_id = $1
        AND (cardinality($2::uuid[]) > 0 AND shift_id = ANY($2::uuid[]))
    `,
    [tenantId, shiftIds]
  );
  await pool.query(
    `
      DELETE FROM time_clock_presence_observation
      WHERE tenant_id = $1
        AND employee_id = ANY($2::uuid[])
    `,
    [tenantId, [seniorId, photoId]]
  );
  await pool.query("DELETE FROM clock_event WHERE tenant_id = $1 AND employee_id = ANY($2::uuid[])", [tenantId, [seniorId, photoId]]);
  await pool.query("DELETE FROM time_segment WHERE tenant_id = $1 AND employee_id = ANY($2::uuid[])", [tenantId, [seniorId, photoId]]);
  await pool.query("DELETE FROM time_session WHERE tenant_id = $1 AND employee_id = ANY($2::uuid[])", [tenantId, [seniorId, photoId]]);

  if (shiftIds.length) {
    await pool.query("DELETE FROM time_entry WHERE tenant_id = $1 AND shift_id = ANY($2::uuid[])", [tenantId, shiftIds]);
    await pool.query("DELETE FROM shift_segment WHERE shift_id = ANY($1::uuid[])", [shiftIds]);
    await pool.query("DELETE FROM shift_punch WHERE shift_id = ANY($1::uuid[])", [shiftIds]);
    await pool.query("DELETE FROM attendance_exception WHERE shift_id = ANY($1::uuid[])", [shiftIds]);
    await pool.query("DELETE FROM work_shift WHERE id = ANY($1::uuid[])", [shiftIds]);
  }

  if (shootIds.length) {
    await pool.query("DELETE FROM time_entry WHERE tenant_id = $1 AND shoot_id = ANY($2::uuid[])", [tenantId, shootIds]);
    await pool.query("DELETE FROM status_event WHERE tenant_id = $1 AND shoot_id = ANY($2::uuid[])", [tenantId, shootIds]);
    await pool.query("DELETE FROM shoot WHERE id = ANY($1::uuid[])", [shootIds]);
  }
});

describe("attendance monitor worker", () => {
  it("queues pre-shift reminders and pre-start staffing-risk alerts before a shoot begins", async () => {
    const soonShoot = (
      await pool.query(
        `
          INSERT INTO shoot (
            tenant_id, studio_id, shoot_code, title, shoot_date, location_name, location_address, location_lat, location_lng,
            geofence_radius_meters, navigation_url, arrival_time, start_time, end_time_est, projected_students, created_by
          )
          VALUES (
            $1,$2,$3,'Soon staffing risk',CURRENT_DATE,'Soon Test Venue','100 Test Avenue',44.9778,-93.2649,200,NULL,$4,$5,$6,24,$7
          )
          RETURNING id
        `,
        [tenantId, studioId, `SOON-${randomUUID().slice(0, 8)}`, addMinutes(new Date(), 5), addMinutes(new Date(), 8), addMinutes(new Date(), 120), leadershipId]
      )
    ).rows[0];

    const shift = await insertPublishedShift({
      shootId: soonShoot.id,
      assignedUserId: photoId,
      managerUserId: seniorId,
      title: "PreShiftAndRiskCoverage",
      startsAt: addMinutes(new Date(), 10),
      endsAt: addMinutes(new Date(), 160)
    });

    await monitorAttendanceForTenant(tenantId);

    const events = await pool.query(
      `
        SELECT payload->>'notification_type' AS notification_type
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'notification.dispatch'
          AND payload->>'shift_id' = $2
      `,
      [tenantId, shift.id]
    );

    const types = events.rows.map((row) => row.notification_type);
    expect(types).toContain("attendance.pre_shift_reminder");
    expect(types).toContain("attendance.staffing_risk_prestart");
  }, 60000);

  it("queues employee reminders and Assigned but Missing alerts for true missing coverage", async () => {
    const shift = await insertPublishedShift({
      shootId: demoShootId,
      assignedUserId: photoId,
      managerUserId: seniorId,
      title: "LateReminderCoverage",
      startsAt: addMinutes(new Date(), -15),
      endsAt: addMinutes(new Date(), 90)
    });

    await monitorAttendanceForTenant(tenantId);

    const events = await pool.query(
      `
        SELECT payload->>'notification_type' AS notification_type
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'notification.dispatch'
          AND payload->>'shift_id' = $2
      `,
      [tenantId, shift.id]
    );

    const types = events.rows.map((row) => row.notification_type);
    expect(types).toContain("attendance.clock_in_reminder");
    expect(types).toContain("attendance.assigned_but_missing");

    const incidents = await pool.query(
      `
        SELECT alert_type, resolution_status
        FROM time_clock_presence_incident
        WHERE tenant_id = $1
          AND shift_id = $2
      `,
      [tenantId, shift.id]
    );
    expect(incidents.rows.some((row) => row.alert_type === "assigned_but_missing" && row.resolution_status === "open")).toBe(true);

    const lateAudit = await pool.query(
      `
        SELECT action, metadata->>'exception_type' AS exception_type
        FROM audit_log
        WHERE tenant_id = $1
          AND target_user_id = $2
          AND metadata->>'shift_id' = $3
        ORDER BY created_at DESC
      `,
      [tenantId, photoId, shift.id]
    );
    expect(lateAudit.rows.some((row) => row.action === "attendance.exception.auto_created" && row.exception_type === "LATE_CLOCK_IN_WARNING")).toBe(true);
  }, 60000);

  it("only alerts the shoot leader when the employee is likely present but missing a clock-in", async () => {
    const shift = await insertPublishedShift({
      shootId: demoShootId,
      assignedUserId: photoId,
      managerUserId: seniorId,
      title: "LikelyPresentCoverage",
      startsAt: addMinutes(new Date(), -15),
      endsAt: addMinutes(new Date(), 90)
    });

    await pool.query(
      `
        INSERT INTO time_clock_presence_observation (
          tenant_id,
          employee_id,
          current_state,
          latitude,
          longitude,
          captured_at,
          source_type
        )
        VALUES ($1,$2,'off_clock',44.9805,-93.2629,now(),'location_check')
        ON CONFLICT (tenant_id, employee_id)
        DO UPDATE SET
          current_state = EXCLUDED.current_state,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          captured_at = EXCLUDED.captured_at,
          source_type = EXCLUDED.source_type,
          updated_at = now()
      `,
      [tenantId, photoId]
    );

    await monitorAttendanceForTenant(tenantId);

    const events = await pool.query(
      `
        SELECT payload->>'notification_type' AS notification_type, payload->>'recipient_user_id' AS recipient_user_id
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'notification.dispatch'
          AND payload->>'shift_id' = $2
      `,
      [tenantId, shift.id]
    );

    expect(events.rows.some((row) => row.notification_type === "attendance.likely_present_missing_clock_in")).toBe(true);
    expect(events.rows.some((row) => row.notification_type === "attendance.likely_present_missing_clock_in" && row.recipient_user_id === seniorId)).toBe(true);
    expect(events.rows.some((row) => row.notification_type === "attendance.likely_present_missing_clock_in" && row.recipient_user_id === leadershipId)).toBe(false);

    const incidents = await pool.query(
      `
        SELECT alert_type, geofence_classification
        FROM time_clock_presence_incident
        WHERE tenant_id = $1
          AND shift_id = $2
      `,
      [tenantId, shift.id]
    );
    expect(incidents.rows.some((row) => row.alert_type === "likely_present_missing_clock_in")).toBe(true);
  }, 60000);

  it("reminds the assigned senior coverage user when the Setup Photo is still missing after the threshold", async () => {
    const startsAt = addMinutes(new Date(), -45);
    const endsAt = addMinutes(new Date(), 90);
    const shoot = await insertTestShoot({
      title: "Setup Reminder Shoot",
      showtime: startsAt,
      startTime: startsAt,
      endTime: endsAt
    });
    const shift = (
      await pool.query(
        `
          INSERT INTO work_shift (
            tenant_id, shoot_id, assigned_user_id, manager_user_id, created_by_user_id, published_by_user_id,
            shift_kind, status, department, staffing_role, satisfies_lead_coverage, title, starts_at, ends_at,
            location_name, location_address, location_lat, location_lng, geofence_radius_meters, published_at
          )
          VALUES (
            $1,$2,$3,$4,$5,$5,
            'shoot','published','schools','senior_photographer',true,'SetupReminderCoverage',$6,$7,
            'Test Location','123 Test Street',44.9778,-93.2649,200,now()
          )
          RETURNING *
        `,
        [tenantId, shoot.id, seniorId, leadershipId, leadershipId, startsAt, endsAt]
      )
    ).rows[0];

    await pool.query(
      `
        INSERT INTO shift_punch (
          tenant_id, shift_id, shoot_id, user_id, direction, source, client_timestamp,
          geofence_status, gps_confidence, approval_state
        )
        VALUES ($1,$2,$3,$4,'in','test',$5,'inside','normal','not_required')
      `,
      [tenantId, shift.id, shoot.id, seniorId, addMinutes(startsAt, 5)]
    );

    await monitorAttendanceForTenant(tenantId);

    const events = await pool.query(
      `
        SELECT payload->>'notification_type' AS notification_type, payload->>'recipient_user_id' AS recipient_user_id
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'notification.dispatch'
          AND payload->>'shift_id' = $2
      `,
      [tenantId, shift.id]
    );

    expect(events.rows.some((row) => row.notification_type === "shoot.setup_photo_reminder" && row.recipient_user_id === seniorId)).toBe(true);

    const complianceFlag = await pool.query(
      `
        SELECT item_type::text, status::text, metadata->>'source' AS source
        FROM time_clock_compliance_flag
        WHERE tenant_id = $1
          AND shift_id = $2
          AND item_type = 'missing_setup_photo'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [tenantId, shift.id]
    );

    expect(complianceFlag.rows[0]).toMatchObject({
      item_type: "missing_setup_photo",
      status: "open",
      source: "during_shoot_reminder"
    });
  }, 20000);

  it("routes Ready to Shoot reminders to the lead first and escalates missing confirmations to the manager", async () => {
    const reminderStart = addMinutes(new Date(), 15);
    const reminderShoot = await insertTestShoot({
      title: "Ready To Shoot Reminder",
      showtime: reminderStart,
      startTime: reminderStart,
      endTime: addMinutes(reminderStart, 120)
    });
    const reminderShift = await insertPublishedShift({
      shootId: reminderShoot.id,
      assignedUserId: seniorId,
      managerUserId: leadershipId,
      title: "ReadyToShootReminderCoverage",
      startsAt: addMinutes(reminderStart, -10),
      endsAt: addMinutes(reminderStart, 120),
      staffingRole: "senior_photographer",
      satisfiesLeadCoverage: true
    });

    const missingStart = addMinutes(new Date(), 5);
    const missingShoot = await insertTestShoot({
      title: "Ready To Shoot Missing",
      showtime: missingStart,
      startTime: missingStart,
      endTime: addMinutes(missingStart, 120)
    });
    const missingShift = await insertPublishedShift({
      shootId: missingShoot.id,
      assignedUserId: seniorId,
      managerUserId: leadershipId,
      title: "ReadyToShootMissingCoverage",
      startsAt: addMinutes(missingStart, -10),
      endsAt: addMinutes(missingStart, 120),
      staffingRole: "senior_photographer",
      satisfiesLeadCoverage: true
    });

    await monitorAttendanceForTenant(tenantId);

    const readyToShootEvents = await pool.query(
      `
        SELECT
          payload->>'notification_type' AS notification_type,
          payload->>'recipient_user_id' AS recipient_user_id,
          payload->>'shift_id' AS shift_id
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'notification.dispatch'
          AND payload->>'notification_type' IN ('shoot.ready_to_shoot_reminder', 'shoot.ready_to_shoot_missing')
      `,
      [tenantId]
    );

    expect(
      readyToShootEvents.rows.some(
        (row) =>
          row.notification_type === "shoot.ready_to_shoot_reminder" &&
          row.recipient_user_id === seniorId &&
          row.shift_id === reminderShift.id
      )
    ).toBe(true);
    expect(
      readyToShootEvents.rows.some(
        (row) =>
          row.notification_type === "shoot.ready_to_shoot_missing" &&
          row.recipient_user_id === leadershipId &&
          row.shift_id === missingShift.id
      )
    ).toBe(true);
  }, 20000);

  it("escalates missing punches into missed-clock-in and no-show-suspected states", async () => {
    const shift = await insertPublishedShift({
      shootId: demoShootId,
      assignedUserId: photoId,
      managerUserId: seniorId,
      title: "NoShowEscalation",
      startsAt: addMinutes(new Date(), -90),
      endsAt: addMinutes(new Date(), 30)
    });

    await monitorAttendanceForTenant(tenantId);

    const exceptions = await pool.query(
      `
        SELECT exception_type
        FROM attendance_exception
        WHERE shift_id = $1
      `,
      [shift.id]
    );
    const types = exceptions.rows.map((row) => row.exception_type);
    expect(types).toContain("MISSING_CLOCK_IN");
    expect(types).toContain("NO_SHOW_SUSPECTED");

    const state = await pool.query("SELECT attendance_state FROM work_shift WHERE id = $1", [shift.id]);
    expect(state.rows[0].attendance_state).toBe("no_show_suspected");
  }, 20000);

  it("queues end-of-day escalation and leadership digest notifications without duplicating them on retry", async () => {
    const baselineNotifications = await pool.query(
      `
        SELECT payload->>'notification_type' AS notification_type
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'notification.dispatch'
          AND payload->>'notification_type' IN ('attendance.end_of_day_confirmation_escalation', 'attendance.compliance_digest')
      `,
      [tenantId]
    );
    const baselineDigestCount = baselineNotifications.rows.filter((row) => row.notification_type === "attendance.compliance_digest").length;
    const baselineEscalationCount = baselineNotifications.rows.filter(
      (row) => row.notification_type === "attendance.end_of_day_confirmation_escalation"
    ).length;

    const workDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const session = (
      await pool.query(
        `
          INSERT INTO time_session (tenant_id, employee_id, work_date, status)
          VALUES ($1,$2,$3::date,'needs_end_of_day_confirmation')
          RETURNING id
        `,
        [tenantId, photoId, workDate]
      )
    ).rows[0];

    await insertOpenComplianceFlag({
      employeeId: photoId,
      itemType: "unresolved_end_of_day_confirmation",
      sessionId: session.id,
      ageMinutes: 180
    });
    await insertOpenComplianceFlag({
      employeeId: photoId,
      itemType: "missing_setup_photo",
      ageMinutes: 180
    });
    await insertOpenComplianceFlag({
      employeeId: photoId,
      itemType: "missing_post_shoot_evaluation",
      ageMinutes: 180
    });

    await monitorAttendanceForTenant(tenantId);

    const firstPass = await pool.query(
      `
        SELECT
          payload->>'notification_type' AS notification_type,
          payload->>'recipient_user_id' AS recipient_user_id,
          payload->>'deep_link' AS deep_link
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'notification.dispatch'
          AND payload->>'notification_type' IN ('attendance.end_of_day_confirmation_escalation', 'attendance.compliance_digest')
      `,
      [tenantId]
    );

    expect(firstPass.rows.some((row) => row.notification_type === "attendance.end_of_day_confirmation_escalation")).toBe(true);
    expect(firstPass.rows.some((row) => row.notification_type === "attendance.compliance_digest")).toBe(true);
    expect(firstPass.rows.some((row) => row.notification_type === "attendance.end_of_day_confirmation_escalation" && row.deep_link === "/compliance")).toBe(true);

    const firstDigestCount = firstPass.rows.filter((row) => row.notification_type === "attendance.compliance_digest").length;
    const firstEscalationCount = firstPass.rows.filter((row) => row.notification_type === "attendance.end_of_day_confirmation_escalation").length;
    expect(firstDigestCount).toBeGreaterThan(baselineDigestCount);
    expect(firstEscalationCount).toBeGreaterThan(baselineEscalationCount);

    await monitorAttendanceForTenant(tenantId);

    const secondPass = await pool.query(
      `
        SELECT payload->>'notification_type' AS notification_type
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'notification.dispatch'
          AND payload->>'notification_type' IN ('attendance.end_of_day_confirmation_escalation', 'attendance.compliance_digest')
      `,
      [tenantId]
    );

    expect(secondPass.rows.filter((row) => row.notification_type === "attendance.compliance_digest")).toHaveLength(firstDigestCount);
    expect(secondPass.rows.filter((row) => row.notification_type === "attendance.end_of_day_confirmation_escalation")).toHaveLength(
      firstEscalationCount
    );
  }, 60000);

  it("auto-closes stale shifts after 45 minutes and creates a review exception", async () => {
    const startsAt = addMinutes(new Date(), -180);
    const endsAt = addMinutes(new Date(), -50);
    const shift = await insertPublishedShift({
      shootId: demoShootId,
      assignedUserId: photoId,
      managerUserId: seniorId,
      title: "AutoCloseCoverage",
      startsAt,
      endsAt
    });

    const clockInEvent = (
      await pool.query(
        `
          INSERT INTO status_event (tenant_id, shoot_id, user_id, type, captured_at, geofence_status, metadata)
          VALUES ($1,$2,$3,'CLOCK_IN',$4,'inside',$5::jsonb)
          RETURNING *
        `,
        [tenantId, demoShootId, photoId, addMinutes(startsAt, 5), JSON.stringify({ shift_id: shift.id, source: "worker-test" })]
      )
    ).rows[0];

    await pool.query(
      `
        INSERT INTO shift_punch (
          tenant_id, shift_id, shoot_id, user_id, direction, source, status_event_id, client_timestamp,
          geofence_status, gps_confidence, approval_state
        )
        VALUES ($1,$2,$3,$4,'in','test',$5,$6,'inside','normal','not_required')
      `,
      [tenantId, shift.id, demoShootId, photoId, clockInEvent.id, addMinutes(startsAt, 5)]
    );

    await pool.query(
      `
        INSERT INTO time_entry (tenant_id, shoot_id, user_id, clock_in_event_id, clock_in_at)
        VALUES ($1,$2,$3,$4,$5)
      `,
      [tenantId, demoShootId, photoId, clockInEvent.id, clockInEvent.captured_at]
    );

    const workDate = startsAt.toISOString().slice(0, 10);
    const session = (
      await pool.query(
        `
          INSERT INTO time_session (tenant_id, employee_id, work_date, source_shift_id, status)
          VALUES ($1,$2,$3::date,$4,'open')
          RETURNING id
        `,
        [tenantId, photoId, workDate, shift.id]
      )
    ).rows[0];

    const segment = (
      await pool.query(
        `
          INSERT INTO time_segment (
            tenant_id,
            session_id,
            employee_id,
            work_state,
            linked_shoot_id,
            start_time,
            source_type,
            geofence_supported,
            review_status
          )
          VALUES ($1,$2,$3,'photography',$4,$5,'manual',true,'not_required')
          RETURNING id
        `,
        [tenantId, session.id, photoId, demoShootId, clockInEvent.captured_at]
      )
    ).rows[0];

    await monitorAttendanceForTenant(tenantId);

    const autoClosedPunch = await pool.query(
      `
        SELECT *
        FROM shift_punch
        WHERE shift_id = $1
          AND direction = 'out'
          AND auto_closed = true
        LIMIT 1
      `,
      [shift.id]
    );
    expect(autoClosedPunch.rows[0]).toBeTruthy();

    const exception = await pool.query(
      `
        SELECT *
        FROM attendance_exception
        WHERE shift_id = $1
          AND exception_type = 'AUTO_CLOSED_SHIFT'
        LIMIT 1
      `,
      [shift.id]
    );
    expect(exception.rows[0]).toBeTruthy();

    const audit = await pool.query(
      `
        SELECT action, metadata->>'auto_closed' AS auto_closed, metadata->>'exception_type' AS exception_type
        FROM audit_log
        WHERE tenant_id = $1
          AND target_user_id = $2
          AND metadata->>'shift_id' = $3
        ORDER BY created_at ASC
      `,
      [tenantId, photoId, shift.id]
    );
    expect(audit.rows.some((row) => row.action === "attendance.punch.auto_closed" && row.auto_closed === "true")).toBe(true);
    expect(audit.rows.some((row) => row.action === "attendance.exception.auto_created" && row.exception_type === "AUTO_CLOSED_SHIFT")).toBe(true);

    const canonicalSession = await pool.query(
      `
        SELECT status::text AS status
        FROM time_session
        WHERE id = $1
      `,
      [session.id]
    );
    const canonicalSegment = await pool.query(
      `
        SELECT end_time
        FROM time_segment
        WHERE id = $1
      `,
      [segment.id]
    );
    const canonicalEvents = await pool.query(
      `
        SELECT event_type::text AS event_type
        FROM clock_event
        WHERE tenant_id = $1
          AND employee_id = $2
          AND linked_session_id = $3
        ORDER BY event_timestamp ASC
      `,
      [tenantId, photoId, session.id]
    );

    expect(canonicalSession.rows[0].status).toBe("closed");
    expect(canonicalSegment.rows[0].end_time).toBeTruthy();
    const canonicalEventTypes = canonicalEvents.rows.map((row) => row.event_type);
    expect(canonicalEventTypes).toHaveLength(3);
    expect(canonicalEventTypes).toEqual(expect.arrayContaining(["work_state_ended", "clock_out", "session_closed"]));
  }, 20000);
});
