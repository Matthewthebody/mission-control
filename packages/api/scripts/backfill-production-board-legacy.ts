import { pool } from "../src/db/pool.js";
import { withSystemTransaction } from "../src/db/tx.js";
import { mapWorkflowStatusToLegacyStatus } from "../src/services/jobTruth/productionBoardEngine.js";
import {
  buildLegacySchoolWorkDeliverableSeed,
  buildLegacySportsSpecialtyDeliverableSeed,
  mapLegacyProductionProjectToProductionItemSeed
} from "../src/services/jobTruth/productionBoardTemplates.js";
import type { JobDepartmentType, ProductionBoardWorkflowStatus } from "../src/domain/jobTruth/index.js";
import type { PoolClient } from "pg";

type LegacyProjectRow = {
  tenant_id: string;
  legacy_id: string;
  title: string;
  status: string | null;
  job_type: string | null;
  stage: string | null;
  owner_user_id: string | null;
  peer_reviewer_user_id: string | null;
  final_qc_reviewer_user_id: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  linked_shoot_id: string | null;
  job_id: string | null;
  department_type: JobDepartmentType | null;
  organization_id: string | null;
  location_id: string | null;
  primary_contact_id: string | null;
  account_owner_user_id: string | null;
  job_category: string | null;
};

type LegacySchoolWorkRow = {
  tenant_id: string;
  legacy_id: string;
  title: string;
  work_type: string;
  linked_shoot_id: string | null;
  job_id: string | null;
  production_item_id: string | null;
};

type LegacySportsSpecialtyRow = {
  tenant_id: string;
  legacy_id: string;
  title: string;
  product_type: string;
  vendor_name: string | null;
  shoot_id: string;
  job_id: string | null;
  production_item_id: string | null;
};

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

function getArgValue(flag: string) {
  const entry = process.argv.find((value) => value.startsWith(`${flag}=`));
  return entry ? entry.slice(flag.length + 1) : null;
}

function mapLegacyStageToWorkflow(stage: string | null | undefined, status: string | null | undefined): ProductionBoardWorkflowStatus {
  if (status === "completed" || stage === "released_complete") {
    return "DELIVERED_CLOSED";
  }
  switch (stage) {
    case "intake_pending":
      return "WAITING_ON_INTAKE";
    case "ready_for_production":
      return "READY_FOR_PRODUCTION";
    case "in_production":
      return "IN_PRODUCTION";
    case "blocked":
      return "BLOCKED";
    case "ready_for_qa":
      return "READY_FOR_QA";
    case "in_qa_review":
      return "IN_PEER_REVIEW";
    case "correction_needed":
      return "REWORK_REQUIRED";
    case "ready_to_release":
      return "READY_FOR_RELEASE";
    case "on_hold":
      return "ON_HOLD";
    case "cancelled":
      return "CANCELLED";
    default:
      return "DRAFT";
  }
}

function inferDepartment(jobType: string | null | undefined): JobDepartmentType {
  if (jobType?.includes("school")) {
    return "schools";
  }
  if (jobType?.includes("sports") || jobType?.includes("banner") || jobType?.includes("gallery")) {
    return "sports";
  }
  return "other";
}

async function insertDeliverableIfMissing(
  client: PoolClient,
  tenantId: string,
  productionItemId: string,
  seed: ReturnType<typeof buildLegacySchoolWorkDeliverableSeed>
) {
  const existing = await client.query(
    `
      SELECT 1
      FROM deliverable_items
      WHERE tenant_id = $1
        AND production_item_id = $2
        AND (
          legacy_source_reference = $3
          OR (
            deliverable_type = $4
            AND COALESCE(deliverable_group_key, '') = COALESCE($5, '')
            AND COALESCE(completion_marker_key, '') = COALESCE($6, '')
          )
        )
      LIMIT 1
    `,
    [tenantId, productionItemId, seed.legacy_source_reference ?? null, seed.deliverable_type, seed.deliverable_group_key, seed.completion_marker_key]
  );
  if (existing.rowCount) {
    return false;
  }
  await client.query(
    `
      INSERT INTO deliverable_items (
        tenant_id,
        production_item_id,
        deliverable_type,
        deliverable_group_key,
        completion_marker_key,
        title,
        quantity,
        delivery_method,
        status,
        vendor_name,
        legacy_source_reference
      )
      VALUES ($1,$2,$3,$4,$5,$6,null,$7,$8::job_deliverable_status_type,$9,$10)
    `,
    [
      tenantId,
      productionItemId,
      seed.deliverable_type,
      seed.deliverable_group_key,
      seed.completion_marker_key,
      seed.title,
      seed.delivery_method,
      seed.status ?? "not_started",
      seed.vendor_name ?? null,
      seed.legacy_source_reference ?? null
    ]
  );
  return true;
}

