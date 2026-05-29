import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let app: Express;
let pool: Pool;
let leadershipToken = "";
let photographerToken = "";
let associateToken = "";
let tenantId = "";
let leadershipUserId = "";
let photographerUserId = "";
let associateUserId = "";
let testRun = "";

const createdJobIds: string[] = [];
const createdJobDayIds: string[] = [];
const createdOrganizationIds: string[] = [];
const createdLocationIds: string[] = [];
const createdEvaluationIds: string[] = [];
const createdReportIds: string[] = [];

async function login(email: string) {
  const response = await request(app).post("/auth/dev-login").send({ email });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.token as string;
}

async function loadUser(email: string) {
  const { rows } = await pool.query<{ id: string; tenant_id: string }>(
    `SELECT id::text, tenant_id::text FROM app_user WHERE lower(email) = lower($1) LIMIT 1`,
    [email]
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`Missing seeded user ${email}`);
  }
  return row;
}

async function createJobFixture(suffix: string, options: { scheduledStart?: string; leadUserId?: string; associateUserId?: string } = {}) {
  const organization = await pool.query<{ id: string }>(
    `
      INSERT INTO organization (
        tenant_id,
        canonical_name,
        normalized_canonical_name,
        display_name,
        account_type,
        notes,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,lower($2),$2,'schools_underclass_portraits',$3,$4,$4)
      RETURNING id::text
    `,
    [tenantId, `Closeout Test Account ${testRun} ${suffix}`, `job closeout v1 test ${testRun}`, leadershipUserId]
  );
  const organizationId = organization.rows[0].id;
  createdOrganizationIds.push(organizationId);

  const location = await pool.query<{ id: string }>(
    `
      INSERT INTO shoot_location (
        tenant_id,
        external_source,
        external_key,
        name,
        normalized_name,
        organization_id,
        address,
        normalized_address,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,'job_closeout_test',$2,$3,lower($3),$4,'123 Test Lane','123 test lane',$5,$5)
      RETURNING id::text
    `,
    [tenantId, `job-closeout-${testRun}-${suffix}`, `Closeout Test Location ${testRun} ${suffix}`, organizationId, leadershipUserId]
  );
  const locationId = location.rows[0].id;
  createdLocationIds.push(locationId);

  const start = options.scheduledStart ?? new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const end = new Date(new Date(start).getTime() + 90 * 60 * 1000).toISOString();
  const job = await pool.query<{ id: string }>(
    `
      INSERT INTO jobs (
        tenant_id,
        department_type,
        job_category,
        organization_id,
        primary_location_id,
        title,
        event_name,
        job_status,
        scheduled_start_at,
        scheduled_end_at,
        timezone,
        estimated_staff_count,
        production_required,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,'schools','photo_day',$2,$3,$4,$4,'execution_complete',$5,$6,'America/Chicago',2,true,$7,$7)
      RETURNING id::text
    `,
    [tenantId, organizationId, locationId, `Closeout Test Job ${testRun} ${suffix}`, start, end, leadershipUserId]
  );
  const jobId = job.rows[0].id;
  createdJobIds.push(jobId);

  const jobDay = await pool.query<{ id: string }>(
    `
      INSERT INTO job_days (
        tenant_id,
        job_id,
        day_label,
        date,
        start_time,
        end_time,
        timezone,
        location_id,
        lead_user_id,
        day_status
      )
      VALUES ($1,$2,'Primary day',$3::date,'08:00','09:30','America/Chicago',$4,$5,'complete')
      RETURNING id::text
    `,
    [tenantId, jobId, start.slice(0, 10), locationId, options.leadUserId ?? photographerUserId]
  );
  const jobDayId = jobDay.rows[0].id;
  createdJobDayIds.push(jobDayId);

  await pool.query(
    `
      INSERT INTO job_staff_assignments (
        tenant_id,
        job_id,
        job_day_id,
        user_id,
        assignment_role,
        assignment_status,
        is_lead,
        is_ready_present
      )
      VALUES
        ($1,$2,$3,$4,'shoot_lead','assigned',true,true),
        ($1,$2,$3,$5,'associate','assigned',false,true)
    `,
    [tenantId, jobId, jobDayId, options.leadUserId ?? photographerUserId, options.associateUserId ?? associateUserId]
  );

  return { jobId, jobDayId, organizationId, locationId, start };
}

beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  const { pool: dbPool } = await import("../src/db/pool.js");
  app = createApp();
  pool = dbPool;
  testRun = `${Date.now()}`;

  const leadership = await loadUser("leadership@example.com");
  const photographer = await loadUser("photo@example.com");
  const associate = await loadUser("associate@example.com");
  tenantId = leadership.tenant_id;
  leadershipUserId = leadership.id;
  photographerUserId = photographer.id;
  associateUserId = associate.id;

  leadershipToken = await login("leadership@example.com");
  photographerToken = await login("photo@example.com");
  associateToken = await login("associate@example.com");
});

afterAll(async () => {
  const evaluationRows = await pool.query<{ id: string }>(
    "SELECT id::text FROM post_shoot_evaluation WHERE job_id = ANY($1::uuid[])",
    [createdJobIds]
  );
  createdEvaluationIds.push(...evaluationRows.rows.map((row) => row.id));

  const reportRows = await pool.query<{ id: string }>(
    "SELECT id::text FROM operations_report_snapshot WHERE source_evaluation_ids && $1::uuid[]",
    [createdEvaluationIds]
  ).catch(() => ({ rows: [] as Array<{ id: string }> }));
  createdReportIds.push(...reportRows.rows.map((row) => row.id));

  if (createdReportIds.length) {
    await pool.query("DELETE FROM operations_report_snapshot WHERE id = ANY($1::uuid[])", [createdReportIds]);
  }
  await pool.query("DELETE FROM alert_events WHERE watch_flag_id IN (SELECT id FROM job_watch_flags WHERE job_id = ANY($1::uuid[]))", [createdJobIds]);
  await pool.query("DELETE FROM job_watch_flags WHERE job_id = ANY($1::uuid[])", [createdJobIds]);
  await pool.query("DELETE FROM job_closeout_mileage_review WHERE job_id = ANY($1::uuid[])", [createdJobIds]);
  await pool.query("DELETE FROM post_shoot_evaluation_attachment WHERE job_id = ANY($1::uuid[])", [createdJobIds]);
  await pool.query("DELETE FROM post_shoot_late_staff_entry WHERE job_id = ANY($1::uuid[])", [createdJobIds]);
  await pool.query("DELETE FROM post_shoot_evaluation WHERE job_id = ANY($1::uuid[])", [createdJobIds]);
  await pool.query("DELETE FROM shoot_check_in_request WHERE job_id = ANY($1::uuid[])", [createdJobIds]);
  await pool.query("DELETE FROM app_event WHERE aggregate_id = ANY($1::uuid[])", [[...createdJobIds, ...createdOrganizationIds, ...createdLocationIds]]);
  await pool.query("DELETE FROM job_staff_assignments WHERE job_id = ANY($1::uuid[])", [createdJobIds]);
  await pool.query("DELETE FROM job_days WHERE id = ANY($1::uuid[])", [createdJobDayIds]);
  await pool.query("DELETE FROM jobs WHERE id = ANY($1::uuid[])", [createdJobIds]);
  await pool.query("DELETE FROM shoot_location WHERE id = ANY($1::uuid[])", [createdLocationIds]);
  await pool.query("DELETE FROM organization WHERE id = ANY($1::uuid[])", [createdOrganizationIds]);
});

