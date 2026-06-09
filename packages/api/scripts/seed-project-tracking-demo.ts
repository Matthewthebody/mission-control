import process from "node:process";
import { pathToFileURL } from "node:url";
import type { PoolClient, QueryResultRow } from "pg";
import { pool } from "../src/db/pool.js";

const DEMO_MARKER = "project_tracking_foundation";

type DemoScenario = "school_setup" | "sports_setup" | "on_track" | "overdue" | "blocked" | "due_soon" | "completed";

const DEMO_TEMPLATE_DEFINITIONS = [
  {
    templateKey: "mission_control_demo_school_portraits_v1",
    name: "School Portraits Workflow Template",
    description: "Demo template for underclass picture day intake, capture, production, QA, release, and wrap-up.",
    jobType: "school_portraits",
    category: "schools"
  },
  {
    templateKey: "mission_control_demo_sports_picture_day_v1",
    name: "Sports Picture Day Workflow Template",
    description: "Demo template for sports roster confirmation, field capture, graphics production, QA, release, and wrap-up.",
    jobType: "sports_picture_day",
    category: "sports"
  },
  {
    templateKey: "mission_control_demo_graduation_v1",
    name: "Graduation Workflow Template",
    description: "Demo template for ceremony scope, photography, production, QA, gallery release, and final follow-up.",
    jobType: "graduation",
    category: "schools"
  },
  {
    templateKey: "mission_control_demo_spencer_soft_v1",
    name: "Spencer Soft Workflow",
    description: "Demo recipe showing setup, picture day, production intake, image processing, review, delivery, and closeout.",
    jobType: "school_portraits",
    category: "production"
  }
] as const;

const DEMO_TEMPLATE_KEYS = DEMO_TEMPLATE_DEFINITIONS.map((template) => template.templateKey);
const DEMO_JOB_NUMBERS = [
  "PT-DEMO-TRACK-001",
  "PT-DEMO-OVERDUE-002",
  "PT-DEMO-BLOCK-003",
  "PT-DEMO-DUE-004",
  "PT-DEMO-CLOSE-005"
];
const DEMO_ORG_NAMES = ["White Bear Lake High School", "Rogers Youth Hockey", "Maple Grove Senior High", "Lakeview Elementary"];
const STALE_TEST_TEMPLATE_KEY_PATTERNS = [
  "project_tracking_foundation_%",
  "project_tracking_versioning_%",
  "project_tracking_transition_%",
  "project_tracking_sendback_%",
  "project_tracking_permissions_%",
  "project_tracking_command_center_%",
  "project_tracking_sla_alerts_%"
];
const STALE_TEST_JOB_TITLE_PATTERNS = [
  "Project Tracking Foundation %",
  "Project Tracking Version %",
  "Project Tracking Transition %",
  "Project Tracking Send Back %",
  "Project Tracking Permissions %",
  "Project Tracking Command Center %",
  "Project Tracking SLA Alerts %",
  "Shared Schools Job %",
  "Schools Validation %",
  "Sports Validation %",
  "Schools Publish %",
  "Prep Preview %",
  "Prep Blocked %",
  "Prep Ready %",
  "Prep Queue Ready %",
  "Prep Queue Needs Review %",
  "Prep Queue Blocked %",
  "Sports Publish %",
  "Diagnostics Sports Job %",
  "Production Reporting Sports Job %",
  "Production Board Sports Job %",
  "Checklist Engine Job %",
  "Graphics Workflow %",
  "Schools Claim %",
  "Schools Workflow %",
  "Task Host Job %",
  "Workflow-linked Task Host %",
  "Lifecycle Job %",
  "Command Layer Job %"
];

type DemoUserIds = {
  leadership: string;
  photo: string;
  production: string;
};

function logSeedStep(step: string) {
  console.log(`[project-tracking-demo] ${step}`);
}

