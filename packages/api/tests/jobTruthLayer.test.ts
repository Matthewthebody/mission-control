import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let app: Express;
let dbPool: Pool;
let leadershipToken = "";
let schoolsToken = "";
let sportsToken = "";
let photographerToken = "";
let photographerUserId = "";

let schoolsOrganizationId = "";
let schoolsLocationId = "";
let schoolsContactId = "";
let sportsOrganizationId = "";
let sportsLocationId = "";
let sportsContactId = "";

const JOB_TRUTH_WORKFLOW_TEMPLATE_KEY = "job_truth_layer_workflow_fixture";
const JOB_TRUTH_WORKFLOW_EVENT_KEY = "job_truth_layer_fixture_event";
const JOB_TRUTH_TEST_RUN_ID = Date.now().toString();
const JOB_TRUTH_TEST_JOB_TITLE_PREFIXES = [
  "Shared Schools Job",
  "Schools Validation",
  "Sports Validation",
  "Schools Publish",
  "Prep Preview",
  "Prep Blocked",
  "Prep Ready",
  "Prep Queue Ready",
  "Prep Queue Needs Review",
  "Prep Queue Blocked",
  "Sports Publish",
  "Task Host Job",
  "Workflow-linked Task Host",
  "Lifecycle Job",
  "Command Layer Job"
];

type LegacyShootFixture = {
  shoot_id: string;
  tenant_id: string;
  department: "schools" | "sports";
  organization_id: string;
  location_id: string;
  primary_contact_id: string;
  title: string;
};

let tenantId = "";
let schoolsShootId = "";
let sportsShootId = "";

