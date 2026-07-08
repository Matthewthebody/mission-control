import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

const app = createApp();

let adminToken = "";
let leadershipToken = "";
let seniorToken = "";
let tenantId = "";
let studioId = "";
let adminUserId = "";
let leadershipUserId = "";
let seniorUserId = "";
let organizationId = "";
let locationId = "";
let primaryContactId = "";
let locationName = "";
let locationAddress = "";

const createdShootIds: string[] = [];
const createdShiftIds: string[] = [];
const createdAttendanceExceptionIds: string[] = [];
const createdExceptionRequestIds: string[] = [];
const createdPresenceIncidentIds: string[] = [];
const createdComplianceFlagIds: string[] = [];
const createdResourceItemIds: string[] = [];
const createdEvaluationIds: string[] = [];

beforeAll(async () => {
  adminToken = (await devLogin(app, "admin@example.com")).body.token;
  leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;
  seniorToken = (await devLogin(app, "senior@example.com")).body.token;

  const seedContext = await pool.query(
    `
      SELECT
        admin.id AS admin_user_id,
        leadership.id AS leadership_user_id,
        senior.id AS senior_user_id,
        admin.tenant_id,
        studio.id AS studio_id,
        org.id AS organization_id,
        loc.id AS location_id,
        loc.name AS location_name,
        COALESCE(
          NULLIF(trim(concat_ws(', ', loc.address_line_1, loc.address_line_2, concat_ws(', ', loc.city, loc.state), loc.zip)), ''),
          loc.address
        ) AS location_address,
        contact.id AS primary_contact_id
      FROM app_user admin
      JOIN app_user leadership
        ON leadership.tenant_id = admin.tenant_id
       AND lower(leadership.email) = lower('leadership@example.com')
      JOIN app_user senior
        ON senior.tenant_id = admin.tenant_id
       AND lower(senior.email) = lower('senior@example.com')
      JOIN studio
        ON studio.tenant_id = admin.tenant_id
      JOIN organization org
        ON org.tenant_id = admin.tenant_id
       AND org.display_name = 'White Bear Lake High School'
      JOIN shoot_location loc
        ON loc.tenant_id = org.tenant_id
       AND loc.organization_id = org.id
       AND loc.name = 'Downtown Demo Park'
      JOIN organization_contact contact
        ON contact.tenant_id = org.tenant_id
       AND contact.organization_id = org.id
       AND contact.full_name = 'Jamie Carlson'
      WHERE lower(admin.email) = lower('admin@example.com')
      ORDER BY studio.created_at ASC
      LIMIT 1
    `
  );

  const context = seedContext.rows[0];
  tenantId = context.tenant_id;
  studioId = context.studio_id;
  adminUserId = context.admin_user_id;
  leadershipUserId = context.leadership_user_id;
  seniorUserId = context.senior_user_id;
  organizationId = context.organization_id;
  locationId = context.location_id;
  primaryContactId = context.primary_contact_id;
  locationName = context.location_name;
  locationAddress = context.location_address;
});

beforeEach(async () => {
  await cleanupCreatedRecords();
});

afterAll(async () => {
  await cleanupCreatedRecords();
});

