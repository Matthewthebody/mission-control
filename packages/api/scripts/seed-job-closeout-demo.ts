import process from "node:process";
import { pathToFileURL } from "node:url";
import type { PoolClient, QueryResultRow } from "pg";
import { pool } from "../src/db/pool.js";

const DEMO_MARKER = "mission_control_demo_v1";
const DEMO_JOB_NUMBERS = ["JCO-DEMO-SMOOTH-001", "JCO-DEMO-DATA-002", "JCO-DEMO-MISSING-003"];
const DEMO_ORG_NAMES = ["East Metro Soccer Association", "White Bear Lake High School", "Rogers Youth Hockey"];

type DemoUsers = {
  leadership: string;
  photographer: string;
  associate: string;
};

export function assertJobCloseoutDemoSeedAllowed(argv = process.argv, env = process.env) {
  if (env.NODE_ENV === "production") {
    throw new Error("Job Closeout demo seed is disabled in production.");
  }
  if (!argv.includes("--allow-demo-data")) {
    throw new Error("Pass --allow-demo-data to confirm this development-only demo seed.");
  }
}

function normalizeName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

async function queryOne<T extends QueryResultRow>(client: PoolClient, sql: string, params: unknown[]) {
  const { rows } = await client.query<T>(sql, params);
  const row = rows[0];
  if (!row) {
    throw new Error("Expected seed query to return one row.");
  }
  return row;
}

async function getTenantAndUsers(client: PoolClient) {
  const tenant = await queryOne<{ id: string }>(
    client,
    "SELECT id::text FROM tenant WHERE name = 'Demo Studio' ORDER BY created_at ASC LIMIT 1",
    []
  );
  const users = await client.query<{ email: string; id: string }>(
    `
      SELECT lower(email) AS email, id::text
      FROM app_user
      WHERE tenant_id = $1
        AND lower(email) = ANY($2::text[])
    `,
    [tenant.id, ["leadership@example.com", "photo@example.com", "associate@example.com"]]
  );
  const byEmail = new Map(users.rows.map((row) => [row.email, row.id]));
  const fallback = users.rows[0]?.id;
  if (!fallback) {
    throw new Error("Expected seeded demo users before loading Job Closeout demo data.");
  }
  return {
    tenantId: tenant.id,
    users: {
      leadership: byEmail.get("leadership@example.com") ?? fallback,
      photographer: byEmail.get("photo@example.com") ?? fallback,
      associate: byEmail.get("associate@example.com") ?? fallback
    }
  };
}