async function backfillLegacyProjects(client: PoolClient, tenantId: string | null, dryRun: boolean) {
  const rows = await client.query<LegacyProjectRow>(
    `
      SELECT
        project.tenant_id::text,
        project.id::text AS legacy_id,
        project.title,
        project.status::text,
        project.job_type::text,
        project.stage::text,
        project.owner_user_id::text,
        project.peer_reviewer_user_id::text,
        project.final_qc_reviewer_user_id::text,
        project.due_date::text,
        project.completed_at::text,
        project.created_at::text,
        project.updated_at::text,
        project.linked_shoot_id::text,
        mapped_job.job_id,
        mapped_job.department_type::text AS department_type,
        mapped_job.organization_id,
        mapped_job.location_id,
        mapped_job.primary_contact_id,
        mapped_job.account_owner_user_id,
        mapped_job.job_category
      FROM production_project project
      LEFT JOIN LATERAL (
        SELECT
          job.id::text AS job_id,
          job.department_type,
          job.organization_id::text,
          job.primary_location_id::text AS location_id,
          job.primary_contact_id::text,
          job.account_owner_user_id::text,
          job.job_category::text AS job_category
        FROM jobs job
        LEFT JOIN job_shoot_links link
          ON link.tenant_id = job.tenant_id
         AND link.job_id = job.id
         AND link.shoot_id = project.linked_shoot_id
        WHERE job.tenant_id = project.tenant_id
          AND (
            link.shoot_id IS NOT NULL
            OR (project.linked_shoot_id IS NOT NULL AND job.legacy_shoot_id = project.linked_shoot_id)
          )
        ORDER BY CASE WHEN link.shoot_id IS NOT NULL THEN 0 ELSE 1 END, job.created_at ASC
        LIMIT 1
      ) mapped_job ON TRUE
      WHERE ($1::uuid IS NULL OR project.tenant_id = $1::uuid)
      ORDER BY project.created_at ASC
    `,
    [tenantId]
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows.rows) {
    if (!row.job_id) {
      skipped += 1;
      continue;
    }
    const seed = mapLegacyProductionProjectToProductionItemSeed({
      legacyId: row.legacy_id,
      departmentType: row.department_type ?? inferDepartment(row.job_type),
      title: row.title,
      jobType: row.job_type,
      stage: row.stage,
      status: row.status,
      ownerUserId: row.owner_user_id,
      peerReviewerUserId: row.peer_reviewer_user_id,
      finalQcReviewerUserId: row.final_qc_reviewer_user_id,
      dueDate: row.due_date,
      completedAt: row.completed_at
    });
    const workflowStatus = mapLegacyStageToWorkflow(row.stage, row.status);
    const legacyStatus = mapWorkflowStatusToLegacyStatus(workflowStatus, "NOT_STARTED", null);
    if (dryRun) {
      created += 1;
      continue;
    }
    const existing = await client.query<{ id: string }>(
      `
        SELECT id::text AS id
        FROM production_items
        WHERE tenant_id = $1
          AND (id = $2::uuid OR legacy_source_reference = $3)
        LIMIT 1
      `,
      [row.tenant_id, row.legacy_id, seed.legacy_source_reference]
    );
    if (existing.rowCount) {
      await client.query(
        `
          UPDATE production_items
          SET production_template_key = COALESCE(production_template_key, $4),
              completion_rule_key = COALESCE(completion_rule_key, $5),
              imported_status_source = COALESCE(imported_status_source, $6),
              legacy_owner_history_json = COALESCE(legacy_owner_history_json, $7::jsonb),
              legacy_source_reference = COALESCE(legacy_source_reference, $8),
              updated_at = now()
          WHERE tenant_id = $1
            AND id = $2::uuid
        `,
        [row.tenant_id, existing.rows[0].id, seed.production_template_key, seed.completion_rule_key, seed.imported_status_source, JSON.stringify(seed.legacy_owner_history_json), seed.legacy_source_reference]
      );
      updated += 1;
      continue;
    }
    await client.query(
      `
        INSERT INTO production_items (
          id,
          tenant_id,
          job_id,
          production_group_key,
          title,
          job_type,
          production_type,
          production_template_key,
          completion_rule_key,
          created_from_source,
          status,
          workflow_status,
          health_state,
          sync_state,
          priority,
          assigned_to_user_id,
          assigned_peer_reviewer_user_id,
          assigned_release_reviewer_user_id,
          department_owner_user_id,
          organization_id,
          location_id,
          primary_contact_id,
          account_owner_user_id,
          department_type,
          approval_required,
          proof_required,
          qa_required,
          due_at,
          release_due_at,
          completed_at,
          closed_at,
          legacy_source_reference,
          imported_status_source,
          legacy_owner_history_json,
          created_at,
          updated_at
        )
        VALUES (
          $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,'legacy_import',
          $10::job_production_status_type,$11::production_board_workflow_status_type,$12::production_board_health_state_type,
          'STALE'::production_board_sync_state_type,'normal'::job_priority_level,$13::uuid,$14::uuid,$15::uuid,$16::uuid,
          $17::uuid,$18::uuid,$19::uuid,$20::uuid,$21::job_department_type,false,false,true,$22,$23,$24,$25,$26,$27,$28::jsonb,$29,$30
        )
      `,
      [
        row.legacy_id,
        row.tenant_id,
        row.job_id,
        `${row.department_type ?? inferDepartment(row.job_type)}:${row.job_id}:legacy:${row.legacy_id}`,
        row.title,
        row.job_category ?? row.job_type ?? "other",
        seed.production_type,
        seed.production_template_key,
        seed.completion_rule_key,
        legacyStatus,
        workflowStatus,
        workflowStatus === "BLOCKED" ? "BLOCKED" : row.completed_at ? "ON_TRACK" : "WATCH",
        row.owner_user_id,
        row.peer_reviewer_user_id,
        row.final_qc_reviewer_user_id,
        row.owner_user_id ?? row.account_owner_user_id,
        row.organization_id,
        row.location_id,
        row.primary_contact_id,
        row.account_owner_user_id,
        row.department_type ?? inferDepartment(row.job_type),
        row.due_date,
        row.due_date,
        seed.completed_at,
        seed.completed_at,
        seed.legacy_source_reference,
        seed.imported_status_source,
        JSON.stringify(seed.legacy_owner_history_json),
        row.created_at,
        row.updated_at
      ]
    );
    created += 1;
  }

  return { created, updated, skipped };
}