describe("phase G1 compliance workspace", () => {
  it("projects mixed compliance sources into one review desk with linked detail context", async () => {
    const fixture = await createComplianceFixture();

    const missingSetupFlagId = await insertComplianceFlag({
      itemType: "missing_setup_photo",
      shiftId: fixture.shiftId,
      shootId: fixture.shootId,
      sessionId: null,
      linkedExceptionRequestId: null,
      severity: "warning",
      metadata: { message: "Setup Photo is still missing for this Shoot." }
    });

    const endOfDayRequestId = await insertExceptionRequest({
      requestType: "other",
      linkedShiftId: fixture.shiftId,
      linkedShootId: fixture.shootId,
      note: "Need leadership review for final drive-home correction.",
      requestedState: "office_drive"
    });
    await insertComplianceFlag({
      itemType: "unresolved_end_of_day_confirmation",
      shiftId: fixture.shiftId,
      shootId: fixture.shootId,
      sessionId: null,
      linkedExceptionRequestId: endOfDayRequestId,
      severity: "warning",
      metadata: { message: "This Time Session still needs end-of-day confirmation." }
    });

    const noLunchExceptionId = await insertAttendanceException({
      exceptionType: "NO_LUNCH_CHALLENGE",
      workflowKind: "exception",
      missingDirection: null,
      notes: "Worked straight through lunch because the gym turnaround never paused.",
      requestedValue: { reason: "continuous_shoot" }
    });
    await insertExceptionRequest({
      requestType: "lunch_deduction_challenge",
      linkedShiftId: fixture.shiftId,
      linkedShootId: fixture.shootId,
      relatedAttendanceExceptionId: noLunchExceptionId,
      note: "Challenge lunch deduction for uninterrupted coverage."
    });

    const correctedStart = new Date(Date.now() - 55 * 60 * 1000).toISOString();
    const missedPunchExceptionId = await insertAttendanceException({
      exceptionType: "MISSED_PUNCH",
      workflowKind: "missed_punch",
      missingDirection: "in",
      notes: "Photographer forgot to clock in at arrival.",
      correctedTime: correctedStart,
      requestedValue: { corrected_time: correctedStart }
    });
    const missedPunchRequestId = await insertExceptionRequest({
      requestType: "missing_clock_in",
      linkedShiftId: fixture.shiftId,
      linkedShootId: fixture.shootId,
      relatedAttendanceExceptionId: missedPunchExceptionId,
      requestedStartTime: correctedStart,
      note: "Please review missed clock-in correction."
    });

    await insertPresenceIncident({
      alertType: "likely_present_missing_clock_in",
      linkedCorrectionRequestId: missedPunchRequestId,
      shiftId: fixture.shiftId,
      shootId: fixture.shootId,
      geofenceClassification: "inside_soft_radius"
    });

    await insertResourceUpload({
      shootId: fixture.shootId,
      shiftId: fixture.shiftId,
      fileName: "setup-reference.jpg"
    });

    await insertPostShootEvaluation({
      shootId: fixture.shootId,
      shiftId: fixture.shiftId
    });

    const response = await request(app)
      .get(`/api/compliance/workspace?status=unresolved&shoot_id=${fixture.shootId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body.summary.open_count).toBe(5);
    expect(response.body.summary.payroll_blocking_count).toBe(4);
    expect(response.body.summary.mileage_blocking_count).toBe(0);
    expect(response.body.summary.missing_closeout_count).toBe(1);
    expect(response.body.summary.unresolved_end_of_day_confirmation_count).toBe(1);
    expect(response.body.summary.counts_by_urgency.important).toBeGreaterThanOrEqual(3);
    expect(response.body.freshness.generated_at).toEqual(expect.any(String));
    expect(response.body.freshness.latest_unresolved_item_updated_at).toEqual(expect.any(String));
    expect(response.body.summary.counts_by_issue_type.no_lunch_challenge).toBe(1);
    expect(response.body.summary.counts_by_issue_type.missed_clock_in_request).toBe(1);
    expect(response.body.summary.counts_by_issue_type.likely_present_missing_clock_in).toBe(1);
    expect(response.body.summary.missed_clock_in_review_count).toBe(1);
    expect(response.body.summary.no_lunch_review_count).toBe(1);
    expect(response.body.summary.presence_incident_review_count).toBe(1);
    expect(response.body.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issue_type: "missing_setup_photo",
          source_kind: "compliance_flag",
          blocker: expect.objectContaining({ state: "closeout_blocked", owning_workspace_hash: "#employees/compliance" })
        }),
        expect.objectContaining({
          issue_type: "no_lunch_challenge",
          source_kind: "attendance_exception",
          blocker: expect.objectContaining({ state: "payroll_blocked", owning_workspace_hash: "#operations/attendance" })
        }),
        expect.objectContaining({
          issue_type: "missed_clock_in_request",
          source_kind: "attendance_exception",
          blocker: expect.objectContaining({ state: "payroll_blocked", owning_workspace_hash: "#operations/attendance" })
        }),
        expect.objectContaining({ issue_type: "likely_present_missing_clock_in", source_kind: "presence_incident" }),
        expect.objectContaining({ issue_type: "unresolved_end_of_day_confirmation", source_kind: "compliance_flag" })
      ])
    );
    const missingSetupIndex = response.body.rows.findIndex((row: { issue_type: string }) => row.issue_type === "missing_setup_photo");
    const missedPunchIndex = response.body.rows.findIndex((row: { issue_type: string }) => row.issue_type === "missed_clock_in_request");
    expect(missedPunchIndex).toBeGreaterThanOrEqual(0);
    expect(missingSetupIndex).toBeGreaterThan(missedPunchIndex);

    const filtered = await request(app)
      .get(
        `/api/compliance/workspace?issue_type=missed_clock_in_request&status=unresolved&shoot_id=${fixture.shootId}`
      )
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(filtered.status).toBe(200);
    expect(filtered.body.rows).toHaveLength(1);
    expect(filtered.body.rows[0].source_id).toBe(missedPunchExceptionId);

    const detail = await request(app)
      .get(`/api/compliance/workspace/attendance_exception/${missedPunchExceptionId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(detail.status).toBe(200);
    expect(detail.body.item.issue_type).toBe("missed_clock_in_request");
    expect(detail.body.item.blocker).toMatchObject({
      state: "payroll_blocked",
      owning_workspace_hash: "#operations/attendance"
    });
    expect(detail.body.deep_links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "compliance", hash: "#employees/compliance" }),
        expect.objectContaining({ id: "attendance", hash: "#operations/attendance" }),
        expect.objectContaining({ id: "payroll_review", hash: "#employees/payroll" })
      ])
    );
    expect(detail.body.available_actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "approve_missed_clock_in", kind: "review", hash: null }),
        expect.objectContaining({ label: "Open Attendance", kind: "drill_out", hash: "#operations/attendance" })
      ])
    );
    expect(detail.body.payroll_impact).toMatchObject({
      blocked: true
    });
    expect(detail.body.mileage_impact).toMatchObject({
      blocked: false
    });
    expect(detail.body.history.length).toBeGreaterThan(0);
    expect(detail.body.linked_records.correction_request).toMatchObject({
      id: missedPunchRequestId,
      request_type: "missing_clock_in"
    });
    expect(new Date(detail.body.linked_records.correction_request.requested_start_time).toISOString()).toBe(correctedStart);
    expect(detail.body.linked_records.post_shoot_evaluation).toMatchObject({
      overall_shoot_status: "successful",
      submit_for_mileage: true,
      vehicle_type: "personal_vehicle"
    });
    expect(detail.body.linked_records.resource_uploads).toEqual(
      expect.arrayContaining([expect.objectContaining({ file_name: "setup-reference.jpg" })])
    );

    const flagDetail = await request(app)
      .get(`/api/compliance/workspace/compliance_flag/${missingSetupFlagId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(flagDetail.status).toBe(200);
    expect(flagDetail.body.item.issue_type).toBe("missing_setup_photo");
    expect(flagDetail.body.item.blocker).toMatchObject({
      state: "closeout_blocked",
      owning_workspace_hash: "#employees/compliance"
    });
    expect(flagDetail.body.linked_records.shoot).toMatchObject({
      id: fixture.shootId,
      shoot_code: fixture.shootCode
    });

    const legacyAlias = await request(app)
      .get(`/api/attendance/compliance-review?status=unresolved&shoot_id=${fixture.shootId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(legacyAlias.status).toBe(200);
    expect(legacyAlias.headers["x-pmc-canonical-route"]).toBe("/api/compliance/workspace");
    expect(legacyAlias.headers["x-pmc-deprecated-route"]).toBe("true");
  }, 15000);
});

