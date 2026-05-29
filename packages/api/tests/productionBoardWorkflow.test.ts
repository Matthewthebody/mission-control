import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { listProductionManagementExceptions } from "../src/services/jobTruth/productionBoardWatchService.js";
import { sweepProductionBoardAutomation } from "../src/services/jobTruth/jobService.js";
import { resolveAuthenticatedUser } from "../src/services/auth.js";

let app: Express;
let dbPool: Pool;
let leadershipToken = "";
let sportsToken = "";
let photographerToken = "";
let photographerUserId = "";
let sportsManagerUserId = "";
let sportsOrganizationId = "";
let sportsLocationId = "";
let sportsContactId = "";

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

function uniqueTitle(prefix: string) {
  return `${prefix} ${Date.now()} ${Math.floor(Math.random() * 10_000)}`;
}

function qaAnswers(decision: "approve" | "send_back" = "approve", overrides: Record<string, unknown> = {}) {
  return {
    files_complete_storage: decision === "approve",
    color_density_consistency: decision === "approve",
    sorting_and_roster_accuracy: decision === "approve",
    template_price_release_accuracy: decision === "approve",
    next_stage_decision: decision,
    ...overrides
  };
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
  const title = uniqueTitle("Production Board Sports Job");
  const draft = await createDraft(sportsToken, {
    department_type: "sports",
    job_category: "photo_day",
    organization_id: sportsOrganizationId,
    primary_location_id: sportsLocationId,
    primary_contact_id: sportsContactId,
    title,
    scheduled_start_at: plusDaysWithHours(7, 18),
    scheduled_end_at: plusDaysWithHours(7, 20),
    timezone: "America/Chicago",
    estimated_staff_count: 1,
    production_required: true,
    sports_profile: {
      sport_type: "basketball",
      season: "winter",
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

async function assignPhotographer(jobId: string) {
  const response = await request(app)
    .post(`/api/jobs/${jobId}/staff-assignments`)
    .set("Authorization", `Bearer ${sportsToken}`)
    .send({
      user_id: photographerUserId,
      assignment_role: "lead_photographer",
      is_lead: true
    });

  expect(response.status).toBe(201);
}

async function forceProductionItemUpdatedAt(productionItemId: string, updatedAt: string) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    // The canonical audit trigger always rewrites updated_at to now().
    // For this deterministic stale-stage test we need to bypass the trigger
    // on a dedicated session so we can simulate an older stage timestamp.
    await client.query(`SET LOCAL session_replication_role = replica`);
    await client.query(`UPDATE production_items SET updated_at = $2::timestamptz WHERE id = $1`, [
      productionItemId,
      updatedAt
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function forceLatestProductionWorkflowEventAt(productionItemId: string, createdAt: string) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL session_replication_role = replica`);
    await client.query(
      `
        UPDATE activity_log_entries
        SET created_at = $2::timestamptz
        WHERE id = (
          SELECT id
          FROM activity_log_entries
          WHERE production_item_id = $1::uuid
            AND event_type = 'production_workflow_status_changed'
          ORDER BY created_at DESC
          LIMIT 1
        )
      `,
      [productionItemId, createdAt]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { pool } = await import("../src/db/pool.js");
  app = createApp();
  dbPool = pool;

  leadershipToken = await login("leadership@example.com");
  sportsToken = await login("sports-office@example.com");
  photographerToken = await login("photo@example.com");

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
    throw new Error("Expected a seeded sports shoot fixture for production board tests.");
  }

  sportsOrganizationId = sportsFixture.rows[0].organization_id;
  sportsLocationId = sportsFixture.rows[0].location_id;
  sportsContactId = sportsFixture.rows[0].primary_contact_id;

  const photographerRow = await dbPool.query<{ id: string }>(
    `SELECT id::text FROM app_user WHERE lower(email) = lower('photo@example.com') LIMIT 1`
  );
  photographerUserId = photographerRow.rows[0]?.id ?? "";

  const sportsManagerRow = await dbPool.query<{ id: string }>(
    `SELECT id::text FROM app_user WHERE lower(email) = lower('sports-office@example.com') LIMIT 1`
  );
  sportsManagerUserId = sportsManagerRow.rows[0]?.id ?? "";
});

describe("production board workflow engine", () => {
  it("auto-creates a default production item on publish", async () => {
    const publish = await createPublishedSportsJob();
    expect(publish.production_items).toHaveLength(1);
    expect(publish.production_items[0].created_from_source).toBe("job_publish");
    expect(publish.production_items[0].workflow_status).toBe("DRAFT");
    expect(publish.production_items[0].status).toBe("queued");
  });

  it("creates a blocker and risk state when file counts mismatch", async () => {
    const publish = await createPublishedSportsJob();
    const itemId = publish.production_items[0].id;

    const response = await request(app)
      .patch(`/api/jobs/${publish.job.id}/production-items/${itemId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        handoff_complete: true,
        file_count_expected: 10,
        file_count_received: 7
      });

    expect(response.status).toBe(200);
    const item = response.body.production_items.find((row: { id: string }) => row.id === itemId);
    expect(item.workflow_status).toBe("BLOCKED");
    expect(item.health_state).toMatch(/AT_RISK|BLOCKED/);
    expect(item.open_blocker_count).toBeGreaterThanOrEqual(1);
    expect(
      response.body.production_blockers.some(
        (blocker: { production_item_id: string; source_key: string }) =>
          blocker.production_item_id === itemId && blocker.source_key === "file_count_mismatch"
      )
    ).toBe(true);

      const exceptions = await request(app)
        .get("/api/jobs/production-items/exceptions")
        .set("Authorization", `Bearer ${leadershipToken}`)
        .query({ department_type: "sports", limit: 250 });

    expect(exceptions.status).toBe(200);
    const exceptionItem = exceptions.body.items.find((row: { id: string }) => row.id === itemId);
    expect(exceptionItem).toBeTruthy();
    expect(exceptionItem.exception_types).toContain("blocked");
  }, 20000);

  it("routes peer review fail and pass transitions through the shared production workflow", async () => {
    const publish = await createPublishedSportsJob();
    const itemId = publish.production_items[0].id;

    const prep = await request(app)
      .patch(`/api/jobs/${publish.job.id}/production-items/${itemId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        assigned_to_user_id: photographerUserId,
        handoff_complete: true,
        file_count_expected: 12,
        file_count_received: 12,
        naming_verified: true,
        folder_structure_verified: true,
        tags_or_flags_verified: true,
        creator_review_complete: true
      });

    expect(prep.status).toBe(200);
    expect(prep.body.production_items.find((row: { id: string }) => row.id === itemId)?.workflow_status).toBe("READY_FOR_QA");

    const failedReview = await request(app)
      .post(`/api/jobs/${publish.job.id}/production-items/${itemId}/qa-reviews`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        review_type: "peer",
        review_stage: "peer_review",
        reviewer_user_id: sportsManagerUserId,
        status: "failed",
        decision: "needs_changes",
        sample_size_percent: 10,
        question_answers_json: qaAnswers("send_back", {
          files_complete_storage: false,
          color_density_consistency: false
        }),
        decision_reason: "Color and grouping still need correction before upload.",
        issue_category: "color_grouping",
        rework_required: true,
        sent_back_to_user_id: photographerUserId
      });

    expect(failedReview.status).toBe(201);
    let item = failedReview.body.production_items.find((row: { id: string }) => row.id === itemId);
    expect(item.workflow_status).toBe("REWORK_REQUIRED");
    expect(item.rework_count).toBe(1);
    expect(item.qa_fail_count).toBe(1);
    expect(item.assigned_to_user_id).toBe(photographerUserId);

    const qaReviewId = failedReview.body.qa_reviews.find((row: { production_item_id: string }) => row.production_item_id === itemId)?.id;
    expect(qaReviewId).toBeTruthy();

    const passedReview = await request(app)
      .patch(`/api/jobs/${publish.job.id}/production-items/${itemId}/qa-reviews/${qaReviewId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        status: "passed",
        decision: "approve",
        sample_size_percent: 10,
        question_answers_json: qaAnswers("approve"),
        decision_reason: "Peer review passed after corrections.",
        rework_required: false
      });

    expect(passedReview.status).toBe(200);
    item = passedReview.body.production_items.find((row: { id: string }) => row.id === itemId);
    expect(item.workflow_status).toBe("READY_FOR_UPLOAD");
    expect(item.peer_review_complete).toBe(true);
    expect(item.first_pass_approved).toBe(false);
  });

  it("requires peer review before upload can be advanced", async () => {
    const publish = await createPublishedSportsJob();
    const itemId = publish.production_items[0].id;

    const prep = await request(app)
      .patch(`/api/jobs/${publish.job.id}/production-items/${itemId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        assigned_to_user_id: photographerUserId,
        handoff_complete: true,
        file_count_expected: 12,
        file_count_received: 12,
        naming_verified: true,
        folder_structure_verified: true,
        tags_or_flags_verified: true,
        creator_review_complete: true,
        qa_required: true
      });

    expect(prep.status).toBe(200);

    const uploadAttempt = await request(app)
      .patch(`/api/jobs/${publish.job.id}/production-items/${itemId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        workflow_status: "READY_FOR_UPLOAD"
      });

    expect(uploadAttempt.status).toBe(409);
    expect(uploadAttempt.body.details?.checklist_block_validation?.issues?.[0]?.template_code).toBe("peer_review_sign_off");
  });

  it("requires final release review before release can be advanced", async () => {
    const publish = await createPublishedSportsJob();
    const itemId = publish.production_items[0].id;

    const prep = await request(app)
      .patch(`/api/jobs/${publish.job.id}/production-items/${itemId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        assigned_to_user_id: photographerUserId,
        handoff_complete: true,
        file_count_expected: 12,
        file_count_received: 12,
        naming_verified: true,
        folder_structure_verified: true,
        tags_or_flags_verified: true,
        creator_review_complete: true,
        qa_required: true
      });

    expect(prep.status).toBe(200);

    const peerPassed = await request(app)
      .post(`/api/jobs/${publish.job.id}/production-items/${itemId}/qa-reviews`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        review_type: "peer",
        review_stage: "peer_review",
        reviewer_user_id: sportsManagerUserId,
        status: "passed",
        decision: "approve",
        sample_size_percent: 10,
        question_answers_json: qaAnswers("approve"),
        decision_reason: "Peer review cleared for upload.",
        rework_required: false
      });

    expect(peerPassed.status).toBe(201);

    const releaseAttempt = await request(app)
      .patch(`/api/jobs/${publish.job.id}/production-items/${itemId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        upload_status: "VERIFIED",
        workflow_status: "RELEASED"
      });

    expect(releaseAttempt.status).toBe(409);
    expect(releaseAttempt.body.details?.checklist_block_validation?.issues?.[0]?.template_code).toBe("final_release_checklist");
  });

  it("requires a send-back reason and issue category for QA rework", async () => {
    const publish = await createPublishedSportsJob();
    const itemId = publish.production_items[0].id;

    const prep = await request(app)
      .patch(`/api/jobs/${publish.job.id}/production-items/${itemId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        assigned_to_user_id: photographerUserId,
        handoff_complete: true,
        file_count_expected: 12,
        file_count_received: 12,
        naming_verified: true,
        folder_structure_verified: true,
        tags_or_flags_verified: true,
        creator_review_complete: true,
        qa_required: true
      });

    expect(prep.status).toBe(200);

    const failedReview = await request(app)
      .post(`/api/jobs/${publish.job.id}/production-items/${itemId}/qa-reviews`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        review_type: "peer",
        review_stage: "peer_review",
        reviewer_user_id: sportsManagerUserId,
        status: "failed",
        decision: "needs_changes",
        sample_size_percent: 10,
        question_answers_json: qaAnswers("send_back", {
          files_complete_storage: false
        }),
        rework_required: true
      });

    expect(failedReview.status).toBe(400);
    expect(failedReview.body.error).toMatch(/Validation failed/i);
  });

  it("blocks peer self-review unless an explicit override is provided", async () => {
    const publish = await createPublishedSportsJob();
    const itemId = publish.production_items[0].id;

    const prep = await request(app)
      .patch(`/api/jobs/${publish.job.id}/production-items/${itemId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        assigned_to_user_id: photographerUserId,
        handoff_complete: true,
        file_count_expected: 12,
        file_count_received: 12,
        naming_verified: true,
        folder_structure_verified: true,
        tags_or_flags_verified: true,
        creator_review_complete: true,
        qa_required: true
      });

    expect(prep.status).toBe(200);

    const selfReview = await request(app)
      .post(`/api/jobs/${publish.job.id}/production-items/${itemId}/qa-reviews`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        review_type: "peer",
        review_stage: "peer_review",
        reviewer_user_id: photographerUserId,
        status: "queued"
      });

    expect(selfReview.status).toBe(400);
    expect(selfReview.body.error).toMatch(/Validation failed/i);
  });

  it("writes audit-backed activity entries for QA decisions", async () => {
    const publish = await createPublishedSportsJob();
    const itemId = publish.production_items[0].id;

    const prep = await request(app)
      .patch(`/api/jobs/${publish.job.id}/production-items/${itemId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        assigned_to_user_id: photographerUserId,
        handoff_complete: true,
        file_count_expected: 12,
        file_count_received: 12,
        naming_verified: true,
        folder_structure_verified: true,
        tags_or_flags_verified: true,
        creator_review_complete: true,
        qa_required: true
      });

    expect(prep.status).toBe(200);

    const failedReview = await request(app)
      .post(`/api/jobs/${publish.job.id}/production-items/${itemId}/qa-reviews`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        review_type: "peer",
        review_stage: "peer_review",
        reviewer_user_id: sportsManagerUserId,
        status: "failed",
        decision: "needs_changes",
        sample_size_percent: 10,
        question_answers_json: qaAnswers("send_back", {
          files_complete_storage: false,
          color_density_consistency: false
        }),
        decision_reason: "Peer review found inconsistent color and file handling.",
        issue_category: "color_consistency",
        rework_required: true,
        sent_back_to_user_id: photographerUserId
      });

    expect(failedReview.status).toBe(201);
    const qaReviewId = failedReview.body.qa_reviews.find((row: { production_item_id: string }) => row.production_item_id === itemId)?.id;
    expect(qaReviewId).toBeTruthy();

    const passedReview = await request(app)
      .patch(`/api/jobs/${publish.job.id}/production-items/${itemId}/qa-reviews/${qaReviewId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        status: "passed",
        decision: "approve",
        sample_size_percent: 10,
        question_answers_json: qaAnswers("approve"),
        decision_reason: "Peer review cleared the corrected work.",
        rework_required: false
      });

    expect(passedReview.status).toBe(200);

    const detail = await request(app)
      .get(`/api/jobs/${publish.job.id}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(detail.status).toBe(200);
    expect(detail.body.activity.some((entry: { event_type: string }) => entry.event_type === "qa_review_sent_back")).toBe(true);
    expect(detail.body.activity.some((entry: { event_type: string }) => entry.event_type === "qa_review_passed")).toBe(true);

    const auditEvents = await dbPool.query<{ action: string }>(
      `
        SELECT action
        FROM audit_log
        WHERE entity_id = $1
          AND action IN ('job_truth.qa_review_sent_back', 'job_truth.qa_review_passed')
      `,
      [itemId]
    );

    expect(auditEvents.rows.map((row) => row.action)).toContain("job_truth.qa_review_sent_back");
    expect(auditEvents.rows.map((row) => row.action)).toContain("job_truth.qa_review_passed");
  });

  it("marks open production items overdue when due dates pass", async () => {
    const publish = await createPublishedSportsJob();
    const itemId = publish.production_items[0].id;

    const response = await request(app)
      .patch(`/api/jobs/${publish.job.id}/production-items/${itemId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        due_at: plusDays(-2)
      });

    expect(response.status).toBe(200);
    const item = response.body.production_items.find((row: { id: string }) => row.id === itemId);
    expect(item.health_state).toBe("OVERDUE");
    expect(item.overdue_flag).toBe(true);

    const overdueQueue = await request(app)
      .get("/api/jobs/production-items/overdue")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .query({ department_type: "sports" });

    expect(overdueQueue.status).toBe(200);
    expect(overdueQueue.body.items.some((row: { id: string }) => row.id === itemId)).toBe(true);

    const client = await dbPool.connect();
    try {
      const auth = await resolveAuthenticatedUser(leadershipToken);
      expect(auth).toBeTruthy();
      const exceptions = await listProductionManagementExceptions(client, auth!, {
        department_type: "sports",
        limit: 5000
      });
      const exceptionItem = exceptions.items.find((row) => row.id === itemId);
      expect(exceptionItem).toBeTruthy();
      expect(exceptionItem?.exception_types).toContain("overdue");
    } finally {
      client.release();
    }
  }, 20000);

  it("surfaces stalled production stages in urgent watch", async () => {
    const publish = await createPublishedSportsJob();
    const itemId = publish.production_items[0].id;

    const prep = await request(app)
      .patch(`/api/jobs/${publish.job.id}/production-items/${itemId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        handoff_complete: true,
        file_count_expected: 15,
        file_count_received: 15,
        naming_verified: true,
        folder_structure_verified: true,
        tags_or_flags_verified: true,
        creator_review_complete: true,
        qa_required: true
      });

    expect(prep.status).toBe(200);
    expect(prep.body.production_items.find((row: { id: string }) => row.id === itemId)?.workflow_status).toBe("READY_FOR_QA");

    await dbPool.query(`UPDATE production_items SET due_at = now() - interval '1 hour' WHERE id = $1`, [itemId]);
    await forceProductionItemUpdatedAt(itemId, new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString());
    await forceLatestProductionWorkflowEventAt(itemId, new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString());
    await reconcileProductionJob(publish.job.id);

    const client = await dbPool.connect();
    try {
      const auth = await resolveAuthenticatedUser(leadershipToken);
      expect(auth).toBeTruthy();
      const exceptions = await listProductionManagementExceptions(client, auth!, {
        department_type: "sports",
        limit: 5000
      });
      const exceptionItem = exceptions.items.find((row) => row.id === itemId);
      expect(exceptionItem).toBeTruthy();
      expect(exceptionItem?.exception_types).toContain("stalled_stage");
    } finally {
      client.release();
    }
  }, 20000);

  it("escalates repeated QA failures into management exceptions", async () => {
    const publish = await createPublishedSportsJob();
    const itemId = publish.production_items[0].id;

    const prep = await request(app)
      .patch(`/api/jobs/${publish.job.id}/production-items/${itemId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        assigned_to_user_id: photographerUserId,
        handoff_complete: true,
        file_count_expected: 12,
        file_count_received: 12,
        naming_verified: true,
        folder_structure_verified: true,
        tags_or_flags_verified: true,
        creator_review_complete: true,
        qa_required: true
      });

    expect(prep.status).toBe(200);

    for (let index = 0; index < 2; index += 1) {
      const failedReview = await request(app)
        .post(`/api/jobs/${publish.job.id}/production-items/${itemId}/qa-reviews`)
        .set("Authorization", `Bearer ${leadershipToken}`)
        .send({
          review_type: "peer",
          review_stage: "peer_review",
        reviewer_user_id: sportsManagerUserId,
        status: "failed",
        decision: "color_issue",
        sample_size_percent: 10,
        question_answers_json: qaAnswers("send_back", {
          files_complete_storage: false,
          color_density_consistency: false
          }),
          decision_reason: "Repeated color and file handling issues still need rework.",
          issue_category: "color_issue",
          rework_required: true,
          sent_back_to_user_id: photographerUserId
        });

      expect(failedReview.status).toBe(201);
    }

    const detail = await request(app)
      .get(`/api/jobs/${publish.job.id}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(detail.status).toBe(200);
    const item = detail.body.production_items.find((row: { id: string }) => row.id === itemId);
    expect(item.rework_count).toBeGreaterThanOrEqual(2);
    expect(item.health_state).toBe("AT_RISK");

    const exceptions = await request(app)
      .get("/api/jobs/production-items/exceptions")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .query({ department_type: "sports", limit: 250 });

    expect(exceptions.status).toBe(200);
    const exceptionItem = exceptions.body.items.find((row: { id: string }) => row.id === itemId);
    expect(exceptionItem).toBeTruthy();
    expect(exceptionItem.exception_types).toContain("rework_escalation");

    const urgentWatch = await request(app)
      .get("/api/jobs/production-items/urgent-watch")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .query({ department_type: "sports", limit: 250 });

    expect(urgentWatch.status).toBe(200);
  }, 20000);

  it("surfaces missing owners and reviewers in urgent watch and management views", async () => {
    const publish = await createPublishedSportsJob();
    const itemId = publish.production_items[0].id;

    const staged = await request(app)
      .patch(`/api/jobs/${publish.job.id}/production-items/${itemId}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        handoff_complete: true,
        file_count_expected: 20,
        file_count_received: 20,
        naming_verified: true,
        folder_structure_verified: true,
        tags_or_flags_verified: true,
        creator_review_complete: true,
        qa_required: true
      });

    expect(staged.status).toBe(200);

    const peerPassed = await request(app)
      .post(`/api/jobs/${publish.job.id}/production-items/${itemId}/qa-reviews`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        review_type: "peer",
        review_stage: "peer_review",
        reviewer_user_id: sportsManagerUserId,
        status: "passed",
        decision: "approve",
        sample_size_percent: 10,
        question_answers_json: qaAnswers("approve"),
        decision_reason: "Peer review cleared the upload path.",
        rework_required: false
      });

    expect(peerPassed.status).toBe(201);

    await dbPool.query(
      `
        UPDATE production_items
        SET assigned_to_user_id = NULL,
            assigned_peer_reviewer_user_id = NULL,
            assigned_release_reviewer_user_id = NULL,
            upload_status = 'VERIFIED'::production_board_upload_status_type,
            final_release_review_complete = false,
            updated_at = now()
        WHERE id = $1
      `,
      [itemId]
    );
    await reconcileProductionJob(publish.job.id);

    const detail = await request(app)
      .get(`/api/jobs/${publish.job.id}`)
      .set("Authorization", `Bearer ${leadershipToken}`);

    expect(detail.status).toBe(200);
    const detailItem = detail.body.production_items.find((row: { id: string }) => row.id === itemId);
    expect(detailItem).toBeTruthy();

    const exceptions = await request(app)
      .get("/api/jobs/production-items/exceptions")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .query({ department_type: "sports", limit: 250 });

    expect(exceptions.status).toBe(200);
    const exceptionItem = exceptions.body.items.find((row: { id: string }) => row.id === itemId);
    expect(exceptionItem).toBeTruthy();
    expect(exceptionItem.exception_types).toContain("missing_owner");
    expect(exceptionItem.exception_types).toContain("missing_peer_reviewer");
    expect(exceptionItem.exception_types).toContain("missing_release_reviewer");
  }, 20000);

  it("enforces group and split permissions while allowing authorized workflow managers", async () => {
    const publish = await createPublishedSportsJob();
    const jobId = publish.job.id;
    const primaryItemId = publish.production_items[0].id;

    await assignPhotographer(jobId);

    const secondItem = await request(app)
      .post(`/api/jobs/${jobId}/production-items`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        title: uniqueTitle("Grouped Production Item"),
        production_type: publish.production_items[0].production_type
      });

    expect(secondItem.status).toBe(201);
    expect(secondItem.body.production_items).toHaveLength(2);
    const secondItemId = secondItem.body.production_items.find((row: { id: string }) => row.id !== primaryItemId)?.id;
    expect(secondItemId).toBeTruthy();

    const deniedGroup = await request(app)
      .post(`/api/jobs/${jobId}/production-items/group`)
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        production_item_ids: [primaryItemId, secondItemId]
      });

    expect(deniedGroup.status).toBe(403);

    const grouped = await request(app)
      .post(`/api/jobs/${jobId}/production-items/group`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        production_item_ids: [primaryItemId, secondItemId]
      });

    expect(grouped.status).toBe(200);
    expect(grouped.body.production_items).toHaveLength(1);

    const deniedSplit = await request(app)
      .post(`/api/jobs/${jobId}/production-items/${primaryItemId}/split`)
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        branches: [
          {
            title: "Gallery Path",
            production_type: publish.production_items[0].production_type,
            due_at: plusDays(5),
            release_target: "gallery"
          },
          {
            title: "Vendor Path",
            production_type: "banner_batch",
            due_at: plusDays(6),
            release_target: "vendor_queue",
            vendor_name: "Acme Vendor"
          }
        ]
      });

    expect(deniedSplit.status).toBe(403);

    const split = await request(app)
      .post(`/api/jobs/${jobId}/production-items/${primaryItemId}/split`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({
        branches: [
          {
            title: "Gallery Path",
            production_type: publish.production_items[0].production_type,
            due_at: plusDays(5),
            release_target: "gallery"
          },
          {
            title: "Vendor Path",
            production_type: "banner_batch",
            due_at: plusDays(6),
            release_target: "vendor_queue",
            vendor_name: "Acme Vendor"
          }
        ]
      });

    expect(split.status).toBe(200);
    expect(split.body.production_items.length).toBeGreaterThanOrEqual(2);
  });
});
