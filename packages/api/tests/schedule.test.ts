import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { pool } from "../src/db/pool.js";
import { setActiveProviderMode, upsertConnection } from "../src/services/outlookStore.js";
import { elevateSession } from "./helpers.js";

const app = createApp();

let leadershipToken = "";
let adminToken = "";
let officeToken = "";
let seniorToken = "";
let photoToken = "";
let tenantId = "";
let studioId = "";
let demoShootId = "";
let adminId = "";
let leadershipId = "";
let officeId = "";
let seniorId = "";
let photoId = "";
let schoolOrganizationId = "";
let schoolLocationId = "";
let schoolPrimaryContactId = "";
const originalOutlookGraphConfig = {
  clientId: config.MICROSOFT_GRAPH_CLIENT_ID,
  clientSecret: config.MICROSOFT_GRAPH_CLIENT_SECRET,
  tenantId: config.MICROSOFT_GRAPH_TENANT_ID,
  appPermissionFeaturesEnabled: config.OUTLOOK_APP_PERMISSION_FEATURES_ENABLED,
  conflictMode: config.OUTLOOK_CONFLICT_MODE,
  travelBufferMinutes: config.OUTLOOK_CONFLICT_TRAVEL_BUFFER_MINUTES
};

function localDateString(offsetDays = 0) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

// A near-future date is routinely occupied in the shared demo DB (office@ carries
// 18 shifts on some days), which makes trade acceptance 409 on shift_overlap even
// though the trade itself is valid. For flows that must accept cleanly, pick a far
// date where none of the participants has any shift.
async function dateWithNoShiftsFor(userIds: string[]) {
  const result = await pool.query(
    `SELECT (CURRENT_DATE + off)::text AS day
     FROM generate_series(40, 120) AS off
     WHERE NOT EXISTS (
       SELECT 1 FROM work_shift ws
       WHERE ws.tenant_id = $1 AND ws.assigned_user_id = ANY($2::uuid[])
         AND ws.starts_at::date = (CURRENT_DATE + off)
     )
     ORDER BY off LIMIT 1`,
    [tenantId, userIds]
  );
  expect(result.rows.length).toBe(1);
  return result.rows[0].day as string;
}

function isoAt(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}

async function createShoot(
  code: string,
  title: string,
  date: string,
  options?: {
    shootType?: string;
  }
) {
  const response = await request(app)
    .post("/api/shoots")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      studio_id: studioId,
      organization_id: schoolOrganizationId,
      location_id: schoolLocationId,
      primary_contact_id: schoolPrimaryContactId,
      shoot_type: options?.shootType ?? "schools_underclass_portraits",
      shoot_code: code,
      title,
      shoot_date: date,
      geofence_radius_meters: 1609,
      arrival_time: isoAt(date, "14:45"),
      start_time: isoAt(date, "15:00"),
      end_time_est: isoAt(date, "17:00"),
      projected_students: 48,
      planned_staff_count: 2,
      required_lead_count: 1
    });
  expect(response.status).toBe(201);
  return response.body;
}

async function connectMockOutlook() {
  await elevateSession(app, leadershipToken, "LocalDemo123!");
  const response = await request(app)
    .post(`/api/integrations/outlook/connect?date=${localDateString()}&provider=mock`)
    .set("Authorization", `Bearer ${leadershipToken}`);
  expect(response.status).toBe(200);
}

async function createShift(options: {
  shootId: string;
  assignedUserId: string;
  managerUserId?: string;
  title: string;
  date: string;
  staffingRole?: string;
  satisfiesLeadCoverage?: boolean;
}) {
  const startsAt = isoAt(options.date, "14:15");
  const endsAt = isoAt(options.date, "17:15");
  const response = await request(app)
    .post("/api/shifts")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      shoot_id: options.shootId,
      assigned_user_id: options.assignedUserId,
      manager_user_id: options.managerUserId ?? null,
      shift_kind: "shoot",
      department: "schools",
      staffing_role: options.staffingRole ?? "photographer",
      satisfies_lead_coverage: Boolean(options.satisfiesLeadCoverage),
      title: options.title,
      starts_at: startsAt,
      ends_at: endsAt,
      location_name: "Schedule Test Site",
      location_address: "123 Schedule Way, Minneapolis, MN",
      segments: [
        {
          segment_kind: "shoot",
          label: "Coverage",
          scheduled_start_at: startsAt,
          scheduled_end_at: endsAt,
          rate_code: "shoot",
          hourly_rate_cents: 2500
        }
      ]
    });
  expect(response.status).toBe(201);
  return response.body;
}