async function createComplianceFixture() {
  const startsAt = new Date(Date.now() - 90 * 60 * 1000);
  const endsAt = new Date(Date.now() + 90 * 60 * 1000);
  const shootCode = `CMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const shootDate = toLocalDateString(startsAt);

  const createResponse = await request(app)
    .post("/api/shoots")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      studio_id: studioId,
      organization_id: organizationId,
      location_id: locationId,
      primary_contact_id: primaryContactId,
      shoot_type: "schools_underclass_portraits",
      shoot_code: shootCode,
      title: "Phase G1 Compliance Fixture",
      shoot_date: shootDate,
      geofence_radius_meters: 180,
      showtime: startsAt.toISOString(),
      arrival_time: startsAt.toISOString(),
      start_time: startsAt.toISOString(),
      end_time_est: endsAt.toISOString(),
      planned_staff_count: 1,
      required_lead_count: 1,
      special_instructions: "Compliance workspace integration fixture."
    });

  expect(createResponse.status).toBe(201);
  const shootId = createResponse.body.id as string;
  createdShootIds.push(shootId);

  const shiftInsert = await pool.query<{ id: string }>(
    `
      INSERT INTO work_shift (
        tenant_id, shoot_id, studio_id, assigned_user_id, manager_user_id, created_by_user_id, published_by_user_id,
        shift_kind, status, department, staffing_role, satisfies_lead_coverage, title, starts_at, ends_at,
        location_name, location_address, geofence_radius_meters, navigation_url, notes, published_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$6,
        'shoot','published','schools','senior_photographer',true,$7,$8,$9,
        $10,$11,180,'https://maps.example/compliance-fixture','Compliance workspace test shift',now()
      )
      RETURNING id
    `,
    [
      tenantId,
      shootId,
      studioId,
      seniorUserId,
      leadershipUserId,
      adminUserId,
      `${shootCode} Senior Coverage`,
      startsAt.toISOString(),
      endsAt.toISOString(),
      locationName,
      locationAddress
    ]
  );

  const shiftId = shiftInsert.rows[0].id;
  createdShiftIds.push(shiftId);

  return { shootId, shiftId, shootCode };
}

async function insertAttendanceException(input: {
  exceptionType: string;
  workflowKind: string;
  missingDirection: "in" | "out" | null;
  notes: string;
  requestedValue?: Record<string, unknown>;
  correctedTime?: string | null;
}) {
  const { rows } = await pool.query<{ id: string }>(
    `
      INSERT INTO attendance_exception (
        tenant_id,
        shift_id,
        shoot_id,
        user_id,
        exception_type,
        workflow_kind,
        missing_direction,
        status,
        severity,
        classification,
        notes,
        requested_value,
        original_value,
        corrected_time
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7::punch_direction,'open','high','review_required',$8,$9::jsonb,'{}'::jsonb,$10::timestamptz
      )
      RETURNING id
    `,
    [
      tenantId,
      createdShiftIds[0],
      createdShootIds[0],
      seniorUserId,
      input.exceptionType,
      input.workflowKind,
      input.missingDirection,
      input.notes,
      JSON.stringify(input.requestedValue ?? {}),
      input.correctedTime ?? null
    ]
  );
  createdAttendanceExceptionIds.push(rows[0].id);
  return rows[0].id;
}

async function insertExceptionRequest(input: {
  requestType: string;
  linkedShiftId: string;
  linkedShootId: string;
  relatedAttendanceExceptionId?: string | null;
  requestedStartTime?: string | null;
  requestedState?: "office_drive" | "photography" | null;
  note: string;
}) {
  const { rows } = await pool.query<{ id: string }>(
    `
      INSERT INTO exception_request (
        tenant_id,
        employee_id,
        request_type,
        linked_shift_id,
        linked_shoot_id,
        requested_approver_id,
        related_attendance_exception_id,
        requested_state,
        requested_start_time,
        note,
        status,
        reporting_flags
      )
      VALUES (
        $1,$2,$3::exception_request_type,$4,$5,$6,$7,$8::time_work_state,$9::timestamptz,$10,'submitted',$11::text[]
      )
      RETURNING id
    `,
    [
      tenantId,
      seniorUserId,
      input.requestType,
      input.linkedShiftId,
      input.linkedShootId,
      leadershipUserId,
      input.relatedAttendanceExceptionId ?? null,
      input.requestedState ?? null,
      input.requestedStartTime ?? null,
      input.note,
      input.requestType === "missing_clock_in" ? ["manual_adjustment", "missed_clock_in_approval"] : []
    ]
  );
  createdExceptionRequestIds.push(rows[0].id);
  return rows[0].id;
}

async function insertPresenceIncident(input: {
  alertType: "assigned_but_missing" | "likely_present_missing_clock_in";
  linkedCorrectionRequestId?: string | null;
  shiftId: string;
  shootId: string;
  geofenceClassification: "inside_shoot_radius" | "inside_soft_radius" | "outside_soft_radius" | "inside_studio_radius" | "outside_studio_radius" | "unknown";
}) {
  const { rows } = await pool.query<{ id: string }>(
    `
      INSERT INTO time_clock_presence_incident (
        tenant_id,
        employee_id,
        shift_id,
        shoot_id,
        alert_type,
        geofence_classification,
        current_state,
        resolution_status,
        linked_correction_request_id,
        repeat_count,
        last_notified_at
      )
      VALUES (
        $1,$2,$3,$4,$5::time_presence_alert_type,$6::time_presence_geofence_classification,'off_clock','open',$7,1,now()
      )
      RETURNING id
    `,
    [tenantId, seniorUserId, input.shiftId, input.shootId, input.alertType, input.geofenceClassification, input.linkedCorrectionRequestId ?? null]
  );
  createdPresenceIncidentIds.push(rows[0].id);
  return rows[0].id;
}

async function insertComplianceFlag(input: {
  itemType:
    | "missing_setup_photo"
    | "missing_post_shoot_evaluation"
    | "mileage_blocked_missing_post_shoot_evaluation"
    | "upload_while_off_clock"
    | "unresolved_end_of_day_confirmation";
  shiftId: string;
  shootId: string;
  sessionId: string | null;
  linkedExceptionRequestId: string | null;
  severity: "warning" | "high";
  metadata: Record<string, unknown>;
}) {
  const { rows } = await pool.query<{ id: string }>(
    `
      INSERT INTO time_clock_compliance_flag (
        tenant_id,
        employee_id,
        shift_id,
        session_id,
        shoot_id,
        organization_id,
        location_id,
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
        $1,$2,$3,$4,$5,$6,$7,$8,$9::time_clock_compliance_item,$10::time_clock_compliance_severity,'open',$11,$12::jsonb,now(),now()
      )
      RETURNING id
    `,
    [
      tenantId,
      seniorUserId,
      input.shiftId,
      input.sessionId,
      input.shootId,
      organizationId,
      locationId,
      input.linkedExceptionRequestId,
      input.itemType,
      input.severity,
      `compliance-workspace:${input.itemType}:${crypto.randomUUID()}`,
      JSON.stringify(input.metadata)
    ]
  );
  createdComplianceFlagIds.push(rows[0].id);
  return rows[0].id;
}

async function insertResourceUpload(input: { shootId: string; shiftId: string; fileName: string }) {
  const { rows } = await pool.query<{ id: string }>(
    `
      INSERT INTO resource_library_item (
        tenant_id,
        organization_id,
        location_id,
        shoot_id,
        uploader_user_id,
        uploader_name,
        resource_type,
        category,
        note,
        issue_type,
        approval_status,
        visibility_scope,
        file_name,
        content_type,
        file_size_bytes,
        storage_key,
        file_url,
        upload_source,
        created_at,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,'Senior Photographer','image','setup_photo','Setup captured after arrival.',NULL,'approved','photographer_prep',$6,'image/jpeg',102400,$7,$8,'mobile_library',now(),now()
      )
      RETURNING id
    `,
    [
      tenantId,
      organizationId,
      locationId,
      input.shootId,
      seniorUserId,
      input.fileName,
      `compliance-workspace/${crypto.randomUUID()}.jpg`,
      `https://files.example/${crypto.randomUUID()}.jpg`
    ]
  );
  createdResourceItemIds.push(rows[0].id);
  return rows[0].id;
}