async function resetDemoData(client: PoolClient, tenantId: string) {
  const jobIds = (
    await client.query<{ id: string }>(
      "SELECT id::text FROM jobs WHERE tenant_id = $1 AND job_number = ANY($2::text[])",
      [tenantId, DEMO_JOB_NUMBERS]
    )
  ).rows.map((row) => row.id);
  const evaluationIds = (
    await client.query<{ id: string }>(
      "SELECT id::text FROM post_shoot_evaluation WHERE tenant_id = $1 AND job_id = ANY($2::uuid[])",
      [tenantId, jobIds]
    )
  ).rows.map((row) => row.id);
  const organizationIds = (
    await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM organization
        WHERE tenant_id = $1
          AND normalized_canonical_name = ANY($2::text[])
          AND notes LIKE '%job closeout demo data%'
      `,
      [tenantId, DEMO_ORG_NAMES.map(normalizeName)]
    )
  ).rows.map((row) => row.id);
  const locationIds = (
    await client.query<{ id: string }>(
      "SELECT id::text FROM shoot_location WHERE tenant_id = $1 AND external_source = 'mission_control_demo_v1'",
      [tenantId]
    )
  ).rows.map((row) => row.id);
  const jobDayIds = (
    await client.query<{ id: string }>(
      "SELECT id::text FROM job_days WHERE tenant_id = $1 AND job_id = ANY($2::uuid[])",
      [tenantId, jobIds]
    )
  ).rows.map((row) => row.id);

  await client.query("DELETE FROM alert_events WHERE tenant_id = $1 AND watch_flag_id IN (SELECT id FROM job_watch_flags WHERE tenant_id = $1 AND job_id = ANY($2::uuid[]))", [
    tenantId,
    jobIds
  ]);
  await client.query("DELETE FROM job_watch_flags WHERE tenant_id = $1 AND job_id = ANY($2::uuid[])", [tenantId, jobIds]);
  await client.query("DELETE FROM job_closeout_mileage_review WHERE tenant_id = $1 AND job_id = ANY($2::uuid[])", [tenantId, jobIds]);
  await client.query("DELETE FROM operations_report_snapshot WHERE tenant_id = $1 AND filters->>'demo_seed' = $2", [tenantId, DEMO_MARKER]);
  await client.query("DELETE FROM post_shoot_late_staff_entry WHERE tenant_id = $1 AND evaluation_id = ANY($2::uuid[])", [tenantId, evaluationIds]);
  await client.query("DELETE FROM post_shoot_evaluation_attachment WHERE tenant_id = $1 AND job_id = ANY($2::uuid[])", [tenantId, jobIds]);
  await client.query("DELETE FROM post_shoot_evaluation WHERE tenant_id = $1 AND job_id = ANY($2::uuid[])", [tenantId, jobIds]);
  await client.query("DELETE FROM shoot_check_in_request WHERE tenant_id = $1 AND job_id = ANY($2::uuid[])", [tenantId, jobIds]);
  await client.query("DELETE FROM app_event WHERE tenant_id = $1 AND payload->>'demo_seed' = $2", [tenantId, DEMO_MARKER]);
  await client.query("DELETE FROM job_staff_assignments WHERE tenant_id = $1 AND job_id = ANY($2::uuid[])", [tenantId, jobIds]);
  await client.query("DELETE FROM job_days WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, jobDayIds]);
  await client.query("DELETE FROM jobs WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, jobIds]);
  await client.query("DELETE FROM shoot_location WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, locationIds]);
  await client.query("DELETE FROM organization WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, organizationIds]);
}

async function insertOrganization(client: PoolClient, tenantId: string, actorUserId: string, name: string) {
  const existing = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM organization
      WHERE tenant_id = $1
        AND normalized_canonical_name = $2
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [tenantId, normalizeName(name)]
  );
  if (existing.rows[0]) {
    return existing.rows[0];
  }
  return queryOne<{ id: string }>(
    client,
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
      VALUES ($1,$2,$3,$2,'schools_underclass_portraits',$4,$5,$5)
      RETURNING id::text
    `,
    [tenantId, name, normalizeName(name), `[${DEMO_MARKER}] job closeout demo data`, actorUserId]
  );
}

