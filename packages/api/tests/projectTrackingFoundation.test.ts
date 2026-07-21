import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let app: Express;
let dbPool: Pool;
let leadershipToken = "";
let photoToken = "";
let associateToken = "";
let tenantId = "";
let organizationId = "";
let locationId = "";
let contactId = "";
let leadershipUserId = "";
let photoUserId = "";
let associateUserId = "";

const PROJECT_TRACKING_TEST_TEMPLATE_PATTERNS = [
  "project_tracking_foundation_%",
  "project_tracking_versioning_%",
  "project_tracking_transition_%",
  "project_tracking_assignment_%",
  "project_tracking_sendback_%",
  "project_tracking_permissions_%",
  "project_tracking_command_center_%",
  "project_tracking_sla_alerts_%",
  "project_tracking_handoff_%"
];
const PROJECT_TRACKING_TEST_JOB_PATTERNS = [
  "Project Tracking Foundation %",
  "Project Tracking Version %",
  "Project Tracking Transition %",
  "Project Tracking Assignment %",
  "Project Tracking Send Back %",
  "Project Tracking Permissions %",
  "Project Tracking Command Center %",
  "Project Tracking SLA Alerts %",
  "Project Tracking Handoff %"
];

function plusDaysWithHours(days: number, hours: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hours, 0, 0, 0);
  return date.toISOString();
}

async function login(email: string) {
  const response = await request(app).post("/auth/dev-login").send({ email });
  return response.body.token as string;
}

async function createDraftJob(title: string) {
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
      scheduled_start_at: plusDaysWithHours(12, 14),
      scheduled_end_at: plusDaysWithHours(12, 16),
      timezone: "America/Chicago",
      production_required: false,
      school_profile: {
        school_type: "high_school",
        school_year: "2026-2027",
        grade_scope: "9-12"
      }
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.job.id as string;
}