function uniqueIds(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

type TemplateStep = {
  milestone_key: string;
  step_key: string;
  name: string;
  description: string;
  department: "photography" | "production" | "schools" | "sports";
  role_key: string;
  owner_type: "department" | "role" | "user" | "account_owner" | "job_owner" | "qa_reviewer" | "production_lead";
  owner_value: string;
  expected_duration_minutes: number;
  depends_on_step_keys: string[];
  sort_order: number;
};

const TEMPLATE_MILESTONES = [
  ["intake", "Intake", "Confirm scope, schedule, roster/data, and the owner path before the job starts.", 10],
  ["photography", "Photography", "Capture the job and complete field handoff.", 20],
  ["production", "Production", "Download, verify, edit, and prepare files for QA.", 30],
  ["qa", "QA", "Review quality and send back anything that needs correction.", 40],
  ["release", "Release", "Release the gallery or deliverables after final checks.", 50],
  ["wrap_up", "Wrap-up", "Confirm follow-up, close the job, and preserve next-year notes.", 60]
] as const;

const TEMPLATE_STEPS: TemplateStep[] = [
  {
    milestone_key: "intake",
    step_key: "confirm_scope",
    name: "Confirm scope",
    description: "Confirm job type, account expectations, schedule, and owner path.",
    department: "schools",
    role_key: "CSR",
    owner_type: "account_owner",
    owner_value: "account_owner",
    expected_duration_minutes: 120,
    depends_on_step_keys: [],
    sort_order: 10
  },
  {
    milestone_key: "intake",
    step_key: "confirm_schedule",
    name: "Confirm schedule",
    description: "Confirm arrival, start, staffing, and account contact timing.",
    department: "schools",
    role_key: "Scheduler",
    owner_type: "role",
    owner_value: "scheduler",
    expected_duration_minutes: 90,
    depends_on_step_keys: ["confirm_scope"],
    sort_order: 20
  },
  {
    milestone_key: "intake",
    step_key: "prep_data_admin",
    name: "Prep data and admin",
    description: "Confirm roster, ID/admin needs, due date, and school communication notes before picture day.",
    department: "schools",
    role_key: "CSR",
    owner_type: "account_owner",
    owner_value: "account_owner",
    expected_duration_minutes: 120,
    depends_on_step_keys: ["confirm_schedule"],
    sort_order: 25
  },
  {
    milestone_key: "photography",
    step_key: "photograph_job",
    name: "Photograph job",
    description: "Capture the job and keep the lead informed of field exceptions.",
    department: "photography",
    role_key: "Senior Photographer",
    owner_type: "role",
    owner_value: "senior_photographer",
    expected_duration_minutes: 240,
    depends_on_step_keys: ["prep_data_admin"],
    sort_order: 30
  },
  {
    milestone_key: "photography",
    step_key: "send_to_production",
    name: "Send to Production",
    description: "Confirm files, data, due date, and notes before handing this job to Production.",
    department: "schools",
    role_key: "CSR",
    owner_type: "account_owner",
    owner_value: "account_owner",
    expected_duration_minutes: 45,
    depends_on_step_keys: ["photograph_job"],
    sort_order: 35
  },
  {
    milestone_key: "production",
    step_key: "count_images",
    name: "Count Images",
    description: "Count images against expected volume before production work starts.",
    department: "production",
    role_key: "Production Lead",
    owner_type: "production_lead",
    owner_value: "production_lead",
    expected_duration_minutes: 60,
    depends_on_step_keys: ["send_to_production"],
    sort_order: 38
  },
  {
    milestone_key: "production",
    step_key: "download_verify_images",
    name: "Download and verify images",
    description: "Ingest cards, confirm expected counts, and catch missing files early.",
    department: "production",
    role_key: "Production Lead",
    owner_type: "production_lead",
    owner_value: "production_lead",
    expected_duration_minutes: 120,
    depends_on_step_keys: ["count_images"],
    sort_order: 40
  },
  {
    milestone_key: "production",
    step_key: "edit_cull",
    name: "Edit and cull",
    description: "Prepare the image set for QA review.",
    department: "production",
    role_key: "Graphic Artist",
    owner_type: "role",
    owner_value: "graphic_artist",
    expected_duration_minutes: 180,
    depends_on_step_keys: ["download_verify_images"],
    sort_order: 50
  },
  {
    milestone_key: "qa",
    step_key: "qa_review",
    name: "QA review",
    description: "Review quality, sorting, and release readiness before the gallery goes live.",
    department: "production",
    role_key: "QA Reviewer",
    owner_type: "qa_reviewer",
    owner_value: "qa_reviewer",
    expected_duration_minutes: 90,
    depends_on_step_keys: ["edit_cull"],
    sort_order: 60
  },
  {
    milestone_key: "qa",
    step_key: "return_to_schools",
    name: "Return to Schools",
    description: "Return completed production work or issue notes back to Schools for communication and admin follow-through.",
    department: "production",
    role_key: "Production Lead",
    owner_type: "production_lead",
    owner_value: "production_lead",
    expected_duration_minutes: 30,
    depends_on_step_keys: ["qa_review"],
    sort_order: 65
  },
  {
    milestone_key: "release",
    step_key: "release_gallery",
    name: "Release gallery",
    description: "Release the finished gallery or deliverables to the account.",
    department: "schools",
    role_key: "CSR",
    owner_type: "account_owner",
    owner_value: "account_owner",
    expected_duration_minutes: 60,
    depends_on_step_keys: ["return_to_schools"],
    sort_order: 70
  },
  {
    milestone_key: "release",
    step_key: "family_communication",
    name: "Family communication complete",
    description: "Confirm the gallery is sent to families and the main school contact has been notified.",
    department: "schools",
    role_key: "CSR",
    owner_type: "account_owner",
    owner_value: "account_owner",
    expected_duration_minutes: 45,
    depends_on_step_keys: ["release_gallery"],
    sort_order: 75
  },
  {
    milestone_key: "wrap_up",
    step_key: "id_admin_item",
    name: "ID/admin item complete",
    description: "Confirm ID cards, admin exports, or related school admin work are complete when required.",
    department: "schools",
    role_key: "CSR",
    owner_type: "account_owner",
    owner_value: "account_owner",
    expected_duration_minutes: 45,
    depends_on_step_keys: ["family_communication"],
    sort_order: 78
  },
  {
    milestone_key: "wrap_up",
    step_key: "close_job",
    name: "Close job",
    description: "Send follow-up, capture next-year notes, and close the workflow.",
    department: "schools",
    role_key: "Account Owner",
    owner_type: "account_owner",
    owner_value: "account_owner",
    expected_duration_minutes: 60,
    depends_on_step_keys: ["id_admin_item"],
    sort_order: 80
  }
];

const DEMO_WORKFLOWS: Array<{
  scenario: DemoScenario;
  jobNumber: string;
  organizationName: string;
  templateKey: (typeof DEMO_TEMPLATE_KEYS)[number];
  title: string;
  startsInDays: number;
}> = [
  {
    scenario: "school_setup",
    jobNumber: "PT-DEMO-TRACK-001",
    organizationName: "White Bear Lake High School",
    templateKey: "mission_control_demo_school_portraits_v1",
    title: "White Bear Lake Underclass Picture Day Setup",
    startsInDays: 5
  },
  {
    scenario: "sports_setup",
    jobNumber: "PT-DEMO-OVERDUE-002",
    organizationName: "Rogers Youth Hockey",
    templateKey: "mission_control_demo_sports_picture_day_v1",
    title: "Rogers Youth Hockey Team Picture Day Setup",
    startsInDays: 2
  },
  {
    scenario: "blocked",
    jobNumber: "PT-DEMO-BLOCK-003",
    organizationName: "Maple Grove Senior High",
    templateKey: "mission_control_demo_graduation_v1",
    title: "Maple Grove Graduation Ceremony Photography",
    startsInDays: 8
  },
  {
    scenario: "due_soon",
    jobNumber: "PT-DEMO-DUE-004",
    organizationName: "Lakeview Elementary",
    templateKey: "mission_control_demo_school_portraits_v1",
    title: "Lakeview Elementary Retake Day",
    startsInDays: 1
  },
  {
    scenario: "completed",
    jobNumber: "PT-DEMO-CLOSE-005",
    organizationName: "White Bear Lake High School",
    templateKey: "mission_control_demo_school_portraits_v1",
    title: "White Bear Lake ID and Family Communication Closeout",
    startsInDays: -4
  }
];

function templateStepsForDefinition(definition: (typeof DEMO_TEMPLATE_DEFINITIONS)[number]) {
  if (definition.category !== "sports") {
    return TEMPLATE_STEPS;
  }
  return TEMPLATE_STEPS.map((step) =>
    step.department === "schools"
      ? {
          ...step,
          department: "sports" as const,
          role_key: step.role_key === "Scheduler" ? "Sports Coordinator" : "Sports Lead",
          owner_type: step.owner_type === "account_owner" ? ("role" as const) : step.owner_type,
          owner_value: step.owner_type === "account_owner" ? "sports_lead" : step.owner_value
        }
      : step
  );
}

function templateStepsForTemplateKey(templateKey: (typeof DEMO_TEMPLATE_KEYS)[number]) {
  const definition = DEMO_TEMPLATE_DEFINITIONS.find((candidate) => candidate.templateKey === templateKey);
  return definition ? templateStepsForDefinition(definition) : TEMPLATE_STEPS;
}

export function assertProjectTrackingDemoSeedAllowed(argv = process.argv, env = process.env) {
  if (env.NODE_ENV === "production") {
    throw new Error("Project tracking demo seed is disabled in production.");
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

async function getDemoUsers(client: PoolClient, tenantId: string): Promise<DemoUserIds> {
  const { rows } = await client.query<{ email: string; id: string }>(
    `
      SELECT lower(email) AS email, id::text
      FROM app_user
      WHERE tenant_id = $1
        AND lower(email) = ANY($2::text[])
    `,
    [tenantId, ["leadership@example.com", "photo@example.com", "graphic.artist@example.com", "graphic@example.com"]]
  );
  const byEmail = new Map(rows.map((row) => [row.email, row.id]));
  return {
    leadership: byEmail.get("leadership@example.com") ?? rows[0]?.id,
    photo: byEmail.get("photo@example.com") ?? rows[0]?.id,
    production: byEmail.get("graphic.artist@example.com") ?? byEmail.get("graphic@example.com") ?? byEmail.get("leadership@example.com") ?? rows[0]?.id
  };
}

async function resetDemoData(client: PoolClient, tenantId: string) {
  const demoJobIds = (
    await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM jobs
        WHERE tenant_id = $1
          AND job_number LIKE 'PT-DEMO-%'
      `,
      [tenantId]
    )
  ).rows.map((row) => row.id);
  const staleTestJobIds = (
    await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM jobs
        WHERE tenant_id = $1
          AND title LIKE ANY($2::text[])
      `,
      [tenantId, STALE_TEST_JOB_TITLE_PATTERNS]
    )
  ).rows.map((row) => row.id);
  const jobIdsToDelete = uniqueIds([...demoJobIds, ...staleTestJobIds]);
  const staleTestTemplateIds = (
    await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM workflow_template
        WHERE tenant_id = $1
          AND (
            name = 'Project Tracking Smoke Template'
            OR template_key LIKE ANY($2::text[])
          )
      `,
      [tenantId, STALE_TEST_TEMPLATE_KEY_PATTERNS]
    )
  ).rows.map((row) => row.id);
  const templateIdsToDelete = (
    await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM workflow_template
        WHERE tenant_id = $1
          AND (
            template_key = ANY($2::text[])
            OR id = ANY($3::uuid[])
          )
      `,
      [tenantId, DEMO_TEMPLATE_KEYS, staleTestTemplateIds]
    )
  ).rows.map((row) => row.id);
  const templateVersionIdsToDelete = (
    await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM workflow_template_version
        WHERE tenant_id = $1
          AND template_id = ANY($2::uuid[])
      `,
      [tenantId, templateIdsToDelete]
    )
  ).rows.map((row) => row.id);
  const demoRunIds = (
    await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM workflow_run
        WHERE tenant_id = $1
          AND (
            metadata->>'demo_seed' = $2
            OR job_id = ANY($3::uuid[])
            OR template_id = ANY($4::uuid[])
          )
      `,
      [tenantId, DEMO_MARKER, jobIdsToDelete, templateIdsToDelete]
    )
  ).rows.map((row) => row.id);
  const runIdsToDelete = uniqueIds(demoRunIds);
  const stalePrepQueueLocationIds = (
    await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM shoot_location
        WHERE tenant_id = $1
          AND external_source IN ('job_truth_prep_readiness_test', 'job_truth_prep_queue_test')
      `,
      [tenantId]
    )
  ).rows.map((row) => row.id);

  await client.query(
    `
      DELETE FROM app_event
      WHERE tenant_id = $1
        AND (
          dedupe_key LIKE 'project-tracking-demo:%'
          OR payload->>'demo_seed' = $2
          OR aggregate_id = ANY($3::uuid[])
        )
    `,
    [tenantId, DEMO_MARKER, runIdsToDelete]
  );
  await client.query(
    "DELETE FROM work_task WHERE tenant_id = $1 AND (task_number LIKE 'PT-DEMO-TASK-%' OR related_job_id = ANY($2::uuid[]))",
    [tenantId, jobIdsToDelete]
  );
  await client.query("DELETE FROM workflow_handoff WHERE tenant_id = $1 AND workflow_run_id = ANY($2::uuid[])", [tenantId, runIdsToDelete]);
  await client.query("DELETE FROM workflow_step_audit_log WHERE tenant_id = $1 AND workflow_run_id = ANY($2::uuid[])", [tenantId, runIdsToDelete]);
  await client.query("DELETE FROM workflow_step_dependency WHERE tenant_id = $1 AND workflow_run_id = ANY($2::uuid[])", [tenantId, runIdsToDelete]);
  await client.query("DELETE FROM workflow_step WHERE tenant_id = $1 AND workflow_run_id = ANY($2::uuid[])", [tenantId, runIdsToDelete]);
  await client.query("DELETE FROM workflow_run_milestone WHERE tenant_id = $1 AND workflow_run_id = ANY($2::uuid[])", [tenantId, runIdsToDelete]);
  await client.query("DELETE FROM workflow_run WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, runIdsToDelete]);
  await client.query("DELETE FROM workflow_template_step_dependency WHERE tenant_id = $1 AND template_version_id = ANY($2::uuid[])", [tenantId, templateVersionIdsToDelete]);
  await client.query("DELETE FROM workflow_template_step WHERE tenant_id = $1 AND template_version_id = ANY($2::uuid[])", [tenantId, templateVersionIdsToDelete]);
  await client.query("DELETE FROM workflow_template_milestone WHERE tenant_id = $1 AND template_version_id = ANY($2::uuid[])", [tenantId, templateVersionIdsToDelete]);
  await client.query("DELETE FROM workflow_template_version WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, templateVersionIdsToDelete]);
  await client.query("DELETE FROM workflow_template WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, templateIdsToDelete]);
  await client.query("DELETE FROM jobs WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, jobIdsToDelete]);
  await client.query(
    `
      UPDATE shoot
      SET deleted_at = COALESCE(deleted_at, now())
      WHERE tenant_id = $1
        AND location_id = ANY($2::uuid[])
    `,
    [tenantId, stalePrepQueueLocationIds]
  );
  await client.query(
    `
      DELETE FROM shoot_location
      WHERE tenant_id = $1
        AND id = ANY($2::uuid[])
        AND NOT EXISTS (
          SELECT 1
          FROM shoot
          WHERE shoot.tenant_id = shoot_location.tenant_id
            AND shoot.location_id = shoot_location.id
            AND shoot.deleted_at IS NULL
        )
    `,
    [tenantId, stalePrepQueueLocationIds]
  );
  await client.query(
    `
      DELETE FROM organization
      WHERE tenant_id = $1
        AND client_demo_key IS NULL
        AND notes LIKE '%project tracking demo data%'
    `,
    [tenantId]
  );
}

async function upsertOrganization(client: PoolClient, tenantId: string, actorUserId: string, name: string) {
  const normalized = normalizeName(name);
  const existing = await client.query<{ id: string; client_demo_key: string | null }>(
    `
      SELECT id::text, client_demo_key
      FROM organization
      WHERE tenant_id = $1
        AND normalized_canonical_name = $2
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [tenantId, normalized]
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
      VALUES ($1,$2,$3,$2,'schools_underclass_portraits'::organization_account_type,$4,$5,$5)
      RETURNING id::text
    `,
    [tenantId, name, normalized, `[${DEMO_MARKER}] project tracking demo data`, actorUserId]
  );
}

async function insertDemoJob(
  client: PoolClient,
  input: { tenantId: string; actorUserId: string; organizationId: string; jobNumber: string; title: string; startsInDays: number }
) {
  return queryOne<{ id: string }>(
    client,
    `
      INSERT INTO jobs (
        tenant_id,
        job_number,
        department_type,
        job_category,
        organization_id,
        account_owner_user_id,
        title,
        event_name,
        description_internal,
        job_status,
        readiness_status,
        scheduled_start_at,
        scheduled_end_at,
        timezone,
        production_required,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES (
        $1,
        $2,
        'schools'::job_department_type,
        'photo_day'::job_category_type,
        $3,
        $4,
        $5,
        $5,
        $6,
        'confirmed'::job_status_type,
        'on_track'::job_readiness_status_type,
        now() + ($7::text || ' days')::interval,
        now() + ($7::text || ' days')::interval + interval '4 hours',
        'America/Chicago',
        true,
        $4,
        $4
      )
      RETURNING id::text
    `,
    [input.tenantId, input.jobNumber, input.organizationId, input.actorUserId, input.title, `[${DEMO_MARKER}] demo job`, input.startsInDays]
  );
}

async function createDemoTemplate(
  client: PoolClient,
  tenantId: string,
  actorUserId: string,
  definition: (typeof DEMO_TEMPLATE_DEFINITIONS)[number]
) {
  const templateSteps = templateStepsForDefinition(definition);
  const departmentsInvolved = Array.from(new Set(templateSteps.map((step) => step.department)));
  const template = await queryOne<{ id: string }>(
    client,
    `
      INSERT INTO workflow_template (
        tenant_id,
        template_key,
        name,
        description,
        workflow_family,
        job_type,
        category,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1, $2, $3, $4, 'project_tracking'::shared_workflow_family_type, $5, $6, $7, $7)
      RETURNING id::text
    `,
    [tenantId, definition.templateKey, definition.name, definition.description, definition.jobType, definition.category, actorUserId]
  );
  const version = await queryOne<{ id: string }>(
    client,
    `
      INSERT INTO workflow_template_version (
        tenant_id,
        template_id,
        version_number,
        status,
        default_for_new_jobs,
        owner_defaults_json,
        departments_involved,
        published_at,
        published_by_user_id
      )
      VALUES (
        $1,
        $2,
        1,
        'active'::shared_workflow_template_version_status_type,
        true,
        $3::jsonb,
        $5::work_department_type[],
        now(),
        $4
      )
      RETURNING id::text
    `,
    [tenantId, template.id, JSON.stringify({ demo_seed: DEMO_MARKER }), actorUserId, departmentsInvolved]
  );
  const milestoneIds = new Map<string, string>();
  for (const milestone of TEMPLATE_MILESTONES) {
    const row = await queryOne<{ id: string }>(
      client,
      `
        INSERT INTO workflow_template_milestone (
          tenant_id,
          template_version_id,
          milestone_key,
          name,
          description,
          sort_order,
          default_owner_type,
          default_owner_value
        )
        VALUES ($1,$2,$3,$4,$5,$6,'account_owner',$7)
        RETURNING id::text
      `,
      [tenantId, version.id, milestone[0], milestone[1], milestone[2], milestone[3], "account_owner"]
    );
    milestoneIds.set(milestone[0], row.id);
  }
  for (const step of templateSteps) {
    await client.query(
      `
        INSERT INTO workflow_template_step (
          tenant_id,
          template_version_id,
          template_milestone_id,
          step_key,
          name,
          description,
          department,
          role_key,
          owner_type,
          owner_value,
          required,
          skippable,
          blocking,
          expected_duration_minutes,
          due_offset_minutes,
          dependency_mode,
          sort_order
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7::work_department_type,$8,$9,$10,true,$11,true,$12,0,'waits_for_prior_step',$13)
      `,
      [
        tenantId,
        version.id,
        milestoneIds.get(step.milestone_key),
        step.step_key,
        step.name,
        step.description,
        step.department,
        step.role_key,
        step.owner_type,
        step.owner_value,
        step.step_key === "close_job",
        step.expected_duration_minutes,
        step.sort_order
      ]
    );
  }
  for (const step of templateSteps) {
    for (const dependency of step.depends_on_step_keys) {
      await client.query(
        `
          INSERT INTO workflow_template_step_dependency (tenant_id, template_version_id, step_key, depends_on_step_key)
          VALUES ($1,$2,$3,$4)
        `,
        [tenantId, version.id, step.step_key, dependency]
      );
    }
  }
  return { templateId: template.id, versionId: version.id, templateKey: definition.templateKey };
}

async function createDemoWorkflowRun(
  client: PoolClient,
  input: {
    tenantId: string;
    jobId: string;
    templateId: string;
    templateKey: string;
    versionId: string;
    users: DemoUserIds;
    scenario: DemoScenario;
  }
) {
  const templateSteps = templateStepsForTemplateKey(input.templateKey as (typeof DEMO_TEMPLATE_KEYS)[number]);
  const run = await queryOne<{ id: string }>(
    client,
    `
      INSERT INTO workflow_run (
        tenant_id,
        job_id,
        template_id,
        template_version_id,
        template_key,
        workflow_family,
        status,
        created_by_user_id,
        updated_by_user_id,
        started_at,
        metadata
      )
      VALUES ($1,$2,$3,$4,$5,'project_tracking'::shared_workflow_family_type,'active'::shared_workflow_run_status_type,$6,$6,now() - interval '1 day',$7::jsonb)
      RETURNING id::text
    `,
    [
      input.tenantId,
      input.jobId,
      input.templateId,
      input.versionId,
      input.templateKey,
      input.users.leadership,
      JSON.stringify({ demo_seed: DEMO_MARKER, scenario: input.scenario })
    ]
  );

  const templateMilestones = await client.query<{
    id: string;
    milestone_key: string;
    name: string;
    description: string | null;
    sort_order: number;
  }>(
    `
      SELECT id::text, milestone_key, name, description, sort_order
      FROM workflow_template_milestone
      WHERE tenant_id = $1 AND template_version_id = $2
      ORDER BY sort_order
    `,
    [input.tenantId, input.versionId]
  );
  const runMilestoneIds = new Map<string, string>();
  for (const milestone of templateMilestones.rows) {
    const status = milestoneStatusForScenario(input.scenario, milestone.milestone_key);
    const row = await queryOne<{ id: string }>(
      client,
      `
        INSERT INTO workflow_run_milestone (
          tenant_id,
          workflow_run_id,
          template_milestone_id,
          milestone_key,
          name,
          description,
          status,
          sort_order,
          started_at,
          completed_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7::workflow_milestone_status_type,$8,now() - interval '1 day',$9)
        RETURNING id::text
      `,
      [
        input.tenantId,
        run.id,
        milestone.id,
        milestone.milestone_key,
        milestone.name,
        milestone.description,
        status,
        milestone.sort_order,
        status === "COMPLETE" ? new Date().toISOString() : null
      ]
    );
    runMilestoneIds.set(milestone.milestone_key, row.id);
  }

  const templateStepRows = await client.query<{ id: string; step_key: string }>(
    `
      SELECT id::text, step_key
      FROM workflow_template_step
      WHERE tenant_id = $1 AND template_version_id = $2
    `,
    [input.tenantId, input.versionId]
  );
  const templateStepIds = new Map(templateStepRows.rows.map((row) => [row.step_key, row.id]));
  const stepIds = new Map<string, string>();
  for (const step of templateSteps) {
    const scenarioStatus = statusForScenario(input.scenario, step.step_key);
    const assignedUserId =
      step.department === "schools" || step.department === "sports"
        ? input.users.leadership
        : step.department === "photography"
          ? input.users.photo
          : input.users.production;
    const row = await queryOne<{ id: string }>(
      client,
      `
        INSERT INTO workflow_step (
          tenant_id,
          workflow_run_id,
          workflow_run_milestone_id,
          template_step_id,
          job_id,
          step_key,
          name,
          description,
          department,
          role_key,
          assigned_user_id,
          status,
          required,
          skippable,
          blocking,
          expected_duration_minutes,
          started_at,
          completed_at,
          completed_by_user_id,
          notes,
          exception_reason,
          rework_count,
          last_transition_at,
          last_transition_by_user_id,
          active_owner_user_id,
          sort_order
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::work_department_type,$10,$11,$12::workflow_step_status_type,true,$13,true,$14,$15,$16,$17,$18,$19,$20,$21,$11,$11,$22)
        RETURNING id::text
      `,
      [
        input.tenantId,
        run.id,
        runMilestoneIds.get(step.milestone_key),
        templateStepIds.get(step.step_key),
        input.jobId,
        step.step_key,
        step.name,
        step.description,
        step.department,
        step.role_key,
        assignedUserId,
        scenarioStatus.status,
        step.step_key === "close_job",
        step.expected_duration_minutes,
        scenarioStatus.started_at,
        scenarioStatus.completed_at,
        scenarioStatus.completed_at ? assignedUserId : null,
        scenarioStatus.notes,
        scenarioStatus.exception_reason,
        scenarioStatus.rework_count,
        scenarioStatus.last_transition_at,
        step.sort_order
      ]
    );
    stepIds.set(step.step_key, row.id);
  }
  for (const step of templateSteps) {
    for (const dependency of step.depends_on_step_keys) {
      await client.query(
        `
          INSERT INTO workflow_step_dependency (
            tenant_id,
            workflow_run_id,
            workflow_step_id,
            depends_on_workflow_step_id
          )
          VALUES ($1,$2,$3,$4)
        `,
        [input.tenantId, run.id, stepIds.get(step.step_key), stepIds.get(dependency)]
      );
    }
  }

  const productionQueueStepKey =
    input.scenario === "blocked"
      ? "edit_cull"
      : input.scenario === "overdue"
        ? "qa_review"
        : input.scenario === "completed"
          ? "return_to_schools"
          : "download_verify_images";
  const createsProductionHandoff = !["school_setup", "sports_setup"].includes(input.scenario);
  const handoffStatus =
    input.scenario === "completed"
      ? "returned_to_schools"
      : input.scenario === "blocked"
        ? "waiting_on_info"
        : input.scenario === "overdue"
          ? "production_complete"
          : "accepted_by_production";
  const waitingDetail = input.scenario === "blocked" ? "Production needs corrected ceremony direction before finishing edits." : null;

  if (createsProductionHandoff) {
    await client.query(
      `
        UPDATE workflow_step
        SET assignment_status = $3::workflow_assignment_status_type,
            assigned_queue = 'production'::work_department_type,
            waiting_on_party = $4,
            waiting_detail = $5,
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [
        input.tenantId,
        stepIds.get(productionQueueStepKey),
        input.scenario === "blocked" ? "waiting_on_info" : input.scenario === "completed" ? "returned" : "needs_assignment",
        input.scenario === "blocked" ? "school" : null,
        waitingDetail
      ]
    );

    await client.query(
      `
        INSERT INTO workflow_handoff (
          tenant_id,
          workflow_run_id,
          from_step_id,
          to_step_id,
          from_department,
          to_department,
          from_user_id,
          to_user_id,
          status,
          reason,
          expectations,
          notes,
          sla_started_at,
          sent_by_user_id,
          sent_at,
          accepted_by_user_id,
          accepted_at,
          returned_by_user_id,
          returned_at,
          created_by_user_id
        )
        VALUES ($1,$2,$3,$4,'photography'::work_department_type,'production'::work_department_type,$5,$6,$7::workflow_handoff_status_type,$8,$9,$10,now() - interval '2 hours',$5,now() - interval '2 hours',$11,$12,$13,$14,$5)
      `,
      [
        input.tenantId,
        run.id,
        stepIds.get("send_to_production"),
        stepIds.get("count_images"),
        input.users.photo,
        input.users.production,
        handoffStatus,
        "Demo Schools-to-Production handoff after files, data, and due date are confirmed.",
        "Production accepts the job, counts images first, verifies files, and moves only real blockers forward.",
        waitingDetail ?? "Production queue demo handoff.",
        handoffStatus === "accepted_by_production" || handoffStatus === "waiting_on_info" || handoffStatus === "production_complete" || handoffStatus === "returned_to_schools"
          ? input.users.production
          : null,
        handoffStatus === "accepted_by_production" || handoffStatus === "waiting_on_info" || handoffStatus === "production_complete" || handoffStatus === "returned_to_schools"
          ? new Date(Date.now() - 90 * 60000).toISOString()
          : null,
        handoffStatus === "returned_to_schools" ? input.users.production : null,
        handoffStatus === "returned_to_schools" ? new Date(Date.now() - 45 * 60000).toISOString() : null
      ]
    );
  }

  if (input.scenario === "blocked") {
    await client.query(
      `
        INSERT INTO workflow_step_audit_log (
          tenant_id,
          workflow_run_id,
          workflow_step_id,
          actor_user_id,
          transition_type,
          previous_status,
          new_status,
          previous_values,
          new_values,
          reason
        )
        VALUES ($1,$2,$3,$4,'sent_back'::workflow_step_transition_type,'COMPLETE'::workflow_step_status_type,'IN_PROGRESS'::workflow_step_status_type,$5::jsonb,$6::jsonb,$7)
      `,
      [
        input.tenantId,
        run.id,
        stepIds.get("edit_cull"),
        input.users.leadership,
        JSON.stringify({ status: "COMPLETE" }),
        JSON.stringify({ status: "IN_PROGRESS", rework_count: 1 }),
        "QA found missing ceremony correction expectations during demo setup."
      ]
    );
  }

  await client.query(
    `
      INSERT INTO work_task (
        tenant_id,
        task_number,
        title,
        department_type,
        related_job_id,
        linked_step_id,
        assigned_to_user_id,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,'production'::work_department_type,$4,$5,$6,$7,$7)
    `,
    [
      input.tenantId,
      `PT-DEMO-TASK-${input.scenario}`,
      taskTitleForScenario(input.scenario),
      input.jobId,
      taskStepIdForScenario(input.scenario, stepIds),
      input.users.production,
      input.users.leadership
    ]
  );

  await client.query(
    `
      INSERT INTO app_event (tenant_id, event_type, aggregate_type, aggregate_id, payload, dedupe_key)
      VALUES ($1,'workflow.instance_created','workflow_run',$2,$3::jsonb,$4)
      ON CONFLICT (tenant_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL
      DO NOTHING
    `,
    [
      input.tenantId,
      run.id,
      JSON.stringify({ demo_seed: DEMO_MARKER, scenario: input.scenario }),
      `project-tracking-demo:${run.id}:instance_created`
    ]
  );

  return run.id;
}

