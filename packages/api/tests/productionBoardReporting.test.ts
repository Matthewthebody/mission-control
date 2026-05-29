import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sweepProductionBoardAutomation } from "../src/services/jobTruth/jobService.js";
import { resolveAuthenticatedUser } from "../src/services/auth.js";

let app: Express;
let dbPool: Pool;
let leadershipToken = "";
let sportsToken = "";
let photographerUserId = "";
let sportsOrganizationId = "";
let sportsLocationId = "";
let sportsContactId = "";
const productionReportingRunId = Date.now().toString();

function minusDays(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function plusDaysWithHours(days: number, hours: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

function uniqueTitle(prefix: string) {
  return `${prefix} ${productionReportingRunId} ${Math.floor(Math.random() * 10_000)}`;
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

async function createPublishedSportsJob() {
  const title = uniqueTitle("Production Reporting Sports Job");
  const draft = await createDraft(sportsToken, {
    department_type: "sports",
    job_category: "photo_day",
    organization_id: sportsOrganizationId,
    primary_location_id: sportsLocationId,
    primary_contact_id: sportsContactId,
    title,
    scheduled_start_at: plusDaysWithHours(3, 18),
    scheduled_end_at: plusDaysWithHours(3, 20),
    timezone: "America/Chicago",
    estimated_staff_count: 1,
    production_required: true,
    sports_profile: {
      sport_type: "soccer",
      season: "spring",
      team_structure: "multi_team",
      proof_required: true,
      approval_contact_id: sportsContactId
    }
  });

  expect(draft.status).toBe(201);
  const publish = await publishJob(sportsToken, draft.body.job.id);
  expect(publish.status).toBe(200);
  return {
    ...publish.body,
    job: {
      ...publish.body.job,
      title
    }
  } as {
    job: { id: string; title: string };
    production_items: Array<Record<string, any>>;
  };
}

async function reconcileProductionJob(jobId: string) {
  const auth = await resolveAuthenticatedUser(leadershipToken);
  expect(auth).toBeTruthy();
  const client = await dbPool.connect();
  try {
    await sweepProductionBoardAutomation(client, auth!.tenantId, auth!.id, { jobId, limit: 1 });
  } finally {
    client.release();
  }
}

async function cleanupProductionReportingJobs() {
  const auth = await resolveAuthenticatedUser(leadershipToken);
  if (!auth) {
    return;
  }

  const jobIds = (
    await dbPool.query<{ id: string }>(
      `
        SELECT id::text
        FROM jobs
        WHERE tenant_id = $1
          AND title LIKE $2
      `,
      [auth.tenantId, `Production Reporting Sports Job ${productionReportingRunId} %`]
    )
  ).rows.map((row) => row.id);

  if (!jobIds.length) {
    return;
  }

  const runIds = (
    await dbPool.query<{ id: string }>(
      `
        SELECT id::text
        FROM workflow_run
        WHERE tenant_id = $1
          AND job_id = ANY($2::uuid[])
      `,
      [auth.tenantId, jobIds]
    )
  ).rows.map((row) => row.id);

  await dbPool.query(
    `
      DELETE FROM app_event
      WHERE tenant_id = $1
        AND (
          aggregate_id = ANY($2::uuid[])
          OR aggregate_id = ANY($3::uuid[])
        )
    `,
    [auth.tenantId, jobIds, runIds]
  );
  await dbPool.query("DELETE FROM production_items WHERE tenant_id = $1 AND job_id = ANY($2::uuid[])", [auth.tenantId, jobIds]);
  await dbPool.query("DELETE FROM work_task WHERE tenant_id = $1 AND related_job_id = ANY($2::uuid[])", [auth.tenantId, jobIds]);
  await dbPool.query("DELETE FROM workflow_handoff WHERE tenant_id = $1 AND workflow_run_id = ANY($2::uuid[])", [auth.tenantId, runIds]);
  await dbPool.query("DELETE FROM workflow_step_audit_log WHERE tenant_id = $1 AND workflow_run_id = ANY($2::uuid[])", [auth.tenantId, runIds]);
  await dbPool.query("DELETE FROM workflow_step_dependency WHERE tenant_id = $1 AND workflow_run_id = ANY($2::uuid[])", [auth.tenantId, runIds]);
  await dbPool.query("DELETE FROM workflow_step WHERE tenant_id = $1 AND workflow_run_id = ANY($2::uuid[])", [auth.tenantId, runIds]);
  await dbPool.query("DELETE FROM workflow_run_milestone WHERE tenant_id = $1 AND workflow_run_id = ANY($2::uuid[])", [auth.tenantId, runIds]);
  await dbPool.query("DELETE FROM workflow_run WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [auth.tenantId, runIds]);
  await dbPool.query("DELETE FROM jobs WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [auth.tenantId, jobIds]);
}

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { pool } = await import("../src/db/pool.js");
  app = createApp();
  dbPool = pool;

  leadershipToken = await login("leadership@example.com");
  sportsToken = await login("sports-office@example.com");

  const sportsFixture = await dbPool.query<{
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
      WHERE s.deleted_at IS NULL
        AND s.record_state = 'published'::shoot_record_state
        AND s.organization_id IS NOT NULL
        AND s.location_id IS NOT NULL
        AND s.primary_contact_id IS NOT NULL
        AND s.department = 'sports'::department_code
      ORDER BY s.created_at ASC
      LIMIT 1
    `
  );

  if (!sportsFixture.rows[0]) {
    throw new Error("Expected a seeded sports shoot fixture for production board reporting tests.");
  }

  sportsOrganizationId = sportsFixture.rows[0].organization_id;
  sportsLocationId = sportsFixture.rows[0].location_id;
  sportsContactId = sportsFixture.rows[0].primary_contact_id;

  const photographerRow = await dbPool.query<{ id: string }>(
    `SELECT id::text FROM app_user WHERE lower(email) = lower('photo@example.com') LIMIT 1`
  );
  photographerUserId = photographerRow.rows[0]?.id ?? "";
});

afterAll(async () => {
  await cleanupProductionReportingJobs();
});

describe("production board reporting", () => {
  it("calculates shared production metrics and scopes management queues by department", async () => {
    const publish = await createPublishedSportsJob();
    const itemId = publish.production_items[0].id as string;

    const update = await request(app)
      .patch(`/api/jobs/${publish.job.id}/production-items/${itemId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        assigned_to_user_id: photographerUserId,
        handoff_complete: true,
        due_at: minusDays(1),
        release_due_at: plusDaysWithHours(1, 12),
        file_count_expected: 10,
        file_count_received: 7,
        upload_status: "FAILED",
        post_shoot_eval_summary: "Late handoff and missing files slowed release."
      });

    expect(update.status).toBe(200);

    const response = await request(app)
      .get("/api/jobs/production-items/reporting")
      .query({ department_type: "sports", search: publish.job.title })
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body.summary.overdue_items).toBeGreaterThanOrEqual(1);
    expect(response.body.summary.blocked_items).toBeGreaterThanOrEqual(1);
    expect(response.body.summary.file_mismatch_rate).toBeGreaterThan(0);
    expect(response.body.management.overdue_queue.some((item: { id: string }) => item.id === itemId)).toBe(true);
    expect(response.body.management.blocked_queue.some((item: { id: string }) => item.id === itemId)).toBe(true);
    expect(
      response.body.management.exception_view.every((item: { department_type: string }) => item.department_type === "sports")
    ).toBe(true);
    expect(Array.isArray(response.body.management.team_workload)).toBe(true);
    expect(Array.isArray(response.body.insights.operational_burden_by_account)).toBe(true);
    expect(Array.isArray(response.body.insights.top_performers)).toBe(true);
  });

  it("keeps restricted executive overlays hidden for non-executive users", async () => {
    const sportsResponse = await request(app)
      .get("/api/jobs/production-items/reporting")
      .query({ department_type: "sports" })
      .set("Authorization", `Bearer ${sportsToken}`);

    expect(sportsResponse.status).toBe(200);
    expect(sportsResponse.body.restricted_overlays).toBeNull();

    const leadershipResponse = await request(app)
      .get("/api/jobs/production-items/reporting")
      .query({ department_type: "sports" })
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(leadershipResponse.status).toBe(200);
    expect(leadershipResponse.body.restricted_overlays).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "cost_overlay"
        })
      ])
    );
  });

  it("applies release-state filters consistently to reporting summaries and management queues", async () => {
    const vendorPublish = await createPublishedSportsJob();
    const vendorItemId = vendorPublish.production_items[0].id as string;
    const baselinePublish = await createPublishedSportsJob();

    await dbPool.query(
      `
        UPDATE production_items
        SET assigned_to_user_id = $3::uuid,
            status = 'blocked'::job_production_status_type,
            health_state = 'BLOCKED'::production_board_health_state_type,
            workflow_status = 'SENT_TO_VENDOR'::production_board_workflow_status_type,
            release_status = 'SENT_TO_VENDOR'::production_board_release_status_type,
            vendor_name = 'Prime Prints',
            blocked_reason = 'Vendor handoff stalled on missing print spec.',
            due_at = $4::timestamptz,
            updated_at = now()
        WHERE id = $1::uuid
          AND job_id = $2::uuid
      `,
      [vendorItemId, vendorPublish.job.id, photographerUserId, plusDaysWithHours(2, 10)]
    );
    await reconcileProductionJob(vendorPublish.job.id);

    const response = await request(app)
      .get("/api/jobs/production-items/reporting")
      .query({
        department_type: "sports",
        release_status: "SENT_TO_VENDOR"
      })
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(response.status).toBe(200);
    expect(response.body.summary.total_open_items).toBeGreaterThanOrEqual(1);
    expect(response.body.management.exception_view.length).toBeGreaterThan(0);
    expect(
      response.body.management.exception_view.every(
        (item: { id: string; release_status: string }) => item.release_status === "SENT_TO_VENDOR" && item.id !== baselinePublish.production_items[0].id
      )
    ).toBe(true);
    expect(response.body.management.overdue_queue.every((item: { release_status: string }) => item.release_status === "SENT_TO_VENDOR")).toBe(true);
    expect(response.body.management.blocked_queue.every((item: { release_status: string }) => item.release_status === "SENT_TO_VENDOR")).toBe(true);
  });
});
