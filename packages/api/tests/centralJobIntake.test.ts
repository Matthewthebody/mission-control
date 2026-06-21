import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import {
  evaluateJobReadiness,
  normalizeIntakePayload,
  parseJobIntakeText,
  sanitizeProtectedFieldUpdates,
  validateJobDraft,
  validateJobPublish
} from "../src/services/centralJobIntake.js";

let app: Express;
let dbPool: Pool;
let leadershipToken = "";
let leadershipAuth: any;
let adminToken = "";
let schoolsOfficeToken = "";
let sportsOfficeToken = "";
let publishDraftJobFn: any;
let withClientTransactionFn: any;

let schoolsOrganizationId = "";
let schoolsOrganizationName = "";
let schoolsLocationId = "";
let schoolsLocationName = "";
let schoolsPrimaryContactId = "";
let schoolsPrimaryContactName = "";
let schoolsJobType = "schools_underclass_portraits";
let schoolsShootDate = "";
let schoolsFutureBaseDate = "";
let schoolsOfficeUserId = "";

let sportsOrganizationId = "";
let sportsOrganizationName = "";
let sportsLocationId = "";
let sportsLocationName = "";
let sportsPrimaryContactId = "";
let sportsPrimaryContactName = "";
let sportsJobType = "sports";
let sportsShootDate = "";
let sportsFutureBaseDate = "";
let sportsOfficeUserId = "";
const RUN_UNIQUIFIER = Math.floor(Date.now() / 1000) % 10000;

function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function futureSchoolsDate(offset: number) {
  return addDays(schoolsFutureBaseDate || schoolsShootDate, offset);
}

function futureSportsDate(offset: number) {
  return addDays(sportsFutureBaseDate || sportsShootDate, offset);
}

function relativeToToday(days: number) {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + days);
  return now.toISOString().slice(0, 10);
}

function uniqueRelativeDate(offset: number) {
  return relativeToToday(RUN_UNIQUIFIER + offset);
}

async function loginAndFetchAuth(email: string) {
  const login = await request(app).post("/auth/dev-login").send({ email });
  const token = login.body.token as string;
  const me = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
  return {
    token,
    auth: me.body.user
  };
}

async function createDraft(token: string, payload: Record<string, unknown>) {
  return request(app).post("/api/shoots/intake/drafts").set("Authorization", `Bearer ${token}`).send(payload);
}

async function duplicateCheck(token: string, draftId: string) {
  return request(app)
    .post(`/api/shoots/intake/drafts/${draftId}/duplicate-check`)
    .set("Authorization", `Bearer ${token}`);
}

async function publishDraft(token: string, draftId: string, payload: Record<string, unknown> = {}) {
  return request(app)
    .post(`/api/shoots/intake/drafts/${draftId}/publish`)
    .set("Authorization", `Bearer ${token}`)
    .send(payload);
}

async function createImportSession(token: string, payload: Record<string, unknown>) {
  return request(app).post("/api/shoots/intake/import-sessions").set("Authorization", `Bearer ${token}`).send(payload);
}

async function updateImportMapping(token: string, sessionId: string, payload: Record<string, unknown>) {
  return request(app)
    .patch(`/api/shoots/intake/import-sessions/${sessionId}/mapping`)
    .set("Authorization", `Bearer ${token}`)
    .send(payload);
}

async function commitImportSession(token: string, sessionId: string, payload: Record<string, unknown> = {}) {
  return request(app)
    .post(`/api/shoots/intake/import-sessions/${sessionId}/commit`)
    .set("Authorization", `Bearer ${token}`)
    .send(payload);
}

beforeAll(async () => {
  process.env.CENTRAL_JOB_INTAKE_V1_ENABLED = "true";
  const { createApp } = await import("../src/app.js");
  const { pool } = await import("../src/db/pool.js");
  const { publishDraftJob } = await import("../src/services/centralJobIntake.js");
  const { withClientTransaction } = await import("../src/db/tx.js");
  app = createApp();
  dbPool = pool;
  publishDraftJobFn = publishDraftJob;
  withClientTransactionFn = withClientTransaction;

  const leadershipLogin = await loginAndFetchAuth("leadership@example.com");
  leadershipToken = leadershipLogin.token;
  leadershipAuth = leadershipLogin.auth;

  adminToken = (await loginAndFetchAuth("admin@example.com")).token;
  schoolsOfficeToken = (await loginAndFetchAuth("schools-office@example.com")).token;
  sportsOfficeToken = (await loginAndFetchAuth("sports-office@example.com")).token;

  const seededSchoolsJob = await dbPool.query<{
    organization_id: string;
    organization_name: string;
    location_id: string;
    location_name: string;
    primary_contact_id: string;
    primary_contact_name: string;
    job_type: string;
    shoot_date: string;
  }>(
    `
      SELECT
        s.organization_id::text AS organization_id,
        o.display_name AS organization_name,
        s.location_id::text AS location_id,
        sl.name AS location_name,
        s.primary_contact_id::text AS primary_contact_id,
        oc.full_name AS primary_contact_name,
        s.shoot_type::text AS job_type,
        s.shoot_date::text AS shoot_date
      FROM shoot s
      JOIN organization o
        ON o.tenant_id = s.tenant_id
       AND o.id = s.organization_id
      LEFT JOIN shoot_location sl
        ON sl.tenant_id = s.tenant_id
       AND sl.id = s.location_id
      LEFT JOIN organization_contact oc
        ON oc.tenant_id = s.tenant_id
       AND oc.id = s.primary_contact_id
      WHERE s.deleted_at IS NULL
        AND s.department = 'schools'::department_code
        AND s.record_state = 'published'::shoot_record_state
        AND s.organization_id IS NOT NULL
        AND s.location_id IS NOT NULL
        AND s.primary_contact_id IS NOT NULL
      ORDER BY s.shoot_date ASC, s.created_at ASC
      LIMIT 1
    `
  );

  const seededSportsJob = await dbPool.query<{
    organization_id: string;
    organization_name: string;
    location_id: string;
    location_name: string;
    primary_contact_id: string;
    primary_contact_name: string;
    job_type: string;
    shoot_date: string;
  }>(
    `
      SELECT
        s.organization_id::text AS organization_id,
        o.display_name AS organization_name,
        s.location_id::text AS location_id,
        sl.name AS location_name,
        s.primary_contact_id::text AS primary_contact_id,
        oc.full_name AS primary_contact_name,
        s.shoot_type::text AS job_type,
        s.shoot_date::text AS shoot_date
      FROM shoot s
      JOIN organization o
        ON o.tenant_id = s.tenant_id
       AND o.id = s.organization_id
      LEFT JOIN shoot_location sl
        ON sl.tenant_id = s.tenant_id
       AND sl.id = s.location_id
      LEFT JOIN organization_contact oc
        ON oc.tenant_id = s.tenant_id
       AND oc.id = s.primary_contact_id
      WHERE s.deleted_at IS NULL
        AND s.department = 'sports'::department_code
        AND s.record_state = 'published'::shoot_record_state
        AND s.organization_id IS NOT NULL
        AND s.location_id IS NOT NULL
        AND s.primary_contact_id IS NOT NULL
      ORDER BY s.shoot_date ASC, s.created_at ASC
      LIMIT 1
    `
  );

  const officeUsers = await dbPool.query<{ email: string; id: string }>(
    `
      SELECT email, id::text
      FROM app_user
      WHERE email IN ('schools-office@example.com', 'sports-office@example.com')
    `
  );
  schoolsOfficeUserId = officeUsers.rows.find((row) => row.email === "schools-office@example.com")?.id ?? "";
  sportsOfficeUserId = officeUsers.rows.find((row) => row.email === "sports-office@example.com")?.id ?? "";

  schoolsOrganizationId = seededSchoolsJob.rows[0].organization_id;
  schoolsOrganizationName = seededSchoolsJob.rows[0].organization_name;
  schoolsLocationId = seededSchoolsJob.rows[0].location_id;
  schoolsLocationName = seededSchoolsJob.rows[0].location_name;
  schoolsPrimaryContactId = seededSchoolsJob.rows[0].primary_contact_id;
  schoolsPrimaryContactName = seededSchoolsJob.rows[0].primary_contact_name;
  schoolsJobType = seededSchoolsJob.rows[0].job_type;
  schoolsShootDate = seededSchoolsJob.rows[0].shoot_date;

  sportsOrganizationId = seededSportsJob.rows[0].organization_id;
  sportsOrganizationName = seededSportsJob.rows[0].organization_name;
  sportsLocationId = seededSportsJob.rows[0].location_id;
  sportsLocationName = seededSportsJob.rows[0].location_name;
  sportsPrimaryContactId = seededSportsJob.rows[0].primary_contact_id;
  sportsPrimaryContactName = seededSportsJob.rows[0].primary_contact_name;
  sportsJobType = seededSportsJob.rows[0].job_type;
  sportsShootDate = seededSportsJob.rows[0].shoot_date;

  const schoolsFutureBase = await dbPool.query<{ base_date: string }>(
    `
      SELECT greatest(coalesce(max(s.shoot_date), current_date), current_date)::text AS base_date
      FROM shoot s
      WHERE s.deleted_at IS NULL
        AND s.department = 'schools'::department_code
        AND s.organization_id = $1::uuid
        AND s.location_id = $2::uuid
    `,
    [schoolsOrganizationId, schoolsLocationId]
  );
  schoolsFutureBaseDate = schoolsFutureBase.rows[0]?.base_date ?? schoolsShootDate;

  const sportsFutureBase = await dbPool.query<{ base_date: string }>(
    `
      SELECT greatest(coalesce(max(s.shoot_date), current_date), current_date)::text AS base_date
      FROM shoot s
      WHERE s.deleted_at IS NULL
        AND s.department = 'sports'::department_code
        AND s.organization_id = $1::uuid
        AND s.location_id = $2::uuid
    `,
    [sportsOrganizationId, sportsLocationId]
  );
  sportsFutureBaseDate = sportsFutureBase.rows[0]?.base_date ?? sportsShootDate;
});