async function insertLocation(client: PoolClient, input: { tenantId: string; organizationId: string; actorUserId: string; key: string; name: string }) {
  return queryOne<{ id: string }>(
    client,
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
      VALUES ($1,'mission_control_demo_v1',$2,$3,$4,$5,'100 Demo School Road','100 demo school road',$6,$6)
      RETURNING id::text
    `,
    [input.tenantId, input.key, input.name, normalizeName(input.name), input.organizationId, input.actorUserId]
  );
}

async function insertJobFixture(
  client: PoolClient,
  input: {
    tenantId: string;
    users: DemoUsers;
    organizationName: string;
    locationName: string;
    jobNumber: string;
    title: string;
    daysAgo: number;
  }
) {
  const organization = await insertOrganization(client, input.tenantId, input.users.leadership, input.organizationName);
  const location = await insertLocation(client, {
    tenantId: input.tenantId,
    organizationId: organization.id,
    actorUserId: input.users.leadership,
    key: input.jobNumber.toLowerCase(),
    name: input.locationName
  });
  const start = new Date(Date.now() - input.daysAgo * 24 * 60 * 60 * 1000);
  start.setUTCHours(14, 0, 0, 0);
  const end = new Date(start.getTime() + 90 * 60 * 1000);
  const job = await queryOne<{ id: string }>(
    client,
    `
      INSERT INTO jobs (
        tenant_id,
        job_number,
        department_type,
        job_category,
        organization_id,
        primary_location_id,
        account_owner_user_id,
        title,
        event_name,
        description_internal,
        job_status,
        scheduled_start_at,
        scheduled_end_at,
        timezone,
        estimated_staff_count,
        production_required,
        created_by_user_id,
        updated_by_user_id,
        data_origin
      )
      VALUES ($1,$2,'schools','photo_day',$3,$4,$5,$6,$6,$7,'execution_complete',$8,$9,'America/Chicago',2,true,$5,$5,'seed_demo')
      RETURNING id::text
    `,
    [
      input.tenantId,
      input.jobNumber,
      organization.id,
      location.id,
      input.users.leadership,
      input.title,
      `[${DEMO_MARKER}] job closeout demo job`,
      start.toISOString(),
      end.toISOString()
    ]
  );
  const jobDay = await queryOne<{ id: string }>(
    client,
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
      VALUES ($1,$2,'Primary day',$3::date,'09:00','10:30','America/Chicago',$4,$5,'complete')
      RETURNING id::text
    `,
    [input.tenantId, job.id, start.toISOString().slice(0, 10), location.id, input.users.photographer]
  );
  await client.query(
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
    [input.tenantId, job.id, jobDay.id, input.users.photographer, input.users.associate]
  );
  return { jobId: job.id, jobDayId: jobDay.id, organizationId: organization.id, locationId: location.id, start };
}

async function insertEvaluation(
  client: PoolClient,
  input: {
    tenantId: string;
    jobId: string;
    locationId: string;
    userId: string;
    title: string;
    date: string;
    status: "smooth" | "few_bumps" | "rough";
    score: number;
    dataIssues: string[];
    mileageQualified: boolean;
    note: string;
  }
) {
  return queryOne<{ id: string }>(
    client,
    `
      INSERT INTO post_shoot_evaluation (
        tenant_id,
        location_id,
        job_id,
        evaluation_type,
        evaluation_version,
        submitter_role,
        shoot_name,
        shoot_date,
        photographer_user_id,
        photographer_name,
        shoot_type,
        on_time,
        easy_access,
        overall_rating,
        photos_uploaded,
        notes,
        recommendations,
        image_quality,
        submitted_by_user_id,
        source,
        raw_payload,
        v1_overall_status,
        v1_overall_score,
        schedule_status,
        staffing_status,
        all_photographers_on_time,
        image_confidence_score,
        technical_issue_status,
        retake_risk,
        client_sentiment,
        client_issue_flag,
        data_issue_types,
        data_issue_note,
        positive_shoutout_note,
        support_needed_note,
        next_year_improvement_note,
        mileage_qualified,
        mileage_note,
        submitted_at,
        updated_by_user_id
      )
      VALUES (
        $1,$2,$3,'post_shoot','v1','shoot_lead',$4,$5::date,$6,'Alex Photographer','school_photo_day','yes','yes',$7,'yes',$8,$9,'good',$6,'mission_control_demo',$10::jsonb,
        $11::job_closeout_overall_status_type,$12,'on_schedule','none',true,$13,'none','none','very_happy',$14,$15::job_closeout_data_issue_type[],$16,$17,$18,$19,$20,$21,now(),$6
      )
      RETURNING id::text
    `,
    [
      input.tenantId,
      input.locationId,
      input.jobId,
      input.title,
      input.date,
      input.userId,
      input.score,
      input.note,
      "Use the same entry plan next year.",
      JSON.stringify({ demo_seed: DEMO_MARKER }),
      input.status,
      input.score,
      input.score,
      input.dataIssues.length > 0,
      input.dataIssues,
      input.dataIssues.length ? "Roster QR codes needed manual correction for one group." : null,
      input.status === "smooth" ? "Team kept the line moving and finished early." : "Senior lead kept communication clear while data was corrected.",
      input.status === "rough" ? "CSR should confirm roster export before shoot morning." : "No extra support needed.",
      input.status === "rough" ? "Stage backup QR lookup before arrival." : "Repeat the same setup path.",
      input.mileageQualified,
      input.mileageQualified ? "Personal vehicle used for demo mileage example." : null
    ]
  );
}

