import process from "node:process";
import { pathToFileURL } from "node:url";
import type { PoolClient } from "pg";
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

function toIsoDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function localTodayAt(hour: number, minute = 0) {
  const value = new Date();
  value.setHours(hour, minute, 0, 0);
  return value;
}

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60 * 1000);
}

function normalizeSeedText(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

async function upsertPilotLocation(
  client: PoolClient,
  input: {
    tenantId: string;
    organizationId: string;
    externalKey: string;
    name: string;
    address: string;
    addressLine1: string;
    city: string;
    state: string;
    zip: string;
    actorUserId: string;
    navigationNotes: string;
    parkingInstructions: string;
    entranceInstructions: string;
    setupArea: string;
    employeeFacingNotes: string;
  }
) {
  const location = await client.query<{ id: string }>(
    `
      INSERT INTO shoot_location (
        tenant_id,
        organization_id,
        external_source,
        external_key,
        name,
        normalized_name,
        address,
        normalized_address,
        address_line_1,
        city,
        state,
        zip,
        maps_label,
        navigation_url,
        navigation_notes,
        parking_instructions,
        entrance_instructions,
        setup_area,
        employee_facing_notes,
        location_details,
        created_by_user_id,
        updated_by_user_id,
        updated_at
      )
      VALUES (
        $1,$2,'mission_control_demo',$3,$4,$5,$6,$7,$8,$9,$10,$11,$4,
        'https://www.google.com/maps/search/?api=1&query=' || replace($6, ' ', '%20'),
        $12,$13,$14,$15,$16,'Photography pilot same-day location.',$17,$17,now()
      )
      ON CONFLICT (tenant_id, external_source, external_key) DO UPDATE
      SET
        organization_id = EXCLUDED.organization_id,
        name = EXCLUDED.name,
        normalized_name = EXCLUDED.normalized_name,
        address = EXCLUDED.address,
        normalized_address = EXCLUDED.normalized_address,
        address_line_1 = EXCLUDED.address_line_1,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        zip = EXCLUDED.zip,
        maps_label = EXCLUDED.maps_label,
        navigation_url = EXCLUDED.navigation_url,
        navigation_notes = EXCLUDED.navigation_notes,
        parking_instructions = EXCLUDED.parking_instructions,
        entrance_instructions = EXCLUDED.entrance_instructions,
        setup_area = EXCLUDED.setup_area,
        employee_facing_notes = EXCLUDED.employee_facing_notes,
        location_details = EXCLUDED.location_details,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
      RETURNING id::text
    `,
    [
      input.tenantId,
      input.organizationId,
      input.externalKey,
      input.name,
      normalizeSeedText(input.name),
      input.address,
      normalizeSeedText(input.address),
      input.addressLine1,
      input.city,
      input.state,
      input.zip,
      input.navigationNotes,
      input.parkingInstructions,
      input.entranceInstructions,
      input.setupArea,
      input.employeeFacingNotes,
      input.actorUserId
    ]
  );
  return location.rows[0]!.id;
}

async function enrichSameDayPhotographyJob(
  client: PoolClient,
  input: {
    tenantId: string;
    jobNumber: string;
    start: Date;
    end: Date;
    locationId: string;
    leadUserId: string;
    crewUserIds: string[];
    dayLabel: string;
    readiness: Array<{ label: string; isComplete: boolean; isBlocker?: boolean; sortOrder: number }>;
  }
) {
  const job = await client.query<{ id: string }>(
    `
      UPDATE jobs
      SET
        primary_location_id = $3,
        scheduled_start_at = $4,
        scheduled_end_at = $5,
        staffing_status = CASE WHEN $6 >= 3 THEN 'ready_confirmed'::job_staffing_status_type ELSE 'partially_staffed'::job_staffing_status_type END,
        readiness_status = 'on_track'::job_readiness_status_type,
        updated_at = now()
      WHERE tenant_id = $1
        AND job_number = $2
      RETURNING id::text
    `,
    [input.tenantId, input.jobNumber, input.locationId, input.start.toISOString(), input.end.toISOString(), input.crewUserIds.length]
  );
  const jobId = job.rows[0]?.id;
  if (!jobId) {
    throw new Error(`Missing same-day Photography pilot job ${input.jobNumber}`);
  }

  await client.query("DELETE FROM job_staff_assignments WHERE tenant_id = $1 AND job_id = $2", [input.tenantId, jobId]);
  await client.query("DELETE FROM job_readiness_items WHERE tenant_id = $1 AND job_id = $2", [input.tenantId, jobId]);
  await client.query("DELETE FROM job_days WHERE tenant_id = $1 AND job_id = $2", [input.tenantId, jobId]);

  const day = await client.query<{ id: string }>(
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
        day_status,
        access_notes,
        parking_notes,
        setup_notes,
        travel_notes
      )
      VALUES ($1,$2,$3,$4::date,$5,$6,'America/Chicago',$7,$8,'ready'::job_day_status_type,$9,$10,$11,$12)
      RETURNING id::text
    `,
    [
      input.tenantId,
      jobId,
      input.dayLabel,
      toIsoDateOnly(input.start),
      input.start.toTimeString().slice(0, 5),
      input.end.toTimeString().slice(0, 5),
      input.locationId,
      input.leadUserId,
      "Check in with the front office before setup.",
      "Use the staff lot and keep the unload lane clear.",
      "Stage camera cases near the assigned setup area.",
      "Open Travel & Logistics before leaving the studio."
    ]
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
      SELECT $1,$2,$3,crew.user_id,crew.assignment_role::text,crew.assignment_status::job_assignment_status_type,crew.is_lead,crew.is_ready_present
      FROM jsonb_to_recordset($4::jsonb) AS crew(
        user_id uuid,
        assignment_role text,
        assignment_status text,
        is_lead boolean,
        is_ready_present boolean
      )
    `,
    [
      input.tenantId,
      jobId,
      day.rows[0]!.id,
      JSON.stringify(
        input.crewUserIds.map((userId, index) => ({
          user_id: userId,
          assignment_role: index === 0 ? "shoot_lead" : "photographer",
          assignment_status: index === 0 ? "confirmed" : "assigned",
          is_lead: index === 0,
          is_ready_present: index < 2
        }))
      )
    ]
  );

  await client.query(
    `
      INSERT INTO job_readiness_items (
        tenant_id,
        job_id,
        section_key,
        label,
        description,
        is_required,
        is_blocker,
        is_complete,
        sort_order,
        source_template_key
      )
      SELECT $1,$2,'pilot_review',item.label,NULL,true,item.is_blocker,item.is_complete,item.sort_order,'same_day_photography_pilot'
      FROM jsonb_to_recordset($3::jsonb) AS item(label text, is_blocker boolean, is_complete boolean, sort_order int)
    `,
    [
      input.tenantId,
      jobId,
      JSON.stringify(input.readiness.map((item) => ({ label: item.label, is_blocker: Boolean(item.isBlocker), is_complete: item.isComplete, sort_order: item.sortOrder })))
    ]
  );
}