describe("central job intake bulk import flow", () => {
  it("stages a CSV upload and validates mapped school rows", async () => {
    const csvText = [
      "Organization,Location,Primary Contact,Job Type,Job Owner,Start Date,Start Time,Timezone,Production Required,Staffing Required,Staffing Estimate,School Job Type,Roster Status,Internal Notes",
      `${schoolsOrganizationName},${schoolsLocationName},${schoolsPrimaryContactName},schools_underclass_portraits,schools-office@example.com,${futureSchoolsDate(200)},08:15 AM,America/Chicago,yes,yes,2,underclass,received,Front office confirmed`
    ].join("\n");

    const createResponse = await createImportSession(schoolsOfficeToken, {
      department: "schools",
      source_filename: "schools-batch.csv",
      csv_text: csvText
    });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.headers).toContain("Organization");
    expect(createResponse.body.mapping.organization_name).toBe("Organization");

    const validateResponse = await updateImportMapping(schoolsOfficeToken, createResponse.body.session.id, {
      mapping: createResponse.body.mapping
    });

    expect(validateResponse.status).toBe(200);
    expect(validateResponse.body.session.status).toBe("validated");
    expect(validateResponse.body.rows).toHaveLength(1);
    expect(validateResponse.body.rows[0].can_create_draft).toBe(true);
    expect(validateResponse.body.rows[0].summary.organization_name).toBe(schoolsOrganizationName);
  });

  it("isolates row validation failures without blocking the rest of the session", async () => {
    const csvText = [
      "Organization,Job Type,Start Date,Internal Notes",
      `,schools_underclass_portraits,not-a-date,`,
      `${schoolsOrganizationName},schools_underclass_portraits,${futureSchoolsDate(205)},Import follow-up`
    ].join("\n");

    const createResponse = await createImportSession(schoolsOfficeToken, {
      department: "schools",
      source_filename: "schools-validation.csv",
      csv_text: csvText
    });
    const validateResponse = await updateImportMapping(schoolsOfficeToken, createResponse.body.session.id, {
      mapping: createResponse.body.mapping
    });

    expect(validateResponse.status).toBe(200);
    expect(validateResponse.body.summary.exception_rows).toBe(1);
    expect(validateResponse.body.rows[0].can_create_draft).toBe(false);
    expect(validateResponse.body.rows[0].validation_errors.some((entry: { code: string }) => entry.code === "invalid_date")).toBe(true);
    expect(validateResponse.body.rows[1].can_create_draft).toBe(true);
  });

  it("defaults import commit to draft-only mode for standard users", async () => {
    const csvText = [
      "Organization,Location,Primary Contact,Job Type,Job Owner,Start Date,Timezone,Production Required,Staffing Required,School Job Type,Roster Status,Internal Notes",
      `${schoolsOrganizationName},${schoolsLocationName},${schoolsPrimaryContactName},schools_underclass_portraits,schools-office@example.com,${futureSchoolsDate(210)},America/Chicago,yes,yes,underclass,received,Safe default draft`
    ].join("\n");

    const createResponse = await createImportSession(schoolsOfficeToken, {
      department: "schools",
      source_filename: "schools-drafts.csv",
      csv_text: csvText
    });
    await updateImportMapping(schoolsOfficeToken, createResponse.body.session.id, {
      mapping: createResponse.body.mapping
    });

    const commitResponse = await commitImportSession(schoolsOfficeToken, createResponse.body.session.id);

    expect(commitResponse.status).toBe(200);
    expect(commitResponse.body.commit_mode).toBe("create_drafts_only");
    expect(commitResponse.body.summary.drafts_created).toBe(1);
    expect(commitResponse.body.summary.jobs_published).toBe(0);
    expect(commitResponse.body.rows[0].status).toBe("draft_created");
    expect(commitResponse.body.rows[0].linked_job_id).toBeTruthy();
  });

  it("blocks standard users from import publish and hard-duplicate override modes", async () => {
    const csvText = [
      "Organization,Location,Primary Contact,Job Type,Job Owner,Start Date,Timezone,Production Required,Staffing Required,School Job Type,Roster Status,Internal Notes",
      `${schoolsOrganizationName},${schoolsLocationName},${schoolsPrimaryContactName},schools_underclass_portraits,schools-office@example.com,${futureSchoolsDate(212)},America/Chicago,yes,yes,underclass,received,Permission audit`
    ].join("\n");

    const createResponse = await createImportSession(schoolsOfficeToken, {
      department: "schools",
      source_filename: "schools-restricted-publish.csv",
      csv_text: csvText
    });
    await updateImportMapping(schoolsOfficeToken, createResponse.body.session.id, {
      mapping: createResponse.body.mapping
    });

    const publishAttempt = await commitImportSession(schoolsOfficeToken, createResponse.body.session.id, {
      mode: "publish_valid_rows_leave_exceptions"
    });
    expect(publishAttempt.status).toBe(403);
    expect(publishAttempt.body.error).toContain("Only leads and admins can batch publish");

    const overrideAttempt = await commitImportSession(schoolsOfficeToken, createResponse.body.session.id, {
      mode: "create_drafts_only",
      override_hard_duplicates: true,
      duplicate_override_note: "Should still be blocked"
    });
    expect(overrideAttempt.status).toBe(403);
    expect(overrideAttempt.body.error).toContain("Only leads and admins can override hard duplicates");
  });

  it("publishes valid sports rows while leaving exceptions untouched", async () => {
    const publishableSportsDate = futureSportsDate(210);
    const exceptionSportsDate = futureSportsDate(211);
    const csvText = [
      "Organization,Location,Primary Contact,Job Type,Job Owner,Start Date,Start Time,Timezone,Production Required,Staffing Required,Staffing Estimate,Sports Job Type,Sport Name,Internal Notes",
      `${sportsOrganizationName},${sportsLocationName},${sportsPrimaryContactName},sports,sports-office@example.com,${publishableSportsDate},06:30 PM,America/Chicago,yes,yes,2,media_day,Hockey,Ready to publish`,
      `,${sportsLocationName},${sportsPrimaryContactName},sports,sports-office@example.com,${exceptionSportsDate},06:30 PM,America/Chicago,yes,yes,2,media_day,Hockey,Missing org row`
    ].join("\n");

    const createResponse = await createImportSession(leadershipToken, {
      department: "sports",
      source_filename: "sports-publish.csv",
      csv_text: csvText
    });
    const validateResponse = await updateImportMapping(leadershipToken, createResponse.body.session.id, {
      mapping: createResponse.body.mapping
    });

    expect(validateResponse.body.summary.exception_rows).toBe(1);

    const commitResponse = await commitImportSession(leadershipToken, createResponse.body.session.id, {
      mode: "publish_valid_rows_leave_exceptions"
    });

    expect(commitResponse.status).toBe(200);
    expect(commitResponse.body.summary.jobs_published).toBe(1);
    expect(commitResponse.body.summary.exception_rows).toBe(1);
    expect(commitResponse.body.rows.some((row: { status: string }) => row.status === "published")).toBe(true);
    expect(commitResponse.body.rows.some((row: { status: string }) => row.status === "exception")).toBe(true);

    const publishedRow = commitResponse.body.rows.find((row: { status: string }) => row.status === "published");
    const publishedFetch = await request(app)
      .get(`/api/shoots/intake/jobs/${publishedRow.linked_job_id}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(publishedFetch.status).toBe(200);
    expect(publishedFetch.body.job.record_state).toBe("published");
    expect(publishedFetch.body.job.department).toBe("sports");
  });

  it("keeps one bad row from corrupting a draft-only batch commit", async () => {
    const csvText = [
      "Organization,Location,Primary Contact,Job Type,Job Owner,Start Date,Timezone,Production Required,Staffing Required,School Job Type,Roster Status,Internal Notes",
      `${schoolsOrganizationName},${schoolsLocationName},${schoolsPrimaryContactName},schools_underclass_portraits,schools-office@example.com,${futureSchoolsDate(220)},America/Chicago,yes,yes,underclass,received,Valid row`,
      `,${schoolsLocationName},${schoolsPrimaryContactName},schools_underclass_portraits,schools-office@example.com,not-a-date,America/Chicago,yes,yes,underclass,received,Bad row`
    ].join("\n");

    const createResponse = await createImportSession(schoolsOfficeToken, {
      department: "schools",
      source_filename: "schools-mixed.csv",
      csv_text: csvText
    });
    await updateImportMapping(schoolsOfficeToken, createResponse.body.session.id, {
      mapping: createResponse.body.mapping
    });

    const commitResponse = await commitImportSession(schoolsOfficeToken, createResponse.body.session.id);

    expect(commitResponse.status).toBe(200);
    expect(commitResponse.body.summary.drafts_created).toBe(1);
    expect(commitResponse.body.summary.exception_rows).toBe(1);
    expect(commitResponse.body.rows.map((row: { status: string }) => row.status)).toEqual(
      expect.arrayContaining(["draft_created", "exception"])
    );
  });

  it("detects duplicates inside an import session and blocks publish for those rows", async () => {
    const duplicateDate = futureSchoolsDate(230);
    const csvText = [
      "Organization,Location,Primary Contact,Job Type,Job Owner,Start Date,Start Time,Timezone,Production Required,Staffing Required,Staffing Estimate,School Job Type,Roster Status",
      `${schoolsOrganizationName},${schoolsLocationName},${schoolsPrimaryContactName},schools_underclass_portraits,schools-office@example.com,${duplicateDate},08:00 AM,America/Chicago,yes,yes,2,underclass,received`,
      `${schoolsOrganizationName},${schoolsLocationName},${schoolsPrimaryContactName},schools_underclass_portraits,schools-office@example.com,${duplicateDate},08:00 AM,America/Chicago,yes,yes,2,underclass,received`
    ].join("\n");

    const createResponse = await createImportSession(leadershipToken, {
      department: "schools",
      source_filename: "schools-duplicates.csv",
      csv_text: csvText
    });
    const validateResponse = await updateImportMapping(leadershipToken, createResponse.body.session.id, {
      mapping: createResponse.body.mapping
    });

    expect(validateResponse.status).toBe(200);
    expect(validateResponse.body.summary.hard_duplicate_rows).toBe(2);
    expect(
      validateResponse.body.rows.every(
        (row: { duplicate_result: { hard_block: boolean; matching_records: Array<{ match_source?: string }> } }) =>
          row.duplicate_result?.hard_block && row.duplicate_result.matching_records.some((match) => match.match_source === "import_row")
      )
    ).toBe(true);

    const commitResponse = await commitImportSession(leadershipToken, createResponse.body.session.id, {
      mode: "publish_valid_rows_leave_exceptions"
    });

    expect(commitResponse.status).toBe(200);
    expect(commitResponse.body.summary.jobs_published).toBe(0);
    expect(commitResponse.body.summary.duplicates_blocked).toBe(2);
    expect(commitResponse.body.rows.every((row: { status: string }) => row.status === "duplicate_blocked")).toBe(true);
  });
});

describe("central job intake domain validators", () => {
  it("parses a simple schools smart-paste request deterministically", () => {
    const result = parseJobIntakeText(
      `School: North High
Date: 2026-09-14
Time: 8:15 AM
School Job Type: Fall Portraits
Roster Status: Requested
Notes: Use the west gym entrance.`,
      "schools"
    );

    expect(result.parsed_input.department).toBe("schools");
    expect(result.parsed_input.job_type).toBe("schools_underclass_portraits");
    expect(result.parsed_input.start_date).toBe("2026-09-14");
    expect(result.parsed_input.start_time).toBe("08:15:00");
    expect(result.parsed_input.unresolved_organization_name).toBe("North High");
    expect(result.parsed_input.school_detail?.school_job_type).toBe("fall_portraits");
    expect(result.parsed_input.school_detail?.roster_status).toBe("Requested");
    expect(result.parsed_input.internal_notes).toBe("Use the west gym entrance.");
    expect(result.inferred_fields.some((entry) => entry.field === "school_detail.school_job_type")).toBe(true);
  });

  it("parses a simple sports smart-paste request deterministically", () => {
    const result = parseJobIntakeText(
      `Organization: Metro Athletics
Sport: Hockey
Date: 10/22/2026
Time: 6:30 PM
Event Type: Media Day
Location: Metro Arena
Need 2 photographers
Notes: Team banners also needed.`,
      "sports"
    );

    expect(result.parsed_input.department).toBe("sports");
    expect(result.parsed_input.job_type).toBe("sports");
    expect(result.parsed_input.start_date).toBe("2026-10-22");
    expect(result.parsed_input.start_time).toBe("18:30:00");
    expect(result.parsed_input.unresolved_organization_name).toBe("Metro Athletics");
    expect(result.parsed_input.unresolved_location_name).toBe("Metro Arena");
    expect(result.parsed_input.staffing_estimate).toBe(2);
    expect(result.parsed_input.sports_detail?.sports_job_type).toBe("media_day");
    expect(result.parsed_input.sports_detail?.sport_name).toBe("Hockey");
  });

  it("enforces the draft minimum", () => {
    const validation = validateJobDraft(
      normalizeIntakePayload({
        department: "schools",
        job_type: "schools_underclass_portraits",
        organization_id: schoolsOrganizationId
      })
    );

    expect(validation.valid).toBe(false);
    expect(validation.errors.some((entry) => entry.code === "draft_anchor_required")).toBe(true);
  });

  it("enforces the publish minimum validator without publishing", () => {
    const validation = validateJobPublish({
      ...normalizeIntakePayload({
        department: "schools",
        job_type: "schools_underclass_portraits",
        organization_id: schoolsOrganizationId,
        start_date: schoolsShootDate,
        timezone: "America/Chicago",
        request_source: "manual",
        production_required: true,
        staffing_required: true,
        school_detail: {
          school_job_type: "underclass",
          roster_status: "received"
        }
      }),
      duplicate_check_completed_at: null
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.some((entry) => entry.field === "job_owner_user_id")).toBe(true);
    expect(validation.errors.some((entry) => entry.field === "duplicate_check_completed_at")).toBe(true);
  });

  it("evaluates readiness blockers consistently", () => {
    const readiness = evaluateJobReadiness({
      department: "schools",
      organization_id: schoolsOrganizationId,
      unresolved_organization_name: null,
      location_id: null,
      unresolved_location_name: "TBD Gym",
      primary_contact_id: null,
      unresolved_primary_contact_name: "TBD Contact",
      start_date: schoolsShootDate,
      date_only: false,
      start_time: null,
      staffing_required: true,
      staffing_estimate: null,
      production_required: true,
      delivery_type: "school_delivery",
      delivery_due_date: null,
      school_detail: {
        school_job_type: "underclass",
        school_type: null,
        student_count_estimate: null,
        staff_count_estimate: null,
        grade_range: null,
        camera_count_estimate: null,
        roster_status: "requested",
        roster_due_date: null,
        id_required: true,
        id_sort_method: null,
        yearbook_required: true,
        yearbook_due_date: null,
        staff_packages_required: false,
        parent_communication_needed: false,
        background_requirements: null,
        school_day_notes: null,
        building_instructions: null,
        photo_day_special_notes: null
      },
      sports_detail: {
        sports_job_type: null,
        sport_name: null,
        season: null,
        level_or_age_group: null,
        team_count_estimate: null,
        athlete_count_estimate: null,
        coach_count_estimate: null,
        coach_contact_id: null,
        alternate_team_contact_id: null,
        specialty_products_required: false,
        specialty_product_types: [],
        gallery_required: false,
        delivery_deadline_type: null,
        uniform_notes: null,
        sponsor_notes: null,
        event_notes: null,
        on_site_sales_notes: null
      }
    });

    expect(readiness.readiness_status).toBe("blocked");
    expect(readiness.blockers.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "MISSING_LOCATION",
        "MISSING_PRIMARY_CONTACT",
        "MISSING_START_TIME",
        "MISSING_STAFFING_ESTIMATE",
        "MISSING_DELIVERY_DUE_DATE",
        "MISSING_ID_SORT_METHOD",
        "MISSING_YEARBOOK_DUE_DATE"
      ])
    );
  });

  it("strips protected post-publish field updates for non-leadership actors", () => {
    const result = sanitizeProtectedFieldUpdates(
      { record_state: "published" },
      {
        department: "sports",
        organization_id: schoolsOrganizationId,
        start_date: schoolsShootDate,
        internal_notes: "Allowed note update",
        school_detail: {
          school_job_type: "class_groups",
          school_day_notes: "Allowed school note update"
        },
        sports_detail: {
          sport_name: "Baseball",
          sponsor_notes: "Allowed sponsor note update"
        }
      },
      { authorityTier: "standard_employee" }
    );

    expect(result.requires_leadership).toBe(true);
    expect(result.blocked_fields).toEqual(
      expect.arrayContaining(["department", "organization_id", "start_date", "school_detail.school_job_type", "sports_detail.sport_name"])
    );
    expect(result.patch.internal_notes).toBe("Allowed note update");
    expect(result.patch.school_detail?.school_day_notes).toBe("Allowed school note update");
    expect(result.patch.sports_detail?.sponsor_notes).toBe("Allowed sponsor note update");
    expect(result.patch.department).toBeUndefined();
    expect(result.patch.organization_id).toBeUndefined();
    expect(result.patch.start_date).toBeUndefined();
    expect(result.patch.school_detail?.school_job_type).toBeUndefined();
    expect(result.patch.sports_detail?.sport_name).toBeUndefined();
  });
});

describe("central job intake draft endpoints", () => {
  it("parses smart-paste text through the shared endpoint", async () => {
    const response = await request(app)
      .post("/api/shoots/intake/parse")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        department_hint: "schools",
        raw_text: "School: North High\nDate: 2026-10-01\nTime: 9:00 AM\nSchool Job Type: Fall Portraits"
      });

    expect(response.status).toBe(200);
    expect(response.body.parsed_input.department).toBe("schools");
    expect(response.body.parsed_input.start_date).toBe("2026-10-01");
    expect(response.body.parsed_input.start_time).toBe("09:00:00");
    expect(response.body.parsed_input.unresolved_organization_name).toBe("North High");
  });

  it("returns structured form-ready validation errors when the draft minimum is missing", async () => {
    const response = await createDraft(leadershipToken, {
      department: "schools",
      job_type: schoolsJobType,
      organization_id: schoolsOrganizationId
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Validation failed");
    expect(response.body.details.field_errors.organization_id ?? []).toEqual([]);
    expect(response.body.details.form_errors).toEqual(
      expect.arrayContaining(["Add a start date, a delivery due date, or internal notes so the draft can be identified later."])
    );
  });

  it("creates, fetches, updates, and previews readiness for a draft", async () => {
    const createResponse = await createDraft(leadershipToken, {
      department: "schools",
      job_type: schoolsJobType,
      organization_id: schoolsOrganizationId,
      start_date: addDays(schoolsShootDate, 21),
      internal_notes: "Initial intake note",
      request_source: "manual",
      school_detail: {
        school_job_type: "underclass",
        roster_status: "requested"
      }
    });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.job.record_state).toBe("draft");
    expect(createResponse.body.job.organization_id).toBe(schoolsOrganizationId);
    expect(createResponse.body.job.title).toContain(schoolsOrganizationName);
    expect(createResponse.body.draft_validation.valid).toBe(true);

    const draftId = createResponse.body.job.id as string;

    const fetchResponse = await request(app)
      .get(`/api/shoots/intake/drafts/${draftId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(fetchResponse.status).toBe(200);
    expect(fetchResponse.body.job.id).toBe(draftId);

    const updateResponse = await request(app)
      .patch(`/api/shoots/intake/drafts/${draftId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        location_id: schoolsLocationId,
        primary_contact_id: schoolsPrimaryContactId,
        internal_notes: "Updated intake note",
        school_detail: {
          school_day_notes: "Use the west activity entrance."
        }
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.job.location_id).toBe(schoolsLocationId);
    expect(updateResponse.body.job.primary_contact_id).toBe(schoolsPrimaryContactId);
    expect(updateResponse.body.job.internal_notes).toBe("Updated intake note");
    expect(updateResponse.body.school_detail.school_day_notes).toBe("Use the west activity entrance.");

    const readinessResponse = await request(app)
      .get(`/api/shoots/intake/drafts/${draftId}/readiness`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(readinessResponse.status).toBe(200);
    expect(readinessResponse.body.readiness_status).toBe("blocked");
    expect(readinessResponse.body.blockers.some((entry: { code: string }) => entry.code === "MISSING_START_TIME")).toBe(true);
  });

  it("returns organization defaults for the chosen department", async () => {
    const response = await request(app)
      .get(`/api/shoots/intake/organizations/${schoolsOrganizationId}/defaults?department=schools`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body.organization_id).toBe(schoolsOrganizationId);
    expect(response.body.organization_name).toBe(schoolsOrganizationName);
    expect(response.body.department).toBe("schools");
    expect(response.body.timezone).toBe("America/Chicago");
  });

  it("returns a hard duplicate block when the draft matches the same department, organization, job type, location, and date", async () => {
    const createResponse = await createDraft(leadershipToken, {
      department: "schools",
      job_type: schoolsJobType,
      organization_id: schoolsOrganizationId,
      location_id: schoolsLocationId,
      start_date: schoolsShootDate,
      internal_notes: "Hard duplicate preview draft",
      request_source: "manual",
      school_detail: {
        school_job_type: "underclass",
        roster_status: "requested"
      }
    });

    expect(createResponse.status).toBe(201);
    const draftId = createResponse.body.job.id as string;

    const duplicateResponse = await duplicateCheck(leadershipToken, draftId);

    expect(duplicateResponse.status).toBe(200);
    expect(duplicateResponse.body.hard_block).toBe(true);
    expect(duplicateResponse.body.disposition).toBe("hard_block");
    expect(
      duplicateResponse.body.matching_records.some((entry: { matched_rules: string[] }) =>
        entry.matched_rules.includes("hard_same_department_organization_type_location_start_date")
      )
    ).toBe(true);

    const refreshedDraft = await request(app)
      .get(`/api/shoots/intake/drafts/${draftId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(refreshedDraft.status).toBe(200);
    expect(refreshedDraft.body.job.duplicate_check_completed_at).not.toBeNull();
  });

  it("returns a soft duplicate warning when the draft lands within the nearby date window", async () => {
    const createResponse = await createDraft(leadershipToken, {
      department: "schools",
      job_type: schoolsJobType,
      organization_id: schoolsOrganizationId,
      start_date: addDays(schoolsShootDate, 2),
      internal_notes: "Soft duplicate preview draft",
      request_source: "manual",
      school_detail: {
        school_job_type: "underclass",
        roster_status: "requested"
      }
    });

    expect(createResponse.status).toBe(201);
    const draftId = createResponse.body.job.id as string;

    const duplicateResponse = await duplicateCheck(leadershipToken, draftId);

    expect(duplicateResponse.status).toBe(200);
    expect(duplicateResponse.body.hard_block).toBe(false);
    expect(duplicateResponse.body.soft_warning).toBe(true);
    expect(duplicateResponse.body.disposition).toBe("soft_warning");
    expect(
      duplicateResponse.body.matching_records.some((entry: { matched_rules: string[] }) =>
        entry.matched_rules.includes("soft_same_organization_type_date_window")
      )
    ).toBe(true);
  });

  it("persists raw source text on smart-paste drafts", async () => {
    const parsed = parseJobIntakeText(
      `School: North High
Date: 2026-11-01
School Job Type: Fall Portraits
Notes: Bring the black backdrop.`,
      "schools"
    );

    const createResponse = await createDraft(leadershipToken, {
      ...parsed.parsed_input,
      job_owner_user_id: schoolsOfficeUserId
    });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.job.request_source).toBe("smart_paste");
    expect(createResponse.body.job.raw_source_text).toContain("Bring the black backdrop.");
  });

  it("does not let smart paste bypass publish validation", async () => {
    const parsed = parseJobIntakeText(
      `School: TBD school
Date: 2026-12-03
School Job Type: Fall Portraits
Notes: Needs follow-up.`,
      "schools"
    );

    const createResponse = await createDraft(leadershipToken, parsed.parsed_input);
    expect(createResponse.status).toBe(201);

    const publishResponse = await publishDraft(leadershipToken, createResponse.body.job.id as string);
    expect(publishResponse.status).toBe(400);
    expect(publishResponse.body.error).toBe("Validation failed");
    expect(publishResponse.body.details.field_errors.job_owner_user_id).toEqual(expect.any(Array));
  });
});

describe("central job intake publish pipeline", () => {
  it("publishes a schools draft and creates downstream shells", async () => {
    const createResponse = await createDraft(leadershipToken, {
      department: "schools",
      job_type: "schools_underclass_portraits",
      organization_id: schoolsOrganizationId,
      location_id: schoolsLocationId,
      primary_contact_id: schoolsPrimaryContactId,
      job_owner_user_id: schoolsOfficeUserId,
      start_date: futureSchoolsDate(60),
      start_time: "08:00",
      timezone: "America/Chicago",
      production_required: true,
      staffing_required: true,
      staffing_estimate: 3,
      delivery_due_date: futureSchoolsDate(67),
      request_source: "manual",
      school_detail: {
        school_job_type: "underclass",
        roster_status: "received",
        id_required: true,
        id_sort_method: "alpha",
        yearbook_required: true,
        yearbook_due_date: futureSchoolsDate(90)
      }
    });

    expect(createResponse.status).toBe(201);
    const draftId = createResponse.body.job.id as string;

    const duplicatePreview = await duplicateCheck(leadershipToken, draftId);
    expect(duplicatePreview.status).toBe(200);
    expect(duplicatePreview.body.hard_block).toBe(false);

    const publishResponse = await publishDraft(leadershipToken, draftId);
    expect(publishResponse.status).toBe(200);
    expect(publishResponse.body.intake.job.record_state).toBe("published");
    expect(publishResponse.body.intake.job.job_status).toBe("confirmed");
    expect(publishResponse.body.intake.job.job_number).toMatch(/^SCH-\d{4}-\d{6}$/);
    expect(publishResponse.body.intake.job.shoot_code).toBe(publishResponse.body.intake.job.job_number);
    expect(publishResponse.body.intake.readiness.readiness_status).toBe("ready");
    expect(publishResponse.body.downstream.production_project_ids.length).toBeGreaterThan(0);
    expect(publishResponse.body.downstream.staffing_requirement_ids.length).toBeGreaterThan(0);

    const persistedDownstream = await dbPool.query<{
      production_count: string;
      staffing_count: string;
    }>(
      `
        SELECT
          (SELECT count(*)::text
           FROM production_project
           WHERE tenant_id = $1
             AND linked_shoot_id = $2::uuid
             AND source_event_key LIKE 'central_job_publish:%') AS production_count,
          (SELECT count(*)::text
           FROM shoot_staffing_requirement
           WHERE tenant_id = $1
             AND shoot_id = $2::uuid
             AND source_of_creation = 'central_job_intake_publish') AS staffing_count
      `,
      [leadershipAuth.tenantId, draftId]
    );

    expect(Number(persistedDownstream.rows[0].production_count)).toBeGreaterThan(0);
    expect(Number(persistedDownstream.rows[0].staffing_count)).toBeGreaterThan(0);
  });

  it("captures a dated-commitment snapshot at publish that stays stable when the contact is later edited", async () => {
    const tenantId = leadershipAuth.tenantId as string;
    const stamp = Date.now();
    // controlled fixture identity + relationship on the seeded schools org (no demo record mutated)
    const contactId = (await dbPool.query<{ id: string }>(`INSERT INTO contact (tenant_id, first_name, last_name, full_name, normalized_full_name, email, phone, preferred_contact_method) VALUES ($1,'Dated','Commit',$2,$3,$4,'555-7777','text') RETURNING id::text`, [tenantId, `Dated Commit ${stamp}`, `dated commit ${stamp}`, `dated-${stamp}@commit.example.com`])).rows[0].id;
    const ocId = (await dbPool.query<{ id: string }>(`INSERT INTO organization_contact (tenant_id, organization_id, contact_id, first_name, last_name, full_name, normalized_full_name, phone, active_status) VALUES ($1,$2,$3,'Dated','Commit',$4,$5,'555-7777','active') RETURNING id::text`, [tenantId, schoolsOrganizationId, contactId, `Dated Commit ${stamp}`, `dated commit ${stamp}`])).rows[0].id;
    await dbPool.query(`INSERT INTO organization_contact_relationship (tenant_id, organization_id, contact_id, relationship_role, client_roles, is_current) VALUES ($1,$2,$3,'general',ARRAY['picture_day_contact']::client_contact_role[],true)`, [tenantId, schoolsOrganizationId, ocId]);

    const createResponse = await createDraft(leadershipToken, {
      department: "schools",
      job_type: schoolsJobType,
      organization_id: schoolsOrganizationId,
      location_id: schoolsLocationId,
      primary_contact_id: ocId,
      job_owner_user_id: schoolsOfficeUserId,
      start_date: futureSchoolsDate(120),
      start_time: "08:30",
      timezone: "America/Chicago",
      production_required: true,
      staffing_required: true,
      staffing_estimate: 2,
      special_instructions: "East gym; load-in at door 3",
      request_source: "manual",
      school_detail: { school_job_type: "fall_portraits", roster_status: "received" }
    });
    expect(createResponse.status).toBe(201);
    const jobId = createResponse.body.job.id as string;
    try {
      await duplicateCheck(leadershipToken, jobId);
      const publishResponse = await publishDraft(leadershipToken, jobId);
      expect(publishResponse.status).toBe(200);

      // the dated-commitment snapshot captured the role + contact + room/area at publish
      const snap1 = (await dbPool.query<{ dated_commitment: any }>(`SELECT dated_commitment FROM shoot WHERE id=$1`, [jobId])).rows[0].dated_commitment;
      expect(snap1).toBeTruthy();
      expect(snap1.contact_name).toBe(`Dated Commit ${stamp}`);
      expect(snap1.primary_contact_id).toBe(ocId);
      expect(snap1.contextual_role).toEqual(["picture_day_contact"]);
      expect(snap1.room_area).toContain("East gym");
      expect(snap1.confirmed_by).toBeTruthy();

      // a LATER edit to the canonical person (name) propagates to the live org_contact ...
      await dbPool.query(`UPDATE contact SET full_name=$2, first_name='Renamed' WHERE id=$1`, [contactId, `Renamed Person ${stamp}`]);
      await dbPool.query(`UPDATE organization_contact SET full_name=$2, first_name='Renamed' WHERE id=$1`, [ocId, `Renamed Person ${stamp}`]);
      const liveName = (await dbPool.query<{ full_name: string }>(`SELECT full_name FROM organization_contact WHERE id=$1`, [ocId])).rows[0].full_name;
      expect(liveName).toBe(`Renamed Person ${stamp}`); // live reference reflects current truth

      // ... but the dated snapshot is UNCHANGED (the committed name + role are preserved)
      const snap2 = (await dbPool.query<{ dated_commitment: any }>(`SELECT dated_commitment FROM shoot WHERE id=$1`, [jobId])).rows[0].dated_commitment;
      expect(snap2.contact_name).toBe(`Dated Commit ${stamp}`); // dated commitment immutable
      expect(snap2.contextual_role).toEqual(["picture_day_contact"]);
    } finally {
      await dbPool.query(`DELETE FROM shoot WHERE id=$1`, [jobId]);
      await dbPool.query(`DELETE FROM organization_contact_relationship WHERE contact_id=$1`, [ocId]);
      await dbPool.query(`DELETE FROM organization_contact WHERE id=$1`, [ocId]);
      await dbPool.query(`DELETE FROM contact WHERE id=$1`, [contactId]);
    }
  });

  it("publishes a sports draft and creates downstream shells", async () => {
    const createResponse = await createDraft(leadershipToken, {
      department: "sports",
      job_type: sportsJobType,
      organization_id: sportsOrganizationId,
      location_id: sportsLocationId,
      primary_contact_id: sportsPrimaryContactId,
      job_owner_user_id: sportsOfficeUserId,
      start_date: futureSportsDate(60),
      start_time: "09:30",
      timezone: "America/Chicago",
      production_required: true,
      staffing_required: true,
      staffing_estimate: 2,
      delivery_due_date: futureSportsDate(66),
      request_source: "manual",
      production_grouping_rule: "one_per_gallery",
      sports_detail: {
        sports_job_type: "team_and_individual",
        sport_name: "Basketball",
        gallery_required: true
      }
    });

    expect(createResponse.status).toBe(201);
    const draftId = createResponse.body.job.id as string;

    const duplicatePreview = await duplicateCheck(leadershipToken, draftId);
    expect(duplicatePreview.status).toBe(200);

    const publishResponse = await publishDraft(leadershipToken, draftId);
    expect(publishResponse.status).toBe(200);
    expect(publishResponse.body.intake.job.record_state).toBe("published");
    expect(publishResponse.body.intake.job.job_number).toMatch(/^SPT-\d{4}-\d{6}$/);
    expect(publishResponse.body.downstream.production_project_ids.length).toBeGreaterThan(0);
    expect(publishResponse.body.downstream.staffing_requirement_ids.length).toBeGreaterThan(0);
  });

  it("hard-blocks publish on duplicates without an override and keeps the draft unpublished", async () => {
    const createResponse = await createDraft(leadershipToken, {
      department: "schools",
      job_type: schoolsJobType,
      organization_id: schoolsOrganizationId,
      location_id: schoolsLocationId,
      primary_contact_id: schoolsPrimaryContactId,
      job_owner_user_id: schoolsOfficeUserId,
      start_date: schoolsShootDate,
      start_time: "08:15",
      timezone: "America/Chicago",
      production_required: true,
      staffing_required: true,
      request_source: "manual",
      school_detail: {
        school_job_type: "underclass",
        roster_status: "received"
      }
    });

    expect(createResponse.status).toBe(201);
    const draftId = createResponse.body.job.id as string;
    await duplicateCheck(leadershipToken, draftId);

    const publishResponse = await publishDraft(leadershipToken, draftId);
    expect(publishResponse.status).toBe(409);
    expect(publishResponse.body.error).toBe("Duplicate publish blocked");

    const fetchResponse = await request(app)
      .get(`/api/shoots/intake/drafts/${draftId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(fetchResponse.status).toBe(200);
    expect(fetchResponse.body.job.record_state).toBe("draft");
    expect(fetchResponse.body.job.job_number).toBeNull();
  });

  it("allows duplicate override only for lead/admin actors and requires a note", async () => {
    const createResponse = await createDraft(leadershipToken, {
      department: "schools",
      job_type: schoolsJobType,
      organization_id: schoolsOrganizationId,
      location_id: schoolsLocationId,
      primary_contact_id: schoolsPrimaryContactId,
      job_owner_user_id: schoolsOfficeUserId,
      start_date: schoolsShootDate,
      start_time: "08:20",
      timezone: "America/Chicago",
      production_required: true,
      staffing_required: true,
      request_source: "manual",
      school_detail: {
        school_job_type: "underclass",
        roster_status: "received"
      }
    });

    expect(createResponse.status).toBe(201);
    const draftId = createResponse.body.job.id as string;
    await duplicateCheck(leadershipToken, draftId);

    const forbiddenResponse = await publishDraft(schoolsOfficeToken, draftId, {
      duplicate_override_note: "Office staff should not be allowed to force this through."
    });
    expect(forbiddenResponse.status).toBe(403);

    const successResponse = await publishDraft(adminToken, draftId, {
      duplicate_override_note: "Confirmed this is a legitimate second job for the same account and date."
    });
    expect(successResponse.status).toBe(200);
    expect(successResponse.body.intake.job.record_state).toBe("published");
    expect(successResponse.body.duplicates.hard_block).toBe(true);
    expect(successResponse.body.intake.job.duplicate_override_note).toContain("legitimate second job");
  });

  it("rolls the publish transaction back if downstream shell creation fails", async () => {
    const createResponse = await createDraft(leadershipToken, {
      department: "schools",
      job_type: "schools_underclass_portraits",
      organization_id: schoolsOrganizationId,
      location_id: schoolsLocationId,
      primary_contact_id: schoolsPrimaryContactId,
      job_owner_user_id: schoolsOfficeUserId,
      start_date: futureSchoolsDate(75),
      start_time: "07:45",
      timezone: "America/Chicago",
      production_required: true,
      staffing_required: true,
      staffing_estimate: 2,
      delivery_due_date: futureSchoolsDate(82),
      request_source: "manual",
      school_detail: {
        school_job_type: "underclass",
        roster_status: "received"
      }
    });

    expect(createResponse.status).toBe(201);
    const draftId = createResponse.body.job.id as string;
    await duplicateCheck(leadershipToken, draftId);

    await expect(
      withClientTransactionFn(leadershipAuth.tenantId, leadershipAuth.id, async (client: any) =>
        publishDraftJobFn(
          client,
          leadershipAuth,
          draftId,
          {},
          {
            hooks: {
              beforeDownstreamCreation: async () => {
                throw new Error("Injected downstream failure");
              }
            }
          }
        )
      )
    ).rejects.toThrow("Injected downstream failure");

    const draftFetch = await request(app)
      .get(`/api/shoots/intake/drafts/${draftId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(draftFetch.status).toBe(200);
    expect(draftFetch.body.job.record_state).toBe("draft");
    expect(draftFetch.body.job.job_number).toBeNull();

    const downstreamRows = await dbPool.query<{ production_count: string; staffing_count: string }>(
      `
        SELECT
          (SELECT count(*)::text
           FROM production_project
           WHERE tenant_id = $1
             AND linked_shoot_id = $2::uuid
             AND source_event_key LIKE 'central_job_publish:%') AS production_count,
          (SELECT count(*)::text
           FROM shoot_staffing_requirement
           WHERE tenant_id = $1
             AND shoot_id = $2::uuid
             AND source_of_creation = 'central_job_intake_publish') AS staffing_count
      `,
      [leadershipAuth.tenantId, draftId]
    );
    expect(Number(downstreamRows.rows[0].production_count)).toBe(0);
    expect(Number(downstreamRows.rows[0].staffing_count)).toBe(0);
  });
});

describe("central job intake publish proof", () => {
  it("generates unique job numbers under concurrent publish", async () => {
    const draftA = await createDraft(leadershipToken, {
      department: "schools",
      job_type: "schools_underclass_portraits",
      organization_id: schoolsOrganizationId,
      location_id: schoolsLocationId,
      primary_contact_id: schoolsPrimaryContactId,
      job_owner_user_id: schoolsOfficeUserId,
      start_date: futureSchoolsDate(120),
      start_time: "08:00",
      timezone: "America/Chicago",
      production_required: false,
      staffing_required: true,
      staffing_estimate: 1,
      request_source: "manual",
      school_detail: {
        school_job_type: "underclass",
        roster_status: "received"
      }
    });
    const draftB = await createDraft(leadershipToken, {
      department: "schools",
      job_type: "schools_underclass_portraits",
      organization_id: schoolsOrganizationId,
      location_id: schoolsLocationId,
      primary_contact_id: schoolsPrimaryContactId,
      job_owner_user_id: schoolsOfficeUserId,
      start_date: futureSchoolsDate(121),
      start_time: "08:00",
      timezone: "America/Chicago",
      production_required: false,
      staffing_required: true,
      staffing_estimate: 1,
      request_source: "manual",
      school_detail: {
        school_job_type: "underclass",
        roster_status: "received"
      }
    });

    const draftIdA = draftA.body.job.id as string;
    const draftIdB = draftB.body.job.id as string;
    await duplicateCheck(leadershipToken, draftIdA);
    await duplicateCheck(leadershipToken, draftIdB);

    const [publishA, publishB] = await Promise.all([publishDraft(leadershipToken, draftIdA), publishDraft(leadershipToken, draftIdB)]);
    expect(publishA.status).toBe(200);
    expect(publishB.status).toBe(200);
    expect(publishA.body.intake.job.job_number).not.toBe(publishB.body.intake.job.job_number);
  });

  it("creates readiness items on publish for blocked-but-publishable jobs", async () => {
    const createResponse = await createDraft(leadershipToken, {
      department: "schools",
      job_type: "schools_underclass_portraits",
      organization_id: schoolsOrganizationId,
      job_owner_user_id: schoolsOfficeUserId,
      start_date: futureSchoolsDate(140),
      timezone: "America/Chicago",
      production_required: true,
      staffing_required: true,
      request_source: "manual",
      school_detail: {
        school_job_type: "underclass",
        roster_status: "received",
        id_required: true,
        yearbook_required: true
      }
    });

    expect(createResponse.status).toBe(201);
    const draftId = createResponse.body.job.id as string;
    await duplicateCheck(leadershipToken, draftId);

    const publishResponse = await publishDraft(leadershipToken, draftId);
    expect(publishResponse.status).toBe(200);
    expect(publishResponse.body.intake.readiness.readiness_status).toBe("blocked");
    expect(publishResponse.body.intake.readiness.blockers.map((entry: { code: string }) => entry.code)).toEqual(
      expect.arrayContaining([
        "MISSING_LOCATION",
        "MISSING_PRIMARY_CONTACT",
        "MISSING_START_TIME",
        "MISSING_STAFFING_ESTIMATE",
        "MISSING_DELIVERY_DUE_DATE",
        "MISSING_ID_SORT_METHOD",
        "MISSING_YEARBOOK_DUE_DATE"
      ])
    );

    const readinessRows = await dbPool.query<{ code: string }>(
      `
        SELECT code
        FROM shoot_readiness_item
        WHERE tenant_id = $1
          AND shoot_id = $2::uuid
        ORDER BY code ASC
      `,
      [leadershipAuth.tenantId, draftId]
    );
    expect(readinessRows.rows.map((row) => row.code)).toEqual(
      expect.arrayContaining([
        "MISSING_LOCATION",
        "MISSING_PRIMARY_CONTACT",
        "MISSING_START_TIME",
        "MISSING_STAFFING_ESTIMATE",
        "MISSING_DELIVERY_DUE_DATE",
        "MISSING_ID_SORT_METHOD",
        "MISSING_YEARBOOK_DUE_DATE"
      ])
    );
  });

  it("enforces protected routing field updates after publish and recomputes readiness for leadership edits", async () => {
    const publishableDate = futureSchoolsDate(160);
    const deliveryDueDate = futureSchoolsDate(168);
    const attemptedEmployeeStartDate = futureSchoolsDate(170);
    const createResponse = await createDraft(leadershipToken, {
      department: "schools",
      job_type: "schools_underclass_portraits",
      organization_id: schoolsOrganizationId,
      location_id: schoolsLocationId,
      primary_contact_id: schoolsPrimaryContactId,
      job_owner_user_id: schoolsOfficeUserId,
      start_date: publishableDate,
      start_time: "08:30",
      timezone: "America/Chicago",
      production_required: true,
      staffing_required: true,
      staffing_estimate: 2,
      delivery_due_date: deliveryDueDate,
      request_source: "manual",
      school_detail: {
        school_job_type: "underclass",
        roster_status: "received"
      }
    });

    expect(createResponse.status).toBe(201);
    const draftId = createResponse.body.job.id as string;
    await duplicateCheck(leadershipToken, draftId);
    const publishResponse = await publishDraft(leadershipToken, draftId);
    expect(publishResponse.status).toBe(200);

    const employeePatch = await request(app)
      .patch(`/api/shoots/intake/jobs/${draftId}`)
      .set("Authorization", `Bearer ${schoolsOfficeToken}`)
      .send({
        department: "sports",
        start_date: attemptedEmployeeStartDate,
        internal_notes: "Operator note preserved"
      });

    expect(employeePatch.status).toBe(200);
    expect(employeePatch.body.job.department).toBe("schools");
    expect(employeePatch.body.job.start_date).toBe(publishableDate);
    expect(employeePatch.body.job.internal_notes).toBe("Operator note preserved");

    const leadershipPatch = await request(app)
      .patch(`/api/shoots/intake/jobs/${draftId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        location_id: null,
        unresolved_location_name: "Updated TBD campus"
      });

    expect(leadershipPatch.status).toBe(200);
    expect(leadershipPatch.body.job.location_id).toBeNull();
    expect(leadershipPatch.body.readiness.readiness_status).toBe("blocked");
    expect(leadershipPatch.body.readiness.blockers.some((entry: { code: string }) => entry.code === "MISSING_LOCATION")).toBe(
      true
    );

    const publishedFetch = await request(app)
      .get(`/api/shoots/intake/jobs/${draftId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(publishedFetch.status).toBe(200);
    expect(publishedFetch.body.job.record_state).toBe("published");
  });

  it("returns published schools job detail with readiness, activity, production, and staffing context", async () => {
    const createResponse = await createDraft(leadershipToken, {
      department: "schools",
      job_type: "schools_underclass_portraits",
      organization_id: schoolsOrganizationId,
      location_id: schoolsLocationId,
      primary_contact_id: schoolsPrimaryContactId,
      job_owner_user_id: schoolsOfficeUserId,
      start_date: futureSchoolsDate(240),
      start_time: "08:10",
      timezone: "America/Chicago",
      production_required: true,
      staffing_required: true,
      staffing_estimate: 2,
      delivery_due_date: futureSchoolsDate(245),
      request_source: "manual",
      school_detail: {
        school_job_type: "underclass",
        roster_status: "received"
      }
    });
    const draftId = createResponse.body.job.id as string;
    await duplicateCheck(leadershipToken, draftId);
    const publishResponse = await publishDraft(leadershipToken, draftId);

    expect(publishResponse.status).toBe(200);

    const detailResponse = await request(app)
      .get(`/api/shoots/intake/jobs/${draftId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.job.record_state).toBe("published");
    expect(detailResponse.body.job.department).toBe("schools");
    expect(detailResponse.body.readiness).toBeTruthy();
    expect(detailResponse.body.activity_log.some((event: { event_type: string }) => event.event_type === "job_published")).toBe(true);
    expect(detailResponse.body.staffing_requirements.length).toBeGreaterThan(0);
    expect(detailResponse.body.production_items.length).toBeGreaterThan(0);
  });

  it("returns published sports job detail with readiness, activity, production, and staffing context", async () => {
    const createResponse = await createDraft(leadershipToken, {
      department: "sports",
      job_type: "sports",
      organization_id: sportsOrganizationId,
      location_id: sportsLocationId,
      primary_contact_id: sportsPrimaryContactId,
      job_owner_user_id: sportsOfficeUserId,
      start_date: futureSportsDate(240),
      start_time: "18:20",
      timezone: "America/Chicago",
      production_required: true,
      staffing_required: true,
      staffing_estimate: 3,
      delivery_due_date: futureSportsDate(244),
      request_source: "manual",
      sports_detail: {
        sports_job_type: "media_day",
        sport_name: "Hockey"
      }
    });
    const draftId = createResponse.body.job.id as string;
    await duplicateCheck(leadershipToken, draftId);
    const publishResponse = await publishDraft(leadershipToken, draftId);

    expect(publishResponse.status).toBe(200);

    const detailResponse = await request(app)
      .get(`/api/shoots/intake/jobs/${draftId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.job.record_state).toBe("published");
    expect(detailResponse.body.job.department).toBe("sports");
    expect(detailResponse.body.readiness).toBeTruthy();
    expect(detailResponse.body.activity_log.some((event: { event_type: string }) => event.event_type === "job_published")).toBe(true);
    expect(detailResponse.body.staffing_requirements.length).toBeGreaterThan(0);
    expect(detailResponse.body.production_items.length).toBeGreaterThan(0);
  });

  it("lists resumable drafts by department with user-relevant fields", async () => {
    const firstDraft = await createDraft(schoolsOfficeToken, {
      department: "schools",
      job_type: "schools_underclass_portraits",
      organization_id: schoolsOrganizationId,
      job_owner_user_id: schoolsOfficeUserId,
      start_date: futureSchoolsDate(250),
      internal_notes: "Resume me first"
    });
    const secondDraft = await createDraft(sportsOfficeToken, {
      department: "sports",
      job_type: "sports",
      organization_id: sportsOrganizationId,
      job_owner_user_id: sportsOfficeUserId,
      start_date: futureSportsDate(251),
      internal_notes: "Sports draft"
    });

    expect(firstDraft.status).toBe(201);
    expect(secondDraft.status).toBe(201);

    const schoolsList = await request(app)
      .get("/api/shoots/intake/drafts?department=schools")
      .set("Authorization", `Bearer ${schoolsOfficeToken}`);

    expect(schoolsList.status).toBe(200);
    expect(schoolsList.body.drafts.some((draft: { id: string }) => draft.id === firstDraft.body.job.id)).toBe(true);
    expect(schoolsList.body.drafts.every((draft: { department: string }) => draft.department === "schools")).toBe(true);
  });

  it("keeps drafts out of the live queue and surfaces published jobs there", async () => {
    const targetDate = futureSchoolsDate(260);
    const draftResponse = await createDraft(leadershipToken, {
      department: "schools",
      job_type: "schools_underclass_portraits",
      organization_id: schoolsOrganizationId,
      location_id: schoolsLocationId,
      primary_contact_id: schoolsPrimaryContactId,
      job_owner_user_id: schoolsOfficeUserId,
      start_date: targetDate,
      start_time: "08:45",
      timezone: "America/Chicago",
      production_required: true,
      staffing_required: true,
      staffing_estimate: 2,
      delivery_due_date: futureSchoolsDate(264),
      request_source: "manual",
      school_detail: {
        school_job_type: "underclass",
        roster_status: "received"
      }
    });

    const draftId = draftResponse.body.job.id as string;
    const prePublishQueue = await request(app)
      .get(`/api/shoots/live-queue?date=${targetDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(prePublishQueue.status).toBe(200);
    expect(
      prePublishQueue.body.sections.every(
        (section: { items: Array<{ shoot: { id: string } }> }) => section.items.every((entry) => entry.shoot.id !== draftId)
      )
    ).toBe(true);

    await duplicateCheck(leadershipToken, draftId);
    const publishResponse = await publishDraft(leadershipToken, draftId);
    expect(publishResponse.status).toBe(200);

    const postPublishQueue = await request(app)
      .get(`/api/shoots/live-queue?date=${targetDate}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(postPublishQueue.status).toBe(200);
    expect(
      postPublishQueue.body.sections.some(
        (section: { items: Array<{ shoot: { id: string } }> }) => section.items.some((entry) => entry.shoot.id === draftId)
      )
    ).toBe(true);
  });

  it("surfaces published jobs in organization history without leaking draft-only rows", async () => {
    const historyProbeStamp = `${RUN_UNIQUIFIER}-${Date.now()}`;
    const organizationResponse = await request(app)
      .post("/api/organizations")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        canonical_name: `Published History Academy ${historyProbeStamp}`,
        display_name: `Published History Academy ${historyProbeStamp}`,
        account_type: "schools_underclass_portraits",
        notes: "Isolated organization fixture for central job intake history coverage."
      });

    expect(organizationResponse.status).toBe(201);
    const isolatedOrganizationId = organizationResponse.body.organization.id as string;

    const contactResponse = await request(app)
      .post(`/api/organizations/${isolatedOrganizationId}/contacts`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        first_name: "Taylor",
        last_name: `History ${historyProbeStamp}`,
        title: "Activities Director",
        email: `history-probe-${historyProbeStamp}@example.com`,
        phone: "555-0188",
        primary_internal_owner_user_id: schoolsOfficeUserId,
        notes: "Isolated intake history coverage contact."
      });

    expect(contactResponse.status).toBe(201);
    const isolatedPrimaryContactId = contactResponse.body.contacts.find(
      (contact: { email: string | null }) => contact.email === `history-probe-${historyProbeStamp}@example.com`
    )?.id as string | undefined;
    expect(isolatedPrimaryContactId).toBeTruthy();

    const locationResponse = await request(app)
      .post(`/api/organizations/${isolatedOrganizationId}/locations`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        location_name: `History Probe Gym ${historyProbeStamp}`,
        address_line_1: "123 History Lane",
        city: "St. Paul",
        state: "MN",
        zip: "55101",
        notes: "Isolated intake history coverage location."
      });

    expect(locationResponse.status).toBe(201);
    const isolatedLocationId = locationResponse.body.locations.find(
      (location: { location_name: string }) => location.location_name === `History Probe Gym ${historyProbeStamp}`
    )?.id as string | undefined;
    expect(isolatedLocationId).toBeTruthy();

    const publishedDate = futureSchoolsDate(247);
    const draftDate = futureSchoolsDate(246);

    const draftResponse = await createDraft(leadershipToken, {
      department: "schools",
      job_type: "schools_underclass_portraits",
      organization_id: isolatedOrganizationId,
      location_id: isolatedLocationId,
      primary_contact_id: isolatedPrimaryContactId,
      job_owner_user_id: schoolsOfficeUserId,
      start_date: draftDate,
      start_time: "08:15",
      timezone: "America/Chicago",
      production_required: true,
      staffing_required: true,
      staffing_estimate: 2,
      delivery_due_date: futureSchoolsDate(251),
      request_source: "manual",
      school_detail: {
        school_job_type: "underclass",
        roster_status: "received"
      }
    });
    expect(draftResponse.status).toBe(201);

    const publishedResponse = await createDraft(leadershipToken, {
      department: "schools",
      job_type: "schools_underclass_portraits",
      organization_id: isolatedOrganizationId,
      location_id: isolatedLocationId,
      primary_contact_id: isolatedPrimaryContactId,
      job_owner_user_id: schoolsOfficeUserId,
      start_date: publishedDate,
      start_time: "08:10",
      timezone: "America/Chicago",
      production_required: true,
      staffing_required: true,
      staffing_estimate: 2,
      delivery_due_date: futureSchoolsDate(252),
      request_source: "manual",
      school_detail: {
        school_job_type: "underclass",
        roster_status: "received"
      }
    });
    expect(publishedResponse.status).toBe(201);

    await duplicateCheck(leadershipToken, publishedResponse.body.job.id);
    const publishResponse = await publishDraft(leadershipToken, publishedResponse.body.job.id);
    expect(publishResponse.status).toBe(200);

    await dbPool.query(
      `
        UPDATE shoot
        SET
          title = '0000 Published Organization History Probe',
          shoot_date = current_date,
          start_time = date_trunc('day', now()) + interval '23 hours 59 minutes',
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2::uuid
      `,
      [leadershipAuth.tenantId, publishedResponse.body.job.id]
    );

    const organizationDetail = await request(app)
      .get(`/api/organizations/${isolatedOrganizationId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(organizationDetail.status).toBe(200);
    expect(
      organizationDetail.body.recent_shoots.some((shoot: { id: string }) => shoot.id === publishedResponse.body.job.id)
    ).toBe(true);
    expect(
      organizationDetail.body.recent_shoots.some((shoot: { id: string }) => shoot.id === draftResponse.body.job.id)
    ).toBe(false);
  });
});
