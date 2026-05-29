import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

let app: Express;
let dbPool: Pool;
let leadershipToken = "";
let schoolsToken = "";
let leadershipUserId = "";
let tenantId = "";

let organizationId = "";
let locationId = "";
let contactId = "";

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

async function createDraft(token: string, payload: Record<string, unknown>) {
  return request(app).post("/api/jobs/drafts").set("Authorization", `Bearer ${token}`).send(payload);
}

async function getJob(token: string, jobId: string) {
  return request(app).get(`/api/jobs/${jobId}`).set("Authorization", `Bearer ${token}`);
}

async function getTask(token: string, taskId: string) {
  return request(app).get(`/api/tasks/${taskId}`).set("Authorization", `Bearer ${token}`);
}

async function updateTask(token: string, taskId: string, payload: Record<string, unknown>) {
  return request(app).patch(`/api/tasks/${taskId}`).set("Authorization", `Bearer ${token}`).send(payload);
}

async function ensureSharedWorkflowSeedPrerequisites(targetTenantId: string) {
  // Migration 139 seeds these for tenants that already exist; this keeps the suite deterministic in long-lived test DBs.
  await dbPool.query(
    `
      INSERT INTO workflow_template (
        tenant_id,
        template_key,
        name,
        description,
        workflow_family
      )
      VALUES
        (
          $1::uuid,
          'schools_phase_one_core',
          'Schools Phase-One Workflow',
          'Shared schools workflow from scheduling confirmation through graphics handoff.',
          'schools'::shared_workflow_family_type
        ),
        (
          $1::uuid,
          'graphics_handoff_phase_one_core',
          'Graphics Handoff Phase-One Workflow',
          'Shared graphics handoff workflow for internal production, QA, and release readiness.',
          'graphics_handoff'::shared_workflow_family_type
        )
      ON CONFLICT (tenant_id, template_key)
      DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        workflow_family = EXCLUDED.workflow_family,
        updated_at = now()
    `,
    [targetTenantId]
  );

  await dbPool.query(
    `
      INSERT INTO workflow_template_version (
        tenant_id,
        template_id,
        version_number,
        status,
        default_for_new_jobs,
        owner_defaults_json
      )
      SELECT
        template.tenant_id,
        template.id,
        1,
        'active'::shared_workflow_template_version_status_type,
        true,
        '{}'::jsonb
      FROM workflow_template template
      WHERE template.tenant_id = $1::uuid
        AND template.template_key IN ('schools_phase_one_core', 'graphics_handoff_phase_one_core')
      ON CONFLICT (template_id, version_number)
      DO UPDATE SET
        status = EXCLUDED.status,
        default_for_new_jobs = EXCLUDED.default_for_new_jobs,
        owner_defaults_json = EXCLUDED.owner_defaults_json,
        updated_at = now()
    `,
    [targetTenantId]
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
      SELECT
        version_row.tenant_id,
        version_row.id,
        seeded.event_key,
        seeded.title,
        seeded.event_type,
        seeded.start_anchor::shared_workflow_date_anchor_type,
        seeded.start_offset_days,
        seeded.start_offset_minutes,
        seeded.duration_minutes,
        seeded.required,
        seeded.sort_order
      FROM workflow_template template
      JOIN workflow_template_version version_row
        ON version_row.template_id = template.id
       AND version_row.version_number = 1
      JOIN (
        VALUES
          ('schools_phase_one_core', 'picture_day', 'Picture Day', 'job_event', 'job_scheduled_start', 0, 0, 120, true, 0),
          ('graphics_handoff_phase_one_core', 'graphics_handoff_window', 'Graphics Handoff Window', 'job_event', 'job_scheduled_end', 0, 0, 60, true, 0)
      ) AS seeded(template_key, event_key, title, event_type, start_anchor, start_offset_days, start_offset_minutes, duration_minutes, required, sort_order)
        ON seeded.template_key = template.template_key
      WHERE template.tenant_id = $1::uuid
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
    [targetTenantId]
  );

  await dbPool.query(
    `
      INSERT INTO workflow_template_task (
        tenant_id,
        template_version_id,
        task_key,
        title,
        description,
        task_type,
        department_type,
        event_key,
        owner_default_type,
        owner_default_value,
        status,
        priority,
        due_anchor,
        due_offset_days,
        due_offset_minutes,
        required,
        sort_order
      )
      SELECT
        version_row.tenant_id,
        version_row.id,
        seeded.task_key,
        seeded.title,
        seeded.description,
        seeded.task_type,
        seeded.department_type::work_department_type,
        seeded.event_key,
        seeded.owner_default_type,
        seeded.owner_default_value,
        seeded.status::work_task_status_type,
        seeded.priority::job_priority_level,
        seeded.due_anchor::shared_workflow_date_anchor_type,
        seeded.due_offset_days,
        seeded.due_offset_minutes,
        seeded.required,
        seeded.sort_order
      FROM workflow_template template
      JOIN workflow_template_version version_row
        ON version_row.template_id = template.id
       AND version_row.version_number = 1
      JOIN (
        VALUES
          (
            'schools_phase_one_core',
            'confirm_schedule',
            'Confirm school schedule and account context',
            'Lock the school day timing, contact expectations, and internal ownership before staffing starts.',
            'coordination',
            'schools',
            'picture_day',
            'account_owner',
            NULL,
            'not_started',
            'high',
            'job_scheduled_start',
            -5,
            0,
            true,
            0
          ),
          (
            'schools_phase_one_core',
            'staff_picture_day',
            'Staff picture day coverage',
            'Assign field coverage and confirm who owns the school-day staffing handoff.',
            'staffing',
            'schools',
            'picture_day',
            'team',
            'schools_staffing',
            'not_started',
            'high',
            'job_scheduled_start',
            -3,
            0,
            true,
            1
          ),
          (
            'schools_phase_one_core',
            'graphics_handoff',
            'Send school work to graphics',
            'Package the school job for internal graphics handoff once day-of work is complete.',
            'handoff',
            'production',
            'picture_day',
            'team',
            'graphics-production',
            'not_started',
            'high',
            'job_scheduled_end',
            1,
            0,
            true,
            2
          ),
          (
            'graphics_handoff_phase_one_core',
            'ingest_assets',
            'Ingest graphics handoff',
            'Claim the incoming work, verify the handoff package, and begin internal production.',
            'production',
            'production',
            'graphics_handoff_window',
            'team',
            'graphics-production',
            'not_started',
            'high',
            'job_scheduled_end',
            0,
            0,
            true,
            0
          ),
          (
            'graphics_handoff_phase_one_core',
            'peer_review',
            'Peer review the graphics package',
            'Run internal peer review before release-ready confirmation.',
            'peer_review',
            'production',
            'graphics_handoff_window',
            'team',
            'graphics-qa',
            'not_started',
            'high',
            'job_scheduled_end',
            1,
            0,
            true,
            1
          ),
          (
            'graphics_handoff_phase_one_core',
            'release_ready',
            'Prepare release-ready package',
            'Finalize the graphics package and request blocking release signoff.',
            'release',
            'production',
            'graphics_handoff_window',
            'team',
            'graphics-release',
            'not_started',
            'high',
            'job_scheduled_end',
            2,
            0,
            true,
            2
          )
      ) AS seeded(
        template_key,
        task_key,
        title,
        description,
        task_type,
        department_type,
        event_key,
        owner_default_type,
        owner_default_value,
        status,
        priority,
        due_anchor,
        due_offset_days,
        due_offset_minutes,
        required,
        sort_order
      )
        ON seeded.template_key = template.template_key
      WHERE template.tenant_id = $1::uuid
      ON CONFLICT (template_version_id, task_key)
      DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        task_type = EXCLUDED.task_type,
        department_type = EXCLUDED.department_type,
        event_key = EXCLUDED.event_key,
        owner_default_type = EXCLUDED.owner_default_type,
        owner_default_value = EXCLUDED.owner_default_value,
        status = EXCLUDED.status,
        priority = EXCLUDED.priority,
        due_anchor = EXCLUDED.due_anchor,
        due_offset_days = EXCLUDED.due_offset_days,
        due_offset_minutes = EXCLUDED.due_offset_minutes,
        required = EXCLUDED.required,
        sort_order = EXCLUDED.sort_order,
        updated_at = now()
    `,
    [targetTenantId]
  );

  await dbPool.query(
    `
      INSERT INTO workflow_template_task_dependency (
        tenant_id,
        template_version_id,
        task_key,
        depends_on_task_key
      )
      SELECT
        version_row.tenant_id,
        version_row.id,
        seeded.task_key,
        seeded.depends_on_task_key
      FROM workflow_template template
      JOIN workflow_template_version version_row
        ON version_row.template_id = template.id
       AND version_row.version_number = 1
      JOIN (
        VALUES
          ('schools_phase_one_core', 'staff_picture_day', 'confirm_schedule'),
          ('schools_phase_one_core', 'graphics_handoff', 'staff_picture_day'),
          ('graphics_handoff_phase_one_core', 'peer_review', 'ingest_assets'),
          ('graphics_handoff_phase_one_core', 'release_ready', 'peer_review')
      ) AS seeded(template_key, task_key, depends_on_task_key)
        ON seeded.template_key = template.template_key
      WHERE template.tenant_id = $1::uuid
      ON CONFLICT (template_version_id, task_key, depends_on_task_key)
      DO NOTHING
    `,
    [targetTenantId]
  );

  await dbPool.query(
    `
      INSERT INTO workflow_template_acknowledgement_rule (
        tenant_id,
        template_version_id,
        rule_key,
        target_type,
        target_key,
        require_on_assignment,
        require_on_claim,
        summary,
        sort_order
      )
      SELECT
        version_row.tenant_id,
        version_row.id,
        seeded.rule_key,
        seeded.target_type,
        seeded.target_key,
        seeded.require_on_assignment,
        seeded.require_on_claim,
        seeded.summary,
        seeded.sort_order
      FROM workflow_template template
      JOIN workflow_template_version version_row
        ON version_row.template_id = template.id
       AND version_row.version_number = 1
      JOIN (
        VALUES
          (
            'schools_phase_one_core',
            'schools_schedule_ack',
            'task',
            'confirm_schedule',
            true,
            false,
            'Acknowledge the school schedule confirmation assignment.',
            0
          ),
          (
            'schools_phase_one_core',
            'schools_graphics_claim',
            'task',
            'graphics_handoff',
            false,
            true,
            'Claim the school graphics handoff before work begins.',
            1
          ),
          (
            'graphics_handoff_phase_one_core',
            'graphics_ingest_claim',
            'task',
            'ingest_assets',
            false,
            true,
            'Claim the graphics ingest queue before taking ownership.',
            0
          )
      ) AS seeded(template_key, rule_key, target_type, target_key, require_on_assignment, require_on_claim, summary, sort_order)
        ON seeded.template_key = template.template_key
      WHERE template.tenant_id = $1::uuid
      ON CONFLICT (template_version_id, rule_key)
      DO UPDATE SET
        target_type = EXCLUDED.target_type,
        target_key = EXCLUDED.target_key,
        require_on_assignment = EXCLUDED.require_on_assignment,
        require_on_claim = EXCLUDED.require_on_claim,
        summary = EXCLUDED.summary,
        sort_order = EXCLUDED.sort_order,
        updated_at = now()
    `,
    [targetTenantId]
  );

  await dbPool.query(
    `
      INSERT INTO workflow_template_approval_checkpoint (
        tenant_id,
        template_version_id,
        checkpoint_key,
        title,
        target_type,
        target_key,
        activate_when,
        request_type,
        requested_action_code,
        request_summary,
        reason,
        severity,
        blocking,
        sort_order
      )
      SELECT
        version_row.tenant_id,
        version_row.id,
        'graphics_release_signoff',
        'Graphics release signoff',
        'task',
        'release_ready',
        'on_task_completion',
        'release_override_approval',
        'approve_graphics_release',
        'Release-ready graphics package requires blocking signoff before downstream release actions.',
        'Approve the graphics release-ready package before it leaves the internal workflow.',
        'high',
        true,
        0
      FROM workflow_template template
      JOIN workflow_template_version version_row
        ON version_row.template_id = template.id
       AND version_row.version_number = 1
      WHERE template.tenant_id = $1::uuid
        AND template.template_key = 'graphics_handoff_phase_one_core'
      ON CONFLICT (template_version_id, checkpoint_key)
      DO UPDATE SET
        title = EXCLUDED.title,
        target_type = EXCLUDED.target_type,
        target_key = EXCLUDED.target_key,
        activate_when = EXCLUDED.activate_when,
        request_type = EXCLUDED.request_type,
        requested_action_code = EXCLUDED.requested_action_code,
        request_summary = EXCLUDED.request_summary,
        reason = EXCLUDED.reason,
        severity = EXCLUDED.severity,
        blocking = EXCLUDED.blocking,
        sort_order = EXCLUDED.sort_order,
        updated_at = now()
    `,
    [targetTenantId]
  );
}

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { pool } = await import("../src/db/pool.js");
  app = createApp();
  dbPool = pool;

  leadershipToken = await login("leadership@example.com");
  schoolsToken = await login("schools-office@example.com");

  const tenantRow = await dbPool.query<{ tenant_id: string }>(
    `SELECT tenant_id::text FROM app_user WHERE lower(email) = lower('schools-office@example.com') LIMIT 1`
  );
  tenantId = tenantRow.rows[0]?.tenant_id ?? "";
  if (!tenantId) {
    throw new Error("Expected a schools office tenant for shared workflow tests.");
  }
  await ensureSharedWorkflowSeedPrerequisites(tenantId);

  const fixtureRows = await dbPool.query<{
    organization_id: string;
    location_id: string;
    primary_contact_id: string;
  }>(
    `
      SELECT
        s.organization_id::text AS organization_id,
        s.location_id::text AS location_id,
        s.primary_contact_id::text AS primary_contact_id
      FROM shoot s
      WHERE s.tenant_id = $1::uuid
        AND s.deleted_at IS NULL
        AND s.record_state = 'published'::shoot_record_state
        AND s.organization_id IS NOT NULL
        AND s.location_id IS NOT NULL
        AND s.primary_contact_id IS NOT NULL
        AND s.department = 'schools'::department_code
      ORDER BY s.created_at ASC
      LIMIT 1
    `,
    [tenantId]
  );

  const fixture = fixtureRows.rows[0];
  if (!fixture) {
    throw new Error("Expected a seeded schools fixture for shared workflow tests.");
  }

  organizationId = fixture.organization_id;
  locationId = fixture.location_id;
  contactId = fixture.primary_contact_id;

  const leadershipRow = await dbPool.query<{ id: string }>(
    `SELECT id::text FROM app_user WHERE lower(email) = lower('leadership@example.com') LIMIT 1`
  );
  leadershipUserId = leadershipRow.rows[0]?.id ?? "";
});