async function mapLegacyDeliverables(client: PoolClient, tenantId: string | null, dryRun: boolean) {
  const schoolRows = await client.query<LegacySchoolWorkRow>(
    `
      SELECT
        work_item.tenant_id::text,
        work_item.id::text AS legacy_id,
        work_item.title,
        work_item.work_type::text,
        work_item.linked_shoot_id::text,
        job.id::text AS job_id,
        item.id::text AS production_item_id
      FROM school_work_item work_item
      LEFT JOIN job_shoot_links link
        ON link.tenant_id = work_item.tenant_id
       AND link.shoot_id = work_item.linked_shoot_id
      LEFT JOIN jobs job
        ON job.tenant_id = work_item.tenant_id
       AND job.id = link.job_id
      LEFT JOIN production_items item
        ON item.tenant_id = work_item.tenant_id
       AND item.job_id = job.id
       AND item.merged_into_production_item_id IS NULL
      WHERE ($1::uuid IS NULL OR work_item.tenant_id = $1::uuid)
    `,
    [tenantId]
  );

  const sportsRows = await client.query<LegacySportsSpecialtyRow>(
    `
      SELECT
        specialty.tenant_id::text,
        specialty.id::text AS legacy_id,
        specialty.title,
        specialty.product_type,
        specialty.vendor_name,
        specialty.shoot_id::text,
        job.id::text AS job_id,
        item.id::text AS production_item_id
      FROM sports_specialty_product_item specialty
      LEFT JOIN job_shoot_links link
        ON link.tenant_id = specialty.tenant_id
       AND link.shoot_id = specialty.shoot_id
      LEFT JOIN jobs job
        ON job.tenant_id = specialty.tenant_id
       AND job.id = link.job_id
      LEFT JOIN production_items item
        ON item.tenant_id = specialty.tenant_id
       AND item.job_id = job.id
       AND item.merged_into_production_item_id IS NULL
      WHERE ($1::uuid IS NULL OR specialty.tenant_id = $1::uuid)
    `,
    [tenantId]
  );

  let mapped = 0;
  let skipped = 0;

  for (const row of schoolRows.rows) {
    if (!row.production_item_id) {
      skipped += 1;
      continue;
    }
    if (!dryRun) {
      await insertDeliverableIfMissing(client, row.tenant_id, row.production_item_id, buildLegacySchoolWorkDeliverableSeed({
        legacyId: row.legacy_id,
        workType: row.work_type,
        title: row.title
      }));
    }
    mapped += 1;
  }

  for (const row of sportsRows.rows) {
    if (!row.production_item_id) {
      skipped += 1;
      continue;
    }
    if (!dryRun) {
      await insertDeliverableIfMissing(client, row.tenant_id, row.production_item_id, buildLegacySportsSpecialtyDeliverableSeed({
        legacyId: row.legacy_id,
        productType: row.product_type,
        title: row.title,
        vendorName: row.vendor_name
      }));
    }
    mapped += 1;
  }

  return { mapped, skipped };
}

async function main() {
  const dryRun = !hasFlag("--write") && !hasFlag("--apply");
  const tenantId = getArgValue("--tenant");
  const summary = await withSystemTransaction(async (client) => {
    const projects = await backfillLegacyProjects(client, tenantId, dryRun);
    const deliverables = await mapLegacyDeliverables(client, tenantId, dryRun);
    return { dryRun, tenantId, projects, deliverables };
  });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));
  await pool.end();
}

main().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  await pool.end();
  process.exit(1);
});
