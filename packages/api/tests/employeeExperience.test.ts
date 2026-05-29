import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { devLogin } from "./helpers.js";

const app = createApp();

let photographerToken = "";
let leadershipToken = "";
let tenantId = "";
let studioId = "";
let organizationId = "";
let locationId = "";
let contactId = "";
let photographerUserId = "";
let seniorUserId = "";
let photographerShiftId = "";
let seniorShiftId = "";
let isolatedShiftId = "";
const myWorkAnchorDate = "2035-02-03";

function plusDaysWithHours(days: number, hours: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hours, 0, 0, 0);
  return date.toISOString();
}

async function createWorkflowTemplate(templateKey: string) {
  const response = await request(app)
    .post("/api/workflows/templates")
    .set("Authorization", `Bearer ${leadershipToken}`)
    .send({
      template_key: templateKey,
      name: "Employee My Work Workflow Template",
      description: "Test template for My Work live workflow assignment projection.",
      departments_involved: ["schools", "production"],
      milestones: [
        {
          milestone_key: "production",
          name: "Production",
          steps: [
            {
              step_key: "confirm_files",
              name: "Confirm Files",
              department: "production",
              role_key: "production_owner",
              required: true,
              skippable: false,
              blocking: true,
              expected_duration_minutes: 120
            }
          ]
        }
      ]
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
}

async function createWorkflowJob(title: string) {
  const response = await request(app)
    .post("/api/jobs/drafts")
    .set("Authorization", `Bearer ${leadershipToken}`)
    .send({
      department_type: "schools",
      job_category: "photo_day",
      organization_id: organizationId,
      primary_location_id: locationId,
      primary_contact_id: contactId,
      title,
      scheduled_start_at: plusDaysWithHours(14, 14),
      scheduled_end_at: plusDaysWithHours(14, 16),
      timezone: "America/Chicago",
      production_required: true,
      school_profile: {
        school_type: "elementary",
        school_year: "2026-2027",
        grade_scope: "K-5"
      }
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.job.id as string;
}

async function instantiateWorkflow(jobId: string, templateKey: string) {
  const response = await request(app)
    .post("/api/workflows/instances")
    .set("Authorization", `Bearer ${leadershipToken}`)
    .send({
      job_id: jobId,
      template_key: templateKey,
      idempotency_key: `employee-my-work:${jobId}:${templateKey}`
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body;
}

function workflowStepByKey(workflow: any, stepKey: string) {
  return workflow.milestones.flatMap((milestone: any) => milestone.steps).find((step: any) => step.step_key === stepKey);
}

async function cleanupLiveWorkflowFixtures() {
  if (!tenantId) {
    return;
  }
  const jobIds = (
    await pool.query<{ id: string }>(
      `
        SELECT id::text
        FROM jobs
        WHERE tenant_id = $1
          AND title LIKE 'Employee My Work Workflow %'
      `,
      [tenantId]
    )
  ).rows.map((row) => row.id);
  if (jobIds.length) {
    await pool.query("DELETE FROM jobs WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, jobIds]);
  }

  const templateIds = (
    await pool.query<{ id: string }>(
      `
        SELECT id::text
        FROM workflow_template
        WHERE tenant_id = $1
          AND template_key LIKE 'employee_my_work_workflow_%'
      `,
      [tenantId]
    )
  ).rows.map((row) => row.id);
  if (!templateIds.length) {
    return;
  }
  const versionIds = (
    await pool.query<{ id: string }>(
      `
        SELECT id::text
        FROM workflow_template_version
        WHERE tenant_id = $1
          AND template_id = ANY($2::uuid[])
      `,
      [tenantId, templateIds]
    )
  ).rows.map((row) => row.id);
  if (versionIds.length) {
    await pool.query("DELETE FROM workflow_template_step_dependency WHERE tenant_id = $1 AND template_version_id = ANY($2::uuid[])", [tenantId, versionIds]);
    await pool.query("DELETE FROM workflow_template_step WHERE tenant_id = $1 AND template_version_id = ANY($2::uuid[])", [tenantId, versionIds]);
    await pool.query("DELETE FROM workflow_template_milestone WHERE tenant_id = $1 AND template_version_id = ANY($2::uuid[])", [tenantId, versionIds]);
    await pool.query("DELETE FROM workflow_template_version WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, versionIds]);
  }
  await pool.query("DELETE FROM workflow_template WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, templateIds]);
}

beforeAll(async () => {
  photographerToken = (await devLogin(app, "photo@example.com")).body.token;
  leadershipToken = (await devLogin(app, "leadership@example.com")).body.token;

  const photographerUser = (
    await pool.query("SELECT id, tenant_id FROM app_user WHERE lower(email) = lower('photo@example.com') LIMIT 1")
  ).rows[0];
  photographerUserId = photographerUser.id;
  tenantId = photographerUser.tenant_id;

  studioId = (await pool.query("SELECT id FROM studio WHERE tenant_id = $1 LIMIT 1", [tenantId])).rows[0].id;
  seniorUserId = (await pool.query("SELECT id FROM app_user WHERE lower(email) = lower('senior@example.com') LIMIT 1")).rows[0].id;
  const fixture = (
    await pool.query(
      `
        SELECT organization_id::text, location_id::text, primary_contact_id::text
        FROM shoot
        WHERE tenant_id = $1
          AND deleted_at IS NULL
          AND record_state = 'published'::shoot_record_state
          AND organization_id IS NOT NULL
          AND location_id IS NOT NULL
          AND primary_contact_id IS NOT NULL
        ORDER BY created_at ASC
        LIMIT 1
      `,
      [tenantId]
    )
  ).rows[0];
  organizationId = fixture.organization_id;
  locationId = fixture.location_id;
  contactId = fixture.primary_contact_id;

  photographerShiftId = (
    await pool.query(
      `
        SELECT ws.id
        FROM work_shift ws
        JOIN shoot s ON s.id = ws.shoot_id
        JOIN app_user au ON au.id = ws.assigned_user_id
        WHERE lower(au.email) = lower('photo@example.com')
          AND s.shoot_code = 'DEMO-001'
          AND ws.status = 'published'
          AND ws.cancelled_at IS NULL
        ORDER BY ws.starts_at ASC
        LIMIT 1
      `
    )
  ).rows[0].id;

  seniorShiftId = (
    await pool.query(
      `
        SELECT ws.id
        FROM work_shift ws
        JOIN shoot s ON s.id = ws.shoot_id
        JOIN app_user au ON au.id = ws.assigned_user_id
        WHERE lower(au.email) = lower('senior@example.com')
          AND s.shoot_code = 'DEMO-001'
          AND ws.status = 'published'
          AND ws.cancelled_at IS NULL
        ORDER BY ws.starts_at ASC
        LIMIT 1
      `
    )
  ).rows[0].id;

  const shiftInsert = await pool.query(
    `
      INSERT INTO work_shift (
        tenant_id, shoot_id, studio_id, assigned_user_id, manager_user_id, created_by_user_id, published_by_user_id,
        shift_kind, status, department, staffing_role, satisfies_lead_coverage, title, starts_at, ends_at,
        location_name, location_address, geofence_radius_meters, navigation_url, notes, published_at
      )
      VALUES (
        $1,NULL,$2,$3,$4,$4,$4,
        'shoot','published','schools','photographer',false,'Employee Route Test Shift',
        ($5::date + time '09:00') AT TIME ZONE 'America/Chicago', ($5::date + time '12:00') AT TIME ZONE 'America/Chicago',
        'Employee Test Site','700 Test Drive',180,'https://maps.example/employee-route-test',
        'Check in with the front office before unloading and keep the backup light stand near the east wall.',
        now()
      )
      RETURNING id
    `,
    [tenantId, studioId, photographerUserId, seniorUserId, myWorkAnchorDate]
  );
  isolatedShiftId = shiftInsert.rows[0].id;
});

afterAll(async () => {
  await cleanupLiveWorkflowFixtures();
  if (isolatedShiftId) {
    await pool.query("DELETE FROM shift_note_acknowledgement WHERE shift_id = $1", [isolatedShiftId]);
    await pool.query("DELETE FROM work_shift WHERE id = $1", [isolatedShiftId]);
  }
});

beforeEach(async () => {
  await pool.query(
    `
      DELETE FROM shift_note_acknowledgement
      WHERE user_id = $1
        AND shift_id = ANY($2::uuid[])
        AND acknowledgement_scope = 'pre_service_notes'
    `,
    [photographerUserId, [photographerShiftId, isolatedShiftId]]
  );
  await pool.query(
    `
      DELETE FROM operational_note
      WHERE tenant_id = $1
        AND author_user_id = $2
        AND source_context LIKE 'mobile_%'
    `,
    [tenantId, photographerUserId]
  );
  await pool.query(
    `
      DELETE FROM app_event
      WHERE tenant_id = $1
        AND event_type = 'notification.dispatch'
        AND payload->'metadata'->>'source_context' LIKE 'mobile_%'
    `,
    [tenantId]
  );
});

describe("employee My Work surface", () => {
  it("returns only the authenticated employee's published event-native My Work payload", async () => {
    const response = await request(app)
      .get(`/api/employee/my-work?anchor_date=${myWorkAnchorDate}`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.events)).toBe(true);
    expect(response.body.shifts.length).toBeGreaterThan(0);
    expect(response.body.shifts.every((shift: { id: string }) => shift.id !== seniorShiftId)).toBe(true);
    expect(response.body.shifts.some((shift: { id: string }) => shift.id === isolatedShiftId)).toBe(true);
    expect(response.body.events.every((event: { id: string }) => event.id !== seniorShiftId)).toBe(true);
    expect(response.body.events.some((event: { id: string }) => event.id === isolatedShiftId)).toBe(true);
    expect(response.body.events.map((event: { id: string }) => event.id)).toEqual(
      response.body.shifts.map((eventProjection: { id: string }) => eventProjection.id)
    );
    expect(typeof response.body.summary.attention_needed_count).toBe("number");
    expect(typeof response.body.summary.closeout_due_count).toBe("number");
    expect(typeof response.body.summary.late_or_exception_count).toBe("number");
    expect(typeof response.body.summary.mileage_review_count).toBe("number");
    expect(typeof response.body.summary.events_today).toBe("number");
    expect(typeof response.body.summary.upcoming_events).toBe("number");
    expect(typeof response.body.summary.next_event_label).toBe("string");
    expect(typeof response.body.summary.assigned_event_count).toBe("number");
    expect(typeof response.body.summary.assigned_task_count).toBe("number");
    expect(typeof response.body.summary.acknowledgement_count).toBe("number");
    expect(typeof response.body.summary.owned_exception_count).toBe("number");
    expect(typeof response.body.summary.approval_waiting_count).toBe("number");
    expect(Array.isArray(response.body.tasks)).toBe(true);
    expect(Array.isArray(response.body.acknowledgements)).toBe(true);
    expect(Array.isArray(response.body.exceptions)).toBe(true);
    expect(Array.isArray(response.body.approvals)).toBe(true);
    expect(Array.isArray(response.body.recent_changes)).toBe(true);
    expect(response.body.schedule_context).toBeTruthy();
    expect(
      response.body.events.some(
        (event: { id: string; event_id: string; source_record_type: string; source_record_id: string }) =>
          event.id === isolatedShiftId &&
          event.event_id === isolatedShiftId &&
          event.source_record_type === "work_shift" &&
          event.source_record_id === isolatedShiftId
      )
    ).toBe(true);
    expect(
      response.body.acknowledgements.some(
        (item: {
          acknowledgement_type: string;
          event_id: string;
          source_record_type: string;
          source_record_id: string;
          shift_id: string;
        }) =>
          item.acknowledgement_type === "pre_service_notes" &&
          item.event_id === isolatedShiftId &&
          item.source_record_type === "work_shift" &&
          item.source_record_id === isolatedShiftId &&
          item.shift_id === isolatedShiftId
      )
    ).toBe(true);
    expect(response.body.shifts[0]).toHaveProperty("follow_through_label");
    expect(response.body.shifts[0]).toHaveProperty("follow_through_tone");
  }, 30000);

  it("includes current live workflow steps assigned to the employee without showing queue-only assignments", async () => {
    const assignedTemplateKey = `employee_my_work_workflow_assigned_${Date.now()}`;
    await createWorkflowTemplate(assignedTemplateKey);
    const assignedJobId = await createWorkflowJob(`Employee My Work Workflow Assigned ${Date.now()}`);
    const assignedWorkflow = await instantiateWorkflow(assignedJobId, assignedTemplateKey);
    const assignedStep = workflowStepByKey(assignedWorkflow, "confirm_files");
    const assignedResponse = await request(app)
      .post(`/api/workflows/steps/${assignedStep.id}/transition`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        status: assignedStep.status,
        assigned_user_id: photographerUserId,
        assigned_queue: "production",
        reason: "Assign current live workflow step to the employee My Work test user.",
        notes: "This live workflow step should appear in My Work."
      });
    expect(assignedResponse.status, JSON.stringify(assignedResponse.body)).toBe(200);

    const queueOnlyTemplateKey = `employee_my_work_workflow_queue_${Date.now()}`;
    await createWorkflowTemplate(queueOnlyTemplateKey);
    const queueOnlyJobId = await createWorkflowJob(`Employee My Work Workflow Queue Only ${Date.now()}`);
    const queueOnlyWorkflow = await instantiateWorkflow(queueOnlyJobId, queueOnlyTemplateKey);
    const queueOnlyStep = workflowStepByKey(queueOnlyWorkflow, "confirm_files");
    const queueOnlyResponse = await request(app)
      .post(`/api/workflows/steps/${queueOnlyStep.id}/transition`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        status: queueOnlyStep.status,
        assigned_queue: "production",
        reason: "Assign current live workflow step to queue only.",
        notes: "Queue-only ownership should not appear as personal My Work."
      });
    expect(queueOnlyResponse.status, JSON.stringify(queueOnlyResponse.body)).toBe(200);

    const response = await request(app)
      .get(`/api/employee/my-work?anchor_date=${myWorkAnchorDate}`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.live_workflow_steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: assignedStep.id,
          workflow_run_id: assignedWorkflow.workflow_run.id,
          job_id: assignedJobId,
          job_title: expect.stringContaining("Employee My Work Workflow Assigned"),
          step_name: "Confirm Files",
          department: "production",
          assigned_user_id: photographerUserId,
          assigned_queue: "production",
          assignment_status: "assigned",
          notes: "This live workflow step should appear in My Work.",
          updated_at: expect.any(String),
          deep_link: `#project-tracking/workflows/${assignedWorkflow.workflow_run.id}`
        })
      ])
    );
    expect(response.body.live_workflow_steps.some((step: { job_id: string }) => step.job_id === queueOnlyJobId)).toBe(false);
    expect(response.body.summary.live_workflow_step_count).toBeGreaterThanOrEqual(1);
    const assignedJob = response.body.jobs.find((job: { id: string }) => job.id === assignedJobId);
    expect(assignedJob).toEqual(expect.objectContaining({ assigned_workflow_step_count: 1 }));
    expect(response.body.events.some((event: { id: string }) => event.id === isolatedShiftId)).toBe(true);
  }, 30000);

  it("blocks a field employee from opening another employee's event detail", async () => {
    const response = await request(app)
      .get(`/api/employee/events/${seniorShiftId}`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(response.status).toBe(403);
  });

  it("keeps the shift detail route as a measurable compatibility alias", async () => {
    const response = await request(app)
      .get(`/api/employee/shifts/${photographerShiftId}`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(response.status).toBe(200);
    expect(response.headers.deprecation).toBe("true");
    expect(response.headers["x-mission-control-compatibility-alias"]).toBe("/api/employee/shifts/:id");
    expect(response.headers["x-mission-control-canonical-route"]).toBe("/api/employee/events/:id");
    expect(response.body.event.id).toBe(photographerShiftId);
  }, 15000);

  it("stores a note acknowledgement against the employee's own event projection", async () => {
    const response = await request(app)
      .post(`/api/employee/events/${isolatedShiftId}/acknowledge`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.acknowledged).toBe(true);
    expect(response.body.event_id).toBe(isolatedShiftId);
    expect(response.body.shift_id).toBe(isolatedShiftId);
    expect(response.body.note_snapshot_hash).toBeTruthy();

    const persisted = await pool.query(
      `
        SELECT note_snapshot_hash
      FROM shift_note_acknowledgement
      WHERE user_id = $1
        AND shift_id = $2
        AND acknowledgement_scope = 'pre_service_notes'
      LIMIT 1
    `,
      [photographerUserId, isolatedShiftId]
    );

    expect(persisted.rows[0]?.note_snapshot_hash).toBe(response.body.note_snapshot_hash);
  });

  it("keeps the shift acknowledgement route as a measurable compatibility alias", async () => {
    const response = await request(app)
      .post(`/api/employee/shifts/${isolatedShiftId}/acknowledge`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(response.status).toBe(200);
    expect(response.headers.deprecation).toBe("true");
    expect(response.headers["x-mission-control-compatibility-alias"]).toBe("/api/employee/shifts/:id/acknowledge");
    expect(response.headers["x-mission-control-canonical-route"]).toBe("/api/employee/events/:id/acknowledge");
    expect(response.body.acknowledged).toBe(true);
    expect(response.body.event_id).toBe(isolatedShiftId);
  });

  it("returns a prep-only Resource Library for employee event detail", async () => {
    const response = await request(app)
      .get(`/api/employee/events/${photographerShiftId}`)
      .set("Authorization", `Bearer ${photographerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.event.id).toBe(photographerShiftId);
    expect(response.body.event.id).toBe(response.body.shift.id);
    expect(response.body.event.source_record_type).toBe("work_shift");
    expect(response.body.linked_records.shoot?.id).toBeTruthy();
    expect(response.body.closeout_compliance).toBeTruthy();
    expect(Array.isArray(response.body.closeout_compliance.missing_required_items)).toBe(true);
    expect(response.body.resource_library.access.limited_view).toBe(true);
    expect(response.body.resource_library.access.can_download).toBe(false);
    expect(response.body.resource_library.summary.total_items).toBeGreaterThan(0);
    expect(
      response.body.resource_library.prep_highlights.some(
        (item: { is_best_reference: boolean; file_name: string; download_url: string | null }) =>
          item.is_best_reference === true &&
          item.file_name === "demo-001-best-reference.jpg" &&
          item.download_url === null
        )
    ).toBe(true);
  }, 15000);

  it("creates a field issue report as a reviewable operational note and notification event", async () => {
    const response = await request(app)
      .post(`/api/employee/shifts/${photographerShiftId}/form-submissions`)
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        form_type: "field_issue_report",
        issue_category: "setup_room_problem",
        severity: "major",
        summary: "Backdrop lane is blocked by a room change.",
        note: "Need manager confirmation before setup starts.",
        follow_up_needed: true
      });

    expect(response.status).toBe(201);
    expect(response.body.form_type).toBe("field_issue_report");
    expect(response.body.review_state).toBe("needs_review");
    expect(response.body.derived_record.type).toBe("operational_note");

    const note = await pool.query(
      `
        SELECT source_context, body
        FROM operational_note
        WHERE id = $1
        LIMIT 1
      `,
      [response.body.derived_record.id]
    );

    expect(note.rows[0]?.source_context).toBe("mobile_field_issue_report");
    expect(String(note.rows[0]?.body ?? "")).toContain("Backdrop lane is blocked by a room change.");

    const notify = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'notification.dispatch'
          AND payload->'metadata'->>'operational_note_id' = $2
      `,
      [tenantId, response.body.derived_record.id]
    );

    expect(Number(notify.rows[0]?.total ?? 0)).toBeGreaterThan(0);
  });

  it("creates a location memory suggestion from the employee mobile workflow", async () => {
    const response = await request(app)
      .post(`/api/employee/shifts/${photographerShiftId}/form-submissions`)
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        form_type: "location_memory_suggestion",
        memory_type: "parking_load_in",
        summary: "Use the south service door before 7:00 AM for carts.",
        why_it_matters: "The front loop locks during arrival traffic.",
        useful_for_future_crews: true
      });

    expect(response.status).toBe(201);
    expect(response.body.form_type).toBe("location_memory_suggestion");

    const note = await pool.query(
      `
        SELECT source_context, body
        FROM operational_note
        WHERE id = $1
        LIMIT 1
      `,
      [response.body.derived_record.id]
    );

    expect(note.rows[0]?.source_context).toBe("mobile_location_memory_suggestion");
    expect(String(note.rows[0]?.body ?? "")).toContain("Use the south service door before 7:00 AM for carts.");
  });
});