describe("Job Closeout / Evaluations / Reporting V1", () => {
  it("submits a senior closeout, creates structured flags, soft photo reminder, late entry, and mileage review", async () => {
    const fixture = await createJobFixture("senior");

    const response = await request(app)
      .post(`/api/job-closeout/jobs/${fixture.jobId}/evaluations`)
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        submitter_role: "shoot_lead",
        overall_status: "rough",
        overall_score: 2,
        schedule_status: "major_delays",
        schedule_note: "Buses arrived late and the first class was not ready.",
        staffing_status: "major",
        staffing_note: "Needed a second lead for the morning rush.",
        all_photographers_on_time: false,
        late_note: "One person arrived after setup.",
        image_confidence_score: 2,
        technical_issue_status: "major",
        technical_issue_note: "Main tether cable failed during first station.",
        retake_risk: "likely",
        client_sentiment: "frustrated",
        client_issue_flag: true,
        client_issue_note: "Office was frustrated about schedule slippage.",
        data_issue_types: ["qr_sorting_issue", "schedule_or_roster_issue"],
        data_issue_note: "QR sorting issue affected two classrooms.",
        positive_shoutout_note: "Alex kept the line moving.",
        support_needed_note: "Coach the team on morning station handoffs.",
        next_year_improvement_note: "Bring an extra scanner and stage QR cards at check-in.",
        mileage_qualified: true,
        mileage_note: "I drove my personal vehicle.",
        late_staff: [{ display_name: "Taylor Tester", minutes_late: 14, reason: "Traffic" }]
      });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.evaluation.overall_status).toBe("rough");
    expect(response.body.late_staff_entry_ids).toHaveLength(1);
    expect(response.body.mileage_review?.status).toMatch(/^(pending_review|needs_zone_review)$/);
    expect(response.body.flag_ids.length).toBeGreaterThanOrEqual(8);

    const workspace = await request(app)
      .get(`/api/job-closeout/jobs/${fixture.jobId}`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(workspace.status, JSON.stringify(workspace.body)).toBe(200);
    expect(workspace.body.latest_evaluation.next_year_improvement_note).toContain("extra scanner");
    expect(workspace.body.flags.map((flag: any) => flag.flag_type)).toEqual(
      expect.arrayContaining([
        "job_closeout_day_status",
        "job_closeout_image_quality",
        "job_closeout_data_issue",
        "job_closeout_lateness",
        "job_closeout_setup_photo"
      ])
    );
    expect(workspace.body.pre_shoot_brief.prior_next_year_notes).toEqual(expect.any(Array));
  });

  it("supports lightweight associate closeout and protects mileage review from associate access", async () => {
    const fixture = await createJobFixture("associate");

    const response = await request(app)
      .post(`/api/job-closeout/jobs/${fixture.jobId}/evaluations`)
      .set("Authorization", `Bearer ${associateToken}`)
      .send({
        submitter_role: "associate",
        overall_status: "few_bumps",
        image_confidence_score: 4,
        data_issue_types: ["missing_subjects"],
        data_issue_note: "A few subjects were not on the roster.",
        mileage_qualified: false,
        mileage_disqualification_reason: "carpool",
        general_note: "Line moved well once roster was corrected."
      });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.evaluation.submitter_role).toBe("associate");

    const denied = await request(app)
      .get("/api/job-closeout/mileage-review")
      .set("Authorization", `Bearer ${associateToken}`);
    expect(denied.status).toBe(403);
  });

  it("creates issue and missed check-in flags without duplicating active missed alerts", async () => {
    const fixture = await createJobFixture("check-in", {
      scheduledStart: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    });

    const created = await request(app)
      .post(`/api/job-closeout/jobs/${fixture.jobId}/check-ins`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.check_ins.length).toBeGreaterThan(0);

    const issueResponse = await request(app)
      .post(`/api/job-closeout/jobs/${fixture.jobId}/check-ins/${created.body.check_ins[0].id}/respond`)
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({ status: "issue", issue_note: "We need help with a locked gym door." });
    expect(issueResponse.status, JSON.stringify(issueResponse.body)).toBe(200);
    const issueFlag = await pool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM job_watch_flags
        WHERE job_id = $1
          AND flag_type = 'job_closeout_check_in'
          AND source_entity_type = 'shoot_check_in'
      `,
      [fixture.jobId]
    );
    expect(Number(issueFlag.rows[0].count)).toBe(1);

    const missedFixture = await createJobFixture("missed", {
      scheduledStart: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    });
    await pool.query(
      `
        INSERT INTO shoot_check_in_request (
          tenant_id,
          job_id,
          job_day_id,
          requested_for_user_id,
          requested_at,
          due_at,
          status,
          created_by_user_id
        )
        VALUES ($1,$2,$3,$4,now() - interval '90 minutes',now() - interval '60 minutes','pending',$5)
      `,
      [tenantId, missedFixture.jobId, missedFixture.jobDayId, photographerUserId, leadershipUserId]
    );

    const firstSweep = await request(app)
      .post("/api/job-closeout/check-ins/sweep")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});
    expect(firstSweep.status, JSON.stringify(firstSweep.body)).toBe(200);
    expect(firstSweep.body.missed_count).toBeGreaterThanOrEqual(1);

    const secondSweep = await request(app)
      .post("/api/job-closeout/check-ins/sweep")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});
    expect(secondSweep.status, JSON.stringify(secondSweep.body)).toBe(200);

    const duplicateCount = await pool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM job_watch_flags
        WHERE job_id = $1
          AND flag_type = 'job_closeout_check_in'
          AND status <> 'resolved'
      `,
      [missedFixture.jobId]
    );
    expect(Number(duplicateCount.rows[0].count)).toBe(1);
  });

  it("persists daily and weekly report snapshots with source evaluation and flag ids", async () => {
    const fixture = await createJobFixture("reports");
    const evalResponse = await request(app)
      .post(`/api/job-closeout/jobs/${fixture.jobId}/evaluations`)
      .set("Authorization", `Bearer ${photographerToken}`)
      .send({
        submitter_role: "shoot_lead",
        overall_status: "smooth",
        overall_score: 5,
        schedule_status: "on_schedule",
        staffing_status: "none",
        all_photographers_on_time: true,
        image_confidence_score: 5,
        technical_issue_status: "none",
        retake_risk: "none",
        client_sentiment: "very_happy",
        data_issue_types: [],
        positive_shoutout_note: "The team crushed the morning rush.",
        next_year_improvement_note: "Use the same gym entrance next year.",
        mileage_qualified: true,
        attachments: [
          {
            attachment_type: "setup",
            file_url: "https://example.com/setup.jpg",
            filename: "setup.jpg",
            mime_type: "image/jpeg",
            size_bytes: 1000
          }
        ]
      });
    expect(evalResponse.status, JSON.stringify(evalResponse.body)).toBe(201);

    const periodStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const periodEnd = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const daily = await request(app)
      .post(`/api/job-closeout/reports/daily/generate?period_start=${encodeURIComponent(periodStart)}&period_end=${encodeURIComponent(periodEnd)}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});
    expect(daily.status, JSON.stringify(daily.body)).toBe(201);
    expect(daily.body.snapshot.summary_metrics.evaluations_submitted).toBeGreaterThanOrEqual(1);
    expect(daily.body.snapshot.source_evaluation_ids).toContain(evalResponse.body.evaluation.id);
    expect(daily.body.snapshot.source_flag_ids.length).toBeGreaterThanOrEqual(1);
    createdReportIds.push(daily.body.snapshot.id);

    const weekly = await request(app)
      .post(`/api/job-closeout/reports/weekly/generate?period_start=${encodeURIComponent(periodStart)}&period_end=${encodeURIComponent(periodEnd)}`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});
    expect(weekly.status, JSON.stringify(weekly.body)).toBe(201);
    expect(weekly.body.snapshot.report_type).toBe("weekly");
    expect(weekly.body.snapshot.people_summary.photographer_rollup).toEqual(expect.any(Array));
    createdReportIds.push(weekly.body.snapshot.id);

    const listed = await request(app)
      .get("/api/job-closeout/reports/daily")
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    expect(listed.body.snapshots.some((snapshot: any) => snapshot.id === daily.body.snapshot.id)).toBe(true);
  });
});