async function insertPostShootEvaluation(input: { shootId: string; shiftId: string }) {
  const { rows } = await pool.query<{ id: string }>(
    `
      INSERT INTO post_shoot_evaluation (
        tenant_id,
        location_id,
        shoot_id,
        organization_id,
        shift_id,
        shoot_name,
        shoot_date,
        photographer_user_id,
        photographer_name,
        shoot_type,
        on_time,
        easy_access,
        overall_rating,
        photos_uploaded,
        overall_shoot_status,
        went_well,
        remember_next_time,
        issue_flag,
        open_comment,
        submitted_at,
        submit_for_mileage,
        vehicle_type
      )
      VALUES (
        $1,$2,$3,$4,$5,'Phase G1 Compliance Fixture',$6::date,$7,'Senior Photographer','Schools','Yes','Yes',5,'Yes','successful',
        'Crew flow was smooth once the gym opened.',
        'Bring the same backdrop placement next season.',
        false,
        'All closeout details looked clean.',
        now(),
        true,
        'personal_vehicle'::mileage_vehicle_type
      )
      RETURNING id
    `,
    [tenantId, locationId, input.shootId, organizationId, input.shiftId, toLocalDateString(new Date()), seniorUserId]
  );
  createdEvaluationIds.push(rows[0].id);
  return rows[0].id;
}