describe("shared workflow engine", () => {
  it("creates a schools draft with a shared workflow run, generated event, and dependent tasks", async () => {
    const draft = await createDraft(schoolsToken, {
      department_type: "schools",
      job_category: "photo_day",
      organization_id: organizationId,
      primary_location_id: locationId,
      primary_contact_id: contactId,
      title: `Schools Workflow ${Date.now()}`,
      scheduled_start_at: plusDaysWithHours(8, 14),
      scheduled_end_at: plusDaysWithHours(8, 16),
      timezone: "America/Chicago",
      production_required: true,
      school_profile: {
        school_type: "high_school",
        school_year: "2026-2027",
        grade_scope: "9-12"
      }
    });

    expect(draft.status).toBe(201);
    expect(draft.body.shared_workflow).toBeTruthy();
    expect(draft.body.shared_workflow.template.template_key).toBe("schools_phase_one_core");
    expect(draft.body.shared_workflow.pilot_runtime.workflow_family).toBe("schools");
    expect(draft.body.shared_workflow.pilot_runtime.version_number).toBe(1);
    expect(draft.body.shared_workflow.pilot_runtime.version_label).toBe("v1");
    expect(draft.body.shared_workflow.events.map((event: { event_key: string }) => event.event_key)).toContain("picture_day");

    const tasks = draft.body.shared_workflow.tasks as Array<{
      task_key: string;
      status: string;
      dependency_task_ids: string[];
      dependencies: Array<{ depends_on_task_key: string; blocking: boolean; satisfied: boolean }>;
      dependency_blocked: boolean;
      assigned_team_id: string | null;
      acknowledgement: { rule_key: string; require_on_claim: boolean; target_key: string | null } | null;
    }>;
    const taskKeys = tasks.map((task) => task.task_key);
    expect(taskKeys).toEqual(expect.arrayContaining(["confirm_schedule", "staff_picture_day", "graphics_handoff"]));
    expect(tasks.find((task) => task.task_key === "staff_picture_day")?.status).toBe("blocked");
    expect(tasks.find((task) => task.task_key === "staff_picture_day")?.dependency_task_ids.length).toBe(1);
    expect(tasks.find((task) => task.task_key === "staff_picture_day")?.dependency_blocked).toBe(true);
    expect(tasks.find((task) => task.task_key === "staff_picture_day")?.dependencies[0]).toMatchObject({
      depends_on_task_key: "confirm_schedule",
      blocking: true,
      satisfied: false
    });
    expect(tasks.find((task) => task.task_key === "graphics_handoff")?.assigned_team_id).toBe("graphics-production");
    expect(tasks.find((task) => task.task_key === "graphics_handoff")?.acknowledgement).toMatchObject({
      rule_key: "schools_graphics_claim",
      require_on_claim: true,
      target_key: "graphics_handoff"
    });

    const acknowledgements = draft.body.shared_workflow.acknowledgements as Array<{
      rule_key: string;
      requested_user_id: string | null;
      status: string;
      require_on_assignment: boolean;
      require_on_claim: boolean;
    }>;
    expect(acknowledgements.find((item) => item.rule_key === "schools_schedule_ack")?.requested_user_id).toBeTruthy();
    expect(acknowledgements.find((item) => item.rule_key === "schools_schedule_ack")?.require_on_assignment).toBe(true);
    expect(acknowledgements.find((item) => item.rule_key === "schools_graphics_claim")?.status).toBe("pending");
    expect(acknowledgements.find((item) => item.rule_key === "schools_graphics_claim")?.require_on_claim).toBe(true);
  });

  it("acknowledges ownership when a team-assigned workflow task is claimed", async () => {
    const draft = await createDraft(schoolsToken, {
      department_type: "schools",
      job_category: "photo_day",
      organization_id: organizationId,
      primary_location_id: locationId,
      primary_contact_id: contactId,
      title: `Schools Claim ${Date.now()}`,
      scheduled_start_at: plusDaysWithHours(9, 14),
      scheduled_end_at: plusDaysWithHours(9, 16),
      timezone: "America/Chicago",
      production_required: true
    });

    expect(draft.status).toBe(201);
    const graphicsTask = (draft.body.shared_workflow.tasks as Array<{ task_id: string; task_key: string }>).find(
      (task) => task.task_key === "graphics_handoff"
    );
    expect(graphicsTask).toBeTruthy();

    const claim = await updateTask(leadershipToken, graphicsTask!.task_id, {
      assigned_to_user_id: leadershipUserId
    });
    expect(claim.status).toBe(200);
    expect(claim.body.task.assigned_to_user_id).toBe(leadershipUserId);
    expect(claim.body.shared_workflow_runtime.task.acknowledgement).toMatchObject({
      rule_key: "schools_graphics_claim",
      status: "acknowledged",
      requested_user_id: leadershipUserId,
      acknowledged_by_user_id: leadershipUserId
    });

    const taskDetail = await getTask(leadershipToken, graphicsTask!.task_id);
    expect(taskDetail.status).toBe(200);
    expect(taskDetail.body.shared_workflow_runtime.pilot_runtime.workflow_family).toBe("schools");
    expect(taskDetail.body.shared_workflow_runtime.task.acknowledgement).toMatchObject({
      rule_key: "schools_graphics_claim",
      status: "acknowledged"
    });

    const ackRow = await dbPool.query<{
      requested_user_id: string | null;
      acknowledged_at: string | null;
      status: string;
    }>(
      `
        SELECT requested_user_id::text, acknowledged_at::text, status::text
        FROM workflow_run_acknowledgement
        WHERE work_task_id = $1
        LIMIT 1
      `,
      [graphicsTask!.task_id]
    );

    expect(ackRow.rows[0]?.requested_user_id).toBe(leadershipUserId);
    expect(ackRow.rows[0]?.acknowledged_at).toBeTruthy();
    expect(ackRow.rows[0]?.status).toBe("acknowledged");
  });

  it("unblocks dependent graphics tasks and opens a workflow approval checkpoint on release-ready completion", async () => {
    const draft = await createDraft(leadershipToken, {
      department_type: "schools",
      job_category: "photo_day",
      organization_id: organizationId,
      primary_location_id: locationId,
      primary_contact_id: contactId,
      title: `Graphics Workflow ${Date.now()}`,
      scheduled_start_at: plusDaysWithHours(10, 13),
      scheduled_end_at: plusDaysWithHours(10, 15),
      timezone: "America/Chicago",
      production_required: true,
      school_profile: {
        school_type: "high_school",
        school_year: "2026-2027",
        grade_scope: "9-12"
      },
      workflow_template_key: "graphics_handoff_phase_one_core"
    });

    expect(draft.status).toBe(201);
    expect(draft.body.shared_workflow.template.template_key).toBe("graphics_handoff_phase_one_core");

    const taskByKey = new Map(
      (draft.body.shared_workflow.tasks as Array<{ task_id: string; task_key: string; status: string }>).map((task) => [
        task.task_key,
        task
      ])
    );

    const ingestTask = taskByKey.get("ingest_assets");
    const peerReviewTask = taskByKey.get("peer_review");
    const releaseReadyTask = taskByKey.get("release_ready");
    expect(ingestTask?.status).toBe("not_started");
    expect(peerReviewTask?.status).toBe("blocked");
    expect(releaseReadyTask?.status).toBe("blocked");

    const ingestComplete = await updateTask(leadershipToken, ingestTask!.task_id, {
      assigned_to_user_id: leadershipUserId,
      status: "completed"
    });
    expect(ingestComplete.status).toBe(200);

    let jobDetail = await getJob(leadershipToken, draft.body.job.id);
    expect(jobDetail.status).toBe(200);
    taskByKey.clear();
    for (const task of jobDetail.body.shared_workflow.tasks) {
      taskByKey.set(task.task_key, task);
    }
    expect(taskByKey.get("peer_review")?.status).toBe("not_started");
    expect(taskByKey.get("peer_review")?.dependency_blocked).toBe(false);
    expect(taskByKey.get("peer_review")?.dependencies[0]).toMatchObject({
      depends_on_task_key: "ingest_assets",
      satisfied: true,
      blocking: false
    });

    const peerReviewComplete = await updateTask(leadershipToken, peerReviewTask!.task_id, {
      assigned_to_user_id: leadershipUserId,
      status: "completed"
    });
    expect(peerReviewComplete.status).toBe(200);

    jobDetail = await getJob(leadershipToken, draft.body.job.id);
    expect(jobDetail.status).toBe(200);
    taskByKey.clear();
    for (const task of jobDetail.body.shared_workflow.tasks) {
      taskByKey.set(task.task_key, task);
    }
    expect(taskByKey.get("release_ready")?.status).toBe("not_started");

    const releaseReadyComplete = await updateTask(leadershipToken, releaseReadyTask!.task_id, {
      assigned_to_user_id: leadershipUserId,
      status: "completed"
    });
    expect(releaseReadyComplete.status).toBe(200);

    jobDetail = await getJob(leadershipToken, draft.body.job.id);
    expect(jobDetail.status).toBe(200);
    const checkpoint = (jobDetail.body.shared_workflow.approval_checkpoints as Array<{
      checkpoint_key: string;
      status: string;
      activate_when: string;
      operational_approval_request_id: string | null;
    }>).find((item) => item.checkpoint_key === "graphics_release_signoff");
    expect(checkpoint?.status).toBe("pending");
    expect(checkpoint?.activate_when).toBe("on_task_completion");
    expect(checkpoint?.operational_approval_request_id).toBeTruthy();

    const releaseReadyDetail = await getTask(leadershipToken, releaseReadyTask!.task_id);
    expect(releaseReadyDetail.status).toBe(200);
    expect(releaseReadyDetail.body.shared_workflow_runtime.pilot_runtime.workflow_family).toBe("graphics_handoff");
    expect(releaseReadyDetail.body.shared_workflow_runtime.task.approval_checkpoints[0]).toMatchObject({
      checkpoint_key: "graphics_release_signoff",
      status: "pending",
      activate_when: "on_task_completion"
    });
  });
});
