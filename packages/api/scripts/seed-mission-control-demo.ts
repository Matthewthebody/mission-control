import process from "node:process";
import { pathToFileURL } from "node:url";
import { pool } from "../src/db/pool.js";
import { seedProjectTrackingDemoData } from "./seed-project-tracking-demo.js";
import { runClientCommandCenterDemoSeed } from "./seed-client-command-center-demo.js";
import { seedJobCloseoutDemoData } from "./seed-job-closeout-demo.js";

const DEMO_MARKER = "mission_control_demo_v1";
const SPORTS_PEER_QA_MARKER = "sports_peer_qa_board_v1";

type SportsPeerQaSeedDefinition = {
  jobNumber: string;
  jobName: string;
  organizationName: string;
  startsInDays: number;
  qaStatus: string;
  sportsJobType: string;
  productionType: string;
  correctionCategory?: string | null;
  correctionNotes?: string | null;
  blockerReason?: string | null;
  blockerOwner?: string | null;
  blockerNotes?: string | null;
  knownExceptions?: string | null;
  ownerDone: number;
  peerDone: number;
  conditionalChecks: Array<{ label: string; complete: boolean; applies?: boolean }>;
  approved?: boolean;
};

const SPORTS_PEER_QA_DEMO_JOBS: SportsPeerQaSeedDefinition[] = [
  {
    jobNumber: "SPQA-DEMO-001",
    jobName: "Kettle Moraine Volleyball Team & Individual",
    organizationName: "Kettle Moraine Volleyball Club",
    startsInDays: 2,
    qaStatus: "ready_for_owner_qa",
    sportsJobType: "standard_team_individual",
    productionType: "sports_gallery",
    knownExceptions: "Standard gray gym lighting; no client exception.",
    ownerDone: 0,
    peerDone: 0,
    conditionalChecks: []
  },
  {
    jobNumber: "SPQA-DEMO-002",
    jobName: "Brookfield Baseball Spring Media Day",
    organizationName: "Brookfield Baseball Association",
    startsInDays: 3,
    qaStatus: "ready_for_peer_qa",
    sportsJobType: "virtual_teams",
    productionType: "virtual_team_composites",
    knownExceptions: "Virtual teams required for three missing athletes.",
    ownerDone: 7,
    peerDone: 1,
    conditionalChecks: [
      { label: "Virtual teams built", complete: true },
      { label: "Virtual teams proofed by owner", complete: true },
      { label: "Virtual teams approved or waiting reason recorded", complete: false }
    ]
  },
  {
    jobNumber: "SPQA-DEMO-003",
    jobName: "North Shore Dance Buddy Photo Cleanup",
    organizationName: "North Shore Dance Alliance",
    startsInDays: 4,
    qaStatus: "corrections_needed",
    sportsJobType: "buddy_photos",
    productionType: "sports_gallery",
    correctionCategory: "file_structure",
    correctionNotes: "Buddy temp group is still in the upload folder and two buddy images were not moved into individual galleries.",
    knownExceptions: "Dance job has buddy photos and mixed-age teams.",
    ownerDone: 5,
    peerDone: 3,
    conditionalChecks: [
      { label: "Buddy photos duplicated before upload", complete: true },
      { label: "Buddy images moved to correct individual galleries", complete: false },
      { label: "Temporary buddy/team group deleted", complete: false },
      { label: "Buddy count verified", complete: false }
    ]
  },
  {
    jobNumber: "SPQA-DEMO-004",
    jobName: "Hartland Soccer Senior Banner Review",
    organizationName: "Hartland Soccer Club",
    startsInDays: 5,
    qaStatus: "ready_for_spencer_review",
    sportsJobType: "posters_banners",
    productionType: "senior_banners",
    knownExceptions: "Senior banner names need final spelling confidence before release.",
    ownerDone: 7,
    peerDone: 7,
    conditionalChecks: [
      { label: "Correct athlete selected", complete: true },
      { label: "Correct pose selected", complete: true },
      { label: "Spelling/name check complete", complete: true },
      { label: "Logo/color/background check complete", complete: true }
    ]
  },
  {
    jobNumber: "SPQA-DEMO-005",
    jobName: "Lake Country Lacrosse Multi-Day Release",
    organizationName: "Lake Country Lacrosse",
    startsInDays: 6,
    qaStatus: "blocked_waiting",
    sportsJobType: "multi_day_sports_dance",
    productionType: "sports_gallery",
    blockerReason: "waiting_on_second_shoot_day",
    blockerOwner: "Photography",
    blockerNotes: "Release is held until the second shoot day is complete and replaced images are confirmed.",
    knownExceptions: "Day two makeups are expected before the final release packet.",
    ownerDone: 6,
    peerDone: 4,
    conditionalChecks: [
      { label: "Second day status documented", complete: false },
      { label: "Replaced/hidden images reviewed", complete: false },
      { label: "Missing-day risk documented", complete: true }
    ]
  },
  {
    jobNumber: "SPQA-DEMO-006",
    jobName: "Mukwonago Football Gray Screen Final",
    organizationName: "Mukwonago Football Boosters",
    startsInDays: 7,
    qaStatus: "approved_for_release",
    sportsJobType: "gray_screen",
    productionType: "sports_gallery",
    knownExceptions: "Gray screen cutouts passed peer review.",
    ownerDone: 7,
    peerDone: 7,
    conditionalChecks: [
      { label: "Background consistency reviewed", complete: true },
      { label: "Cutouts reviewed", complete: true },
      { label: "Cleanup quality reviewed", complete: true }
    ],
    approved: true
  }
];

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
              OR org.notes LIKE '%sports_peer_qa_board_v1%'
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
              OR org.notes LIKE '%sports_peer_qa_board_v1%'
            )
        )::text AS accounts,
        (
          SELECT count(*)
          FROM jobs job, demo_tenant tenant
          WHERE job.tenant_id = tenant.id
            AND (job.job_number LIKE 'PT-DEMO-%' OR job.job_number LIKE 'CCC-DEMO-%' OR job.job_number LIKE 'JCO-DEMO-%' OR job.job_number LIKE 'SPQA-DEMO-%')
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
  const overCap = Object.entries(counts).filter(([key, count]) => count > (["organizations", "accounts", "jobs"].includes(key) ? 20 : 12));
  if (overCap.length > 0) {
    throw new Error(`Mission Control demo caps exceeded: ${JSON.stringify(Object.fromEntries(overCap))}`);
  }
}