async function insertWatchFlag(
  client: PoolClient,
  input: {
    tenantId: string;
    jobId: string;
    jobDayId?: string | null;
    ownerUserId: string;
    sourceType: string;
    sourceId: string;
    severity: "info" | "low" | "medium" | "high" | "critical";
    flagType: string;
    title: string;
    description: string;
    dueMinutes?: number;
  }
) {
  return queryOne<{ id: string }>(
    client,
    `
      INSERT INTO job_watch_flags (
        tenant_id,
        job_id,
        job_day_id,
        severity,
        flag_type,
        title,
        description,
        status,
        owner_user_id,
        due_at,
        auto_key,
        source_entity_type,
        source_entity_id,
        created_by_user_id
      )
      VALUES ($1,$2,$3,$4::job_watch_flag_severity_type,$5,$6,$7,'open',$8,now() + ($9::text || ' minutes')::interval,$10,$11,$12::uuid,$8)
      RETURNING id::text
    `,
    [
      input.tenantId,
      input.jobId,
      input.jobDayId ?? null,
      input.severity,
      input.flagType,
      input.title,
      input.description,
      input.ownerUserId,
      input.dueMinutes ?? 240,
      `demo:${DEMO_MARKER}:${input.flagType}:${input.sourceId}`,
      input.sourceType,
      input.sourceId
    ]
  );
}

async function insertMileageReview(
  client: PoolClient,
  input: {
    tenantId: string;
    jobId: string;
    organizationId: string;
    userId: string;
    evaluationId: string;
    status: "approved" | "needs_zone_review";
    note: string;
  }
) {
  await client.query(
    `
      INSERT INTO job_closeout_mileage_review (
        tenant_id,
        job_id,
        account_id,
        organization_id,
        user_id,
        evaluation_id,
        mileage_qualified,
        zone_name,
        calculated_amount,
        status,
        note
      )
      VALUES ($1,$2,$3,$3,$4,$5,true,$6,$7,$8::job_closeout_mileage_status_type,$9)
    `,
    [
      input.tenantId,
      input.jobId,
      input.organizationId,
      input.userId,
      input.evaluationId,
      input.status === "approved" ? "Metro Demo Zone" : null,
      input.status === "approved" ? 18.5 : null,
      input.status,
      input.note
    ]
  );
}

async function insertCheckIn(
  client: PoolClient,
  input: {
    tenantId: string;
    jobId: string;
    jobDayId: string;
    userId: string;
    createdByUserId: string;
    status: "missed" | "issue";
    issueNote?: string;
  }
) {
  return queryOne<{ id: string }>(
    client,
    `
      INSERT INTO shoot_check_in_request (
        tenant_id,
        job_id,
        job_day_id,
        requested_for_user_id,
        requested_at,
        due_at,
        responded_at,
        status,
        issue_note,
        created_by_user_id
      )
      VALUES (
        $1,$2,$3,$4,
        now() - interval '90 minutes',
        now() - interval '60 minutes',
        CASE WHEN $6::shoot_check_in_status_type = 'issue' THEN now() - interval '55 minutes' ELSE NULL END,
        $6::shoot_check_in_status_type,
        $7,
        $5
      )
      RETURNING id::text
    `,
    [input.tenantId, input.jobId, input.jobDayId, input.userId, input.createdByUserId, input.status, input.issueNote ?? null]
  );
}