function milestoneStatusForScenario(scenario: DemoScenario, milestoneKey: string) {
  if (scenario === "completed") {
    return "COMPLETE";
  }
  if (scenario === "school_setup" || scenario === "sports_setup") {
    return milestoneKey === "intake" ? "ACTIVE" : "WAITING";
  }
  if (scenario === "on_track" || scenario === "due_soon") {
    if (["intake", "photography"].includes(milestoneKey)) {
      return "COMPLETE";
    }
    if (milestoneKey === "production") {
      return "ACTIVE";
    }
    return "WAITING";
  }
  if (scenario === "overdue") {
    if (["intake", "photography", "production"].includes(milestoneKey)) {
      return "COMPLETE";
    }
    return milestoneKey === "qa" ? "ACTIVE" : "WAITING";
  }
  if (["intake", "photography"].includes(milestoneKey)) {
    return "COMPLETE";
  }
  return milestoneKey === "production" ? "ACTIVE" : "WAITING";
}

function statusForScenario(scenario: DemoScenario, stepKey: string) {
  const now = new Date();
  const iso = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60000).toISOString();
  const complete = { status: "COMPLETE", started_at: iso(420), completed_at: iso(240), last_transition_at: iso(240), notes: null, exception_reason: null, rework_count: 0 };
  const waiting = { status: "WAITING", started_at: null, completed_at: null, last_transition_at: iso(30), notes: null, exception_reason: null, rework_count: 0 };

  if (scenario === "completed") {
    return {
      ...complete,
      notes: ["send_to_production", "return_to_schools", "family_communication", "id_admin_item", "close_job"].includes(stepKey)
        ? "Demo completed school workflow path."
        : null
    };
  }

  if (scenario === "school_setup") {
    if (["confirm_scope", "confirm_schedule"].includes(stepKey)) {
      return complete;
    }
    if (stepKey === "prep_data_admin") {
      return {
        status: "IN_PROGRESS",
        started_at: iso(40),
        completed_at: null,
        last_transition_at: iso(40),
        notes: "Demo school setup story: roster, admin needs, and deadline are being confirmed.",
        exception_reason: null,
        rework_count: 0
      };
    }
    return waiting;
  }

  if (scenario === "sports_setup") {
    if (stepKey === "confirm_scope") {
      return {
        status: "IN_PROGRESS",
        started_at: iso(55),
        completed_at: null,
        last_transition_at: iso(55),
        notes: "Demo sports setup story: team count, package expectations, and schedule are being confirmed.",
        exception_reason: null,
        rework_count: 0
      };
    }
    return waiting;
  }

  if (scenario === "on_track") {
    if (["confirm_scope", "confirm_schedule", "prep_data_admin", "photograph_job", "send_to_production", "count_images"].includes(stepKey)) {
      return complete;
    }
    if (stepKey === "download_verify_images") {
      return { status: "IN_PROGRESS", started_at: iso(18), completed_at: null, last_transition_at: iso(18), notes: "Demo on-track production intake.", exception_reason: null, rework_count: 0 };
    }
    return waiting;
  }

  if (scenario === "due_soon") {
    if (["confirm_scope", "confirm_schedule", "prep_data_admin", "photograph_job", "send_to_production", "count_images"].includes(stepKey)) {
      return complete;
    }
    if (stepKey === "download_verify_images") {
      return { status: "IN_PROGRESS", started_at: iso(92), completed_at: null, last_transition_at: iso(92), notes: "Demo due-soon production intake.", exception_reason: null, rework_count: 0 };
    }
    return waiting;
  }

  if (scenario === "overdue") {
    if (["confirm_scope", "confirm_schedule", "prep_data_admin", "photograph_job", "send_to_production", "count_images", "download_verify_images", "edit_cull"].includes(stepKey)) {
      return complete;
    }
    if (stepKey === "qa_review") {
      return { status: "IN_PROGRESS", started_at: iso(155), completed_at: null, last_transition_at: iso(155), notes: "Demo overdue QA review.", exception_reason: null, rework_count: 0 };
    }
    return waiting;
  }

  if (["confirm_scope", "confirm_schedule", "prep_data_admin", "photograph_job", "send_to_production", "count_images", "download_verify_images"].includes(stepKey)) {
    return complete;
  }
  if (stepKey === "edit_cull") {
    return {
      status: "BLOCKED",
      started_at: iso(150),
      completed_at: null,
      last_transition_at: iso(140),
      notes: "Demo blocked step for leadership review.",
      exception_reason: "Missing ceremony correction direction from QA.",
      rework_count: 1
    };
  }
  return waiting;
}