function plusDays(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function plusDaysWithHours(days: number, hours: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

function todayAtUtcHour(hours: number) {
  const date = new Date();
  date.setUTCHours(hours, 0, 0, 0);
  return date.toISOString();
}

async function login(email: string) {
  const response = await request(app).post("/auth/dev-login").send({ email });
  return response.body.token as string;
}

async function createDraft(token: string, payload: Record<string, unknown>) {
  return request(app).post("/api/jobs/drafts").set("Authorization", `Bearer ${token}`).send(payload);
}

async function publishJob(token: string, jobId: string) {
  return request(app).post(`/api/jobs/${jobId}/publish`).set("Authorization", `Bearer ${token}`).send({});
}

async function createWatchFlag(token: string, jobId: string, payload: Record<string, unknown>) {
  return request(app).post(`/api/jobs/${jobId}/watch-flags`).set("Authorization", `Bearer ${token}`).send(payload);
}

async function createTask(token: string, payload: Record<string, unknown>) {
  return request(app).post("/api/tasks").set("Authorization", `Bearer ${token}`).send(payload);
}

async function getTask(token: string, taskId: string) {
  return request(app).get(`/api/tasks/${taskId}`).set("Authorization", `Bearer ${token}`);
}

async function updateTask(token: string, taskId: string, payload: Record<string, unknown>) {
  return request(app).patch(`/api/tasks/${taskId}`).set("Authorization", `Bearer ${token}`).send(payload);
}

async function countAlertEvents(watchFlagId: string) {
  const result = await dbPool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM alert_events WHERE watch_flag_id = $1`,
    [watchFlagId]
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function createPrepLocationFixture(
  key: string,
  overrides: {
    navigationUrl?: string | null;
    navigationNotes?: string;
    parkingInstructions?: string | null;
    entranceInstructions?: string | null;
    setupArea?: string | null;
    clientFacingNotes?: string;
    employeeFacingNotes?: string;
    internalOnlyNotes?: string;
  } = {}
) {
  const result = await dbPool.query<{ id: string }>(
    `
      INSERT INTO shoot_location (
        tenant_id,
        external_source,
        external_key,
        name,
        normalized_name,
        address,
        normalized_address,
        organization_id,
        address_line_1,
        city,
        state,
        zip,
        navigation_url,
        navigation_notes,
        location_type,
        parking_instructions,
        entrance_instructions,
        unloading_instructions,
        setup_area,
        backup_indoor_location,
        power_availability_notes,
        wifi_cell_notes,
        weather_contingency_notes,
        client_facing_notes,
        employee_facing_notes,
        internal_only_notes,
        location_details
      )
      VALUES (
        $1::uuid,
        'job_truth_prep_readiness_test',
        $2,
        $3,
        lower($3),
        '200 Queue Ave, Plymouth, MN 55446',
        '200 queue ave plymouth mn 55446',
        $4::uuid,
        '200 Queue Ave',
        'Plymouth',
        'MN',
        '55446',
        $5,
        $6,
        'main_building',
        $7,
        $8,
        'Unload by the west lane.',
        $9,
        'Media center.',
        'North wall outlets.',
        'Guest Wi-Fi is available.',
        'Use indoor route during rain.',
        $10,
        $11,
        $12,
        'Prep readiness fixture location.'
      )
      RETURNING id::text
    `,
    [
      tenantId,
      key,
      `Prep Readiness Location ${key}`,
      schoolsOrganizationId,
      Object.prototype.hasOwnProperty.call(overrides, "navigationUrl") ? overrides.navigationUrl : "https://maps.google.com/?q=prep-readiness-location",
      overrides.navigationNotes ?? "Use Door 7.",
      Object.prototype.hasOwnProperty.call(overrides, "parkingInstructions") ? overrides.parkingInstructions : "Park in the west staff lot.",
      Object.prototype.hasOwnProperty.call(overrides, "entranceInstructions") ? overrides.entranceInstructions : "Check in at Door 7.",
      Object.prototype.hasOwnProperty.call(overrides, "setupArea") ? overrides.setupArea : "Set up in the cafeteria.",
      overrides.clientFacingNotes ?? "Please send families to Door 7.",
      overrides.employeeFacingNotes ?? "Arrive after bus drop-off.",
      overrides.internalOnlyNotes ?? "Internal-only crew note."
    ]
  );
  return result.rows[0].id;
}

async function cleanupJobTruthTestFixtures() {
  if (!tenantId) {
    return;
  }
  const currentRunTitlePatterns = JOB_TRUTH_TEST_JOB_TITLE_PREFIXES.map((prefix) => `${prefix} ${JOB_TRUTH_TEST_RUN_ID}`);

  await dbPool.query(
    `
      DELETE FROM jobs
      WHERE tenant_id = $1::uuid
        AND title LIKE ANY($2::text[])
    `,
    [tenantId, currentRunTitlePatterns]
  );
  await dbPool.query(
    `
      DELETE FROM shoot_location
      WHERE tenant_id = $1::uuid
        AND external_source = 'job_truth_prep_readiness_test'
        AND external_key LIKE $2
    `,
    [tenantId, `%${JOB_TRUTH_TEST_RUN_ID}`]
  );
}

async function ensureLegacyShootJobMapping(fixture: LegacyShootFixture) {
  await dbPool.query(
    `
      INSERT INTO jobs (
        id,
        tenant_id,
        legacy_shoot_id,
        department_type,
        job_category,
        organization_id,
        primary_location_id,
        primary_contact_id,
        title
      )
      SELECT
        $1::uuid,
        $2::uuid,
        $1::uuid,
        $3::job_department_type,
        'photo_day'::job_category_type,
        $4::uuid,
        $5::uuid,
        $6::uuid,
        $7
      WHERE NOT EXISTS (
        SELECT 1
        FROM jobs existing
        WHERE existing.id = $1::uuid
           OR existing.legacy_shoot_id = $1::uuid
      )
    `,
    [
      fixture.shoot_id,
      fixture.tenant_id,
      fixture.department,
      fixture.organization_id,
      fixture.location_id,
      fixture.primary_contact_id,
      fixture.title
    ]
  );

  await dbPool.query(
    `
      INSERT INTO job_legacy_mapping (tenant_id, job_id, legacy_table, legacy_record_id)
      SELECT job.tenant_id, job.id, 'shoot', job.legacy_shoot_id
      FROM jobs job
      WHERE job.tenant_id = $1::uuid
        AND job.legacy_shoot_id = $2::uuid
      ON CONFLICT (tenant_id, legacy_table, legacy_record_id)
      DO NOTHING
    `,
    [fixture.tenant_id, fixture.shoot_id]
  );
}

async function ensureJobTruthWorkflowFixture(targetTenantId: string) {
  const templateResult = await dbPool.query<{ id: string }>(
    `
      INSERT INTO workflow_template (
        tenant_id,
        template_key,
        name,
        description,
        workflow_family
      )
      VALUES (
        $1::uuid,
        $2,
        'Job Truth Layer Workflow Fixture',
        'Test-owned workflow template for canonical job/task linkage checks.',
        'schools'::shared_workflow_family_type
      )
      ON CONFLICT (tenant_id, template_key)
      DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        workflow_family = EXCLUDED.workflow_family,
        updated_at = now()
      RETURNING id::text
    `,
    [targetTenantId, JOB_TRUTH_WORKFLOW_TEMPLATE_KEY]
  );

  const versionResult = await dbPool.query<{ id: string }>(
    `
      INSERT INTO workflow_template_version (
        tenant_id,
        template_id,
        version_number,
        status,
        default_for_new_jobs,
        owner_defaults_json
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        1,
        'active'::shared_workflow_template_version_status_type,
        false,
        '{}'::jsonb
      )
      ON CONFLICT (template_id, version_number)
      DO UPDATE SET
        status = EXCLUDED.status,
        default_for_new_jobs = EXCLUDED.default_for_new_jobs,
        owner_defaults_json = EXCLUDED.owner_defaults_json,
        updated_at = now()
      RETURNING id::text
    `,
    [targetTenantId, templateResult.rows[0].id]
  );

  await dbPool.query(
    `
      INSERT INTO workflow_template_event (
        tenant_id,
        template_version_id,
        event_key,
        title,
        event_type,
        start_anchor,
        start_offset_days,
        start_offset_minutes,
        duration_minutes,
        required,
        sort_order
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3,
        'Job Truth Fixture Event',
        'job_event',
        'job_scheduled_start'::shared_workflow_date_anchor_type,
        0,
        0,
        120,
        true,
        0
      )
      ON CONFLICT (template_version_id, event_key)
      DO UPDATE SET
        title = EXCLUDED.title,
        event_type = EXCLUDED.event_type,
        start_anchor = EXCLUDED.start_anchor,
        start_offset_days = EXCLUDED.start_offset_days,
        start_offset_minutes = EXCLUDED.start_offset_minutes,
        duration_minutes = EXCLUDED.duration_minutes,
        required = EXCLUDED.required,
        sort_order = EXCLUDED.sort_order,
        updated_at = now()
    `,
    [targetTenantId, versionResult.rows[0].id, JOB_TRUTH_WORKFLOW_EVENT_KEY]
  );
}

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { pool } = await import("../src/db/pool.js");
  app = createApp();
  dbPool = pool;

  leadershipToken = await login("leadership@example.com");
  schoolsToken = await login("schools-office@example.com");
  sportsToken = await login("sports-office@example.com");
  photographerToken = await login("photo@example.com");

  const fixtureRows = await dbPool.query<{
    shoot_id: string;
    tenant_id: string;
    department: string;
    organization_id: string;
    location_id: string;
    primary_contact_id: string;
    title: string;
  }>(
    `
      SELECT
        s.id::text AS shoot_id,
        s.tenant_id::text AS tenant_id,
        s.department::text AS department,
        s.organization_id::text AS organization_id,
        s.location_id::text AS location_id,
        s.primary_contact_id::text AS primary_contact_id,
        s.title
      FROM shoot s
      WHERE s.deleted_at IS NULL
        AND s.record_state = 'published'::shoot_record_state
        AND s.organization_id IS NOT NULL
        AND s.location_id IS NOT NULL
        AND s.primary_contact_id IS NOT NULL
        AND s.department IN ('schools'::department_code, 'sports'::department_code)
      ORDER BY s.created_at ASC
    `
  );

  const schoolFixture = fixtureRows.rows.find((row) => row.department === "schools");
  const sportsFixture = fixtureRows.rows.find((row) => row.department === "sports");
  if (!schoolFixture || !sportsFixture) {
    throw new Error("Expected seeded schools and sports shoots for job truth tests.");
  }
  if (schoolFixture.tenant_id !== sportsFixture.tenant_id) {
    throw new Error("Expected seeded schools and sports shoots to belong to the same tenant.");
  }

  tenantId = schoolFixture.tenant_id;
  schoolsShootId = schoolFixture.shoot_id;
  schoolsOrganizationId = schoolFixture.organization_id;
  schoolsLocationId = schoolFixture.location_id;
  schoolsContactId = schoolFixture.primary_contact_id;
  sportsShootId = sportsFixture.shoot_id;
  sportsOrganizationId = sportsFixture.organization_id;
  sportsLocationId = sportsFixture.location_id;
  sportsContactId = sportsFixture.primary_contact_id;

  await cleanupJobTruthTestFixtures();
  await ensureLegacyShootJobMapping(schoolFixture as LegacyShootFixture);
  await ensureLegacyShootJobMapping(sportsFixture as LegacyShootFixture);
  await ensureJobTruthWorkflowFixture(tenantId);

  const photographerRow = await dbPool.query<{ id: string }>(
    `SELECT id::text FROM app_user WHERE lower(email) = lower('photo@example.com') LIMIT 1`
  );
  photographerUserId = photographerRow.rows[0]?.id ?? "";
});

afterAll(async () => {
  await cleanupJobTruthTestFixtures();
});

describe("shared job truth layer", () => {
  it("backfills legacy school and sports shoots into jobs with mapping rows", async () => {
    const result = await dbPool.query<{ department_type: string; legacy_shoot_id: string }>(
      `
        SELECT department_type::text AS department_type, legacy_shoot_id::text AS legacy_shoot_id
        FROM jobs
        WHERE legacy_shoot_id IN ($1::uuid, $2::uuid)
          AND department_type IN ('schools'::job_department_type, 'sports'::job_department_type)
        ORDER BY created_at ASC
        LIMIT 10
      `,
      [schoolsShootId, sportsShootId]
    );

    expect(result.rows.some((row) => row.department_type === "schools")).toBe(true);
    expect(result.rows.some((row) => row.department_type === "sports")).toBe(true);

    const mappingCount = await dbPool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM job_legacy_mapping
        WHERE tenant_id = $1::uuid
          AND legacy_table = 'shoot'
          AND legacy_record_id IN ($2::uuid, $3::uuid)
      `,
      [tenantId, schoolsShootId, sportsShootId]
    );
    expect(Number(mappingCount.rows[0].count)).toBe(2);
  });

  it("creates a draft shared schools job", async () => {
    const response = await createDraft(schoolsToken, {
      department_type: "schools",
      job_category: "photo_day",
      organization_id: schoolsOrganizationId,
      primary_location_id: schoolsLocationId,
      primary_contact_id: schoolsContactId,
      title: `Shared Schools Job ${JOB_TRUTH_TEST_RUN_ID}`,
      scheduled_start_at: plusDaysWithHours(10, 8),
      scheduled_end_at: plusDaysWithHours(10, 10),
      timezone: "America/Chicago",
      estimated_staff_count: 2,
      production_required: true,
      workflow_template_key: JOB_TRUTH_WORKFLOW_TEMPLATE_KEY,
      school_profile: {
        school_type: "high_school",
        school_year: "2026-2027",
        grade_scope: "9-12"
      }
    });

    expect(response.status).toBe(201);
    expect(response.body.job.department_type).toBe("schools");
    expect(response.body.job.job_status).toBe("draft");
    expect(response.body.job.job_number).toBeNull();
  });

  it("blocks schools publish when adapter requirements are missing", async () => {
    const draft = await createDraft(schoolsToken, {
      department_type: "schools",
      organization_id: schoolsOrganizationId,
      primary_location_id: schoolsLocationId,
      primary_contact_id: schoolsContactId,
      title: `Schools Validation ${JOB_TRUTH_TEST_RUN_ID}`,
      scheduled_start_at: plusDaysWithHours(12, 8),
      timezone: "America/Chicago"
    });

    const publish = await publishJob(schoolsToken, draft.body.job.id);
    expect(publish.status).toBe(400);
    expect(publish.body.details.field_errors["school_profile.school_type"]).toContain("Schools publish needs school context.");
  });

  it("blocks sports publish when adapter requirements are missing", async () => {
    const draft = await createDraft(sportsToken, {
      department_type: "sports",
      organization_id: sportsOrganizationId,
      primary_location_id: sportsLocationId,
      primary_contact_id: sportsContactId,
      title: `Sports Validation ${JOB_TRUTH_TEST_RUN_ID}`,
      scheduled_start_at: plusDaysWithHours(13, 18),
      timezone: "America/Chicago"
    });

    const publish = await publishJob(sportsToken, draft.body.job.id);
    expect(publish.status).toBe(400);
    expect(publish.body.details.field_errors["sports_profile.sport_type"]).toContain("Sports publish needs sport type.");
  });

  it("publishes a schools job and seeds a default day, production item, and readiness", async () => {
    const draft = await createDraft(schoolsToken, {
      department_type: "schools",
      job_category: "photo_day",
      organization_id: schoolsOrganizationId,
      primary_location_id: schoolsLocationId,
      primary_contact_id: schoolsContactId,
      title: `Schools Publish ${JOB_TRUTH_TEST_RUN_ID}`,
      scheduled_start_at: plusDaysWithHours(14, 8),
      scheduled_end_at: plusDaysWithHours(14, 10),
      timezone: "America/Chicago",
      estimated_staff_count: 2,
      production_required: true,
      workflow_template_key: JOB_TRUTH_WORKFLOW_TEMPLATE_KEY,
      school_profile: {
        school_type: "high_school",
        school_year: "2026-2027",
        grade_scope: "9-12"
      }
    });

    const publish = await publishJob(schoolsToken, draft.body.job.id);

    expect(publish.status).toBe(200);
    expect(publish.body.job.job_number).toMatch(/^SCH-\d{4}-\d+$/);
    expect(publish.body.events.length).toBeGreaterThanOrEqual(1);
    expect(publish.body.days.length).toBeGreaterThanOrEqual(1);
    expect(publish.body.events).toHaveLength(publish.body.days.length);
    expect(publish.body.production_items.length).toBe(1);
    expect(publish.body.readiness_items.length).toBeGreaterThan(0);
    expect(publish.body.job_exceptions.some((flag: { flag_type: string }) => flag.flag_type === "staffing_gap")).toBe(true);
    expect(publish.body.watch_flags.some((flag: { flag_type: string }) => flag.flag_type === "staffing_gap")).toBe(true);
  });

  it("shows non-sending job prep readiness with recipients, location context, and safe note separation", async () => {
    const testRun = JOB_TRUTH_TEST_RUN_ID;
    const readyLocationId = await createPrepLocationFixture(`prep-preview-${testRun}`, {
      navigationUrl: null,
      navigationNotes: "Use Door 7, not the main entrance.",
      entranceInstructions: "Check in at Door 7 with the office team.",
      setupArea: "Set up in the cafeteria near the stage.",
      clientFacingNotes: "Please have staff check in at Door 7.",
      employeeFacingNotes: "Bring extension cords and avoid bus drop-off.",
      internalOnlyNotes: "Internal-only: do not mention the bus lane conflict to clients."
    });
    await dbPool.query(
      `
        INSERT INTO location_reference_attachment (
          tenant_id,
          location_id,
          title,
          description,
          attachment_type,
          audience,
          file_url
        )
        SELECT
          $1::uuid,
          $2::uuid,
          $3,
          'West lot reference for the crew.',
          'parking_map'::location_reference_attachment_type,
          'internal_only'::location_reference_attachment_audience,
          'https://example.com/internal-parking-map.png'
        ON CONFLICT (tenant_id, location_id, title) DO NOTHING
      `,
      [tenantId, readyLocationId, `Internal Parking Map ${testRun}`]
    );

    const readyContact = await request(app)
      .post("/api/client-command-center/contacts")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        account_id: schoolsOrganizationId,
        first_name: "Pat",
        last_name: `PrepReady${testRun}`,
        email: `pat.prep.${testRun}@example.com`,
        mobile_phone: "555-2010",
        allow_email: true,
        allow_sms: true,
        sms_consent_status: "opted_in",
        sms_consent_source: "test_fixture"
      });
    expect(readyContact.status, JSON.stringify(readyContact.body)).toBe(201);
    const unknownSmsContact = await request(app)
      .post("/api/client-command-center/contacts")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        account_id: schoolsOrganizationId,
        first_name: "Sam",
        last_name: `SmsUnknown${testRun}`,
        email: `sam.sms.${testRun}@example.com`,
        mobile_phone: "555-2020",
        allow_email: true,
        allow_sms: true,
        sms_consent_status: "unknown"
      });
    expect(unknownSmsContact.status, JSON.stringify(unknownSmsContact.body)).toBe(201);
    const doNotContact = await request(app)
      .post("/api/client-command-center/contacts")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        account_id: schoolsOrganizationId,
        first_name: "Riley",
        last_name: `DoNotContact${testRun}`,
        email: `riley.dnc.${testRun}@example.com`,
        mobile_phone: "555-2030",
        allow_email: true,
        allow_sms: true,
        do_not_contact: true,
        sms_consent_status: "opted_in"
      });
    expect(doNotContact.status, JSON.stringify(doNotContact.body)).toBe(201);

    for (const contactId of [readyContact.body.id, unknownSmsContact.body.id, doNotContact.body.id]) {
      const relationship = await request(app)
        .post("/api/client-command-center/contact-relationships")
        .set("Authorization", `Bearer ${leadershipToken}`)
        .send({
          account_id: schoolsOrganizationId,
          contact_id: contactId,
          roles: contactId === readyContact.body.id ? ["picture_day_prep_recipient", "emergency_day_of_contact"] : ["picture_day_prep_recipient"]
        });
      expect(relationship.status, JSON.stringify(relationship.body)).toBe(201);
    }

    const draft = await createDraft(schoolsToken, {
      department_type: "schools",
      job_category: "photo_day",
      organization_id: schoolsOrganizationId,
      primary_location_id: readyLocationId,
      primary_contact_id: schoolsContactId,
      title: `Prep Preview ${testRun}`,
      scheduled_start_at: plusDaysWithHours(9, 8),
      scheduled_end_at: plusDaysWithHours(9, 10),
      timezone: "America/Chicago",
      estimated_staff_count: 2,
      production_required: true,
      school_profile: {
        school_type: "high_school",
        school_year: "2026-2027",
        grade_scope: "9-12"
      }
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);

    const response = await request(app).get(`/api/jobs/${draft.body.job.id}`).set("Authorization", `Bearer ${schoolsToken}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);

    expect(response.body.prep_readiness.preview_only).toBe(true);
    expect(response.body.prep_readiness.client_prep.eligible_email_recipients).toEqual(
      expect.arrayContaining([expect.objectContaining({ display_name: expect.stringContaining("PrepReady") })])
    );
    expect(response.body.prep_readiness.client_prep.eligible_sms_recipients).toEqual(
      expect.arrayContaining([expect.objectContaining({ display_name: expect.stringContaining("PrepReady") })])
    );
    expect(response.body.prep_readiness.client_prep.excluded_contacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          display_name: expect.stringContaining("SmsUnknown"),
          prep_sms_exclusion_reason: "SMS consent is unknown."
        }),
        expect.objectContaining({
          display_name: expect.stringContaining("DoNotContact"),
          prep_email_exclusion_reason: "Do not contact is enabled.",
          prep_sms_exclusion_reason: "Do not contact is enabled."
        })
      ])
    );
    expect(response.body.prep_readiness.client_prep.primary_location.google_maps_url).toContain("https://www.google.com/maps/search/");
    expect(response.body.prep_readiness.client_prep.primary_location.client_facing_notes).toContain("Door 7");
    expect(JSON.stringify(response.body.prep_readiness.client_prep)).not.toContain("Internal-only");
    expect(JSON.stringify(response.body.prep_readiness.client_prep)).not.toContain("Internal Parking Map");
    expect(response.body.prep_readiness.employee_briefing.primary_location.internal_only_notes).toContain("Internal-only");
    expect(response.body.prep_readiness.employee_briefing.primary_location.reference_attachments).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: expect.stringContaining("Internal Parking Map"), audience: "internal_only" })])
    );
    expect(response.body.prep_readiness.message_previews.client_prep_email.body_lines.join("\n")).toContain("Prep note:");
    expect(response.body.prep_readiness.message_previews.client_prep_email.body_lines.join("\n")).not.toContain("Internal-only");
    expect(response.body.prep_readiness.message_previews.client_prep_sms.recipients).toEqual(
      expect.arrayContaining([expect.objectContaining({ display_name: expect.stringContaining("PrepReady") })])
    );
    expect(response.body.prep_readiness.message_previews.employee_briefing.body_lines.join("\n")).toContain("Internal-only");
    expect(response.body.prep_readiness.message_previews.employee_briefing.reference_attachments).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: expect.stringContaining("Internal Parking Map"), audience: "internal_only" })])
    );
    expect(response.body.prep_readiness.warnings.map((warning: { code: string }) => warning.code)).not.toContain("missing_primary_location");
    expect(response.body.prep_readiness.warnings.map((warning: { code: string }) => warning.code)).not.toContain("no_day_of_contact");
    expect(response.body.prep_readiness.status).toBe("ready");
  });

  it("blocks prep readiness when the job is missing a primary location or prep email recipient", async () => {
    const draft = await createDraft(schoolsToken, {
      department_type: "schools",
      job_category: "photo_day",
      organization_id: schoolsOrganizationId,
      primary_contact_id: schoolsContactId,
      title: `Prep Blocked ${JOB_TRUTH_TEST_RUN_ID}`,
      scheduled_start_at: plusDaysWithHours(11, 8),
      timezone: "America/Chicago",
      estimated_staff_count: 2,
      school_profile: {
        school_type: "high_school",
        school_year: "2026-2027",
        grade_scope: "9-12"
      }
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);

    const response = await request(app).get(`/api/jobs/${draft.body.job.id}`).set("Authorization", `Bearer ${schoolsToken}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.prep_readiness.status).toBe("blocked");
    expect(response.body.prep_readiness.client_prep.primary_location).toBeNull();
    expect(response.body.prep_readiness.employee_briefing.primary_location).toBeNull();
    expect(response.body.prep_readiness.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_primary_location", severity: "blocker" })
      ])
    );
    expect(response.body.prep_readiness.message_previews.client_prep_email.can_preview).toBe(false);
    expect(response.body.prep_readiness.message_previews.client_prep_email.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "email_preview_no_location", severity: "blocker" })])
    );
    expect(response.body.prep_readiness.message_previews.employee_briefing.can_preview).toBe(false);
  });

  it("marks prep readiness ready when contact and location prep data are complete", async () => {
    const testRun = JOB_TRUTH_TEST_RUN_ID;
    const readyLocationId = await createPrepLocationFixture(`prep-ready-${testRun}`, {
      navigationUrl: "https://maps.google.com/?q=job-prep-ready-location",
      navigationNotes: "Navigate to Door 7.",
      clientFacingNotes: "Please send families to Door 7.",
      internalOnlyNotes: "Internal-only crew note."
    });
    const readyContact = await request(app)
      .post("/api/client-command-center/contacts")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        account_id: schoolsOrganizationId,
        first_name: "Jordan",
        last_name: `Ready${testRun}`,
        email: `jordan.ready.${testRun}@example.com`,
        mobile_phone: "555-2040",
        allow_email: true,
        allow_sms: true,
        sms_consent_status: "opted_in",
        sms_consent_source: "test_fixture"
      });
    expect(readyContact.status, JSON.stringify(readyContact.body)).toBe(201);
    const relationship = await request(app)
      .post("/api/client-command-center/contact-relationships")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        account_id: schoolsOrganizationId,
        contact_id: readyContact.body.id,
        roles: ["picture_day_prep_recipient", "emergency_day_of_contact"]
      });
    expect(relationship.status, JSON.stringify(relationship.body)).toBe(201);

    const draft = await createDraft(schoolsToken, {
      department_type: "schools",
      job_category: "photo_day",
      organization_id: schoolsOrganizationId,
      primary_location_id: readyLocationId,
      primary_contact_id: schoolsContactId,
      title: `Prep Ready ${testRun}`,
      scheduled_start_at: plusDaysWithHours(12, 8),
      timezone: "America/Chicago",
      estimated_staff_count: 2,
      school_profile: {
        school_type: "high_school",
        school_year: "2026-2027",
        grade_scope: "9-12"
      }
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);

    const response = await request(app).get(`/api/jobs/${draft.body.job.id}`).set("Authorization", `Bearer ${schoolsToken}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.prep_readiness.status).toBe("ready");
    expect(response.body.prep_readiness.client_prep.primary_location.google_maps_url).toBe("https://maps.google.com/?q=job-prep-ready-location");
    expect(response.body.prep_readiness.client_prep.eligible_email_recipients).toEqual(
      expect.arrayContaining([expect.objectContaining({ display_name: expect.stringContaining("Ready") })])
    );
    expect(response.body.prep_readiness.client_prep.eligible_sms_recipients).toEqual(
      expect.arrayContaining([expect.objectContaining({ display_name: expect.stringContaining("Ready") })])
    );
    expect(response.body.prep_readiness.message_previews.client_prep_email.can_preview).toBe(true);
    expect(response.body.prep_readiness.message_previews.client_prep_email.body_lines.join("\n")).toContain("Please send families to Door 7.");
    expect(response.body.prep_readiness.message_previews.client_prep_email.body_lines.join("\n")).not.toContain("Internal-only crew note.");
    expect(response.body.prep_readiness.message_previews.client_prep_sms.can_preview).toBe(true);
    expect(response.body.prep_readiness.message_previews.client_prep_sms.body_lines.join(" ")).toContain("https://maps.google.com/?q=job-prep-ready-location");
    expect(response.body.prep_readiness.message_previews.employee_briefing.body_lines.join("\n")).toContain("Internal-only notes: Internal-only crew note.");
    expect(response.body.prep_readiness.warnings).toEqual([]);
  });

  it("lists prep readiness queue rows from the same job-level readiness rules", async () => {
    const testRun = JOB_TRUTH_TEST_RUN_ID;
    const readyLocationId = await createPrepLocationFixture(`prep-queue-ready-${testRun}`, {
      navigationUrl: "https://maps.google.com/?q=prep-queue-location",
      internalOnlyNotes: "Internal-only queue fixture note."
    });
    const needsReviewLocationId = await createPrepLocationFixture(`prep-queue-needs-review-${testRun}`, {
      navigationUrl: "https://maps.google.com/?q=prep-queue-location",
      parkingInstructions: null,
      entranceInstructions: null,
      setupArea: null,
      internalOnlyNotes: "Internal-only queue fixture note."
    });
    const queueContact = await request(app)
      .post("/api/client-command-center/contacts")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        account_id: schoolsOrganizationId,
        first_name: "Quinn",
        last_name: `QueueReady${testRun}`,
        email: `quinn.queue.${testRun}@example.com`,
        mobile_phone: "555-2050",
        allow_email: true,
        allow_sms: true,
        sms_consent_status: "opted_in",
        sms_consent_source: "test_fixture"
      });
    expect(queueContact.status, JSON.stringify(queueContact.body)).toBe(201);
    const relationship = await request(app)
      .post("/api/client-command-center/contact-relationships")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        account_id: schoolsOrganizationId,
        contact_id: queueContact.body.id,
        roles: ["picture_day_prep_recipient", "emergency_day_of_contact"]
      });
    expect(relationship.status, JSON.stringify(relationship.body)).toBe(201);

    // Keep the fixtures on today's UTC job date so locally seeded/test rows
    // from older runs cannot push these exact assertions out of the limited queue.
    const queueJobStart = todayAtUtcHour(12);

    const readyDraft = await createDraft(schoolsToken, {
      department_type: "schools",
      job_category: "photo_day",
      organization_id: schoolsOrganizationId,
      primary_location_id: readyLocationId,
      primary_contact_id: schoolsContactId,
      title: `Prep Queue Ready ${testRun}`,
      scheduled_start_at: queueJobStart,
      timezone: "America/Chicago",
      estimated_staff_count: 2,
      school_profile: {
        school_type: "high_school",
        school_year: "2026-2027",
        grade_scope: "9-12"
      }
    });
    expect(readyDraft.status, JSON.stringify(readyDraft.body)).toBe(201);

    const needsReviewDraft = await createDraft(schoolsToken, {
      department_type: "schools",
      job_category: "photo_day",
      organization_id: schoolsOrganizationId,
      primary_location_id: needsReviewLocationId,
      primary_contact_id: schoolsContactId,
      title: `Prep Queue Needs Review ${testRun}`,
      scheduled_start_at: queueJobStart,
      timezone: "America/Chicago",
      estimated_staff_count: 2,
      school_profile: {
        school_type: "high_school",
        school_year: "2026-2027",
        grade_scope: "9-12"
      }
    });
    expect(needsReviewDraft.status, JSON.stringify(needsReviewDraft.body)).toBe(201);

    const blockedDraft = await createDraft(schoolsToken, {
      department_type: "schools",
      job_category: "photo_day",
      organization_id: schoolsOrganizationId,
      primary_contact_id: schoolsContactId,
      title: `Prep Queue Blocked ${testRun}`,
      scheduled_start_at: queueJobStart,
      timezone: "America/Chicago",
      estimated_staff_count: 2,
      school_profile: {
        school_type: "high_school",
        school_year: "2026-2027",
        grade_scope: "9-12"
      }
    });
    expect(blockedDraft.status, JSON.stringify(blockedDraft.body)).toBe(201);

    const queueLimit = 25;

    const queue = await request(app)
      .get(`/api/jobs/prep-readiness-queue?department_type=schools&limit=${queueLimit}`)
      .set("Authorization", `Bearer ${schoolsToken}`);
    expect(queue.status, JSON.stringify(queue.body)).toBe(200);
    const rows = queue.body.items as Array<{ job_id: string; job_name: string; readiness_status: string; issue_codes: string[]; job_command_center_href: string; client_command_center_href: string | null }>;
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          job_id: readyDraft.body.job.id,
          readiness_status: "ready",
          job_command_center_href: `#jobs/${readyDraft.body.job.id}`,
          client_command_center_href: `#client-command-center/accounts/${schoolsOrganizationId}`
        }),
        expect.objectContaining({
          job_id: needsReviewDraft.body.job.id,
          readiness_status: "needs_attention",
          issue_codes: expect.arrayContaining(["missing_location_details"])
        }),
        expect.objectContaining({
          job_id: blockedDraft.body.job.id,
          readiness_status: "blocked",
          issue_codes: expect.arrayContaining(["missing_location"])
        })
      ])
    );

    const blocked = await request(app)
      .get(`/api/jobs/prep-readiness-queue?status=blocked&department_type=schools&limit=${queueLimit}`)
      .set("Authorization", `Bearer ${schoolsToken}`);
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(200);
    expect(blocked.body.items.some((row: { job_id: string }) => row.job_id === blockedDraft.body.job.id)).toBe(true);
    expect(blocked.body.items.some((row: { job_id: string }) => row.job_id === readyDraft.body.job.id)).toBe(false);

    const missingLocation = await request(app)
      .get(`/api/jobs/prep-readiness-queue?issue=missing_location&department_type=schools&limit=${queueLimit}`)
      .set("Authorization", `Bearer ${schoolsToken}`);
    expect(missingLocation.status, JSON.stringify(missingLocation.body)).toBe(200);
    expect(missingLocation.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ job_id: blockedDraft.body.job.id })])
    );
  });

  it("publishes a sports job, assigns a lead, checks in, and records lead-ready confirmation", async () => {
    const draft = await createDraft(sportsToken, {
      department_type: "sports",
      job_category: "photo_day",
      organization_id: sportsOrganizationId,
      primary_location_id: sportsLocationId,
      primary_contact_id: sportsContactId,
      title: `Sports Publish ${JOB_TRUTH_TEST_RUN_ID}`,
      scheduled_start_at: plusDaysWithHours(15, 18),
      scheduled_end_at: plusDaysWithHours(15, 20),
      timezone: "America/Chicago",
      estimated_staff_count: 1,
      production_required: true,
      sports_profile: {
        sport_type: "hockey",
        season: "winter",
        team_structure: "single_team",
        proof_required: true,
        approval_contact_id: sportsContactId
      }
    });

    const publish = await publishJob(sportsToken, draft.body.job.id);
    expect(publish.status).toBe(200);

    const assigned = await request(app)
      .post(`/api/jobs/${publish.body.job.id}/staff-assignments`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({
        user_id: photographerUserId,
        assignment_role: "lead_photographer",
        is_lead: true
      });

    expect(assigned.status).toBe(201);
    const assignmentId = assigned.body.staff_assignments.find((row: { user_id: string }) => row.user_id === photographerUserId)?.id;
    const dayId = assigned.body.events[0].id;
    expect(assigned.body.staff_assignments.some((row: { user_id: string; job_day_id: string | null }) => row.user_id === photographerUserId && row.job_day_id === null)).toBe(true);

    const checkIn = await request(app)
      .post(`/api/jobs/${publish.body.job.id}/staff-assignments/${assignmentId}/check-in`)
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({});
    expect(checkIn.status).toBe(200);

    for (const item of publish.body.readiness_items as Array<{ id: string }>) {
      const completeReadiness = await request(app)
        .post(`/api/jobs/${publish.body.job.id}/readiness-items/${item.id}/complete`)
        .set("Authorization", `Bearer ${sportsToken}`)
        .send({ note: "Readiness gate completed before lead-ready confirmation." });

      expect(completeReadiness.status).toBe(200);
    }

    const ready = await request(app)
      .post(`/api/jobs/${publish.body.job.id}/days/${dayId}/ready`)
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({ note: "On site and setup complete." });

    expect(ready.status).toBe(200);
    expect(ready.body.status.staffing_status).toBe("ready_confirmed");
    expect(ready.body.activity.some((entry: { event_type: string }) => entry.event_type === "lead_ready_confirmed")).toBe(true);
  });

  it("enforces permission checks for standard employees", async () => {
    const createAttempt = await createDraft(photographerToken, {
      department_type: "sports",
      organization_id: sportsOrganizationId,
      title: "Should fail"
    });

    expect(createAttempt.status).toBe(403);
  });

  it("creates and updates a cross-functional task linked to a job / event", async () => {
    const draft = await createDraft(schoolsToken, {
      department_type: "schools",
      job_category: "photo_day",
      organization_id: schoolsOrganizationId,
      primary_location_id: schoolsLocationId,
      primary_contact_id: schoolsContactId,
      title: `Task Host Job ${JOB_TRUTH_TEST_RUN_ID}`,
      scheduled_start_at: plusDaysWithHours(6, 8),
      scheduled_end_at: plusDaysWithHours(6, 10),
      timezone: "America/Chicago",
      estimated_staff_count: 2,
      production_required: true,
      school_profile: {
        school_type: "high_school",
        school_year: "2026-2027",
        grade_scope: "9-12"
      }
    });

    const published = await publishJob(schoolsToken, draft.body.job.id);
    expect(published.status).toBe(200);
    const eventId = published.body.events[0].id;

    const created = await createTask(leadershipToken, {
      title: `Travel Packet ${Date.now()}`,
      department_type: "photography",
      job_id: published.body.job.id,
      event_id: eventId,
      assigned_to_user_id: photographerUserId,
      due_at: plusDaysWithHours(5, 6),
      proof_required: true
    });

    expect(created.status).toBe(201);
    expect(created.body.task.department_type).toBe("photography");
    expect(created.body.task.job_id).toBe(published.body.job.id);
    expect(created.body.task.related_job_id).toBe(published.body.job.id);
    expect(created.body.task.event_id).toBe(eventId);
    expect(created.body.task.workflow_run_id).toBeNull();
    expect(created.body.linkage).toMatchObject({
      job_id: published.body.job.id,
      event_id: eventId,
      workflow_run_id: null
    });
    expect(created.body.related_job?.id).toBe(published.body.job.id);
    expect(created.body.related_event?.id).toBe(eventId);
    expect(created.body.related_workflow_run).toBeNull();
    expect(created.body.assignments.some((assignment: { user_id: string }) => assignment.user_id === photographerUserId)).toBe(true);

    const fetched = await getTask(leadershipToken, created.body.task.id);
    expect(fetched.status).toBe(200);
    expect(fetched.body.task.task_number).toMatch(/^TSK-PHO-\d{4}-\d{4}$/);
    expect(
      fetched.body.work_model.some(
        (entry: { object_kind: string; description: string }) =>
          entry.object_kind === "schedule_entry" && /projection/i.test(entry.description)
      )
    ).toBe(true);

    const updated = await updateTask(leadershipToken, created.body.task.id, {
      status: "blocked",
      blocked_reason: "Waiting on travel confirmation."
    });
    expect(updated.status).toBe(200);
    expect(updated.body.task.status).toBe("blocked");
    expect(updated.body.task.blocked_reason).toBe("Waiting on travel confirmation.");
  });

  it("creates a task linked to a workflow run and derives the owning job from canonical linkage", async () => {
    const draft = await createDraft(schoolsToken, {
      department_type: "schools",
      job_category: "photo_day",
      organization_id: schoolsOrganizationId,
      primary_location_id: schoolsLocationId,
      primary_contact_id: schoolsContactId,
      title: `Workflow-linked Task Host ${JOB_TRUTH_TEST_RUN_ID}`,
      scheduled_start_at: plusDaysWithHours(7, 8),
      scheduled_end_at: plusDaysWithHours(7, 10),
      timezone: "America/Chicago",
      estimated_staff_count: 2,
      production_required: true,
      workflow_template_key: JOB_TRUTH_WORKFLOW_TEMPLATE_KEY,
      school_profile: {
        school_type: "high_school",
        school_year: "2026-2027",
        grade_scope: "9-12"
      }
    });

    expect(draft.status).toBe(201);
    expect(draft.body.shared_workflow?.run?.id).toBeTruthy();

    const workflowRunId = draft.body.shared_workflow.run.id;
    const workflowEventId = draft.body.shared_workflow.events[0].job_day_id;

    const created = await createTask(leadershipToken, {
      title: `Workflow Follow-up ${Date.now()}`,
      department_type: "operations",
      workflow_run_id: workflowRunId,
      event_id: workflowEventId,
      assigned_to_user_id: photographerUserId
    });

    expect(created.status).toBe(201);
    expect(created.body.task.job_id).toBe(draft.body.job.id);
    expect(created.body.task.event_id).toBe(workflowEventId);
    expect(created.body.task.workflow_run_id).toBe(workflowRunId);
    expect(created.body.linkage).toMatchObject({
      job_id: draft.body.job.id,
      event_id: workflowEventId,
      workflow_run_id: workflowRunId
    });
    expect(created.body.related_event?.id).toBe(workflowEventId);
    expect(created.body.related_workflow_run?.id).toBe(workflowRunId);
    expect(created.body.related_workflow_run?.job_id).toBe(draft.body.job.id);
  });

  it("blocks unauthorized task creation for standard employees", async () => {
    const createAttempt = await createTask(photographerToken, {
      title: `Unauthorized Task ${Date.now()}`,
      department_type: "photography"
    });

    expect(createAttempt.status).toBe(403);
  });

  it("supports cancel, postpone, and archive flows with activity logging", async () => {
    const draft = await createDraft(sportsToken, {
      department_type: "sports",
      organization_id: sportsOrganizationId,
      primary_location_id: sportsLocationId,
      primary_contact_id: sportsContactId,
      title: `Lifecycle Job ${JOB_TRUTH_TEST_RUN_ID}`,
      scheduled_start_at: plusDaysWithHours(18, 18),
      timezone: "America/Chicago",
      sports_profile: {
        sport_type: "soccer",
        season: "fall",
        team_structure: "single_team"
      }
    });

    const published = await publishJob(sportsToken, draft.body.job.id);
    const postponed = await request(app)
      .post(`/api/jobs/${published.body.job.id}/postpone`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ reason: "Weather concern" });
    expect(postponed.status).toBe(200);
    expect(postponed.body.job.job_status).toBe("postponed");

    const cancelled = await request(app)
      .post(`/api/jobs/${published.body.job.id}/cancel`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ reason: "Client requested cancellation" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.job.job_status).toBe("cancelled");

    const archived = await request(app)
      .post(`/api/jobs/${published.body.job.id}/archive`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});
    expect(archived.status).toBe(200);
    expect(archived.body.job.job_status).toBe("archived");
    expect(archived.body.activity.some((entry: { event_type: string }) => entry.event_type === "job_archived")).toBe(true);
  });

  it("supports shared watch flag lifecycle, alert deliveries, and deduped alert updates", async () => {
    const draft = await createDraft(sportsToken, {
      department_type: "sports",
      job_category: "photo_day",
      organization_id: sportsOrganizationId,
      primary_location_id: sportsLocationId,
      primary_contact_id: sportsContactId,
      title: `Command Layer Job ${JOB_TRUTH_TEST_RUN_ID}`,
      scheduled_start_at: plusDaysWithHours(2, 18),
      scheduled_end_at: plusDaysWithHours(2, 20),
      timezone: "America/Chicago",
      estimated_staff_count: 2,
      production_required: true,
      sports_profile: {
        sport_type: "football",
        season: "fall",
        team_structure: "scheduled_slots",
        proof_required: true,
        approval_contact_id: sportsContactId
      }
    });

    const published = await publishJob(sportsToken, draft.body.job.id);
    expect(published.status).toBe(200);

    const createdFlag = await createWatchFlag(sportsToken, published.body.job.id, {
      severity: "high",
      flag_type: "production_blocked",
      title: "Banner batch blocked",
      description: "Vendor approval is missing.",
      due_at: plusDaysWithHours(1, 8)
    });
    expect(createdFlag.status).toBe(201);

    const flagId = createdFlag.body.watch_flags.find((flag: { title: string }) => flag.title === "Banner batch blocked")?.id;
    expect(flagId).toBeTruthy();
    expect(await countAlertEvents(flagId)).toBe(1);

    const firstAcknowledge = await request(app)
      .post(`/api/jobs/watch-flags/${flagId}/acknowledge`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({});
    expect(firstAcknowledge.status).toBe(204);
    expect(await countAlertEvents(flagId)).toBe(2);

    const secondAcknowledge = await request(app)
      .post(`/api/jobs/watch-flags/${flagId}/acknowledge`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({});
    expect(secondAcknowledge.status).toBe(204);
    expect(await countAlertEvents(flagId)).toBe(2);

    const snoozed = await request(app)
      .post(`/api/jobs/watch-flags/${flagId}/snooze`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({ snooze_until: plusDaysWithHours(1, 12), note: "Waiting on vendor callback" });
    expect(snoozed.status).toBe(204);

    const escalated = await request(app)
      .post(`/api/jobs/watch-flags/${flagId}/escalate`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({
        severity: "critical",
        escalated_to_role: "leadership",
        due_at: plusDaysWithHours(1, 10),
        note: "Escalating blocked vendor confirmation."
      });
    expect(escalated.status).toBe(204);

    const escalatedWatchlist = await request(app)
      .get("/api/jobs/watchlist")
      .query({ department_type: "sports", only_escalated: "yes" })
      .set("Authorization", `Bearer ${sportsToken}`);
    expect(escalatedWatchlist.status).toBe(200);
    expect(escalatedWatchlist.body.items.some((item: { id: string; escalated_to_role: string; severity: string }) => item.id === flagId && item.escalated_to_role === "leadership" && item.severity === "critical")).toBe(true);

    const snoozedWatchlist = await request(app)
      .get("/api/jobs/watchlist")
      .query({ department_type: "sports", only_snoozed: "yes" })
      .set("Authorization", `Bearer ${sportsToken}`);
    expect(snoozedWatchlist.status).toBe(200);
    expect(snoozedWatchlist.body.items.some((item: { id: string }) => item.id === flagId)).toBe(true);

    const alertCenter = await request(app).get("/api/jobs/alerts").set("Authorization", `Bearer ${sportsToken}`);
    expect(alertCenter.status).toBe(200);
    const deliveryId = alertCenter.body.items.find((item: { watch_flag_id: string }) => item.watch_flag_id === flagId)?.id;
    expect(deliveryId).toBeTruthy();
    expect(await countAlertEvents(flagId)).toBe(4);

    const markedRead = await request(app)
      .post(`/api/jobs/alerts/${deliveryId}/read`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({});
    expect(markedRead.status).toBe(200);
    expect(markedRead.body.delivery.read_at).toBeTruthy();

    const resolved = await request(app)
      .post(`/api/jobs/watch-flags/${flagId}/resolve`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({ resolution_note: "Vendor responded and the batch is released.", follow_up_required: false });
    expect(resolved.status).toBe(204);

    const openWatchlist = await request(app)
      .get("/api/jobs/watchlist")
      .query({ department_type: "sports" })
      .set("Authorization", `Bearer ${sportsToken}`);
    expect(openWatchlist.status).toBe(200);
    expect(openWatchlist.body.items.some((item: { id: string }) => item.id === flagId)).toBe(false);

    const dismissedFlag = await createWatchFlag(sportsToken, published.body.job.id, {
      severity: "medium",
      flag_type: "client_issue",
      title: "Client requested callback",
      description: "Informational issue no longer needs watch visibility.",
      due_at: plusDaysWithHours(2, 9)
    });
    const dismissedFlagId = dismissedFlag.body.watch_flags.find((flag: { title: string }) => flag.title === "Client requested callback")?.id;
    expect(dismissedFlagId).toBeTruthy();

    const dismissed = await request(app)
      .post(`/api/jobs/watch-flags/${dismissedFlagId}/dismiss`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({ reason: "Handled directly with the client." });
    expect(dismissed.status).toBe(204);
  }, 15000);

  it("persists watchlist saved views and serves dashboard scopes with executive access control", async () => {
    const viewName = `Sports Critical ${Date.now()}`;
    const createdView = await request(app)
      .post("/api/jobs/watchlist/saved-views")
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({
        name: viewName,
        scope_type: "personal",
        department_type: "sports",
        filters_json: {
          department_type: "sports",
          critical_high_only: true
        },
        is_default: false,
        is_shared: false
      });

    expect(createdView.status).toBe(201);
    const viewId = createdView.body.view.id as string;
    expect(viewId).toBeTruthy();

    const listedViews = await request(app)
      .get("/api/jobs/watchlist/saved-views")
      .query({ department_type: "sports" })
      .set("Authorization", `Bearer ${sportsToken}`);
    expect(listedViews.status).toBe(200);
    expect(listedViews.body.views.some((view: { id: string; name: string }) => view.id === viewId && view.name === viewName)).toBe(true);

    const updatedName = `${viewName} Updated`;
    const updatedView = await request(app)
      .patch(`/api/jobs/watchlist/saved-views/${viewId}`)
      .set("Authorization", `Bearer ${sportsToken}`)
      .send({ name: updatedName });
    expect(updatedView.status).toBe(200);
    expect(updatedView.body.view.name).toBe(updatedName);

    const filteredWatchlist = await request(app)
      .get("/api/jobs/watchlist")
      .query({ view_id: viewId })
      .set("Authorization", `Bearer ${sportsToken}`);
    expect(filteredWatchlist.status).toBe(200);
    expect(filteredWatchlist.body.saved_views.some((view: { id: string }) => view.id === viewId)).toBe(true);

    const homeDashboard = await request(app)
      .get("/api/jobs/dashboard/home")
      .query({ department_type: "sports" })
      .set("Authorization", `Bearer ${sportsToken}`);
    expect(homeDashboard.status).toBe(200);
    expect(homeDashboard.body.widgets.length).toBeGreaterThan(0);
    expect(homeDashboard.body.health.state).toBeTruthy();

    const todayDashboard = await request(app)
      .get("/api/jobs/dashboard/today")
      .query({ department_type: "sports" })
      .set("Authorization", `Bearer ${sportsToken}`);
    expect(todayDashboard.status).toBe(200);
    expect(Array.isArray(todayDashboard.body.today_jobs)).toBe(true);

    const executiveDashboard = await request(app).get("/api/jobs/dashboard/executive").set("Authorization", `Bearer ${leadershipToken}`);
    expect(executiveDashboard.status).toBe(200);
    expect(executiveDashboard.body.summary.jobs_today).toBeGreaterThanOrEqual(0);

    const deniedExecutive = await request(app).get("/api/jobs/dashboard/executive").set("Authorization", `Bearer ${photographerToken}`);
    expect(deniedExecutive.status).toBe(403);

    const deletedView = await request(app)
      .delete(`/api/jobs/watchlist/saved-views/${viewId}`)
      .set("Authorization", `Bearer ${sportsToken}`);
    expect(deletedView.status).toBe(204);
  }, 45000);
});