function normalizeName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function checklist(labels: string[], completeCount: number) {
  return labels.map((label, index) => ({ label, complete: index < completeCount }));
}

export async function seedSportsPeerQaDemoData() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenant = await client.query<{ id: string }>("SELECT id::text FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
    const tenantId = tenant.rows[0]?.id;
    if (!tenantId) {
      throw new Error("Demo Studio tenant is required before seeding Sports peer QA demo data.");
    }
    const users = await client.query<{ id: string; email: string; full_name: string }>(
      `
        SELECT id::text, lower(email) AS email, full_name
        FROM app_user
        WHERE tenant_id = $1
        ORDER BY created_at ASC
      `,
      [tenantId]
    );
    const userByEmail = new Map(users.rows.map((user) => [user.email, user]));
    const owner = userByEmail.get("photo@example.com") ?? users.rows[0];
    const peer = userByEmail.get("associate@example.com") ?? users.rows[1] ?? owner;
    const finalReviewer = users.rows.find((user) => /spencer/i.test(user.full_name)) ?? userByEmail.get("leadership@example.com") ?? users.rows[0];
    if (!owner || !peer || !finalReviewer) {
      throw new Error("Demo users are required before seeding Sports peer QA demo data.");
    }

    await client.query(
      `
        DELETE FROM jobs
        WHERE tenant_id = $1
          AND job_number LIKE 'SPQA-DEMO-%'
      `,
      [tenantId]
    );

    for (const definition of SPORTS_PEER_QA_DEMO_JOBS) {
      const normalizedOrganizationName = normalizeName(definition.organizationName);
      const existingOrg = await client.query<{ id: string }>(
        `
          SELECT id::text
          FROM organization
          WHERE tenant_id = $1
            AND normalized_canonical_name = $2
          ORDER BY created_at ASC
          LIMIT 1
        `,
        [tenantId, normalizedOrganizationName]
      );
      const org =
        existingOrg.rows[0] ??
        (
          await client.query<{ id: string }>(
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
              VALUES ($1,$2,$3,$2,'sports'::organization_account_type,$4,$5,$5)
              RETURNING id::text
            `,
            [tenantId, definition.organizationName, normalizedOrganizationName, `[${SPORTS_PEER_QA_MARKER}] demo account`, owner.id]
          )
        ).rows[0];
      await client.query(
        `
          UPDATE organization
          SET notes = $3,
              updated_by_user_id = $4,
              updated_at = now()
          WHERE tenant_id = $1
            AND id = $2
        `,
        [tenantId, org!.id, `[${SPORTS_PEER_QA_MARKER}] demo account`, owner.id]
      );

      const job = await client.query<{ id: string }>(
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
            production_status,
            readiness_status,
            scheduled_start_at,
            scheduled_end_at,
            timezone,
            estimated_subject_count,
            production_required,
            created_by_user_id,
            updated_by_user_id
          )
          VALUES (
            $1,$2,'sports'::job_department_type,$3::job_category_type,$4,$5,$6,$6,$7,
            'in_progress'::job_status_type,'editing'::job_production_status_type,'on_track'::job_readiness_status_type,
            now() + ($8::text || ' days')::interval,
            now() + ($8::text || ' days')::interval + interval '3 hours',
            'America/Chicago',
            240,
            true,
            $5,
            $5
          )
          RETURNING id::text
        `,
        [
          tenantId,
          definition.jobNumber,
          definition.productionType === "senior_banners" ? "banner_day" : "media_day",
          org!.id,
          owner.id,
          definition.jobName,
          `[${SPORTS_PEER_QA_MARKER}] demo sports QA job`,
          definition.startsInDays
        ]
      );

      await client.query(
        `
          INSERT INTO sports_job_profiles (
            job_id,
            tenant_id,
            sport_type,
            season,
            team_structure,
            proof_required,
            banner_work_required,
            specialty_products_required,
            buddy_photos_required,
            client_expectations_notes
          )
          VALUES ($1,$2,'Sports','Spring 2026','team_and_individual',true,$3,$4,$5,$6)
          ON CONFLICT (job_id)
          DO UPDATE SET
            client_expectations_notes = EXCLUDED.client_expectations_notes,
            updated_at = now()
        `,
        [
          job.rows[0]!.id,
          tenantId,
          definition.sportsJobType === "posters_banners",
          definition.productionType !== "sports_gallery",
          definition.sportsJobType === "buddy_photos",
          definition.knownExceptions ?? null
        ]
      );

      const productionItem = await client.query<{ id: string }>(
        `
          INSERT INTO production_items (
            tenant_id,
            job_id,
            production_group_key,
            title,
            production_type,
            status,
            priority,
            assigned_to_user_id,
            approval_required,
            proof_required,
            due_at,
            delivery_deadline_at,
            file_count_expected,
            file_count_received,
            qa_status,
            job_type,
            organization_id,
            department_owner_user_id,
            assigned_peer_reviewer_user_id,
            assigned_release_reviewer_user_id,
            shoot_date_start,
            workflow_status,
            health_state,
            creator_review_complete,
            peer_review_complete,
            final_release_review_complete,
            blocked_reason,
            blocker_count,
            rework_count,
            internal_notes
            , department_type
            , production_template_key
            , completion_rule_key
          )
          VALUES (
            $1,$2,$3,$4,$5,'editing'::job_production_status_type,'normal'::job_priority_level,$6,true,true,
            now() + interval '2 days',
            now() + interval '5 days',
            240,
            CASE WHEN $7 IN ('ready_for_owner_qa','owner_qa_in_progress') THEN 220 ELSE 240 END,
            $7,
            $8,
            $9,
            $6,
            $10,
            $11,
            (now() + ($12::text || ' days')::interval)::date,
            CASE
              WHEN $7 = 'blocked_waiting' THEN 'BLOCKED'::production_board_workflow_status_type
              WHEN $7 = 'corrections_needed' THEN 'REWORK_REQUIRED'::production_board_workflow_status_type
              WHEN $7 = 'ready_for_spencer_review' THEN 'READY_FOR_RELEASE'::production_board_workflow_status_type
              WHEN $7 = 'approved_for_release' THEN 'READY_FOR_RELEASE'::production_board_workflow_status_type
              WHEN $7 = 'ready_for_peer_qa' THEN 'READY_FOR_QA'::production_board_workflow_status_type
              ELSE 'IN_PRODUCTION'::production_board_workflow_status_type
            END,
            CASE WHEN $7 = 'blocked_waiting' THEN 'BLOCKED'::production_board_health_state_type ELSE 'ON_TRACK'::production_board_health_state_type END,
            $13,
            $14,
            $15,
            $16,
            CASE WHEN $7 = 'blocked_waiting' THEN 1 ELSE 0 END,
            CASE WHEN $7 = 'corrections_needed' THEN 1 ELSE 0 END,
            $17,
            'sports'::job_department_type,
            CASE WHEN $5 = 'senior_banners' THEN 'specialty_workflow' ELSE 'sports_workflow' END,
            CASE WHEN $5 = 'senior_banners' THEN 'specialty_template_marker' ELSE 'sports_release_date_or_legacy_finished' END
          )
          RETURNING id::text
        `,
        [
          tenantId,
          job.rows[0]!.id,
          `sports-peer-qa:${definition.jobNumber}`,
          definition.jobName,
          definition.productionType,
          owner.id,
          definition.qaStatus,
          definition.sportsJobType,
          org!.id,
          peer.id,
          finalReviewer.id,
          definition.startsInDays,
          definition.ownerDone >= 7,
          definition.peerDone >= 7,
          definition.qaStatus === "ready_for_spencer_review" || Boolean(definition.approved),
          definition.blockerReason ?? null,
          definition.knownExceptions ?? null
        ]
      );

      const ownerChecklist = checklist(
        [
          "Image quality reviewed",
          "Counts reviewed",
          "File structure reviewed",
          "Naming/folders reviewed",
          "Team images reviewed if applicable",
          "Individual galleries reviewed",
          "Known exceptions documented"
        ],
        definition.ownerDone
      );
      const peerChecklist = checklist(
        [
          "Exposure/color/crop/cutouts look correct",
          "Subject/team/gallery counts make sense",
          "Athletes appear sorted correctly",
          "Team images are in the correct place",
          "Price sheet or release setup reviewed",
          "Client-specific notes reviewed",
          "No obvious missing athletes, wrong folders, or leftover working files"
        ],
        definition.peerDone
      );
      const releasePacket = {
        owner_qa_complete: definition.ownerDone >= 7,
        peer_qa_complete: definition.peerDone >= 7,
        corrections_resolved: definition.qaStatus !== "corrections_needed",
        spencer_review_complete: definition.qaStatus === "approved_for_release",
        price_sheet_confirmed: definition.qaStatus === "approved_for_release" || definition.qaStatus === "ready_for_spencer_review",
        team_images_confirmed: definition.peerDone >= 6,
        individual_galleries_confirmed: definition.peerDone >= 6,
        buddy_photos_complete: definition.sportsJobType === "buddy_photos" ? false : null,
        virtual_teams_complete: definition.sportsJobType === "virtual_teams" ? false : null,
        known_exceptions_documented: Boolean(definition.knownExceptions),
        approved_for_release: Boolean(definition.approved)
      };
      await client.query(
        `
          INSERT INTO sports_peer_qa_reviews (
            tenant_id,
            production_item_id,
            qa_status,
            sports_job_type,
            known_exceptions,
            owner_checklist_json,
            peer_checklist_json,
            conditional_checklist_json,
            correction_category,
            correction_notes,
            blocker_reason,
            blocker_owner,
            blocker_notes,
            release_packet_json,
            approved_for_release_at
          )
          VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14::jsonb,CASE WHEN $15 THEN now() ELSE NULL END)
          ON CONFLICT (tenant_id, production_item_id)
          DO UPDATE SET
            qa_status = EXCLUDED.qa_status,
            sports_job_type = EXCLUDED.sports_job_type,
            known_exceptions = EXCLUDED.known_exceptions,
            owner_checklist_json = EXCLUDED.owner_checklist_json,
            peer_checklist_json = EXCLUDED.peer_checklist_json,
            conditional_checklist_json = EXCLUDED.conditional_checklist_json,
            correction_category = EXCLUDED.correction_category,
            correction_notes = EXCLUDED.correction_notes,
            blocker_reason = EXCLUDED.blocker_reason,
            blocker_owner = EXCLUDED.blocker_owner,
            blocker_notes = EXCLUDED.blocker_notes,
            release_packet_json = EXCLUDED.release_packet_json,
            approved_for_release_at = EXCLUDED.approved_for_release_at,
            updated_at = now()
        `,
        [
          tenantId,
          productionItem.rows[0]!.id,
          definition.qaStatus,
          definition.sportsJobType,
          definition.knownExceptions ?? null,
          JSON.stringify(ownerChecklist),
          JSON.stringify(peerChecklist),
          JSON.stringify(definition.conditionalChecks),
          definition.correctionCategory ?? null,
          definition.correctionNotes ?? null,
          definition.blockerReason ?? null,
          definition.blockerOwner ?? null,
          definition.blockerNotes ?? null,
          JSON.stringify(releasePacket),
          Boolean(definition.approved)
        ]
      );
    }
    await client.query("COMMIT");
    return { seeded: SPORTS_PEER_QA_DEMO_JOBS.length, marker: SPORTS_PEER_QA_MARKER };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function seedMissionControlDemoData(argv = process.argv) {
  assertMissionControlDemoSeedAllowed(argv, process.env);
  await runClientCommandCenterDemoSeed(argv.includes("--reset") ? argv : [...argv, "--reset"]);
  const projectTracking = await seedProjectTrackingDemoData();
  const jobCloseout = await seedJobCloseoutDemoData(argv);
  const sportsPeerQa = await seedSportsPeerQaDemoData();
  const counts = await getDemoCounts();
  assertDemoCaps(counts);
  return {
    ok: true,
    demo_marker: DEMO_MARKER,
    project_tracking: projectTracking,
    job_closeout: jobCloseout,
    sports_peer_qa: sportsPeerQa,
    counts,
    seeded_areas: ["client_command_center", "project_tracking", "workflow_templates", "job_closeout", "sports_peer_qa"],
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