async function seedSameDayPhotographyPilotRows() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenant = await client.query<{ id: string }>("SELECT id::text FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
    const tenantId = tenant.rows[0]?.id;
    if (!tenantId) {
      throw new Error("Demo Studio tenant is required before seeding same-day Photography pilot rows.");
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
    const lead = userByEmail.get("photo@example.com") ?? users.rows[0];
    const associate = userByEmail.get("associate@example.com") ?? users.rows[1] ?? lead;
    const senior = users.rows.find((user) => /senior/i.test(user.full_name)) ?? userByEmail.get("leadership@example.com") ?? lead;
    if (!lead || !associate || !senior) {
      throw new Error("Demo users are required before seeding same-day Photography pilot rows.");
    }

    const schoolOrg = await client.query<{ id: string }>(
      "SELECT id::text FROM organization WHERE tenant_id = $1 AND normalized_canonical_name = $2 LIMIT 1",
      [tenantId, normalizeName("White Bear Lake High School")]
    );
    const sportsOrg = await client.query<{ id: string }>(
      "SELECT id::text FROM organization WHERE tenant_id = $1 AND normalized_canonical_name = $2 LIMIT 1",
      [tenantId, normalizeName("Kettle Moraine Volleyball Club")]
    );
    if (!schoolOrg.rows[0] || !sportsOrg.rows[0]) {
      throw new Error("Demo organizations are required before seeding same-day Photography pilot rows.");
    }

    const schoolLocationId = await upsertPilotLocation(client, {
      tenantId,
      organizationId: schoolOrg.rows[0].id,
      externalKey: "same-day-school-portrait",
      name: "White Bear Lake Main Gym",
      address: "5040 Bald Eagle Ave, White Bear Lake, MN 55110",
      addressLine1: "5040 Bald Eagle Ave",
      city: "White Bear Lake",
      state: "MN",
      zip: "55110",
      actorUserId: lead.id,
      navigationNotes: "Use the south activities entrance and check in at the main office.",
      parkingInstructions: "Park in the visitor lot near the activities entrance.",
      entranceInstructions: "Enter through Door 4 and check in with the front office.",
      setupArea: "Main gym, west wall.",
      employeeFacingNotes: "Bring the school portrait kit and ID card packet."
    });
    const sportsLocationId = await upsertPilotLocation(client, {
      tenantId,
      organizationId: sportsOrg.rows[0].id,
      externalKey: "same-day-sports-media-day",
      name: "Kettle Moraine Fieldhouse",
      address: "349 N Oak Crest Dr, Wales, WI 53183",
      addressLine1: "349 N Oak Crest Dr",
      city: "Wales",
      state: "WI",
      zip: "53183",
      actorUserId: lead.id,
      navigationNotes: "Unload at the athletics entrance before moving vehicles to the north lot.",
      parkingInstructions: "Use the north athletics lot after unloading.",
      entranceInstructions: "Enter at the athletics doors and check in with the activities desk.",
      setupArea: "Fieldhouse court two.",
      employeeFacingNotes: "Bring gray screen kit and team ordering QR cards."
    });

    await enrichSameDayPhotographyJob(client, {
      tenantId,
      jobNumber: "PT-DEMO-TRACK-001",
      start: localTodayAt(9, 0),
      end: localTodayAt(12, 0),
      locationId: schoolLocationId,
      leadUserId: senior.id,
      crewUserIds: [senior.id, lead.id, associate.id],
      dayLabel: "School portrait day",
      readiness: [
        { label: "Portrait kit packed", isComplete: true, sortOrder: 10 },
        { label: "Office packet confirmed", isComplete: true, sortOrder: 20 },
        { label: "Final roster file confirmed", isComplete: false, isBlocker: true, sortOrder: 30 }
      ]
    });
    await enrichSameDayPhotographyJob(client, {
      tenantId,
      jobNumber: "SPQA-DEMO-001",
      start: localTodayAt(14, 0),
      end: addMinutes(localTodayAt(14, 0), 150),
      locationId: sportsLocationId,
      leadUserId: lead.id,
      crewUserIds: [lead.id, associate.id],
      dayLabel: "Sports media day",
      readiness: [
        { label: "Gray screen kit packed", isComplete: true, sortOrder: 10 },
        { label: "Team schedule printed", isComplete: true, sortOrder: 20 },
        { label: "Ordering QR cards staged", isComplete: true, sortOrder: 30 }
      ]
    });

    await client.query("COMMIT");
    return { seeded: 2, job_numbers: ["PT-DEMO-TRACK-001", "SPQA-DEMO-001"] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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

const WAYZATA_ORG_NAME = "Wayzata Public Schools";
const WAYZATA_HIGH_SCHOOL = "Wayzata High School";

type WayzataEvaluationSeed = {
  monthsAgo: number;
  shootName: string;
  shootType: string;
  rating: number;
  onTime: "Yes" | "No";
  easyAccess: "Yes" | "No";
  photographerName: string;
  outcome: "smooth" | "minor_issues" | "major_issues";
  staffingFit: "understaffed" | "right_sized" | "overstaffed";
  setupDifficulty: "low" | "medium" | "high";
  issueCategory: string | null;
  startedOnTime: boolean;
  leadershipReviewNeeded: boolean;
  summary: string;
  watchOut: string | null;
  nextTime: string | null;
  arrivalBuffer: number | null;
  staffingNext: number | null;
};

// ~3.5 years of remembered shoots at Wayzata High School. Authored so the
// historical-intelligence panel lights up: distinct (date,name) pairs drive the
// prior-visit count, repeated understaffing/parking categories trigger pattern
// signals, one rough lighting day creates an open follow-up, and a few client
// quotes surface as "what we learned / client feedback."
const WAYZATA_EVALUATIONS: WayzataEvaluationSeed[] = [
  { monthsAgo: 2, shootName: "Fall Picture Day 2025", shootType: "School Picture Day", rating: 5, onTime: "Yes", easyAccess: "Yes", photographerName: "Carisa Anderson", outcome: "smooth", staffingFit: "right_sized", setupDifficulty: "low", issueCategory: null, startedOnTime: true, leadershipReviewNeeded: false, summary: "Client feedback: \"Photographers were excellent and the lines moved quickly.\"", watchOut: "Load in through the west athletic entrance — the main doors stay locked until 7:30 AM.", nextTime: "Confirm facilities props the west door before the crew arrives.", arrivalBuffer: 30, staffingNext: 5 },
  { monthsAgo: 4, shootName: "Senior Graduation 2025", shootType: "Graduation", rating: 4, onTime: "Yes", easyAccess: "Yes", photographerName: "Josh Park", outcome: "minor_issues", staffingFit: "right_sized", setupDifficulty: "medium", issueCategory: "line_flow_traffic", startedOnTime: true, leadershipReviewNeeded: false, summary: "Stage looked great; processional flow tightened up after the first 20 minutes.", watchOut: null, nextTime: "Add a second floor marshal for the processional.", arrivalBuffer: null, staffingNext: 6 },
  { monthsAgo: 9, shootName: "Spring Picture Day 2025", shootType: "School Picture Day", rating: 4, onTime: "Yes", easyAccess: "Yes", photographerName: "Jessica Lee", outcome: "minor_issues", staffingFit: "understaffed", setupDifficulty: "medium", issueCategory: "staffing", startedOnTime: true, leadershipReviewNeeded: false, summary: "Client feedback: \"Communication from the studio was excellent.\" We were a camera short before 9 AM, though.", watchOut: "Peak volume runs 7:45–9:00 AM — staff the first wave heavier.", nextTime: "Add one more photographer for the morning rush.", arrivalBuffer: null, staffingNext: 6 },
  { monthsAgo: 12, shootName: "Fall Picture Day 2024", shootType: "School Picture Day", rating: 2, onTime: "No", easyAccess: "Yes", photographerName: "Carisa Anderson", outcome: "major_issues", staffingFit: "understaffed", setupDifficulty: "high", issueCategory: "lighting_environment", startedOnTime: false, leadershipReviewNeeded: true, summary: "Gym lights were off at call time and we were short a hand — the first 30 minutes were dim under house lights.", watchOut: "Gym lights are on a manual panel by the locker rooms — bring them up at arrival.", nextTime: "Switch on the gym lights at load-in and verify with facilities.", arrivalBuffer: 30, staffingNext: 6 },
  { monthsAgo: 14, shootName: "Sports Fall Teams 2024", shootType: "Sports - Fall", rating: 4, onTime: "Yes", easyAccess: "Yes", photographerName: "Spencer Vue", outcome: "smooth", staffingFit: "right_sized", setupDifficulty: "medium", issueCategory: null, startedOnTime: true, leadershipReviewNeeded: false, summary: "Field house team composites ran on schedule.", watchOut: null, nextTime: null, arrivalBuffer: null, staffingNext: null },
  { monthsAgo: 18, shootName: "Senior Graduation 2024", shootType: "Graduation", rating: 3, onTime: "No", easyAccess: "Yes", photographerName: "Josh Park", outcome: "minor_issues", staffingFit: "understaffed", setupDifficulty: "high", issueCategory: "parking_load_in", startedOnTime: false, leadershipReviewNeeded: false, summary: "Load-in was slow; the west bay was blocked by a facilities truck at call time.", watchOut: "The west athletic entrance can be blocked — confirm the bay is clear the night before.", nextTime: "Call facilities to reserve the west bay.", arrivalBuffer: 30, staffingNext: null },
  { monthsAgo: 21, shootName: "Spring Picture Day 2024", shootType: "School Picture Day", rating: 5, onTime: "Yes", easyAccess: "Yes", photographerName: "Jessica Lee", outcome: "smooth", staffingFit: "right_sized", setupDifficulty: "low", issueCategory: null, startedOnTime: true, leadershipReviewNeeded: false, summary: "Client feedback: \"Lines moved quickly and the staff were friendly.\"", watchOut: null, nextTime: null, arrivalBuffer: null, staffingNext: null },
  { monthsAgo: 24, shootName: "Fall Picture Day 2023", shootType: "School Picture Day", rating: 2, onTime: "No", easyAccess: "No", photographerName: "Carisa Anderson", outcome: "major_issues", staffingFit: "understaffed", setupDifficulty: "high", issueCategory: "lighting_environment", startedOnTime: false, leadershipReviewNeeded: true, summary: "Gym lights were off at call time; first 30 minutes shot under house lights and early photos looked dim.", watchOut: "Gym lights are on a manual panel by the locker rooms — bring them up at arrival.", nextTime: "Switch on the gym lights immediately at load-in and verify with facilities.", arrivalBuffer: 30, staffingNext: 6 },
  { monthsAgo: 27, shootName: "Sports Winter Teams 2023", shootType: "Sports - Winter", rating: 4, onTime: "Yes", easyAccess: "Yes", photographerName: "Spencer Vue", outcome: "smooth", staffingFit: "right_sized", setupDifficulty: "medium", issueCategory: null, startedOnTime: true, leadershipReviewNeeded: false, summary: "Auxiliary gym worked well for team composites.", watchOut: null, nextTime: null, arrivalBuffer: null, staffingNext: null },
  { monthsAgo: 30, shootName: "Spring Retakes 2023", shootType: "Underclass Retakes", rating: 4, onTime: "Yes", easyAccess: "Yes", photographerName: "Mike Olson", outcome: "smooth", staffingFit: "right_sized", setupDifficulty: "low", issueCategory: null, startedOnTime: true, leadershipReviewNeeded: false, summary: "Quick retake session in the Commons.", watchOut: null, nextTime: null, arrivalBuffer: null, staffingNext: null },
  { monthsAgo: 33, shootName: "Senior Graduation 2023", shootType: "Graduation", rating: 4, onTime: "Yes", easyAccess: "Yes", photographerName: "Josh Park", outcome: "minor_issues", staffingFit: "right_sized", setupDifficulty: "medium", issueCategory: "student_parent_flow", startedOnTime: true, leadershipReviewNeeded: false, summary: "A few parents had trouble finding the entrance.", watchOut: "Parents miss the entrance — add a sandwich-board sign at the south lot.", nextTime: "Place entrance signage at the south lot.", arrivalBuffer: null, staffingNext: null },
  { monthsAgo: 36, shootName: "Fall Picture Day 2022", shootType: "School Picture Day", rating: 5, onTime: "Yes", easyAccess: "Yes", photographerName: "Carisa Anderson", outcome: "smooth", staffingFit: "right_sized", setupDifficulty: "low", issueCategory: null, startedOnTime: true, leadershipReviewNeeded: false, summary: "Smooth, well-staffed picture day.", watchOut: null, nextTime: null, arrivalBuffer: null, staffingNext: null },
  { monthsAgo: 38, shootName: "Sports Fall Teams 2022", shootType: "Sports - Fall", rating: 4, onTime: "Yes", easyAccess: "Yes", photographerName: "Spencer Vue", outcome: "smooth", staffingFit: "right_sized", setupDifficulty: "medium", issueCategory: null, startedOnTime: true, leadershipReviewNeeded: false, summary: "On schedule in the field house.", watchOut: null, nextTime: null, arrivalBuffer: null, staffingNext: null },
  { monthsAgo: 40, shootName: "Spring Picture Day 2022", shootType: "School Picture Day", rating: 4, onTime: "Yes", easyAccess: "Yes", photographerName: "Jessica Lee", outcome: "minor_issues", staffingFit: "right_sized", setupDifficulty: "medium", issueCategory: "parking_load_in", startedOnTime: true, leadershipReviewNeeded: false, summary: "South lot was busy; load-in took longer than planned.", watchOut: "South lot fills up early — arrive ahead for load-in.", nextTime: "Arrive 30 minutes early for load-in.", arrivalBuffer: 30, staffingNext: null },
  { monthsAgo: 42, shootName: "Senior Graduation 2022", shootType: "Graduation", rating: 4, onTime: "Yes", easyAccess: "Yes", photographerName: "Josh Park", outcome: "smooth", staffingFit: "right_sized", setupDifficulty: "medium", issueCategory: null, startedOnTime: true, leadershipReviewNeeded: false, summary: "Processional ran on time.", watchOut: null, nextTime: null, arrivalBuffer: null, staffingNext: null },
  { monthsAgo: 44, shootName: "Fall Retakes 2021", shootType: "Underclass Retakes", rating: 4, onTime: "Yes", easyAccess: "Yes", photographerName: "Mike Olson", outcome: "smooth", staffingFit: "right_sized", setupDifficulty: "low", issueCategory: null, startedOnTime: true, leadershipReviewNeeded: false, summary: "Quiet retake day.", watchOut: null, nextTime: null, arrivalBuffer: null, staffingNext: null },
  { monthsAgo: 46, shootName: "Fall Picture Day 2021", shootType: "School Picture Day", rating: 4, onTime: "Yes", easyAccess: "Yes", photographerName: "Carisa Anderson", outcome: "smooth", staffingFit: "right_sized", setupDifficulty: "low", issueCategory: null, startedOnTime: true, leadershipReviewNeeded: false, summary: "Solid baseline picture day.", watchOut: null, nextTime: null, arrivalBuffer: null, staffingNext: null }
];

// Demo-only: gives "Wayzata Public Schools -> Wayzata High School" a deep,
// believable history so the Location Intelligence panel has something real to
// remember. One shoot_location row serves both the approved-location picker and
// the /api/locations/intelligence name match.
async function seedWayzataLocationIntelligence() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenant = await client.query<{ id: string }>("SELECT id::text FROM tenant WHERE name = 'Demo Studio' LIMIT 1");
    const tenantId = tenant.rows[0]?.id;
    if (!tenantId) {
      throw new Error("Demo Studio tenant is required before seeding Wayzata location intelligence.");
    }
    const users = await client.query<{ id: string; email: string }>(
      "SELECT id::text, lower(email) AS email FROM app_user WHERE tenant_id = $1 ORDER BY created_at ASC",
      [tenantId]
    );
    const userByEmail = new Map(users.rows.map((user) => [user.email, user]));
    const actor = userByEmail.get("leadership@example.com") ?? userByEmail.get("photo@example.com") ?? users.rows[0];
    if (!actor) {
      throw new Error("Demo users are required before seeding Wayzata location intelligence.");
    }
    const actorUserId = actor.id;

    const existingOrg = await client.query<{ id: string }>(
      "SELECT id::text FROM organization WHERE tenant_id = $1 AND normalized_canonical_name = $2 LIMIT 1",
      [tenantId, normalizeName(WAYZATA_ORG_NAME)]
    );
    let organizationId = existingOrg.rows[0]?.id;
    if (!organizationId) {
      const insertedOrg = await client.query<{ id: string }>(
        `
          INSERT INTO organization (
            tenant_id, canonical_name, normalized_canonical_name, display_name,
            account_type, notes, created_by_user_id, updated_by_user_id
          )
          VALUES ($1, $2, $3, $2, 'schools_underclass_portraits'::organization_account_type, $4, $5, $5)
          RETURNING id::text
        `,
        [tenantId, WAYZATA_ORG_NAME, normalizeName(WAYZATA_ORG_NAME), "[wayzata_location_intel_v1] Location intelligence demo account.", actorUserId]
      );
      organizationId = insertedOrg.rows[0]!.id;
    }

    const locationId = await upsertPilotLocation(client, {
      tenantId,
      organizationId,
      externalKey: "wayzata-high-school",
      name: WAYZATA_HIGH_SCHOOL,
      address: "4955 Peony Ln N, Plymouth, MN 55446",
      addressLine1: "4955 Peony Ln N",
      city: "Plymouth",
      state: "MN",
      zip: "55446",
      actorUserId,
      navigationNotes: "Use the west athletic entrance off the south lot for picture-day load-in.",
      parkingInstructions: "Staff parking in the south lot; the load-in bay is the west athletic entrance.",
      entranceInstructions: "Main front doors are locked until 7:30 AM. Facilities will prop the west door if you call ahead.",
      setupArea: "Main Gym (primary); Auxiliary Gym and Commons for overflow.",
      employeeFacingNotes: "Gym lights are on a manual panel by the locker rooms — budget about 10 minutes to bring them up."
    });

    await client.query("DELETE FROM post_shoot_evaluation WHERE tenant_id = $1 AND location_id = $2", [tenantId, locationId]);
    for (const evaluation of WAYZATA_EVALUATIONS) {
      const when = new Date();
      when.setMonth(when.getMonth() - evaluation.monthsAgo);
      when.setHours(9, 0, 0, 0);
      const shootDate = toIsoDateOnly(when);
      const recordedAt = when.toISOString();
      await client.query(
        `
          INSERT INTO post_shoot_evaluation (
            tenant_id, location_id, shoot_name, shoot_date, photographer_name, shoot_type,
            on_time, easy_access, overall_rating, photos_uploaded,
            photographer_user_id, submitted_by_user_id, notes, recommendations,
            overall_outcome, staffing_fit, setup_difficulty, issue_category, started_on_time,
            short_summary_note, next_time_recommendation, top_watch_out,
            recommended_arrival_buffer_minutes, recommended_staffing_next_time, leadership_review_needed,
            source, created_at, updated_at
          )
          VALUES (
            $1, $2, $3, $4::date, $5, $6,
            $7, $8, $9, $10,
            $11, $11, $12, $13,
            $14::post_shoot_eval_outcome, $15::post_shoot_eval_staffing_fit, $16::post_shoot_eval_setup_difficulty, $17::post_shoot_issue_category, $18,
            $19, $20, $21,
            $22, $23, $24,
            'mission_control', $25::timestamptz, $25::timestamptz
          )
        `,
        [
          tenantId,
          locationId,
          evaluation.shootName,
          shootDate,
          evaluation.photographerName,
          evaluation.shootType,
          evaluation.onTime,
          evaluation.easyAccess,
          evaluation.rating,
          "Yes",
          actorUserId,
          evaluation.summary,
          evaluation.nextTime ?? evaluation.summary,
          evaluation.outcome,
          evaluation.staffingFit,
          evaluation.setupDifficulty,
          evaluation.issueCategory,
          evaluation.startedOnTime,
          evaluation.summary,
          evaluation.nextTime,
          evaluation.watchOut,
          evaluation.arrivalBuffer,
          evaluation.staffingNext,
          evaluation.leadershipReviewNeeded,
          recordedAt
        ]
      );
    }

    await client.query(
      "DELETE FROM operational_note WHERE tenant_id = $1 AND object_type = 'location' AND object_id = $2 AND note_type = 'location_memory'",
      [tenantId, locationId]
    );
    const memoryNotes: Array<{ body: string; pinned: boolean }> = [
      { body: "Load in through the west athletic entrance — the main front doors stay locked until 7:30 AM. Facilities will prop the west door if you call ahead.", pinned: true },
      { body: "Gym lights must be turned on manually at the panel outside the locker rooms; they are not on a timer. Budget about 10 minutes.", pinned: false },
      { body: "Morning traffic on Vicksburg Ln backs up before 8 AM — plan to arrive about 30 minutes early.", pinned: false }
    ];
    for (const note of memoryNotes) {
      await client.query(
        `
          INSERT INTO operational_note (
            tenant_id, object_type, object_id, note_type, body, author_user_id,
            permanence_classification, visibility_scope, publication_state, source_context, pinned,
            promoted_to_location_id, promotion_published_at
          )
          VALUES (
            $1, 'location'::operational_note_object_type, $2::uuid, 'location_memory'::operational_note_type, $3, $4,
            'persistent_memory'::operational_note_permanence, 'object_viewers'::operational_note_visibility_scope, 'active'::operational_note_publication_state, 'mission_control', $5,
            $2::uuid, now()
          )
        `,
        [tenantId, locationId, note.body, actorUserId, note.pinned]
      );
    }

    await client.query("COMMIT");
    return { organization_id: organizationId, location_id: locationId, evaluations: WAYZATA_EVALUATIONS.length, memory_notes: memoryNotes.length };
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
  const photographyToday = await seedSameDayPhotographyPilotRows();
  const wayzataLocationIntel = await seedWayzataLocationIntelligence();
  const counts = await getDemoCounts();
  assertDemoCaps(counts);
  return {
    ok: true,
    demo_marker: DEMO_MARKER,
    project_tracking: projectTracking,
    job_closeout: jobCloseout,
    sports_peer_qa: sportsPeerQa,
    photography_today: photographyToday,
    wayzata_location_intel: wayzataLocationIntel,
    counts,
    seeded_areas: ["client_command_center", "project_tracking", "workflow_templates", "job_closeout", "sports_peer_qa", "photography_today", "wayzata_location_intel"],
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
