import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db.ts";
import { queueReadyToShootPrompts } from "../src/jobs/attendanceMonitor.ts";

let tenantId = "";
let studioId = "";
let leadershipId = "";
let seniorId = "";

const TEST_SHOOT_TITLES = ["Ready To Shoot Prompt Reminder", "Ready To Shoot Prompt Missing"] as const;

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60000);
}

function dateBucket(value: Date) {
  return value.toISOString().slice(0, 10);
}

async function insertTestShoot(input: {
  title: string;
  codePrefix: string;
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
        arrival_time,
        showtime,
        start_time,
        end_time_est,
        projected_students,
        created_by
      )
      VALUES (
        $1,$2,$3,$4,CURRENT_DATE,
        'Ready Test Venue','100 Test Avenue',
        44.9778,-93.2649,200,$5,$6,$7,$8,24,$9
      )
      RETURNING id
    `,
    [
      tenantId,
      studioId,
      `${input.codePrefix}-${randomUUID().slice(0, 8)}`,
      input.title,
      input.showtime,
      input.showtime,
      input.startTime,
      input.endTime,
      leadershipId
    ]
  );
  return String(result.rows[0].id);
}

async function insertLeadShift(input: {
  shootId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  managerUserId: string;
}) {
  const result = await pool.query(
    `
      INSERT INTO work_shift (
        tenant_id,
        shoot_id,
        assigned_user_id,
        manager_user_id,
        created_by_user_id,
        published_by_user_id,
        shift_kind,
        status,
        department,
        staffing_role,
        satisfies_lead_coverage,
        title,
        starts_at,
        ends_at,
        location_name,
        location_address,
        location_lat,
        location_lng,
        geofence_radius_meters,
        published_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$5,
        'shoot','published','schools','senior_photographer',true,$6,$7,$8,
        'Ready Test Venue','100 Test Avenue',44.9778,-93.2649,200,now()
      )
      RETURNING id
    `,
    [tenantId, input.shootId, seniorId, input.managerUserId, leadershipId, input.title, input.startsAt, input.endsAt]
  );
  return String(result.rows[0].id);
}

beforeAll(async () => {
  const tenant = await pool.query("SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
  tenantId = String(tenant.rows[0].id);

  const users = await pool.query(
    `
      SELECT email, id
      FROM app_user
      WHERE tenant_id = $1
        AND email IN ('leadership@example.com', 'senior@example.com')
    `,
    [tenantId]
  );
  leadershipId = String(users.rows.find((row) => row.email === "leadership@example.com")?.id);
  seniorId = String(users.rows.find((row) => row.email === "senior@example.com")?.id);

  const studio = await pool.query("SELECT id FROM studio WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1", [tenantId]);
  studioId = String(studio.rows[0].id);
});

beforeEach(async () => {
  const shootIds = (
    await pool.query(
      `
        SELECT id
        FROM shoot
        WHERE tenant_id = $1
          AND title = ANY($2::text[])
      `,
      [tenantId, TEST_SHOOT_TITLES]
    )
  ).rows.map((row) => String(row.id));

  if (shootIds.length) {
    await pool.query("DELETE FROM work_shift WHERE shoot_id = ANY($1::uuid[])", [shootIds]);
    await pool.query("DELETE FROM shoot WHERE id = ANY($1::uuid[])", [shootIds]);
  }
});

describe("Ready to Shoot reminder routing", () => {
  it("notifies the lead first, then escalates to the manager when confirmation is still missing", async () => {
    const now = new Date();
    const bucket = dateBucket(now);

    const reminderStart = addMinutes(now, 15);
    const reminderShootId = await insertTestShoot({
      title: "Ready To Shoot Prompt Reminder",
      codePrefix: "RTS-REM",
      showtime: reminderStart,
      startTime: reminderStart,
      endTime: addMinutes(reminderStart, 120)
    });
    await insertLeadShift({
      shootId: reminderShootId,
      title: "ReadyToShootPromptReminderLead",
      startsAt: addMinutes(reminderStart, -10),
      endsAt: addMinutes(reminderStart, 120),
      managerUserId: leadershipId
    });

    const missingStart = addMinutes(now, 5);
    const missingShootId = await insertTestShoot({
      title: "Ready To Shoot Prompt Missing",
      codePrefix: "RTS-MISS",
      showtime: missingStart,
      startTime: missingStart,
      endTime: addMinutes(missingStart, 120)
    });
    await insertLeadShift({
      shootId: missingShootId,
      title: "ReadyToShootPromptMissingLead",
      startsAt: addMinutes(missingStart, -10),
      endsAt: addMinutes(missingStart, 120),
      managerUserId: leadershipId
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE pmc_app");
      await client.query("SELECT app.set_context($1::uuid, NULL::uuid)", [tenantId]);
      await queueReadyToShootPrompts(client, tenantId);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const reminderDispatch = await pool.query(
      `
        SELECT id
        FROM app_event
        WHERE tenant_id = $1
          AND dedupe_key = $2
      `,
      [
        tenantId,
        `notify:shoot.ready_to_shoot_reminder:in_app:${seniorId}:ready-to-shoot-reminder:${reminderShootId}:${bucket}`
      ]
    );
    const missingDispatch = await pool.query(
      `
        SELECT id
        FROM app_event
        WHERE tenant_id = $1
          AND dedupe_key = $2
      `,
      [
        tenantId,
        `notify:shoot.ready_to_shoot_missing:in_app:${leadershipId}:ready-to-shoot-missing:${missingShootId}:${bucket}`
      ]
    );

    expect(reminderDispatch.rowCount).toBe(1);
    expect(missingDispatch.rowCount).toBe(1);
  });
});