beforeAll(async () => {
  const tenant = await pool.query("SELECT id FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
  tenantId = tenant.rows[0].id;

  const studio = await pool.query("SELECT id FROM studio WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1", [tenantId]);
  studioId = studio.rows[0].id;

  const people = await pool.query(
    `
      SELECT email, id
      FROM app_user
      WHERE tenant_id = $1
        AND email IN ('leadership@example.com', 'admin@example.com', 'office@example.com', 'senior@example.com', 'photo@example.com')
    `,
    [tenantId]
  );
  adminId = people.rows.find((row) => row.email === "admin@example.com")?.id;
  leadershipId = people.rows.find((row) => row.email === "leadership@example.com")?.id;
  officeId = people.rows.find((row) => row.email === "office@example.com")?.id;
  seniorId = people.rows.find((row) => row.email === "senior@example.com")?.id;
  photoId = people.rows.find((row) => row.email === "photo@example.com")?.id;

  const shoot = await pool.query("SELECT id FROM shoot WHERE tenant_id = $1 AND shoot_code = 'DEMO-001' LIMIT 1", [tenantId]);
  demoShootId = shoot.rows[0].id;

  const schoolDirectory = await pool.query(
    `
      SELECT o.id AS organization_id, l.id AS location_id, c.id AS contact_id
      FROM organization o
      JOIN shoot_location l
        ON l.tenant_id = o.tenant_id
       AND l.organization_id = o.id
       AND l.active_status = 'active'
      JOIN organization_contact c
        ON c.tenant_id = o.tenant_id
       AND c.organization_id = o.id
       AND c.active_status = 'active'
      WHERE o.tenant_id = $1
        AND o.display_name = 'White Bear Lake High School'
      ORDER BY c.created_at ASC
      LIMIT 1
    `,
    [tenantId]
  );
  schoolOrganizationId = schoolDirectory.rows[0].organization_id;
  schoolLocationId = schoolDirectory.rows[0].location_id;
  schoolPrimaryContactId = schoolDirectory.rows[0].contact_id;

  leadershipToken = (await request(app).post("/auth/login").send({ email: "leadership@example.com", password: "LocalDemo123!" })).body.token;
  adminToken = (await request(app).post("/auth/login").send({ email: "admin@example.com", password: "LocalDemo123!" })).body.token;
  officeToken = (await request(app).post("/auth/login").send({ email: "office@example.com", password: "LocalDemo123!" })).body.token;
  seniorToken = (await request(app).post("/auth/login").send({ email: "senior@example.com", password: "LocalDemo123!" })).body.token;
  photoToken = (await request(app).post("/auth/login").send({ email: "photo@example.com", password: "LocalDemo123!" })).body.token;

  await connectMockOutlook();
});

afterEach(() => {
  Object.assign(config, {
    MICROSOFT_GRAPH_CLIENT_ID: originalOutlookGraphConfig.clientId,
    MICROSOFT_GRAPH_CLIENT_SECRET: originalOutlookGraphConfig.clientSecret,
    MICROSOFT_GRAPH_TENANT_ID: originalOutlookGraphConfig.tenantId,
    OUTLOOK_APP_PERMISSION_FEATURES_ENABLED: originalOutlookGraphConfig.appPermissionFeaturesEnabled,
    OUTLOOK_CONFLICT_MODE: originalOutlookGraphConfig.conflictMode,
    OUTLOOK_CONFLICT_TRAVEL_BUFFER_MINUTES: originalOutlookGraphConfig.travelBufferMinutes
  });
  vi.restoreAllMocks();
});

describe("unified schedule endpoints", () => {
  it("returns unified calendar items with shoots, events, and sync metadata", async () => {
    const date = localDateString();
    const seededEvent = await request(app)
      .post("/api/schedule/events")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        department: "operations",
        event_kind: "meeting",
        title: `Calendar Coverage ${randomUUID().slice(0, 6)}`,
        starts_at: isoAt(date, "09:00"),
        ends_at: isoAt(date, "09:30"),
        location_name: "Mission Control"
      });
    expect(seededEvent.status).toBe(201);

    const response = await request(app)
      .get(`/api/schedule/calendar?anchor_date=${date}&window=today`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body.model).toEqual({
      schedule_role: "projection",
      source_of_truth: "mission_control",
      canonical_spine: ["job", "event", "staff_assignment", "task"]
    });
    expect(response.body.sync.source_of_truth).toBe("mission_control");
    expect(response.body.items.some((item: { item_kind: string }) => item.item_kind === "shoot")).toBe(true);
    expect(response.body.items.some((item: { item_kind: string }) => item.item_kind === "event")).toBe(true);
  });

  it("redacts manager-only staffing detail for employee-facing schedule views", async () => {
    const date = localDateString(1);
    const createdShoot = await createShoot(`SELF-${randomUUID().slice(0, 8)}`, "Employee Assignment View", date);
    const createdShift = await createShift({
      shootId: createdShoot.id,
      assignedUserId: photoId,
      managerUserId: seniorId,
      title: "Employee Schedule Coverage",
      date,
      staffingRole: "photographer"
    });
    await pool.query("UPDATE work_shift SET status = 'published' WHERE id = $1", [createdShift.id]);

    const response = await request(app)
      .get(`/api/schedule/calendar?anchor_date=${date}&window=today`)
      .set("Authorization", `Bearer ${photoToken}`);

    expect(response.status).toBe(200);
    const shootItem = response.body.items.find((item: { item_kind: string; id: string }) => item.item_kind === "shoot" && item.id === createdShoot.id);
    expect(shootItem).toMatchObject({
      staffing_detail_visibility: "limited",
      staffing_health_state: "personal_view",
      staffing_health_label: "Assignment View",
      planned_staff_count: null,
      assigned_staff_count: null,
      required_lead_count: null,
      lead_coverage_count: null,
      lead_name: null,
      open_alert_count: null,
      open_attendance_exception_count: null,
      conflict_warning_count: null,
      draft_shift_count: null,
      published_shift_count: null,
      publish_state: null,
      staffing_gap_count: null,
      unconfirmed_staff_count: null
    });
  });

  it("groups the board by department", async () => {
    const date = localDateString();
    const sportsShoot = await createShoot(`SPORT-${randomUUID().slice(0, 8)}`, "Sports Group Coverage", date, {
      shootType: "sports"
    });
    expect(sportsShoot.department).toBe("sports");

    const response = await request(app)
      .get(`/api/schedule/board?anchor_date=${date}&window=week&group_by=department`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body.model).toEqual({
      schedule_role: "projection",
      source_of_truth: "mission_control",
      canonical_spine: ["job", "event", "staff_assignment", "task"]
    });
    expect(response.body.group_by).toBe("department");
    expect(response.body.groups.some((group: { key: string }) => group.key === "schools")).toBe(true);
    expect(response.body.groups.some((group: { key: string }) => group.key === "sports")).toBe(true);
  });

  it("applies a staffing template to a shoot", async () => {
    const date = localDateString(4);
    const createdShoot = await createShoot(`TPL-${randomUUID().slice(0, 8)}`, "Template Application Coverage", date);
    const template = await pool.query(
      "SELECT id, planned_staff_count FROM staffing_template WHERE tenant_id = $1 AND name = 'Large Volume Senior + 4 Shooters + Check-In' LIMIT 1",
      [tenantId]
    );

    const response = await request(app)
      .post(`/api/schedule/shoots/${createdShoot.id}/apply-template`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ template_id: template.rows[0].id });

    expect(response.status).toBe(200);
    expect(response.body.planned_staff_count).toBe(template.rows[0].planned_staff_count);
  });

  it("moves a shoot, updates linked shift timings, and returns warnings", async () => {
    const date = localDateString(2);
    const createdShoot = await createShoot(`MOVE-${randomUUID().slice(0, 8)}`, "Schedule Move Coverage", date);
    const createdShift = await createShift({
      shootId: createdShoot.id,
      assignedUserId: photoId,
      managerUserId: seniorId,
      title: "Move Test Photographer",
      date
    });

    const targetDate = localDateString(3);
    const response = await request(app)
      .post(`/api/schedule/items/shoot/${createdShoot.id}/move`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ target_date: targetDate });

    expect(response.status).toBe(200);
    expect(response.body.item_kind).toBe("shoot");
    expect(Array.isArray(response.body.warnings)).toBe(true);

    const movedShift = await pool.query("SELECT starts_at FROM work_shift WHERE id = $1 LIMIT 1", [createdShift.id]);
    expect(new Date(movedShift.rows[0].starts_at).toISOString().slice(0, 10)).toBe(targetDate);
  });

  it("returns the leadership staffing dashboard with open coverage and availability groups", async () => {
    const response = await request(app)
      .get(`/api/schedule/staffing-dashboard?anchor_date=${localDateString()}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body.summary).toMatchObject({
      shoots_today: expect.any(Number),
      open_staffing_slots: expect.any(Number),
      shoots_missing_lead: expect.any(Number),
      available_staff_today: expect.any(Number)
    });
    expect(Array.isArray(response.body.open_coverage)).toBe(true);
    expect(Array.isArray(response.body.availability_groups)).toBe(true);
  });

  it("supports staffing assignment, conflict override, and publish override on a shoot", async () => {
    const date = localDateString(7);
    const targetShoot = await createShoot(`STF-${randomUUID().slice(0, 8)}`, "Staffing Drawer Coverage", date);
    const conflictShoot = await createShoot(`STC-${randomUUID().slice(0, 8)}`, "Conflicting Assignment", date);

    await createShift({
      shootId: conflictShoot.id,
      assignedUserId: photoId,
      managerUserId: leadershipId,
      title: "Photographer Conflict Shift",
      date
    });

    const initialSnapshot = await request(app)
      .get(`/api/schedule/shoots/${targetShoot.id}/staffing`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(initialSnapshot.status).toBe(200);
    expect(initialSnapshot.body.shoot.missing_lead).toBe(true);

    const leadSlot = initialSnapshot.body.slots.find((slot: { satisfies_lead_coverage: boolean }) => slot.satisfies_lead_coverage);
    expect(leadSlot).toBeTruthy();

    const leadCandidate = leadSlot.option_groups
      .flatMap((group: { options: Array<{ user_id: string; disabled: boolean; requires_override: boolean }> }) => group.options)
      .find((option: { disabled: boolean }) => !option.disabled);
    expect(leadCandidate).toBeTruthy();

    const assignLead = await request(app)
      .post(`/api/schedule/shoots/${targetShoot.id}/staffing/assign`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        slot_key: leadSlot.slot_key,
        assigned_user_id: leadCandidate.user_id,
        override_conflict: Boolean(leadCandidate.requires_override)
      });

    expect(assignLead.status).toBe(200);
    expect(assignLead.body.shoot.lead_coverage_count).toBeGreaterThanOrEqual(1);

    const conflictSlot = assignLead.body.slots.find((slot: { satisfies_lead_coverage: boolean }) => !slot.satisfies_lead_coverage);
    expect(conflictSlot).toBeTruthy();

    const blockedConflict = await request(app)
      .post(`/api/schedule/shoots/${targetShoot.id}/staffing/assign`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        slot_key: conflictSlot.slot_key,
        assigned_user_id: photoId
      });

    expect(blockedConflict.status).toBe(409);

    const overriddenConflict = await request(app)
      .post(`/api/schedule/shoots/${targetShoot.id}/staffing/assign`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        slot_key: conflictSlot.slot_key,
        assigned_user_id: photoId,
        override_conflict: true,
        approval_reason: "Leadership approved the conflict override for same-day coverage."
      });

    expect(overriddenConflict.status).toBe(200);
    expect(overriddenConflict.body.shoot.conflict_warning_count).toBeGreaterThanOrEqual(1);

    const blockedPublish = await request(app)
      .post(`/api/schedule/shoots/${targetShoot.id}/staffing/publish`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});

    expect(blockedPublish.status).toBe(409);

    const published = await request(app)
      .post(`/api/schedule/shoots/${targetShoot.id}/staffing/publish`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        override_warnings: true,
        approval_reason: "Leadership approved publishing despite the remaining staffing warning."
      });

    expect(published.status).toBe(200);
    expect(published.body.shoot.publish_state).toBe("published");
  }, 15000);

  it("returns the canonical staffing snapshot the board merge consumes after a successful lead assignment", async () => {
    const date = localDateString(8);
    const shoot = await createShoot(`STV-${randomUUID().slice(0, 8)}`, "Lead Assign Verification", date);

    const before = await request(app)
      .get(`/api/schedule/shoots/${shoot.id}/staffing`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(before.status).toBe(200);
    expect(before.body.shoot.missing_lead).toBe(true);
    const leadCoverageBefore = before.body.shoot.lead_coverage_count as number;
    const assignedBefore = before.body.shoot.assigned_staff_count as number;

    const leadSlot = before.body.slots.find((slot: { satisfies_lead_coverage: boolean }) => slot.satisfies_lead_coverage);
    expect(leadSlot).toBeTruthy();
    const leadCandidate = leadSlot.option_groups
      .flatMap((group: { options: Array<{ user_id: string; disabled: boolean; requires_override: boolean }> }) => group.options)
      .find((option: { disabled: boolean }) => !option.disabled);
    expect(leadCandidate).toBeTruthy();

    const assign = await request(app)
      .post(`/api/schedule/shoots/${shoot.id}/staffing/assign`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        slot_key: leadSlot.slot_key,
        assigned_user_id: leadCandidate.user_id,
        override_conflict: Boolean(leadCandidate.requires_override),
        ...(leadCandidate.requires_override
          ? { approval_reason: "Leadership approved the lead assignment for verification." }
          : {})
      });

    // A successful (200) assign returns the recomputed canonical snapshot the board merges.
    expect(assign.status, JSON.stringify(assign.body)).toBe(200);
    const snapshot = assign.body;

    // "Lead still required" disappears and lead coverage updates.
    expect(snapshot.shoot.missing_lead).toBe(false);
    expect(snapshot.shoot.lead_coverage_count).toBeGreaterThan(leadCoverageBefore);
    expect(snapshot.shoot.lead_name).toBeTruthy();
    // Total filled count (shown as "N of M positions filled") updates.
    expect(snapshot.shoot.assigned_staff_count).toBeGreaterThan(assignedBefore);

    // The assigned employee name + role + draft status are on the slot the merge reads.
    const filledLead = snapshot.slots.find((slot: { slot_key: string }) => slot.slot_key === leadSlot.slot_key);
    expect(filledLead.assigned_user_id).toBe(leadCandidate.user_id);
    expect(filledLead.assigned_user_name).toBeTruthy();
    expect(filledLead.assigned_title).toBeTruthy();
    expect(filledLead.assignment_status).toBe("draft");

    // The exact shoot fields coverageRowFromSnapshot reads are present and numeric.
    expect(snapshot.shoot).toMatchObject({
      id: shoot.id,
      planned_staff_count: expect.any(Number),
      assigned_staff_count: expect.any(Number),
      required_lead_count: expect.any(Number),
      lead_coverage_count: expect.any(Number),
      draft_shift_count: expect.any(Number)
    });
  }, 15000);

  it("does not synthesize Outlook busy conflicts during the delegated read-only pilot and still queues sync intent", async () => {
    Object.assign(config, {
      MICROSOFT_GRAPH_CLIENT_ID: "calendar-test-client",
      MICROSOFT_GRAPH_CLIENT_SECRET: "calendar-test-secret",
      MICROSOFT_GRAPH_TENANT_ID: "calendar-test-tenant",
      OUTLOOK_APP_PERMISSION_FEATURES_ENABLED: true,
      OUTLOOK_CONFLICT_MODE: "blocking",
      OUTLOOK_CONFLICT_TRAVEL_BUFFER_MINUTES: 20
    });

      const busyDate = localDateString(45);
      const targetShoot = await createShoot(`OCF-${randomUUID().slice(0, 8)}`, "Outlook Conflict Staffing", busyDate);
      await pool.query(
        `
          DELETE FROM work_shift
          WHERE tenant_id = $1
            AND assigned_user_id = $2
            AND shoot_id <> $3
            AND starts_at::date <= $4::date
            AND ends_at::date >= $4::date
        `,
        [tenantId, photoId, targetShoot.id, busyDate]
      );
      await pool.query(
        `
          DELETE FROM schedule_event
          WHERE tenant_id = $1
            AND lead_user_id = $2
            AND starts_at::date <= $3::date
            AND ends_at::date >= $3::date
        `,
        [tenantId, photoId, busyDate]
      );
      await pool.query(
        `
          DELETE FROM shoot_assignment
          WHERE tenant_id = $1
            AND user_id = $2
            AND shoot_id IN (
              SELECT id
              FROM shoot
              WHERE tenant_id = $1
                AND shoot_date = $3::date
                AND id <> $4
            )
        `,
        [tenantId, photoId, busyDate, targetShoot.id]
      );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await request(app)
      .get(`/api/schedule/shoots/${targetShoot.id}/staffing`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(snapshot.status).toBe(200);
    const targetSlot = snapshot.body.slots.find((slot: { satisfies_lead_coverage: boolean }) => !slot.satisfies_lead_coverage) ?? snapshot.body.slots[0];
    expect(targetSlot).toBeTruthy();
    const conflictingOption = targetSlot.option_groups
      .flatMap((group: { options: Array<Record<string, unknown>> }) => group.options)
      .find((option: { user_id: string }) => option.user_id === photoId);

    expect(conflictingOption).toMatchObject({
      user_id: photoId,
      requires_override: false,
      calendar_conflict_status: "clear"
    });
    expect(conflictingOption.short_reason ?? null).toBeNull();
    expect(
      snapshot.body.warnings.some((warning: string) => warning.includes("intersect Outlook busy time or travel buffers"))
    ).toBe(false);

    const overriddenAssign = await request(app)
      .post(`/api/schedule/shoots/${targetShoot.id}/staffing/assign`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        slot_key: targetSlot.slot_key,
        assigned_user_id: photoId,
        override_conflict: false
      });

    expect(overriddenAssign.status).toBe(200);

    const persistedShift = await pool.query(
      `
        SELECT
          id::text AS id,
          sync_status::text AS sync_status,
          conflict_status::text AS conflict_status,
          conflict_detail,
          calendar_sync_required,
          last_sync_attempt_at::text AS last_sync_attempt_at
        FROM work_shift
        WHERE shoot_id = $1
          AND assigned_user_id = $2
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [targetShoot.id, photoId]
    );

    expect(persistedShift.rows[0]).toMatchObject({
      sync_status: "pending",
      conflict_status: "clear",
      calendar_sync_required: true
    });
    expect(persistedShift.rows[0].conflict_detail ?? {}).not.toMatchObject({
      source: "outlook_busy"
    });

    const queuedSync = await pool.query(
      `
        SELECT payload
        FROM integration_sync_operation
        WHERE tenant_id = $1
          AND provider = 'outlook'
          AND entity_type = 'work_shift'
          AND entity_id = $2
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [tenantId, persistedShift.rows[0].id]
    );

    expect(queuedSync.rows[0].payload).toMatchObject({
      source_object: {
        type: "work_shift",
        id: persistedShift.rows[0].id
      },
      target_object: {
        type: "outlook_calendar_event"
      },
      sync_state: {
        retry_state: "pending_dispatch"
      },
      write_intent: {
        source_of_truth: "mission_control",
        delivery_layer: "outlook_calendar"
      }
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks Outlook-linked records for review instead of silently pushing outbound changes", async () => {
    await connectMockOutlook();
    const date = localDateString(8);
    const createdShoot = await createShoot(`SYNC-${randomUUID().slice(0, 8)}`, "Explicit Sync Guard", date);

    const updateResponse = await request(app)
      .patch(`/api/shoots/${createdShoot.id}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ title: "Explicit Sync Guard Updated" });

    expect(updateResponse.status).toBe(200);

    const queuedOps = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM integration_sync_operation
        WHERE tenant_id = $1
          AND provider = 'outlook'
          AND entity_type = 'shoot'
          AND entity_id = $2
      `,
      [tenantId, createdShoot.id]
    );
    const updatedShoot = await pool.query(
      `
        SELECT schedule_sync_required, schedule_sync_state
        FROM shoot
        WHERE id = $1
      `,
      [createdShoot.id]
    );

    expect(queuedOps.rows[0].count).toBe(0);
    expect(["pending_sync", "not_linked"]).toContain(updatedShoot.rows[0].schedule_sync_state);
  });

  it("queues an explicit Outlook push only when leadership requests it", async () => {
    Object.assign(config, {
      MICROSOFT_GRAPH_CLIENT_ID: "calendar-test-client",
      MICROSOFT_GRAPH_CLIENT_SECRET: "calendar-test-secret",
      MICROSOFT_GRAPH_TENANT_ID: "calendar-test-tenant",
      OUTLOOK_APP_PERMISSION_FEATURES_ENABLED: true
    });
    await connectMockOutlook();
    const client = await pool.connect();
    try {
      await upsertConnection(client, tenantId, {
        connected_by_user_id: leadershipId,
        auth_session_id: null,
        provider_mode: "graph_live",
        connection_status: "connected",
        health_state: "connected_pending_sync",
        connected_account_email: "leader@contoso.com",
        warning_count: 0,
        error_count: 0
      });
      await setActiveProviderMode(client, tenantId, "graph_live");
    } finally {
      client.release();
    }
    const date = localDateString(9);
    const createdShoot = await createShoot(`PUSH-${randomUUID().slice(0, 8)}`, "Explicit Outlook Push", date);

    const response = await request(app)
      .post(`/api/schedule/items/shoot/${createdShoot.id}/outlook-push`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(202);
    expect(response.body.queued).toBe(true);

    const operation = await pool.query(
      `
        SELECT provider, direction, entity_type, entity_id, status, source_system, payload
        FROM integration_sync_operation
        WHERE tenant_id = $1
          AND provider = 'outlook'
          AND entity_type = 'shoot'
          AND entity_id = $2
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [tenantId, createdShoot.id]
    );

    expect(operation.rows[0]).toMatchObject({
      provider: "outlook",
      direction: "outbound",
      entity_type: "shoot",
      entity_id: createdShoot.id,
      status: "pending",
      source_system: "mission_control"
    });
    expect(operation.rows[0].payload).toMatchObject({
      source_object: {
        type: "shoot",
        id: createdShoot.id
      },
      target_object: {
        type: "outlook_calendar_event"
      },
      sync_state: {
        retry_state: "pending_dispatch"
      },
      write_intent: {
        source_of_truth: "mission_control",
        delivery_layer: "outlook_calendar",
        explicit_user_action: true
      }
    });
  });

  it("queues a manual Outlook resync instead of mutating linked events inline", async () => {
    await connectMockOutlook();
    const date = localDateString(365);
    const createdShoot = await createShoot(`OUTLOOK-${randomUUID().slice(0, 8)}`, "Manual Resync Preview Source", date);
    const previewResponse = await request(app)
      .get(`/api/integrations/outlook/events/preview?date=${date}&window=3day&enabled_only=false`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send();
    expect(previewResponse.status).toBe(200);

    const previewEvent = previewResponse.body.find(
      (event: { id: string; shoot_id?: string | null }) =>
        event.id === `event-shoot-${createdShoot.id}` && event.shoot_id === createdShoot.id
    );

    expect(previewEvent).toBeTruthy();

    const createEvent = await request(app)
      .post("/api/schedule/events")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        department: "operations",
        event_kind: "meeting",
        title: `Manual Resync ${randomUUID().slice(0, 6)}`,
        starts_at: previewEvent.starts_at,
        ends_at:
          new Date(previewEvent.ends_at).getTime() > new Date(previewEvent.starts_at).getTime()
            ? previewEvent.ends_at
            : new Date(new Date(previewEvent.starts_at).getTime() + 30 * 60 * 1000).toISOString(),
        location_name: previewEvent.location || "Mission Control Room",
        notes: "Resync test event"
      });

    expect(createEvent.status).toBe(201);

    await pool.query(
      `
        UPDATE schedule_event
        SET outlook_event_id = NULL,
            outlook_calendar_id = NULL
        WHERE tenant_id = $1
          AND outlook_event_id = $2
      `,
      [tenantId, previewEvent.id]
    );

    await pool.query(
      `
        UPDATE schedule_event
        SET outlook_event_id = $2,
            outlook_calendar_id = $3,
            sync_state = 'in_sync',
            source_system = 'outlook',
            last_synced_at = now(),
            last_sync_direction = 'inbound'
        WHERE id = $1
      `,
      [createEvent.body.id, previewEvent.id, previewEvent.calendar_id]
    );

    const beforeCount = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'microsoft_graph.webhook.received'
          AND payload->'body'->>'event_id' = $2
      `,
      [tenantId, previewEvent.id]
    );

    const response = await request(app)
      .post(`/api/schedule/items/event/${createEvent.body.id}/outlook-resync`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(202);
    expect(response.body.queued).toBe(true);

    const afterCount = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'microsoft_graph.webhook.received'
          AND payload->'body'->>'event_id' = $2
      `,
      [tenantId, previewEvent.id]
    );

    expect(afterCount.rows[0].count).toBe(beforeCount.rows[0].count + 1);
  });

  it("allows leadership to acknowledge a review-required Outlook diff without deleting operational history", async () => {
    const date = localDateString(1);
    const createEvent = await request(app)
      .post("/api/schedule/events")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        department: "operations",
        event_kind: "meeting",
        title: `Review Ack ${randomUUID().slice(0, 6)}`,
        starts_at: isoAt(date, "08:30"),
        ends_at: isoAt(date, "09:00"),
        location_name: "Ops Review Room",
        notes: "Acknowledge review test"
      });

    expect(createEvent.status).toBe(201);

    await pool.query(
      `
        UPDATE schedule_event
        SET sync_review_required = true,
            sync_review_reason = 'Outlook moved the event after internal staffing already existed.',
            external_changed_fields = '["starts_at","location_name"]'::jsonb,
            external_change_snapshot = '{"starts_at":"2026-03-26T13:30:00.000Z"}'::jsonb,
            sync_state = 'sync_warning',
            sync_required = false,
            source_system = 'outlook',
            last_sync_direction = 'inbound',
            last_synced_at = now()
        WHERE id = $1
      `,
      [createEvent.body.id]
    );

    const response = await request(app)
      .post(`/api/schedule/items/event/${createEvent.body.id}/outlook-review/acknowledge`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body.acknowledged).toBe(true);

    const refreshedEvent = await pool.query(
      `
        SELECT sync_review_required, sync_review_reason, external_changed_fields, sync_state
        FROM schedule_event
        WHERE id = $1
      `,
      [createEvent.body.id]
    );

    expect(refreshedEvent.rows[0].sync_review_required).toBe(false);
    expect(refreshedEvent.rows[0].sync_review_reason).toBeNull();
    expect(refreshedEvent.rows[0].external_changed_fields).toEqual([]);
    expect(refreshedEvent.rows[0].sync_state).toBe("in_sync");
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

