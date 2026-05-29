import process from "node:process";
import { pathToFileURL } from "node:url";
import { pool } from "../src/db/pool.js";
import { seedProjectTrackingDemoData } from "./seed-project-tracking-demo.js";
import { runClientCommandCenterDemoSeed } from "./seed-client-command-center-demo.js";
import { seedJobCloseoutDemoData } from "./seed-job-closeout-demo.js";

const DEMO_MARKER = "mission_control_demo_v1";

function assertMissionControlDemoSeedAllowed(argv = process.argv, env = process.env) {
  if (env.NODE_ENV === "production") {
    throw new Error("Mission Control demo seed is disabled in production.");
  }
  if (!argv.includes("--allow-demo-data")) {
    throw new Error("Pass --allow-demo-data to confirm this development-only demo seed.");
  }
}

async function getDemoCounts() {
  const { rows } = await pool.query<{
    organizations: string;
    accounts: string;
    jobs: string;
    tasks: string;
    active_steps: string;
    contacts: string;
  }>(
    `
      WITH demo_tenant AS (
        SELECT id
        FROM tenant
        WHERE name = 'Demo Studio'
        LIMIT 1
      )
      SELECT
        (
          SELECT count(*)
          FROM organization org, demo_tenant tenant
          WHERE org.tenant_id = tenant.id
            AND (
              org.client_demo_key LIKE 'client_command_center_v1:%'
              OR org.notes LIKE '%project tracking demo data%'
              OR org.notes LIKE '%job closeout demo data%'
            )
        )::text AS organizations,
        (
          SELECT count(*)
          FROM organization org, demo_tenant tenant
          WHERE org.tenant_id = tenant.id
            AND org.client_entity_kind = 'account'
            AND (
              org.client_demo_key LIKE 'client_command_center_v1:%'
              OR org.notes LIKE '%project tracking demo data%'
              OR org.notes LIKE '%job closeout demo data%'
            )
        )::text AS accounts,
        (
          SELECT count(*)
          FROM jobs job, demo_tenant tenant
          WHERE job.tenant_id = tenant.id
            AND (job.job_number LIKE 'PT-DEMO-%' OR job.job_number LIKE 'CCC-DEMO-%' OR job.job_number LIKE 'JCO-DEMO-%')
        )::text AS jobs,
        (
          SELECT count(*)
          FROM work_task task, demo_tenant tenant
          WHERE task.tenant_id = tenant.id
            AND (task.task_number LIKE 'PT-DEMO-TASK-%' OR task.task_number LIKE 'CCC-DEMO-TASK-%')
        )::text AS tasks,
        (
          SELECT count(*)
          FROM workflow_step step
          JOIN workflow_run run ON run.id = step.workflow_run_id
          JOIN demo_tenant tenant ON tenant.id = step.tenant_id
          WHERE run.metadata->>'demo_seed' = 'project_tracking_foundation'
            AND step.status IN ('IN_PROGRESS'::workflow_step_status_type, 'BLOCKED'::workflow_step_status_type, 'OVERDUE'::workflow_step_status_type)
        )::text AS active_steps,
        (
          SELECT count(*)
          FROM organization_contact contact, demo_tenant tenant
          WHERE contact.tenant_id = tenant.id
            AND contact.client_demo_key LIKE 'client_command_center_v1:%'
        )::text AS contacts
    `
  );
  const row = rows[0] ?? { organizations: "0", accounts: "0", jobs: "0", tasks: "0", active_steps: "0", contacts: "0" };
  return {
    organizations: Number(row.organizations),
    accounts: Number(row.accounts),
    jobs: Number(row.jobs),
    tasks: Number(row.tasks),
    active_steps: Number(row.active_steps),
    contacts: Number(row.contacts)
  };
}

function assertDemoCaps(counts: Awaited<ReturnType<typeof getDemoCounts>>) {
  const overCap = Object.entries(counts).filter(([, count]) => count > 10);
  if (overCap.length > 0) {
    throw new Error(`Mission Control demo caps exceeded: ${JSON.stringify(Object.fromEntries(overCap))}`);
  }
}

export async function seedMissionControlDemoData(argv = process.argv) {
  assertMissionControlDemoSeedAllowed(argv, process.env);
  await runClientCommandCenterDemoSeed(argv.includes("--reset") ? argv : [...argv, "--reset"]);
  const projectTracking = await seedProjectTrackingDemoData();
  const jobCloseout = await seedJobCloseoutDemoData(argv);
  const counts = await getDemoCounts();
  assertDemoCaps(counts);
  return {
    ok: true,
    demo_marker: DEMO_MARKER,
    project_tracking: projectTracking,
    job_closeout: jobCloseout,
    counts,
    seeded_areas: ["client_command_center", "project_tracking", "workflow_templates", "job_closeout"],
    reference_areas: ["checklist_template_defaults"],
    deferred_areas: ["compliance_workspace_specific_story"]
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedMissionControlDemoData()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