async function createTemplate(
  templateKey: string,
  options: {
    templateName?: string;
    confirmScopeAssignedUserId?: string | null;
    prepareFilesAssignedUserId?: string | null;
  } = {}
) {
  const response = await request(app)
    .post("/api/workflows/templates")
    .set("Authorization", `Bearer ${leadershipToken}`)
    .send({
      template_key: templateKey,
      name: options.templateName ?? "Project Tracking Smoke Template",
      description: "System-controlled step foundation for test workflows.",
      departments_involved: ["schools", "production"],
      milestones: [
        {
          milestone_key: "intake",
          name: "Intake",
          steps: [
            {
              step_key: "confirm_scope",
              name: "Confirm scope",
              department: "schools",
              role_key: "account_owner",
              assigned_user_id: options.confirmScopeAssignedUserId ?? undefined,
              required: true,
              skippable: false,
              blocking: true,
              expected_duration_minutes: 60
            }
          ]
        },
        {
          milestone_key: "production",
          name: "Production",
          steps: [
            {
              step_key: "prepare_files",
              name: "Prepare files",
              department: "production",
              role_key: "production_owner",
              assigned_user_id: options.prepareFilesAssignedUserId ?? undefined,
              required: true,
              skippable: false,
              blocking: true,
              expected_duration_minutes: 120,
              depends_on_step_keys: ["confirm_scope"]
            },
            {
              step_key: "release_package",
              name: "Release package",
              department: "production",
              role_key: "release_owner",
              required: true,
              skippable: true,
              blocking: true,
              expected_duration_minutes: 90,
              depends_on_step_keys: ["prepare_files"]
            }
          ]
        }
      ]
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  expect(response.body.version.version_number).toBeGreaterThan(0);
  return response.body.version.id as string;
}

async function instantiate(jobId: string, templateKey: string) {
  const response = await request(app)
    .post("/api/workflows/instances")
    .set("Authorization", `Bearer ${leadershipToken}`)
    .send({
      job_id: jobId,
      template_key: templateKey,
      idempotency_key: `instantiate:${jobId}:${templateKey}`
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body;
}

function stepByKey(workflow: any, stepKey: string) {
  return workflow.milestones.flatMap((milestone: any) => milestone.steps).find((step: any) => step.step_key === stepKey);
}

async function cleanupProjectTrackingTestFixtures() {
  if (!dbPool || !tenantId) {
    return;
  }
  const jobIds = (
    await dbPool.query<{ id: string }>(
      `
        SELECT id::text
        FROM jobs
        WHERE tenant_id = $1
          AND title LIKE ANY($2::text[])
      `,
      [tenantId, PROJECT_TRACKING_TEST_JOB_PATTERNS]
    )
  ).rows.map((row) => row.id);
  const templateIds = (
    await dbPool.query<{ id: string }>(
      `
        SELECT id::text
        FROM workflow_template
        WHERE tenant_id = $1
          AND (
            name = 'Project Tracking Smoke Template'
            OR template_key LIKE ANY($2::text[])
          )
      `,
      [tenantId, PROJECT_TRACKING_TEST_TEMPLATE_PATTERNS]
    )
  ).rows.map((row) => row.id);
  const versionIds = (
    await dbPool.query<{ id: string }>(
      `
        SELECT id::text
        FROM workflow_template_version
        WHERE tenant_id = $1
          AND template_id = ANY($2::uuid[])
      `,
      [tenantId, templateIds]
    )
  ).rows.map((row) => row.id);
  const runIds = (
    await dbPool.query<{ id: string }>(
      `
        SELECT id::text
        FROM workflow_run
        WHERE tenant_id = $1
          AND (
            job_id = ANY($2::uuid[])
            OR template_id = ANY($3::uuid[])
          )
      `,
      [tenantId, jobIds, templateIds]
    )
  ).rows.map((row) => row.id);

  await dbPool.query("DELETE FROM work_task WHERE tenant_id = $1 AND related_job_id = ANY($2::uuid[])", [tenantId, jobIds]);
  await dbPool.query("DELETE FROM workflow_handoff WHERE tenant_id = $1 AND workflow_run_id = ANY($2::uuid[])", [tenantId, runIds]);
  await dbPool.query("DELETE FROM workflow_step_audit_log WHERE tenant_id = $1 AND workflow_run_id = ANY($2::uuid[])", [tenantId, runIds]);
  await dbPool.query("DELETE FROM workflow_step_dependency WHERE tenant_id = $1 AND workflow_run_id = ANY($2::uuid[])", [tenantId, runIds]);
  await dbPool.query("DELETE FROM workflow_step WHERE tenant_id = $1 AND workflow_run_id = ANY($2::uuid[])", [tenantId, runIds]);
  await dbPool.query("DELETE FROM workflow_run_milestone WHERE tenant_id = $1 AND workflow_run_id = ANY($2::uuid[])", [tenantId, runIds]);
  await dbPool.query("DELETE FROM workflow_run WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, runIds]);
  await dbPool.query("DELETE FROM workflow_template_step_dependency WHERE tenant_id = $1 AND template_version_id = ANY($2::uuid[])", [tenantId, versionIds]);
  await dbPool.query("DELETE FROM workflow_template_step WHERE tenant_id = $1 AND template_version_id = ANY($2::uuid[])", [tenantId, versionIds]);
  await dbPool.query("DELETE FROM workflow_template_milestone WHERE tenant_id = $1 AND template_version_id = ANY($2::uuid[])", [tenantId, versionIds]);
  await dbPool.query("DELETE FROM workflow_template_version WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, versionIds]);
  await dbPool.query("DELETE FROM workflow_template WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, templateIds]);
  await dbPool.query("DELETE FROM jobs WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, jobIds]);
}

async function countHandoffAuditRows(workflowRunId: string, handoffId: string) {
  const auditRows = await dbPool.query<{ count: string }>(
    `
      SELECT count(*)::text AS count
      FROM workflow_step_audit_log
      WHERE tenant_id = $1
        AND workflow_run_id = $2
        AND (
          new_values->>'handoff_id' = $3
          OR previous_values->>'handoff_id' = $3
        )
    `,
    [tenantId, workflowRunId, handoffId]
  );
  return Number(auditRows.rows[0]?.count ?? "0");
}

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { pool } = await import("../src/db/pool.js");
  app = createApp();
  dbPool = pool;

  leadershipToken = await login("leadership@example.com");
  photoToken = await login("photo@example.com");
  associateToken = await login("associate@example.com");

  const fixtureRows = await dbPool.query<{
    tenant_id: string;
    organization_id: string;
    location_id: string;
    primary_contact_id: string;
  }>(
    `
      SELECT
        s.tenant_id::text AS tenant_id,
        s.organization_id::text AS organization_id,
        s.location_id::text AS location_id,
        s.primary_contact_id::text AS primary_contact_id
      FROM shoot s
      WHERE s.deleted_at IS NULL
        AND s.record_state = 'published'::shoot_record_state
        AND s.organization_id IS NOT NULL
        AND s.location_id IS NOT NULL
        AND s.primary_contact_id IS NOT NULL
        AND s.department = 'schools'::department_code
      ORDER BY s.created_at ASC
      LIMIT 1
    `
  );
  const fixture = fixtureRows.rows[0];
  if (!fixture) {
    throw new Error("Expected a seeded schools fixture for project tracking tests.");
  }
  tenantId = fixture.tenant_id;
  organizationId = fixture.organization_id;
  locationId = fixture.location_id;
  contactId = fixture.primary_contact_id;

  const userRows = await dbPool.query<{ email: string; id: string }>(
    `
      SELECT lower(email) AS email, id::text
      FROM app_user
      WHERE lower(email) = ANY($1::text[])
    `,
    [["leadership@example.com", "photo@example.com", "associate@example.com"]]
  );
  const userByEmail = new Map(userRows.rows.map((row) => [row.email, row.id]));
  leadershipUserId = userByEmail.get("leadership@example.com") ?? "";
  photoUserId = userByEmail.get("photo@example.com") ?? "";
  associateUserId = userByEmail.get("associate@example.com") ?? "";
});

afterAll(async () => {
  await cleanupProjectTrackingTestFixtures();
});

describe("project tracking foundation", () => {
  it("creates a versioned template and starts a workflow with milestones, primary steps, and waiting dependencies", async () => {
    const templateKey = `project_tracking_foundation_${Date.now()}`;
    const templateVersionId = await createTemplate(templateKey);
    const jobId = await createDraftJob(`Project Tracking Foundation ${Date.now()}`);

    const workflow = await instantiate(jobId, templateKey);

    expect(workflow.workflow_run.workflow_family).toBe("project_tracking");
    expect(workflow.workflow_run.template_version_id).toBe(templateVersionId);
    expect(workflow.workflow_run.template_name).toBe("Project Tracking Smoke Template");
    expect(workflow.workflow_run.template_version_label).toContain("project_tracking_foundation_");
    expect(workflow.job.organization_id).toBe(organizationId);
    expect(workflow.job.title).toContain("Project Tracking Foundation");
    expect(workflow.job.organization_name).toBeTruthy();
    expect(workflow.job.job_type).toBe("photo_day");
    expect(workflow.milestones.map((milestone: any) => milestone.milestone_key)).toEqual(["intake", "production"]);
    expect(stepByKey(workflow, "confirm_scope").status).toBe("NOT_STARTED");
    expect(stepByKey(workflow, "prepare_files").status).toBe("WAITING");
    expect(stepByKey(workflow, "release_package").dependency_step_ids).toHaveLength(1);
  });

  it("creates new template versions without changing historical workflow instances", async () => {
    const templateKey = `project_tracking_versioning_${Date.now()}`;
    const firstVersionId = await createTemplate(templateKey, { templateName: "Version One" });
    const firstJobId = await createDraftJob(`Project Tracking Version One ${Date.now()}`);
    const firstWorkflow = await instantiate(firstJobId, templateKey);

    const secondVersionId = await createTemplate(templateKey, { templateName: "Version Two" });
    const secondJobId = await createDraftJob(`Project Tracking Version Two ${Date.now()}`);
    const secondWorkflow = await instantiate(secondJobId, templateKey);

    expect(firstWorkflow.workflow_run.template_version_id).toBe(firstVersionId);
    expect(secondWorkflow.workflow_run.template_version_id).toBe(secondVersionId);
    expect(secondVersionId).not.toBe(firstVersionId);

    const reloadedFirst = await request(app)
      .get(`/api/workflows/instances/${firstWorkflow.workflow_run.id}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(reloadedFirst.status).toBe(200);
    expect(reloadedFirst.body.workflow_run.template_version_id).toBe(firstVersionId);
  });

  it("requires reasons for deviations, logs events, and activates cross-department handoffs", async () => {
    const templateKey = `project_tracking_transition_${Date.now()}`;
    await createTemplate(templateKey);
    const jobId = await createDraftJob(`Project Tracking Transition ${Date.now()}`);
    let workflow = await instantiate(jobId, templateKey);
    const confirmScope = stepByKey(workflow, "confirm_scope");

    const invalidEarlyComplete = await request(app)
      .post(`/api/workflows/steps/${confirmScope.id}/transition`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ status: "COMPLETE" });
    expect(invalidEarlyComplete.status).toBe(400);
    expect(invalidEarlyComplete.body.error).toContain("requires a reason");

    const started = await request(app)
      .post(`/api/workflows/steps/${confirmScope.id}/transition`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ status: "IN_PROGRESS", assigned_user_id: leadershipUserId });
    expect(started.status).toBe(200);

    const completed = await request(app)
      .post(`/api/workflows/steps/${confirmScope.id}/transition`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        status: "COMPLETE",
        reason: "Scope was confirmed in the kickoff call.",
        idempotency_key: `complete:${confirmScope.id}`
      });
    expect(completed.status).toBe(200);
    workflow = completed.body;
    const completedConfirmScope = stepByKey(workflow, "confirm_scope");
    expect(completedConfirmScope.status).toBe("COMPLETE");
    expect(stepByKey(workflow, "prepare_files").status).toBe("NOT_STARTED");

    const handoffRows = await dbPool.query<{ id: string }>(
      `
        SELECT id::text
        FROM workflow_handoff
        WHERE workflow_run_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [workflow.workflow_run.id]
    );
    expect(handoffRows.rows[0]?.id).toBeTruthy();

    const handoffEventRows = await dbPool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'workflow.handoff_created'
          AND aggregate_id = $2
      `,
      [tenantId, handoffRows.rows[0]?.id]
    );
    expect(Number(handoffEventRows.rows[0]?.count ?? "0")).toBe(1);

    const eventRows = await dbPool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM app_event
        WHERE tenant_id = $1
          AND aggregate_id = $2
          AND event_type = 'workflow.step_completed'
      `,
      [tenantId, confirmScope.id]
    );
    expect(Number(eventRows.rows[0]?.count ?? "0")).toBe(1);

    const auditRows = await dbPool.query<{
      actor_user_id: string;
      previous_status: string;
      new_status: string;
      previous_values: { status: string };
      new_values: { status: string };
      reason: string | null;
    }>(
      `
        SELECT
          actor_user_id::text,
          previous_status::text,
          new_status::text,
          previous_values,
          new_values,
          reason
        FROM workflow_step_audit_log
        WHERE workflow_step_id = $1
          AND transition_type = 'completed'::workflow_step_transition_type
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [confirmScope.id]
    );
    expect(auditRows.rows[0]?.actor_user_id).toBe(leadershipUserId);
    expect(auditRows.rows[0]?.previous_status).toBe("IN_PROGRESS");
    expect(auditRows.rows[0]?.new_status).toBe("COMPLETE");
    expect(auditRows.rows[0]?.previous_values.status).toBe("IN_PROGRESS");
    expect(auditRows.rows[0]?.new_values.status).toBe("COMPLETE");
    expect(auditRows.rows[0]?.reason).toContain("kickoff call");

    const retry = await request(app)
      .post(`/api/workflows/steps/${confirmScope.id}/transition`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        status: "COMPLETE",
        reason: "Scope was confirmed in the kickoff call.",
        idempotency_key: `complete:${confirmScope.id}`
      });
    expect(retry.status).toBe(200);
    expect(stepByKey(retry.body, "confirm_scope").completed_at).toBe(completedConfirmScope.completed_at);

    const postRetryAuditRows = await dbPool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM workflow_step_audit_log
        WHERE workflow_step_id = $1
          AND transition_type = 'completed'::workflow_step_transition_type
      `,
      [confirmScope.id]
    );
    expect(Number(postRetryAuditRows.rows[0]?.count ?? "0")).toBe(1);

    const prepareFiles = stepByKey(workflow, "prepare_files");
    const blocked = await request(app)
      .post(`/api/workflows/steps/${prepareFiles.id}/transition`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ status: "BLOCKED", reason: "Production is waiting on account files." });
    expect(blocked.status).toBe(200);
    expect(stepByKey(blocked.body, "prepare_files").status).toBe("BLOCKED");
  });

  it("lets managers assign the current live workflow step to a person and queue without mutating the template", async () => {
    const templateKey = `project_tracking_assignment_${Date.now()}`;
    const templateVersionId = await createTemplate(templateKey, { templateName: "Assignment Control Template" });
    const jobId = await createDraftJob(`Project Tracking Assignment ${Date.now()}`);
    const workflow = await instantiate(jobId, templateKey);
    const confirmScope = stepByKey(workflow, "confirm_scope");

    const assigned = await request(app)
      .post(`/api/workflows/steps/${confirmScope.id}/transition`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        status: confirmScope.status,
        assigned_user_id: photoUserId,
        assigned_queue: "production",
        reason: "Manager assigned the live workflow step to Production.",
        notes: "Route the current live job step to Production with a named owner."
      });

    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    const assignedStep = stepByKey(assigned.body, "confirm_scope");
    expect(assignedStep.assigned_user_id).toBe(photoUserId);
    expect(assignedStep.assigned_queue).toBe("production");
    expect(assignedStep.assignment_status).toBe("assigned");

    const dashboard = await request(app)
      .get("/api/workflows/command-center?view=global&limit=100")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(dashboard.status, JSON.stringify(dashboard.body)).toBe(200);
    const row = dashboard.body.job_rows.find((candidate: any) => candidate.workflow_run_id === workflow.workflow_run.id);
    expect(row?.current_step.assigned_user_id).toBe(photoUserId);
    expect(row?.current_step.assigned_queue).toBe("production");

    // G7: the per-job view returns exactly this job's row without the caller
    // pulling (and being capped at) the whole command center.
    const byJob = await request(app)
      .get(`/api/workflows/command-center/jobs/${row.job_id}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(byJob.status, JSON.stringify(byJob.body)).toBe(200);
    expect(byJob.body.job_rows.length).toBe(1);
    expect(byJob.body.job_rows[0].job_id).toBe(row.job_id);
    expect(byJob.body.job_rows[0].workflow_run_id).toBe(workflow.workflow_run.id);

    const byJobMissing = await request(app)
      .get("/api/workflows/command-center/jobs/00000000-0000-4000-8000-000000000000")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(byJobMissing.status).toBe(200);
    expect(byJobMissing.body.job_rows.length).toBe(0);

    const byJobMalformed = await request(app)
      .get("/api/workflows/command-center/jobs/not-a-uuid")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(byJobMalformed.status).toBe(404);

    const templateDetail = await dbPool.query<{ assigned_user_id: string | null }>(
      `
        SELECT assigned_user_id::text
        FROM workflow_template_step
        WHERE template_version_id = $1
          AND step_key = 'confirm_scope'
        LIMIT 1
      `,
      [templateVersionId]
    );
    expect(templateDetail.rows[0]?.assigned_user_id ?? null).toBeNull();
  });

  it("lists workflow assignable users through workflow override authority", async () => {
    const response = await request(app)
      .get("/api/workflows/assignable-users")
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_id: leadershipUserId,
          membership_status: "active"
        }),
        expect.objectContaining({
          user_id: photoUserId,
          membership_status: "active"
        }),
        expect.objectContaining({
          user_id: associateUserId,
          membership_status: "active"
        })
      ])
    );
  });

  it("tracks send-back rework with owner, expectations, and audit history", async () => {
    const templateKey = `project_tracking_sendback_${Date.now()}`;
    await createTemplate(templateKey);
    const jobId = await createDraftJob(`Project Tracking Send Back ${Date.now()}`);
    let workflow = await instantiate(jobId, templateKey);
    const confirmScope = stepByKey(workflow, "confirm_scope");

    await request(app)
      .post(`/api/workflows/steps/${confirmScope.id}/transition`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ status: "IN_PROGRESS", assigned_user_id: leadershipUserId });
    workflow = (
      await request(app)
        .post(`/api/workflows/steps/${confirmScope.id}/transition`)
        .set("Authorization", `Bearer ${leadershipToken}`)
        .send({ status: "COMPLETE", reason: "Scope confirmed quickly." })
    ).body;

    const prepareFiles = stepByKey(workflow, "prepare_files");
    const invalidSendBack = await request(app)
      .post(`/api/workflows/steps/${prepareFiles.id}/send-back`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        target_step_id: confirmScope.id,
        assigned_user_id: leadershipUserId,
        expected_duration_minutes: 45
      });
    expect(invalidSendBack.status).toBe(400);

    const sendBack = await request(app)
      .post(`/api/workflows/steps/${prepareFiles.id}/send-back`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        target_step_id: confirmScope.id,
        reason: "Production found missing account expectations.",
        assigned_user_id: leadershipUserId,
        expected_duration_minutes: 45,
        expectations: "Confirm missing package requirements before production restarts."
      });

    expect(sendBack.status).toBe(200);
    const reopened = stepByKey(sendBack.body, "confirm_scope");
    expect(reopened.status).toBe("IN_PROGRESS");
    expect(reopened.rework_count).toBe(1);
    expect(reopened.assigned_user_id).toBe(leadershipUserId);
    expect(reopened.exception_reason).toContain("missing account expectations");

    const auditRows = await dbPool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM workflow_step_audit_log
        WHERE workflow_step_id = $1
          AND transition_type = 'sent_back'::workflow_step_transition_type
      `,
      [confirmScope.id]
    );
    expect(Number(auditRows.rows[0]?.count ?? "0")).toBe(1);
  });

  it("persists Schools-to-Production handoffs, queue-first claims, missing info, completion, and return history", async () => {
    const templateKey = `project_tracking_handoff_${Date.now()}`;
    await createTemplate(templateKey);
    const jobId = await createDraftJob(`Project Tracking Handoff ${Date.now()}`);
    let workflow = await instantiate(jobId, templateKey);
    const confirmScope = stepByKey(workflow, "confirm_scope");

    const sent = await request(app)
      .post(`/api/workflows/instances/${workflow.workflow_run.id}/send-to-production`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        step_id: confirmScope.id,
        notes: "Files, data, job type, and due date are ready for Production.",
        readiness: {
          files_confirmed: true,
          data_confirmed: true,
          job_type_confirmed: true,
          due_date_confirmed: true
        }
      });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    workflow = sent.body;
    const sentHandoff = workflow.handoffs.find((handoff: any) => handoff.to_department === "production");
    expect(sentHandoff?.status).toBe("sent_to_production");
    expect(stepByKey(workflow, "prepare_files").assignment_status).toBe("needs_assignment");

    const queue = await request(app)
      .get("/api/workflows/production-queue")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(queue.status, JSON.stringify(queue.body)).toBe(200);
    const sentQueueItem = queue.body.items.find((item: any) => item.handoff_id === sentHandoff.id);
    expect(sentQueueItem).toEqual(
      expect.objectContaining({
        handoff_id: sentHandoff.id,
        organization_id: organizationId,
        organization_name: expect.any(String)
      })
    );

    const accepted = await request(app)
      .post(`/api/workflows/handoffs/${sentHandoff.id}/accept`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.handoffs.find((handoff: any) => handoff.id === sentHandoff.id)?.status).toBe("accepted_by_production");

    const claimed = await request(app)
      .post(`/api/workflows/handoffs/${sentHandoff.id}/claim`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ assigned_queue: "production", notes: "Claimed by Production lead." });
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(200);
    expect(stepByKey(claimed.body, "prepare_files").assignment_status).toBe("claimed");
    expect(stepByKey(claimed.body, "prepare_files").assigned_user_id).toBe(leadershipUserId);

    const waiting = await request(app)
      .post(`/api/workflows/handoffs/${sentHandoff.id}/mark-waiting`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ waiting_on_party: "school", waiting_detail: "Need corrected roster before edits continue." });
    expect(waiting.status, JSON.stringify(waiting.body)).toBe(200);
    expect(waiting.body.handoffs.find((handoff: any) => handoff.id === sentHandoff.id)?.status).toBe("waiting_on_info");
    expect(stepByKey(waiting.body, "prepare_files").waiting_on_party).toBe("school");

    const completed = await request(app)
      .post(`/api/workflows/handoffs/${sentHandoff.id}/production-complete`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    expect(completed.body.handoffs.find((handoff: any) => handoff.id === sentHandoff.id)?.status).toBe("production_complete");

    const queueAfterProductionComplete = await request(app)
      .get("/api/workflows/production-queue")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(queueAfterProductionComplete.status, JSON.stringify(queueAfterProductionComplete.body)).toBe(200);
    const workflowQueueItems = queueAfterProductionComplete.body.items.filter(
      (item: any) => item.workflow_run_id === workflow.workflow_run.id
    );
    expect(workflowQueueItems).toHaveLength(1);
    expect(workflowQueueItems[0].source).toBe("handoff");
    expect(workflowQueueItems[0].handoff_id).toBe(sentHandoff.id);

    const returned = await request(app)
      .post(`/api/workflows/handoffs/${sentHandoff.id}/return-to-schools`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ return_reason: "Production complete and ready for Schools follow-up.", issue_flag: false });
    expect(returned.status, JSON.stringify(returned.body)).toBe(200);
    expect(returned.body.handoffs.find((handoff: any) => handoff.id === sentHandoff.id)?.status).toBe("returned_to_schools");

    const auditRows = await dbPool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM workflow_step_audit_log
        WHERE tenant_id = $1
          AND workflow_run_id = $2
          AND (
            new_values ? 'handoff_id'
            OR previous_values ? 'handoff_status'
          )
      `,
      [tenantId, workflow.workflow_run.id]
    );
    expect(Number(auditRows.rows[0]?.count ?? "0")).toBeGreaterThanOrEqual(5);
  });

  it("blends Production queue-assigned live workflow current steps into the Production Queue without handoff duplicates", async () => {
    const templateKey = `project_tracking_handoff_queue_${Date.now()}`;
    await createTemplate(templateKey);
    const jobId = await createDraftJob(`Project Tracking Handoff Queue ${Date.now()}`);
    const workflow = await instantiate(jobId, templateKey);
    const prepareFiles = stepByKey(workflow, "prepare_files");

    const assignedToQueue = await request(app)
      .post(`/api/workflows/steps/${prepareFiles.id}/transition`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        status: "IN_PROGRESS",
        assigned_queue: "production",
        reason: "Route current live workflow step to Production Queue.",
        notes: "Queue-owned work should appear in Production Queue without being personal My Work."
      });
    expect(assignedToQueue.status, JSON.stringify(assignedToQueue.body)).toBe(200);

    const queue = await request(app)
      .get("/api/workflows/production-queue")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(queue.status, JSON.stringify(queue.body)).toBe(200);
    const queueOnlyItem = queue.body.items.find((item: any) => item.job_id === jobId);
    expect(queueOnlyItem).toEqual(
      expect.objectContaining({
        source: "live_workflow_assignment",
        handoff_id: null,
        workflow_run_id: workflow.workflow_run.id,
        job_id: jobId,
        step_id: prepareFiles.id,
        production_step: "Prepare files",
        step_status: "IN_PROGRESS",
        assigned_queue: "production",
        notes: "Queue-owned work should appear in Production Queue without being personal My Work.",
        lane_reason: "Here by Production queue assignment",
        next_action: expect.stringContaining("Prepare files"),
        clear_condition: expect.stringContaining("current step")
      })
    );

    const handoffTemplateKey = `project_tracking_handoff_queue_duplicate_${Date.now()}`;
    await createTemplate(handoffTemplateKey);
    const handoffJobId = await createDraftJob(`Project Tracking Handoff Queue Duplicate ${Date.now()}`);
    const handoffWorkflow = await instantiate(handoffJobId, handoffTemplateKey);
    const confirmScope = stepByKey(handoffWorkflow, "confirm_scope");
    const sent = await request(app)
      .post(`/api/workflows/instances/${handoffWorkflow.workflow_run.id}/send-to-production`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        step_id: confirmScope.id,
        notes: "Ready for Production duplicate-prevention coverage.",
        readiness: {
          files_confirmed: true,
          data_confirmed: true,
          job_type_confirmed: true,
          due_date_confirmed: true
        }
      });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const sentHandoff = sent.body.handoffs.find((handoff: any) => handoff.to_department === "production");

    const duplicateQueue = await request(app)
      .get("/api/workflows/production-queue")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(duplicateQueue.status, JSON.stringify(duplicateQueue.body)).toBe(200);
    const duplicatedWorkflowItems = duplicateQueue.body.items.filter((item: any) => item.workflow_run_id === handoffWorkflow.workflow_run.id);
    expect(duplicatedWorkflowItems).toHaveLength(1);
    expect(duplicatedWorkflowItems[0]).toEqual(expect.objectContaining({ source: "handoff", handoff_id: sentHandoff.id }));

    const duplicatePrepareFiles = stepByKey(sent.body, "prepare_files");
    const productionStepNote = "Queue move note should stay visible after the live step changes.";
    const updatedProductionStep = await request(app)
      .post(`/api/workflows/steps/${duplicatePrepareFiles.id}/transition`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        status: "IN_PROGRESS",
        assigned_queue: "production",
        reason: "Move the handoff-backed Production step from the queue.",
        notes: productionStepNote
      });
    expect(updatedProductionStep.status, JSON.stringify(updatedProductionStep.body)).toBe(200);

    const noteQueue = await request(app)
      .get("/api/workflows/production-queue")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(noteQueue.status, JSON.stringify(noteQueue.body)).toBe(200);
    const noteQueueItem = noteQueue.body.items.find((item: any) => item.workflow_run_id === handoffWorkflow.workflow_run.id);
    expect(noteQueueItem).toEqual(expect.objectContaining({ source: "handoff", notes: productionStepNote, missing_info: productionStepNote }));
  });

  it("rejects invalid durable handoff transitions without adding duplicate audit history", async () => {
    const templateKey = `project_tracking_handoff_state_${Date.now()}`;
    await createTemplate(templateKey);
    const jobId = await createDraftJob(`Project Tracking Handoff State ${Date.now()}`);
    const workflow = await instantiate(jobId, templateKey);
    const confirmScope = stepByKey(workflow, "confirm_scope");

    const sent = await request(app)
      .post(`/api/workflows/instances/${workflow.workflow_run.id}/send-to-production`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        step_id: confirmScope.id,
        notes: "Ready for Production state-machine coverage.",
        readiness: {
          files_confirmed: true,
          data_confirmed: true,
          job_type_confirmed: true,
          due_date_confirmed: true
        }
      });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const sentHandoff = sent.body.handoffs.find((handoff: any) => handoff.to_department === "production");
    expect(sentHandoff?.status).toBe("sent_to_production");
    const auditCountAfterSend = await countHandoffAuditRows(workflow.workflow_run.id, sentHandoff.id);

    const duplicateSend = await request(app)
      .post(`/api/workflows/instances/${workflow.workflow_run.id}/send-to-production`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        step_id: confirmScope.id,
        notes: "Duplicate send should be rejected.",
        readiness: {
          files_confirmed: true,
          data_confirmed: true,
          job_type_confirmed: true,
          due_date_confirmed: true
        }
      });
    expect(duplicateSend.status).toBe(409);
    expect(await countHandoffAuditRows(workflow.workflow_run.id, sentHandoff.id)).toBe(auditCountAfterSend);

    const earlyClaim = await request(app)
      .post(`/api/workflows/handoffs/${sentHandoff.id}/claim`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ assigned_queue: "production" });
    expect(earlyClaim.status).toBe(409);
    expect(await countHandoffAuditRows(workflow.workflow_run.id, sentHandoff.id)).toBe(auditCountAfterSend);

    const earlyComplete = await request(app)
      .post(`/api/workflows/handoffs/${sentHandoff.id}/production-complete`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});
    expect(earlyComplete.status).toBe(409);
    expect(await countHandoffAuditRows(workflow.workflow_run.id, sentHandoff.id)).toBe(auditCountAfterSend);

    const earlyWaiting = await request(app)
      .post(`/api/workflows/handoffs/${sentHandoff.id}/mark-waiting`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ waiting_on_party: "school", waiting_detail: "Too early to mark waiting." });
    expect(earlyWaiting.status).toBe(409);
    expect(await countHandoffAuditRows(workflow.workflow_run.id, sentHandoff.id)).toBe(auditCountAfterSend);

    const earlyReturn = await request(app)
      .post(`/api/workflows/handoffs/${sentHandoff.id}/return-to-schools`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ return_reason: "Trying to return before production is complete.", issue_flag: false });
    expect(earlyReturn.status).toBe(409);
    expect(await countHandoffAuditRows(workflow.workflow_run.id, sentHandoff.id)).toBe(auditCountAfterSend);

    const accepted = await request(app)
      .post(`/api/workflows/handoffs/${sentHandoff.id}/accept`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const auditCountAfterAccept = await countHandoffAuditRows(workflow.workflow_run.id, sentHandoff.id);
    expect(auditCountAfterAccept).toBe(auditCountAfterSend + 1);

    const duplicateAccept = await request(app)
      .post(`/api/workflows/handoffs/${sentHandoff.id}/accept`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});
    expect(duplicateAccept.status).toBe(409);
    expect(await countHandoffAuditRows(workflow.workflow_run.id, sentHandoff.id)).toBe(auditCountAfterAccept);

    const claimed = await request(app)
      .post(`/api/workflows/handoffs/${sentHandoff.id}/claim`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ assigned_queue: "production", notes: "Claim once." });
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(200);
    const auditCountAfterClaim = await countHandoffAuditRows(workflow.workflow_run.id, sentHandoff.id);
    expect(auditCountAfterClaim).toBe(auditCountAfterAccept + 1);

    const duplicateClaim = await request(app)
      .post(`/api/workflows/handoffs/${sentHandoff.id}/claim`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ assigned_queue: "production", notes: "Claim twice." });
    expect(duplicateClaim.status).toBe(409);
    expect(await countHandoffAuditRows(workflow.workflow_run.id, sentHandoff.id)).toBe(auditCountAfterClaim);

    const waiting = await request(app)
      .post(`/api/workflows/handoffs/${sentHandoff.id}/mark-waiting`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ waiting_on_party: "school", waiting_detail: "Need missing roster update." });
    expect(waiting.status, JSON.stringify(waiting.body)).toBe(200);
    const auditCountAfterWaiting = await countHandoffAuditRows(workflow.workflow_run.id, sentHandoff.id);
    expect(auditCountAfterWaiting).toBe(auditCountAfterClaim + 1);

    const duplicateWaiting = await request(app)
      .post(`/api/workflows/handoffs/${sentHandoff.id}/mark-waiting`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ waiting_on_party: "school", waiting_detail: "Need missing roster update again." });
    expect(duplicateWaiting.status).toBe(409);
    expect(await countHandoffAuditRows(workflow.workflow_run.id, sentHandoff.id)).toBe(auditCountAfterWaiting);

    const completed = await request(app)
      .post(`/api/workflows/handoffs/${sentHandoff.id}/production-complete`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    const auditCountAfterComplete = await countHandoffAuditRows(workflow.workflow_run.id, sentHandoff.id);
    expect(auditCountAfterComplete).toBeGreaterThan(auditCountAfterWaiting);

    const duplicateComplete = await request(app)
      .post(`/api/workflows/handoffs/${sentHandoff.id}/production-complete`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});
    expect(duplicateComplete.status).toBe(409);
    expect(await countHandoffAuditRows(workflow.workflow_run.id, sentHandoff.id)).toBe(auditCountAfterComplete);

    const returned = await request(app)
      .post(`/api/workflows/handoffs/${sentHandoff.id}/return-to-schools`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ return_reason: "Production complete and ready for Schools.", issue_flag: false });
    expect(returned.status, JSON.stringify(returned.body)).toBe(200);
    const auditCountAfterReturn = await countHandoffAuditRows(workflow.workflow_run.id, sentHandoff.id);
    expect(auditCountAfterReturn).toBe(auditCountAfterComplete + 1);

    const duplicateReturn = await request(app)
      .post(`/api/workflows/handoffs/${sentHandoff.id}/return-to-schools`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ return_reason: "Returning twice should not be allowed.", issue_flag: false });
    expect(duplicateReturn.status).toBe(409);
    expect(await countHandoffAuditRows(workflow.workflow_run.id, sentHandoff.id)).toBe(auditCountAfterReturn);

    const acceptReturned = await request(app)
      .post(`/api/workflows/handoffs/${sentHandoff.id}/accept`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});
    expect(acceptReturned.status).toBe(409);
    expect(await countHandoffAuditRows(workflow.workflow_run.id, sentHandoff.id)).toBe(auditCountAfterReturn);

    const queueAfterReturn = await request(app)
      .get("/api/workflows/production-queue")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(queueAfterReturn.status, JSON.stringify(queueAfterReturn.body)).toBe(200);
    expect(queueAfterReturn.body.items.some((item: any) => item.handoff_id === sentHandoff.id)).toBe(false);

    const activeHandoffRows = await dbPool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM workflow_handoff
        WHERE tenant_id = $1
          AND workflow_run_id = $2
          AND from_step_id = $3
          AND to_department = 'production'::work_department_type
          AND status IN (
            'pending'::workflow_handoff_status_type,
            'sent_to_production'::workflow_handoff_status_type,
            'accepted_by_production'::workflow_handoff_status_type,
            'waiting_on_info'::workflow_handoff_status_type,
            'production_complete'::workflow_handoff_status_type
          )
      `,
      [tenantId, workflow.workflow_run.id, confirmScope.id]
    );
    expect(Number(activeHandoffRows.rows[0]?.count ?? "0")).toBe(0);
  });

  it("enforces backend step ownership and conflict-aware overwrites", async () => {
    const templateKey = `project_tracking_permissions_${Date.now()}`;
    await createTemplate(templateKey, { confirmScopeAssignedUserId: photoUserId });
    const jobId = await createDraftJob(`Project Tracking Permissions ${Date.now()}`);
    let workflow = await instantiate(jobId, templateKey);
    const confirmScope = stepByKey(workflow, "confirm_scope");

    const unrelatedStaff = await request(app)
      .post(`/api/workflows/steps/${confirmScope.id}/transition`)
      .set("Authorization", `Bearer ${associateToken}`)
      .send({ status: "IN_PROGRESS" });
    expect(unrelatedStaff.status).toBe(403);

    const started = await request(app)
      .post(`/api/workflows/steps/${confirmScope.id}/transition`)
      .set("Authorization", `Bearer ${photoToken}`)
      .send({ status: "IN_PROGRESS" });
    expect(started.status).toBe(200);
    workflow = started.body;
    expect(stepByKey(workflow, "confirm_scope").status).toBe("IN_PROGRESS");

    const conflict = await request(app)
      .post(`/api/workflows/steps/${confirmScope.id}/transition`)
      .set("Authorization", `Bearer ${photoToken}`)
      .send({
        status: "IN_PROGRESS",
        notes: "Trying to overwrite with stale state.",
        last_seen_updated_at: confirmScope.updated_at
      });
    expect(conflict.status).toBe(409);

    const explainedOverwrite = await request(app)
      .post(`/api/workflows/steps/${confirmScope.id}/transition`)
      .set("Authorization", `Bearer ${photoToken}`)
      .send({
        status: "IN_PROGRESS",
        notes: "Overwrite accepted because the stale update was reviewed.",
        reason: "Reviewed the newer step state before preserving this note.",
        last_seen_updated_at: confirmScope.updated_at
      });
    expect(explainedOverwrite.status).toBe(200);

    const auditRows = await dbPool.query<{ conflict_detected: boolean; reason: string | null }>(
      `
        SELECT conflict_detected, reason
        FROM workflow_step_audit_log
        WHERE workflow_step_id = $1
          AND transition_type = 'updated'::workflow_step_transition_type
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [confirmScope.id]
    );
    expect(auditRows.rows[0]?.conflict_detected).toBe(true);
    expect(auditRows.rows[0]?.reason).toContain("Reviewed the newer step state");
  });

  it("keeps tasks optional and orders the command center by overdue, urgent, blocked, due soon, then assigned", async () => {
    await dbPool.query(
      `
        UPDATE workflow_step
        SET status = 'COMPLETE'::workflow_step_status_type,
            completed_at = COALESCE(completed_at, now()),
            updated_at = now()
        WHERE job_id IN (
          SELECT id
          FROM jobs
          WHERE tenant_id = $1
            AND title LIKE 'Project Tracking Command Center %'
        )
      `,
      [tenantId]
    );

    const templateKey = `project_tracking_command_center_${Date.now()}`;
    await createTemplate(templateKey);
    const jobId = await createDraftJob(`Project Tracking Command Center ${Date.now()}`);
    const workflow = await instantiate(jobId, templateKey);
    const runtimeStepRows = await dbPool.query<{ id: string; step_key: string }>(
      `
        SELECT id::text, step_key
        FROM workflow_step
        WHERE workflow_run_id = $1
          AND step_key = ANY($2::text[])
      `,
      [workflow.workflow_run.id, ["confirm_scope", "prepare_files", "release_package"]]
    );
    const runtimeStepByKey = new Map(runtimeStepRows.rows.map((row) => [row.step_key, row]));
    const confirmScope = runtimeStepByKey.get("confirm_scope");
    const prepareFiles = runtimeStepByKey.get("prepare_files");
    const releasePackage = runtimeStepByKey.get("release_package");
    expect(confirmScope).toBeTruthy();
    expect(prepareFiles).toBeTruthy();
    expect(releasePackage).toBeTruthy();

    await dbPool.query(
      `
        INSERT INTO work_task (
          tenant_id,
          task_number,
          title,
          department_type,
          related_job_id,
          linked_step_id,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES ($1,$2,'Optional task attached to workflow step','schools'::work_department_type,$3,$4,$5,$5)
      `,
      [tenantId, `PT-${Date.now()}`, jobId, confirmScope!.id, leadershipUserId]
    );

    await dbPool.query(
      `
        UPDATE workflow_step
        SET status = 'IN_PROGRESS'::workflow_step_status_type,
            started_at = now() - interval '2 hours',
            expected_duration_minutes = 30,
            last_transition_at = now() - interval '2 hours',
            updated_at = now()
        WHERE id = $1
      `,
      [confirmScope!.id]
    );
    await dbPool.query(
      `
        UPDATE workflow_step
        SET status = 'IN_PROGRESS'::workflow_step_status_type,
            started_at = now() - interval '40 minutes',
            expected_duration_minutes = 60,
            last_transition_at = now() - interval '1 hour',
            updated_at = now()
        WHERE id = $1
      `,
      [prepareFiles!.id]
    );
    await dbPool.query(
      `
        UPDATE workflow_step
        SET status = 'BLOCKED'::workflow_step_status_type,
            started_at = now() - interval '15 minutes',
            last_transition_at = now(),
            updated_at = now()
        WHERE id = $1
      `,
      [releasePackage!.id]
    );

    const commandCenter = await request(app)
      .get("/api/workflows/command-center?view=global&limit=200")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(commandCenter.status).toBe(200);

    const workflowStepIds = new Set([confirmScope!.id, prepareFiles!.id, releasePackage!.id]);
    const orderedSteps = commandCenter.body.steps.filter((step: any) => workflowStepIds.has(step.id));
    expect(orderedSteps.map((step: any) => step.id)).toEqual([confirmScope!.id, prepareFiles!.id, releasePackage!.id]);
    expect(commandCenter.body.summary.open_steps).toBeGreaterThanOrEqual(3);
    expect(commandCenter.body.summary.overdue_steps).toBeGreaterThanOrEqual(1);
    expect(commandCenter.body.summary.due_soon_steps).toBeGreaterThanOrEqual(1);
    expect(commandCenter.body.summary.blocked_steps).toBeGreaterThanOrEqual(1);
    expect(orderedSteps.some((step: any) => step.id === confirmScope!.id && step.timing.alert_level === "overdue")).toBe(true);

    const taskRows = await dbPool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM work_task
        WHERE linked_step_id = $1
      `,
      [confirmScope!.id]
    );
    expect(Number(taskRows.rows[0]?.count ?? "0")).toBe(1);
  });

  it("classifies department queues by the current active workflow step department", async () => {
    const templateKey = `project_tracking_command_center_department_${Date.now()}`;
    await createTemplate(templateKey);
    const jobId = await createDraftJob(`Project Tracking Command Center Department ${Date.now()}`);
    let workflow = await instantiate(jobId, templateKey);
    const confirmScope = stepByKey(workflow, "confirm_scope");

    const initialSchools = await request(app)
      .get("/api/workflows/command-center?view=department&department=schools&limit=200")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(initialSchools.status, JSON.stringify(initialSchools.body)).toBe(200);
    expect(initialSchools.body.job_rows.some((row: any) => row.job_id === jobId)).toBe(true);

    const initialProduction = await request(app)
      .get("/api/workflows/command-center?view=department&department=production&limit=200")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(initialProduction.status, JSON.stringify(initialProduction.body)).toBe(200);
    expect(initialProduction.body.job_rows.some((row: any) => row.job_id === jobId)).toBe(false);

    await dbPool.query(
      `
        UPDATE workflow_step
        SET assigned_queue = 'production'::work_department_type,
            assignment_status = 'queued'::workflow_assignment_status_type,
            updated_at = now()
        WHERE id = $1
      `,
      [confirmScope.id]
    );
    const productionByQueue = await request(app)
      .get("/api/workflows/command-center?view=department&department=production&limit=200")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(productionByQueue.status, JSON.stringify(productionByQueue.body)).toBe(200);
    const productionQueueRow = productionByQueue.body.job_rows.find((row: any) => row.job_id === jobId);
    expect(productionQueueRow?.current_step?.step_key).toBe("confirm_scope");
    expect(productionQueueRow?.current_step?.department).toBe("schools");
    expect(productionQueueRow?.current_step?.assigned_queue).toBe("production");
    expect(productionQueueRow?.queue_intelligence).toMatchObject({
      owner_lane: "Production Queue",
      operational_status: "missing_next_action"
    });
    expect(productionQueueRow?.queue_intelligence?.reason).toContain("Missing data");
    expect(productionQueueRow?.queue_intelligence?.next_action).toContain("Fill in the missing job or workflow data");

    const completed = await request(app)
      .post(`/api/workflows/steps/${confirmScope.id}/transition`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        status: "COMPLETE",
        reason: "Schools setup finished; Production owns the next active step."
      });
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    workflow = completed.body;
    expect(stepByKey(workflow, "prepare_files").department).toBe("production");
    expect(stepByKey(workflow, "prepare_files").status).toBe("NOT_STARTED");

    const schoolsAfterMove = await request(app)
      .get("/api/workflows/command-center?view=department&department=schools&limit=200")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(schoolsAfterMove.status, JSON.stringify(schoolsAfterMove.body)).toBe(200);
    expect(schoolsAfterMove.body.job_rows.some((row: any) => row.job_id === jobId)).toBe(false);

    const productionAfterMove = await request(app)
      .get("/api/workflows/command-center?view=department&department=production&limit=200")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(productionAfterMove.status, JSON.stringify(productionAfterMove.body)).toBe(200);
    const productionRow = productionAfterMove.body.job_rows.find((row: any) => row.job_id === jobId);
    expect(productionRow?.current_step?.step_key).toBe("prepare_files");
    expect(productionRow?.current_step?.department).toBe("production");
  });

  it("returns explicit job rows and true summary totals before applying the display limit", async () => {
    await dbPool.query(
      `
        UPDATE workflow_step
        SET status = 'COMPLETE'::workflow_step_status_type,
            completed_at = COALESCE(completed_at, now()),
            updated_at = now()
        WHERE job_id IN (
          SELECT id
          FROM jobs
          WHERE tenant_id = $1
            AND title LIKE 'Project Tracking Command Center %'
        )
      `,
      [tenantId]
    );

    const templateKey = `project_tracking_command_center_rows_${Date.now()}`;
    await createTemplate(templateKey);
    const noWorkflowJobId = await createDraftJob(`Project Tracking Command Center No Workflow ${Date.now()}`);
    const blockedJobId = await createDraftJob(`Project Tracking Command Center Blocked ${Date.now()}`);
    const lateJobId = await createDraftJob(`Project Tracking Command Center Late ${Date.now()}`);
    const dueSoonJobId = await createDraftJob(`Project Tracking Command Center Due Soon ${Date.now()}`);
    const reworkJobId = await createDraftJob(`Project Tracking Command Center Rework ${Date.now()}`);
    const completeJobId = await createDraftJob(`Project Tracking Command Center Complete ${Date.now()}`);

    const blockedWorkflow = await instantiate(blockedJobId, templateKey);
    const lateWorkflow = await instantiate(lateJobId, templateKey);
    const dueSoonWorkflow = await instantiate(dueSoonJobId, templateKey);
    const reworkWorkflow = await instantiate(reworkJobId, templateKey);
    const completeWorkflow = await instantiate(completeJobId, templateKey);

    const rows = await dbPool.query<{ id: string; job_id: string; step_key: string }>(
      `
        SELECT id::text, job_id::text, step_key
        FROM workflow_step
        WHERE workflow_run_id = ANY($1::uuid[])
      `,
      [[blockedWorkflow.workflow_run.id, lateWorkflow.workflow_run.id, dueSoonWorkflow.workflow_run.id, reworkWorkflow.workflow_run.id, completeWorkflow.workflow_run.id]]
    );
    const stepId = (jobId: string, stepKey = "confirm_scope") => {
      const row = rows.rows.find((candidate) => candidate.job_id === jobId && candidate.step_key === stepKey);
      expect(row).toBeTruthy();
      return row!.id;
    };

    await dbPool.query(
      `
        UPDATE workflow_step
        SET status = 'BLOCKED'::workflow_step_status_type,
            started_at = now() - interval '15 minutes',
            exception_reason = 'Waiting on school roster',
            last_transition_at = now() - interval '15 minutes',
            updated_at = now()
        WHERE id = $1
      `,
      [stepId(blockedJobId)]
    );
    await dbPool.query(
      `
        UPDATE workflow_step
        SET status = 'IN_PROGRESS'::workflow_step_status_type,
            started_at = now() - interval '90 minutes',
            expected_duration_minutes = 60,
            last_transition_at = now() - interval '90 minutes',
            updated_at = now()
        WHERE id = $1
      `,
      [stepId(lateJobId)]
    );
    await dbPool.query(
      `
        UPDATE workflow_step
        SET status = 'IN_PROGRESS'::workflow_step_status_type,
            started_at = now() - interval '40 minutes',
            expected_duration_minutes = 60,
            last_transition_at = now() - interval '40 minutes',
            updated_at = now()
        WHERE id = $1
      `,
      [stepId(dueSoonJobId)]
    );
    await dbPool.query(
      `
        UPDATE workflow_step
        SET status = 'IN_PROGRESS'::workflow_step_status_type,
            started_at = now() - interval '10 minutes',
            expected_duration_minutes = 1440,
            rework_count = 1,
            last_transition_at = now() - interval '10 minutes',
            updated_at = now()
        WHERE id = $1
      `,
      [stepId(reworkJobId)]
    );
    await dbPool.query(
      `
        UPDATE workflow_step
        SET status = 'COMPLETE'::workflow_step_status_type,
            completed_at = now(),
            updated_at = now()
        WHERE workflow_run_id = $1
      `,
      [completeWorkflow.workflow_run.id]
    );
    await dbPool.query(
      `
        UPDATE workflow_run
        SET status = 'completed'::shared_workflow_run_status_type,
            completed_at = now(),
            updated_at = now()
        WHERE id = $1
      `,
      [completeWorkflow.workflow_run.id]
    );
    await dbPool.query(
      `
        UPDATE jobs
        SET scheduled_start_at = NULL,
            updated_at = now()
        WHERE id = $1
      `,
      [noWorkflowJobId]
    );

    const limited = await request(app)
      .get("/api/workflows/command-center?view=global&limit=2")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(limited.status).toBe(200);
    expect(limited.body.job_rows).toHaveLength(2);
    expect(limited.body.summary.source).toBe("true_totals");
    expect(limited.body.summary.total_blocked).toBeGreaterThanOrEqual(1);
    expect(limited.body.summary.total_running_late).toBeGreaterThanOrEqual(1);
    expect(limited.body.summary.total_due_soon).toBeGreaterThanOrEqual(1);
    expect(limited.body.summary.total_returned_for_fixes).toBeGreaterThanOrEqual(1);
    expect(limited.body.summary.total_complete).toBeGreaterThanOrEqual(1);
    expect(limited.body.summary.total_no_workflow_linked).toBeGreaterThanOrEqual(1);

    const full = await request(app)
      .get("/api/workflows/command-center?view=global&limit=200")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(full.status).toBe(200);
    const rowByJobId = new Map(full.body.job_rows.map((row: any) => [row.job_id, row]));
    expect(rowByJobId.get(blockedJobId).health).toBe("blocked");
    expect(rowByJobId.get(blockedJobId).current_step.name).toBe("Confirm scope");
    expect(rowByJobId.get(blockedJobId).waiting_on_party).toBe("unknown");
    expect(rowByJobId.get(blockedJobId).health_reasons).toContain("Current step is blocked");
    expect(rowByJobId.get(blockedJobId).queue_intelligence).toMatchObject({
      reason: "Blocked: Waiting on school roster",
      trigger: "Current workflow step is blocked.",
      operational_status: "blocked",
      clear_condition: "Clear when the blocker is removed or the step leaves Blocked."
    });
    expect(rowByJobId.get(lateJobId).health).toBe("running_late");
    expect(rowByJobId.get(lateJobId).queue_intelligence.operational_status).toBe("overdue");
    expect(rowByJobId.get(lateJobId).queue_intelligence.next_action).toContain("Open the workflow");
    expect(rowByJobId.get(dueSoonJobId).health).toBe("due_soon");
    expect(rowByJobId.get(dueSoonJobId).queue_intelligence.operational_status).toBe("at_risk");
    expect(rowByJobId.get(reworkJobId).health).toBe("at_risk");
    if (rowByJobId.has(completeJobId)) {
      expect(rowByJobId.get(completeJobId).health).toBe("complete");
    }
    if (rowByJobId.has(noWorkflowJobId)) {
      expect(rowByJobId.get(noWorkflowJobId).health).toBe("no_workflow");
      expect(rowByJobId.get(noWorkflowJobId).missing_info_flags).toEqual(expect.arrayContaining(["missing_job_date", "missing_workflow"]));
    }
  });

  it("queues SLA alert events idempotently without making tasks control workflow state", async () => {
    const templateKey = `project_tracking_sla_alerts_${Date.now()}`;
    await createTemplate(templateKey);
    const jobId = await createDraftJob(`Project Tracking SLA Alerts ${Date.now()}`);
    const workflow = await instantiate(jobId, templateKey);
    const confirmScope = stepByKey(workflow, "confirm_scope");
    const prepareFiles = stepByKey(workflow, "prepare_files");

    await dbPool.query(
      `
        UPDATE workflow_step
        SET status = 'IN_PROGRESS'::workflow_step_status_type,
            started_at = now() - interval '90 minutes',
            expected_duration_minutes = 60,
            last_transition_at = now() - interval '90 minutes',
            updated_at = now()
        WHERE id = $1
      `,
      [confirmScope.id]
    );
    await dbPool.query(
      `
        UPDATE workflow_step
        SET status = 'IN_PROGRESS'::workflow_step_status_type,
            started_at = now() - interval '40 minutes',
            expected_duration_minutes = 60,
            last_transition_at = now() - interval '40 minutes',
            updated_at = now()
        WHERE id = $1
      `,
      [prepareFiles.id]
    );

    const { scanProjectTrackingSlaAlerts } = await import("../src/services/projectTracking/slaMonitor.js");
    await scanProjectTrackingSlaAlerts(dbPool as any, { tenantId, limit: 500 });
    await scanProjectTrackingSlaAlerts(dbPool as any, { tenantId, limit: 500 });

    const eventRows = await dbPool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM app_event
        WHERE tenant_id = $1
          AND event_type = 'workflow.sla_alert_queued'
          AND dedupe_key = ANY($2::text[])
      `,
      [
        tenantId,
        [`workflow:sla_alert:${confirmScope.id}:overdue`, `workflow:sla_alert:${prepareFiles.id}:early_warning`]
      ]
    );
    expect(Number(eventRows.rows[0]?.count ?? "0")).toBe(2);

    const reloaded = await request(app)
      .get(`/api/workflows/instances/${workflow.workflow_run.id}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(stepByKey(reloaded.body, "prepare_files").status).toBe("IN_PROGRESS");
  });

  it("scans SLA alerts across tenants without relying on tenant soft-delete columns", async () => {
    const { scanProjectTrackingSlaAlerts } = await import("../src/services/projectTracking/slaMonitor.js");
    const queries: string[] = [];
    const fakeClient = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes("FROM tenant")) {
          return { rows: [{ id: tenantId }] };
        }
        if (sql.includes("FROM workflow_step")) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query during SLA sweep test: ${sql}`);
      }
    };

    const result = await scanProjectTrackingSlaAlerts(fakeClient as any, { limit: 25 });

    expect(result.tenant_count).toBe(1);
    expect(result.scanned_step_count).toBe(0);
    expect(queries[0]).toContain("FROM tenant");
    expect(queries[0]).not.toContain("deleted_at");
  });

  it("gates project tracking demo seed to explicit non-production execution", async () => {
    const { assertProjectTrackingDemoSeedAllowed } = await import("../scripts/seed-project-tracking-demo.js");

    expect(() => assertProjectTrackingDemoSeedAllowed(["node", "seed"], { NODE_ENV: "development" })).toThrow("allow-demo-data");
    expect(() =>
      assertProjectTrackingDemoSeedAllowed(["node", "seed", "--allow-demo-data"], { NODE_ENV: "production" })
    ).toThrow("disabled in production");
    expect(() =>
      assertProjectTrackingDemoSeedAllowed(["node", "seed", "--allow-demo-data"], { NODE_ENV: "development" })
    ).not.toThrow();
  });
});