async function insertReportSnapshots(client: PoolClient, tenantId: string, userId: string, evaluationIds: string[], flagIds: string[]) {
  const periodStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const periodEnd = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  for (const reportType of ["daily", "weekly"] as const) {
    await client.query(
      `
        INSERT INTO operations_report_snapshot (
          tenant_id,
          report_type,
          period_start,
          period_end,
          generated_by_user_id,
          generated_by,
          filters,
          summary_metrics,
          issue_summary,
          wins_summary,
          people_summary,
          account_summary,
          next_year_summary,
          source_evaluation_ids,
          source_flag_ids
        )
        VALUES ($1,$2::operations_report_type,$3,$4,$5,'mission_control_demo',$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::uuid[],$14::uuid[])
      `,
      [
        tenantId,
        reportType,
        periodStart,
        periodEnd,
        userId,
        JSON.stringify({ demo_seed: DEMO_MARKER }),
        JSON.stringify({
          jobs_completed: 2,
          smooth_count: 1,
          data_issue_count: 1,
          urgent_flag_count: flagIds.length,
          mileage_qualified_count: 2
        }),
        JSON.stringify({
          headline: "One clean closeout, one data-quality follow-up, and one missed check-in need review."
        }),
        JSON.stringify({ headline: "East Metro Soccer finished smoothly with a reusable setup note." }),
        JSON.stringify({ photographer_rollup: [{ name: "Alex Photographer", closeouts: 2, flags: 1 }] }),
        JSON.stringify({ accounts: ["East Metro Soccer Association", "White Bear Lake High School"] }),
        JSON.stringify({ notes: ["Confirm roster export the day before White Bear Lake picture day."] }),
        evaluationIds,
        flagIds
      ]
    );
  }
}