async function cleanupCreatedRecords() {
  if (createdPresenceIncidentIds.length) {
    await pool.query("DELETE FROM time_clock_presence_incident WHERE id = ANY($1::uuid[])", [createdPresenceIncidentIds]);
    createdPresenceIncidentIds.length = 0;
  }
  if (createdComplianceFlagIds.length) {
    await pool.query("DELETE FROM time_clock_compliance_flag WHERE id = ANY($1::uuid[])", [createdComplianceFlagIds]);
    createdComplianceFlagIds.length = 0;
  }
  if (createdResourceItemIds.length) {
    await pool.query("DELETE FROM resource_library_item WHERE id = ANY($1::uuid[])", [createdResourceItemIds]);
    createdResourceItemIds.length = 0;
  }
  if (createdEvaluationIds.length) {
    await pool.query("DELETE FROM post_shoot_evaluation WHERE id = ANY($1::uuid[])", [createdEvaluationIds]);
    createdEvaluationIds.length = 0;
  }
  if (createdExceptionRequestIds.length) {
    await pool.query("DELETE FROM approval_record WHERE request_id = ANY($1::uuid[])", [createdExceptionRequestIds]);
    await pool.query("DELETE FROM exception_request WHERE id = ANY($1::uuid[])", [createdExceptionRequestIds]);
    createdExceptionRequestIds.length = 0;
  }
  if (createdAttendanceExceptionIds.length) {
    await pool.query("DELETE FROM attendance_exception WHERE id = ANY($1::uuid[])", [createdAttendanceExceptionIds]);
    createdAttendanceExceptionIds.length = 0;
  }
  if (createdShiftIds.length) {
    await pool.query("DELETE FROM time_entry WHERE shift_id = ANY($1::uuid[])", [createdShiftIds]);
    await pool.query("DELETE FROM shift_punch WHERE shift_id = ANY($1::uuid[])", [createdShiftIds]);
    await pool.query("DELETE FROM shift_segment WHERE shift_id = ANY($1::uuid[])", [createdShiftIds]);
    await pool.query("DELETE FROM work_shift WHERE id = ANY($1::uuid[])", [createdShiftIds]);
    createdShiftIds.length = 0;
  }
  if (createdShootIds.length) {
    await pool.query("DELETE FROM shoot_contact_link WHERE shoot_id = ANY($1::uuid[])", [createdShootIds]);
    await pool.query("DELETE FROM shoot WHERE id = ANY($1::uuid[])", [createdShootIds]);
    createdShootIds.length = 0;
  }
}