describe("trade approval protections", () => {
  it("returns trade candidates and preview rows with conflict and lead coverage context", async () => {
    const date = localDateString(4);
    const createdShoot = await createShoot(`TRP-${randomUUID().slice(0, 8)}`, "Trade Preview Metadata", date);
    const createdShift = await createShift({
      shootId: createdShoot.id,
      assignedUserId: seniorId,
      managerUserId: leadershipId,
      title: "Preview Senior Lead Coverage",
      date,
      staffingRole: "senior_photographer",
      satisfiesLeadCoverage: true
    });

    await createShift({
      shootId: createdShoot.id,
      assignedUserId: adminId,
      managerUserId: leadershipId,
      title: "Director Overlap Coverage",
      date
    });

    const candidates = await request(app)
      .get(`/api/shifts/${createdShift.id}/trade-candidates`)
      .set("Authorization", `Bearer ${seniorToken}`);
    expect(candidates.status).toBe(200);
    const conflictedCandidate = candidates.body.find((row: { id: string }) => row.id === adminId);
    expect(conflictedCandidate).toMatchObject({
      has_conflict: true,
      conflict_code: "shift_overlap"
    });

    const trade = await request(app)
      .post(`/api/shifts/${createdShift.id}/trade-requests`)
      .set("Authorization", `Bearer ${seniorToken}`)
      .send({
        requested_with_user_id: adminId,
        reason: "Need a director-reviewed same-time swap."
      });
    expect(trade.status).toBe(201);
    expect(trade.body.status).toBe("pending_recipient");

    const listing = await request(app)
      .get("/api/shifts/trade-requests/list?status=pending_recipient")
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(listing.status).toBe(200);
    const preview = listing.body.find((row: { id: string }) => row.id === trade.body.id);
    expect(preview).toMatchObject({
      shift_title: "Preview Senior Lead Coverage",
      shoot_title: "Trade Preview Metadata",
      shoot_code: createdShoot.shoot_code,
      staffing_role: "senior_photographer",
      satisfies_lead_coverage: true,
      requested_with_conflict: true
    });
  });

  it("does not allow a trade participant to approve their own trade", async () => {
    const date = await dateWithNoShiftsFor([photoId, officeId]);
    const createdShoot = await createShoot(`TRD-${randomUUID().slice(0, 8)}`, "Participant Review Guard", date);
    const createdShift = await createShift({
      shootId: createdShoot.id,
      assignedUserId: photoId,
      managerUserId: leadershipId,
      title: "Participant Guard Shift",
      date
    });

    const trade = await request(app)
      .post(`/api/shifts/${createdShift.id}/trade-requests`)
      .set("Authorization", `Bearer ${photoToken}`)
      .send({
        requested_with_user_id: officeId,
        reason: "Need coverage swap."
      });
    expect(trade.status).toBe(201);

    const accepted = await request(app)
      .post(`/api/shifts/trade-requests/${trade.body.id}/respond`)
      .set("Authorization", `Bearer ${officeToken}`)
      .send({ status: "accepted" });

    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe("pending_manager");

    const review = await request(app)
      .post(`/api/shifts/trade-requests/${trade.body.id}/review`)
      .set("Authorization", `Bearer ${officeToken}`)
      .send({ status: "approved" });

    expect(review.status).toBe(403);
  });

  it("ends the workflow immediately when the recipient declines", async () => {
    const date = localDateString(5);
    const createdShoot = await createShoot(`TRX-${randomUUID().slice(0, 8)}`, "Recipient Decline Guard", date);
    const createdShift = await createShift({
      shootId: createdShoot.id,
      assignedUserId: photoId,
      managerUserId: leadershipId,
      title: "Recipient Decline Shift",
      date
    });

    const trade = await request(app)
      .post(`/api/shifts/${createdShift.id}/trade-requests`)
      .set("Authorization", `Bearer ${photoToken}`)
      .send({
        requested_with_user_id: seniorId,
        reason: "Testing recipient decline."
      });
    expect(trade.status).toBe(201);

    const declined = await request(app)
      .post(`/api/shifts/trade-requests/${trade.body.id}/respond`)
      .set("Authorization", `Bearer ${seniorToken}`)
      .send({ status: "declined" });

    expect(declined.status).toBe(200);
    expect(declined.body.status).toBe("recipient_declined");

    const managerQueue = await request(app)
      .get("/api/shifts/trade-requests/list?status=pending_manager")
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(managerQueue.status).toBe(200);
    expect(managerQueue.body.find((row: { id: string }) => row.id === trade.body.id)).toBeUndefined();
  });

  it("blocks downward trade requests before approval routing", async () => {
    const date = localDateString(5);
    const createdShoot = await createShoot(`LEAD-${randomUUID().slice(0, 8)}`, "Lead Coverage Guard", date);
    const createdShift = await createShift({
      shootId: createdShoot.id,
      assignedUserId: seniorId,
      managerUserId: leadershipId,
      title: "Senior Lead Coverage",
      date,
      staffingRole: "senior_photographer",
      satisfiesLeadCoverage: true
    });

    const trade = await request(app)
      .post(`/api/shifts/${createdShift.id}/trade-requests`)
      .set("Authorization", `Bearer ${seniorToken}`)
      .send({
        requested_with_user_id: photoId,
        reason: "Trying to swap out the lead."
      });

    expect(trade.status).toBe(409);
    expect(String(trade.body.error ?? "")).toMatch(/same level or higher/i);
  });
});