export async function seedJobCloseoutDemoData(argv = process.argv) {
  assertJobCloseoutDemoSeedAllowed(argv);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { tenantId, users } = await getTenantAndUsers(client);
    await resetDemoData(client, tenantId);

    const smooth = await insertJobFixture(client, {
      tenantId,
      users,
      organizationName: "East Metro Soccer Association",
      locationName: "East Metro Soccer Complex",
      jobNumber: "JCO-DEMO-SMOOTH-001",
      title: "East Metro Soccer Picture Day Closeout",
      daysAgo: 1
    });
    const dataIssue = await insertJobFixture(client, {
      tenantId,
      users,
      organizationName: "White Bear Lake High School",
      locationName: "White Bear Lake High School Main Gym",
      jobNumber: "JCO-DEMO-DATA-002",
      title: "White Bear Lake Data Issue Closeout",
      daysAgo: 2
    });
    const missing = await insertJobFixture(client, {
      tenantId,
      users,
      organizationName: "Rogers Youth Hockey",
      locationName: "Rogers Ice Arena",
      jobNumber: "JCO-DEMO-MISSING-003",
      title: "Rogers Youth Hockey Missing Closeout",
      daysAgo: 1
    });

    const smoothEvaluation = await insertEvaluation(client, {
      tenantId,
      jobId: smooth.jobId,
      locationId: smooth.locationId,
      userId: users.photographer,
      title: "East Metro Soccer Picture Day Closeout",
      date: smooth.start.toISOString().slice(0, 10),
      status: "smooth",
      score: 5,
      dataIssues: [],
      mileageQualified: true,
      note: "Smooth shoot. Field setup, coaches, and production handoff all stayed calm."
    });
    const dataIssueEvaluation = await insertEvaluation(client, {
      tenantId,
      jobId: dataIssue.jobId,
      locationId: dataIssue.locationId,
      userId: users.photographer,
      title: "White Bear Lake Data Issue Closeout",
      date: dataIssue.start.toISOString().slice(0, 10),
      status: "rough",
      score: 2,
      dataIssues: ["qr_sorting_issue", "schedule_or_roster_issue"],
      mileageQualified: true,
      note: "Roster QR mismatch slowed the first group and needs CSR follow-up."
    });

    await client.query(
      "INSERT INTO post_shoot_late_staff_entry (tenant_id, evaluation_id, job_id, user_id, display_name, minutes_late, reason) VALUES ($1,$2,$3,$4,'Taylor Demo',12,'Traffic near school entrance')",
      [tenantId, dataIssueEvaluation.id, dataIssue.jobId, users.associate]
    );

    await insertMileageReview(client, {
      tenantId,
      jobId: smooth.jobId,
      organizationId: smooth.organizationId,
      userId: users.photographer,
      evaluationId: smoothEvaluation.id,
      status: "approved",
      note: "Demo mileage-qualified example."
    });
    await insertMileageReview(client, {
      tenantId,
      jobId: dataIssue.jobId,
      organizationId: dataIssue.organizationId,
      userId: users.photographer,
      evaluationId: dataIssueEvaluation.id,
      status: "needs_zone_review",
      note: "Demo needs-zone-review example."
    });

    const issueCheckIn = await insertCheckIn(client, {
      tenantId,
      jobId: dataIssue.jobId,
      jobDayId: dataIssue.jobDayId,
      userId: users.photographer,
      createdByUserId: users.leadership,
      status: "issue",
      issueNote: "Need help confirming the roster export before the next group."
    });
    const missedCheckIn = await insertCheckIn(client, {
      tenantId,
      jobId: missing.jobId,
      jobDayId: missing.jobDayId,
      userId: users.photographer,
      createdByUserId: users.leadership,
      status: "missed"
    });

    const flags = [
      await insertWatchFlag(client, {
        tenantId,
        jobId: dataIssue.jobId,
        jobDayId: dataIssue.jobDayId,
        ownerUserId: users.leadership,
        sourceType: "post_shoot_evaluation",
        sourceId: dataIssueEvaluation.id,
        severity: "high",
        flagType: "job_closeout_data_issue",
        title: "Data / QR issue needs follow-up",
        description: "Roster QR mismatch was captured in closeout and should be reviewed before the next school job."
      }),
      await insertWatchFlag(client, {
        tenantId,
        jobId: missing.jobId,
        jobDayId: missing.jobDayId,
        ownerUserId: users.leadership,
        sourceType: "missing_evaluation",
        sourceId: missing.jobId,
        severity: "medium",
        flagType: "job_closeout_missing_evaluation",
        title: "Missing post-shoot closeout",
        description: "The job is complete but the lead closeout is still missing."
      }),
      await insertWatchFlag(client, {
        tenantId,
        jobId: missing.jobId,
        jobDayId: missing.jobDayId,
        ownerUserId: users.leadership,
        sourceType: "shoot_check_in",
        sourceId: missedCheckIn.id,
        severity: "medium",
        flagType: "job_closeout_check_in",
        title: "Missed shoot check-in",
        description: "The lead missed the requested check-in window."
      }),
      await insertWatchFlag(client, {
        tenantId,
        jobId: dataIssue.jobId,
        jobDayId: dataIssue.jobDayId,
        ownerUserId: users.leadership,
        sourceType: "shoot_check_in",
        sourceId: issueCheckIn.id,
        severity: "high",
        flagType: "job_closeout_check_in",
        title: "Issue check-in",
        description: "The lead reported a roster export issue during the shoot."
      })
    ];

    await insertReportSnapshots(client, tenantId, users.leadership, [smoothEvaluation.id, dataIssueEvaluation.id], flags.map((flag) => flag.id));

    await client.query("COMMIT");
    return {
      tenant_id: tenantId,
      job_numbers: DEMO_JOB_NUMBERS,
      evaluation_ids: [smoothEvaluation.id, dataIssueEvaluation.id],
      flag_ids: flags.map((flag) => flag.id),
      job_ids: [smooth.jobId, dataIssue.jobId, missing.jobId]
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedJobCloseoutDemoData()
    .then((summary) => {
      console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
      return pool.end();
    })
    .catch(async (error) => {
      console.error(error instanceof Error ? error.message : error);
      await pool.end();
      process.exit(1);
    });
}