function toLocalDateString(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// G1 Part 2 — leadership summary counts (count==rows invariant), linked labor categories, and
// the SSA-3 mileage label nuance. These assert over whatever rows the workspace returns, so they
// hold on any dataset — the invariant is the contract.
describe("compliance workspace G1 part 2", () => {
  async function fetchWorkspace(query = "") {
    const res = await request(app)
      .get(`/api/compliance/workspace${query}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    return res.body as {
      summary: Record<string, number> & { counts_by_issue_type: Record<string, number> };
      linked_categories: Array<Record<string, unknown>>;
      rows: Array<{
        status_bucket: string;
        issue_type: string;
        resolved_at: string | null;
        payroll_blocking: boolean;
        mileage_blocking: boolean;
      }>;
    };
  }

  const EMPLOYEE_TYPES = new Set([
    "missing_setup_photo",
    "missing_post_shoot_evaluation",
    "mileage_blocked_missing_post_shoot_evaluation",
    "unresolved_end_of_day_confirmation"
  ]);
  const MANAGER_TYPES = new Set([
    "no_lunch_challenge",
    "missed_clock_in_request",
    "upload_while_off_clock",
    "likely_present_missing_clock_in",
    "assigned_but_missing",
    "manual_time_adjustment",
    "mileage_review_required"
  ]);

  it("keeps every leadership summary count equal to its matching returned rows", async () => {
    const body = await fetchWorkspace("?status=all&window=all");
    const unresolved = body.rows.filter((row) => row.status_bucket === "unresolved");
    expect(body.summary.needs_employee_correction_count).toBe(
      unresolved.filter((row) => EMPLOYEE_TYPES.has(row.issue_type)).length
    );
    expect(body.summary.needs_manager_review_count).toBe(
      unresolved.filter((row) => MANAGER_TYPES.has(row.issue_type)).length
    );
    // the two triage buckets partition the issue-type space: together they cover every unresolved row
    expect(
      body.summary.needs_employee_correction_count + body.summary.needs_manager_review_count
    ).toBe(unresolved.length);
    expect(body.summary.payroll_blocking_count).toBe(unresolved.filter((row) => row.payroll_blocking).length);
    expect(body.summary.mileage_blocking_count).toBe(unresolved.filter((row) => row.mileage_blocking).length);
    expect(body.summary.overdue_count).toBeLessThanOrEqual(unresolved.length);
  });

  it("counts resolved_today only from RETURNED resolved rows (0 when the filter excludes them)", async () => {
    const unresolvedOnly = await fetchWorkspace("?status=unresolved&window=all");
    expect(unresolvedOnly.summary.resolved_today_count).toBe(0);
    const all = await fetchWorkspace("?status=all&window=all");
    const today = toLocalDateString(new Date());
    const resolvedToday = all.rows.filter(
      (row) => row.status_bucket === "resolved" && row.resolved_at && toLocalDateString(new Date(row.resolved_at)) === today
    );
    expect(all.summary.resolved_today_count).toBe(resolvedToday.length);
  });

  // G1 Part 2b — the two new first-class item types, with working (non-dead) detail drill-ins.
  describe("part 2b item types", () => {
    let adjustmentRequestId = "";
    let mileageReviewId = "";
    let excludedMileageId = "";
    let fixtureEmployeeId = "";

    beforeAll(async () => {
      const employee = await pool.query<{ id: string; tenant_id: string }>(
        `SELECT id, tenant_id FROM app_user WHERE lower(email) = lower('senior@example.com') LIMIT 1`
      );
      fixtureEmployeeId = employee.rows[0].id;
      const fixtureTenantId = employee.rows[0].tenant_id;

      const adjustment = await pool.query<{ id: string }>(
        `INSERT INTO exception_request (tenant_id, employee_id, request_type, status, note)
         VALUES ($1, $2, 'time_segment_correction', 'submitted', 'G1P2B-TEST manual adjustment')
         RETURNING id`,
        [fixtureTenantId, fixtureEmployeeId]
      );
      adjustmentRequestId = adjustment.rows[0].id;

      // review_required with a NON-eval reason -> must appear as mileage_review_required.
      const review = await pool.query<{ id: string }>(
        `INSERT INTO mileage_reimbursement (tenant_id, employee_id, work_date, status, review_reason_code)
         VALUES ($1, $2, CURRENT_DATE - 100, 'review_required', 'missing_zone_match')
         RETURNING id`,
        [fixtureTenantId, fixtureEmployeeId]
      );
      mileageReviewId = review.rows[0].id;

      // review_required with the EVAL reason -> owned by the compliance flag type, must be excluded.
      const excluded = await pool.query<{ id: string }>(
        `INSERT INTO mileage_reimbursement (tenant_id, employee_id, work_date, status, review_reason_code)
         VALUES ($1, $2, CURRENT_DATE - 101, 'review_required', 'missing_post_shoot_evaluation')
         RETURNING id`,
        [fixtureTenantId, fixtureEmployeeId]
      );
      excludedMileageId = excluded.rows[0].id;
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM exception_request WHERE id = $1`, [adjustmentRequestId]);
      await pool.query(`DELETE FROM mileage_reimbursement WHERE id = ANY($1::uuid[])`, [[mileageReviewId, excludedMileageId]]);
    });

    it("emits manual_time_adjustment items with count==rows and a working detail drill-in", async () => {
      const body = await fetchWorkspace("?status=all&window=all&issue_type=manual_time_adjustment");
      const mine = body.rows.filter(
        (row) => (row as Record<string, unknown>).source_id === adjustmentRequestId
      );
      expect(mine).toHaveLength(1);
      const item = mine[0] as Record<string, unknown>;
      expect(item.issue_type).toBe("manual_time_adjustment");
      expect(item.payroll_blocking).toBe(true);
      expect(body.summary.counts_by_issue_type.manual_time_adjustment).toBe(
        body.rows.filter((row) => row.issue_type === "manual_time_adjustment" && row.status_bucket === "unresolved").length
      );
      // detail drill-in works (no dead rows)
      const detail = await request(app)
        .get(`/api/compliance/workspace/exception_request/${adjustmentRequestId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(detail.status).toBe(200);
      expect(detail.body.item.issue_type).toBe("manual_time_adjustment");
      expect(detail.body.payroll_impact.blocked).toBe(true);
    });

    it("emits mileage_review_required items, excludes eval-reason rows, and drills into detail", async () => {
      const body = await fetchWorkspace("?status=all&window=all&issue_type=mileage_review_required");
      const ids = body.rows.map((row) => (row as Record<string, unknown>).source_id);
      expect(ids).toContain(mileageReviewId);
      // the eval-reason row is owned by the compliance-flag type — never duplicated here
      expect(ids).not.toContain(excludedMileageId);
      const item = body.rows.find(
        (row) => (row as Record<string, unknown>).source_id === mileageReviewId
      ) as Record<string, unknown>;
      expect(item.mileage_blocking).toBe(true);
      expect(body.summary.counts_by_issue_type.mileage_review_required).toBe(
        body.rows.filter((row) => row.issue_type === "mileage_review_required" && row.status_bucket === "unresolved").length
      );
      const detail = await request(app)
        .get(`/api/compliance/workspace/mileage_reimbursement/${mileageReviewId}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(detail.status).toBe(200);
      expect(detail.body.item.issue_type).toBe("mileage_review_required");
      expect(detail.body.mileage_impact.blocked).toBe(true);
    });
  });

  it("returns live linked labor categories with exact destinations, never fake zeros for absent sources", async () => {
    const body = await fetchWorkspace();
    expect(body.linked_categories).toHaveLength(2);
    const byKey = new Map(body.linked_categories.map((cat) => [cat.key, cat]));
    const labor = byKey.get("labor_command_center") as Record<string, unknown>;
    const selfCheck = byKey.get("payroll_self_check") as Record<string, unknown>;
    expect(labor.destination_hash).toBe("#labor/command-center");
    expect(selfCheck.destination_hash).toBe("#my-work/payroll-self-check");
    for (const category of [labor, selfCheck]) {
      if (category.available === true) {
        // live counts must be real numbers with a human detail line
        const counts = category.counts as Record<string, number>;
        for (const value of Object.values(counts)) {
          expect(typeof value).toBe("number");
          expect(value).toBeGreaterThanOrEqual(0);
        }
        expect(typeof category.detail).toBe("string");
      } else {
        // an unavailable source must carry a reason and no counts at all
        expect(category.available).toBe(false);
        expect(typeof category.reason).toBe("string");
        expect(category).not.toHaveProperty("counts");
      }
    }
  });
});