function taskTitleForScenario(scenario: DemoScenario) {
  switch (scenario) {
    case "school_setup":
      return "Next action: finish school setup and admin prep";
    case "sports_setup":
      return "Next action: confirm sports teams and schedule";
    case "blocked":
      return "Next action: confirm ceremony correction direction";
    case "overdue":
      return "Next action: finish QA review";
    case "due_soon":
      return "Next action: verify retake image counts";
    case "completed":
      return "Demo path: school setup through closeout complete";
    default:
      return "Next action: keep production intake moving";
  }
}

function taskStepIdForScenario(scenario: DemoScenario, stepIds: Map<string, string>) {
  if (scenario === "school_setup") {
    return stepIds.get("prep_data_admin");
  }
  if (scenario === "sports_setup") {
    return stepIds.get("confirm_scope");
  }
  if (scenario === "blocked") {
    return stepIds.get("edit_cull");
  }
  if (scenario === "overdue") {
    return stepIds.get("qa_review");
  }
  if (scenario === "completed") {
    return stepIds.get("close_job");
  }
  return stepIds.get("download_verify_images");
}

export async function seedProjectTrackingDemoData() {
  assertProjectTrackingDemoSeedAllowed();
  const client = await pool.connect();
  try {
    logSeedStep("begin");
    await client.query("BEGIN");
    const tenant = await queryOne<{ id: string }>(
      client,
      `
        SELECT id::text AS id
        FROM tenant
        WHERE name = 'Demo Studio'
        ORDER BY created_at ASC
        LIMIT 1
      `,
      []
    );
    const users = await getDemoUsers(client, tenant.id);
    if (!users.leadership || !users.photo || !users.production) {
      throw new Error("Demo seed requires seeded leadership, photo, and production users.");
    }
    logSeedStep("reset existing demo rows");
    await resetDemoData(client, tenant.id);

    logSeedStep("upsert organizations");
    const organizations = new Map<string, string>();
    for (const name of DEMO_ORG_NAMES) {
      const organization = await upsertOrganization(client, tenant.id, users.leadership, name);
      organizations.set(name, organization.id);
    }

    logSeedStep("create workflow templates");
    const templates = new Map<string, { templateId: string; versionId: string }>();
    for (const definition of DEMO_TEMPLATE_DEFINITIONS) {
      const template = await createDemoTemplate(client, tenant.id, users.leadership, definition);
      templates.set(definition.templateKey, template);
    }

    logSeedStep("create workflow runs");
    const workflowRunIds: string[] = [];
    for (const demoWorkflow of DEMO_WORKFLOWS) {
      const organizationId = organizations.get(demoWorkflow.organizationName) ?? organizations.values().next().value;
      if (!organizationId) {
        throw new Error(`Missing demo organization ${demoWorkflow.organizationName}`);
      }
      const job = await insertDemoJob(client, {
        tenantId: tenant.id,
        actorUserId: users.leadership,
        organizationId,
        jobNumber: demoWorkflow.jobNumber,
        title: demoWorkflow.title,
        startsInDays: demoWorkflow.startsInDays
      });
      const template = templates.get(demoWorkflow.templateKey);
      if (!template) {
        throw new Error(`Missing demo template ${demoWorkflow.templateKey}`);
      }
      const runId = await createDemoWorkflowRun(client, {
        tenantId: tenant.id,
        jobId: job.id,
        templateId: template.templateId,
        templateKey: demoWorkflow.templateKey,
        versionId: template.versionId,
        users,
        scenario: demoWorkflow.scenario
      });
      workflowRunIds.push(runId);
    }

    await client.query("COMMIT");
    logSeedStep("complete");
    return {
      tenant_id: tenant.id,
      template_keys: DEMO_TEMPLATE_KEYS,
      job_numbers: DEMO_JOB_NUMBERS,
      workflow_run_ids: workflowRunIds
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedProjectTrackingDemoData()
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
