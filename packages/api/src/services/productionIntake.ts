import type { PoolClient } from "pg";
import { createAuditLog } from "./audit.js";
import { ensureTriggeredProductionProject, triggerProductionProjectFromShootCompletion } from "./productionProjects.js";
import type { AuthUser } from "../types/auth.js";
import type {
  ProductionProjectCategory,
  ProductionProjectIntakeIssue,
  ProductionProjectIntakeIssueKind,
  ProductionProjectIntakeSummary,
  ProductionProjectJobType,
  ProductionProjectPriority,
  ProductionProjectStage,
  ProductionProjectStatus
} from "../types/productionProjects.js";
import type { SchoolWorkPriority, SchoolWorkSourceSystem, SchoolWorkStage, SchoolWorkStatus, SchoolWorkType, SchoolWorkWaitingOn } from "../types/schoolsHub.js";

type ShootIntakeRow = {
  id: string;
  shoot_code: string | null;
  title: string;
  shoot_date: string;
  organization_id: string | null;
  organization_name: string | null;
  location_id: string | null;
  location_name: string | null;
  shoot_type: string | null;
  readiness_owner_user_id: string | null;
};

type SchoolWorkIntakeRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  school_job_id: string | null;
  school_job_title: string | null;
  linked_shoot_id: string | null;
  linked_shoot_code: string | null;
  linked_shoot_title: string | null;
  linked_shoot_date: string | null;
  linked_shoot_type: string | null;
  linked_location_id: string | null;
  linked_location_name: string | null;
  linked_production_project_id: string | null;
  linked_production_project_title: string | null;
  linked_production_project_status: ProductionProjectStatus | null;
  linked_production_project_stage: ProductionProjectStage | null;
  linked_project_organization_id: string | null;
  linked_project_shoot_id: string | null;
  work_type: SchoolWorkType;
  title: string;
  description: string | null;
  owner_user_id: string | null;
  status: SchoolWorkStatus;
  stage: SchoolWorkStage;
  priority: SchoolWorkPriority;
  due_date: string | null;
  sla_date: string | null;
  blocker_reason: string | null;
  waiting_on: SchoolWorkWaitingOn;
  source_system: SchoolWorkSourceSystem;
  source_reference: string | null;
  notes: string | null;
  updated_at: string;
  monday_external_record_id: string | null;
  monday_sync_operation_id: string | null;
  monday_sync_operation_status: "pending" | "processing" | "succeeded" | "failed" | "conflict" | null;
  monday_sync_updated_at: string | null;
  monday_sync_error: string | null;
  monday_sync_conflict_summary: string | null;
};

type ExistingSourceProjectRow = {
  id: string;
  title: string;
  status: ProductionProjectStatus;
  stage: ProductionProjectStage;
  source_event_key: string;
  linked_organization_id: string | null;
  linked_shoot_id: string | null;
};

type IntakeCollector = {
  generatedAt: string;
  counts: ProductionProjectIntakeSummary["counts"];
  issues: ProductionProjectIntakeIssue[];
  issueIds: Set<string>;
};

const SCHOOL_INTAKE_WORK_TYPES: SchoolWorkType[] = ["gallery_release", "id_production", "yearbook"];
const STALE_SYNC_THRESHOLD_DAYS = 3;
const MAX_ISSUES = 12;

export async function synchronizeProductionIntake(
  client: PoolClient,
  auth: AuthUser,
  options: { anchorDate: string }
): Promise<ProductionProjectIntakeSummary> {
  return collectProductionIntakeSummary(client, auth, options, { allowMutation: true });
}

export async function inspectProductionIntake(
  client: PoolClient,
  auth: AuthUser,
  options: { anchorDate: string }
): Promise<ProductionProjectIntakeSummary> {
  return collectProductionIntakeSummary(client, auth, options, { allowMutation: false });
}

async function collectProductionIntakeSummary(
  client: PoolClient,
  auth: AuthUser,
  options: { anchorDate: string },
  settings: { allowMutation: boolean }
): Promise<ProductionProjectIntakeSummary> {
  const collector: IntakeCollector = {
    generatedAt: new Date().toISOString(),
    counts: {
      sources_considered: 0,
      created: 0,
      linked: 0,
      duplicates: 0,
      conflicts: 0,
      sync_failures: 0,
      stale_syncs: 0
    },
    issues: [],
    issueIds: new Set<string>()
  };

  await synchronizeShootIntake(client, auth, options, collector, settings);
  await synchronizeSchoolWorkIntake(client, auth, options, collector, settings);

  const issues = [...collector.issues]
    .sort((left, right) => {
      const toneDelta = toneRank(left.tone) - toneRank(right.tone);
      if (toneDelta !== 0) {
        return toneDelta;
      }
      return (right.last_seen_at ?? "").localeCompare(left.last_seen_at ?? "");
    })
    .slice(0, MAX_ISSUES);

  return {
    generated_at: collector.generatedAt,
    summary_line: buildIntakeSummaryLine(collector),
    counts: collector.counts,
    issues
  };
}

async function synchronizeShootIntake(
  client: PoolClient,
  auth: AuthUser,
  options: { anchorDate: string },
  collector: IntakeCollector,
  settings: { allowMutation: boolean }
) {
  const shootRows = await client.query<ShootIntakeRow>(
    `
      SELECT
        shoot.id::text,
        shoot.shoot_code,
        shoot.title,
        shoot.shoot_date::text,
        shoot.organization_id::text,
        organization.display_name AS organization_name,
        shoot.location_id::text,
        location.name AS location_name,
        shoot.shoot_type,
        shoot.readiness_owner_user_id::text
      FROM shoot
      LEFT JOIN organization
        ON organization.tenant_id = shoot.tenant_id
       AND organization.id = shoot.organization_id
      LEFT JOIN shoot_location location
        ON location.tenant_id = shoot.tenant_id
       AND location.id = shoot.location_id
      WHERE shoot.tenant_id = $1
        AND shoot.deleted_at IS NULL
        AND shoot.status = 'POST_PRODUCTION'
      ORDER BY shoot.shoot_date DESC, shoot.updated_at DESC
      LIMIT 400
    `,
    [auth.tenantId]
  );

  collector.counts.sources_considered += shootRows.rows.length;

  for (const row of shootRows.rows) {
    if (!settings.allowMutation) {
      continue;
    }
    try {
      const result = await triggerProductionProjectFromShootCompletion(client, auth, {
        shootId: row.id,
        shootCode: row.shoot_code,
        shootTitle: row.title,
        shootDate: row.shoot_date,
        organizationId: row.organization_id,
        locationId: row.location_id,
        shootType: row.shoot_type,
        ownerUserId: row.readiness_owner_user_id
      });
      if (result.created) {
        collector.counts.created += 1;
      }
    } catch (error) {
      collector.counts.conflicts += 1;
      pushIssue(collector, {
        id: `shoot-backfill:${row.id}`,
        issue_kind: "backfill_failed",
        title: `${row.shoot_code ?? row.title} could not enter the production funnel`,
        summary: messageForIntakeError(error, "The shoot is in post-production, but the canonical production project could not be created automatically."),
        source_label: row.shoot_type === "sports" ? "Sports shoot" : "Shoot post-production",
        source_system_label: "Mission Control",
        source_reference: `shoot:${row.id}`,
        context_label: [row.organization_name, row.location_name, row.shoot_date ? `Shoot ${formatDateLabel(row.shoot_date)}` : null]
          .filter(Boolean)
          .join(" | "),
        linked_project_id: null,
        linked_project_title: null,
        action_hash: `#operations/shoots?shoot=${row.id}`,
        tone: "critical",
        last_seen_at: options.anchorDate
      });
    }
  }
}

async function synchronizeSchoolWorkIntake(
  client: PoolClient,
  auth: AuthUser,
  options: { anchorDate: string },
  collector: IntakeCollector,
  settings: { allowMutation: boolean }
) {
  const workItemRows = await client.query<SchoolWorkIntakeRow>(
    `
      SELECT
        work_item.id::text,
        work_item.organization_id::text,
        organization.display_name AS organization_name,
        work_item.school_job_id::text,
        school_job.title AS school_job_title,
        work_item.linked_shoot_id::text,
        shoot.shoot_code AS linked_shoot_code,
        shoot.title AS linked_shoot_title,
        shoot.shoot_date::text AS linked_shoot_date,
        shoot.shoot_type AS linked_shoot_type,
        work_item.linked_location_id::text,
        location.name AS linked_location_name,
        work_item.linked_production_project_id::text,
        project.title AS linked_production_project_title,
        project.status::text AS linked_production_project_status,
        project.stage::text AS linked_production_project_stage,
        project.linked_organization_id::text AS linked_project_organization_id,
        project.linked_shoot_id::text AS linked_project_shoot_id,
        work_item.work_type::text,
        work_item.title,
        work_item.description,
        work_item.owner_user_id::text,
        work_item.status::text,
        work_item.stage::text,
        work_item.priority::text,
        work_item.due_date::text,
        work_item.sla_date::text,
        work_item.blocker_reason,
        work_item.waiting_on::text,
        work_item.source_system::text,
        work_item.source_reference,
        work_item.notes,
        work_item.updated_at::text,
        external_map.external_id AS monday_external_record_id,
        monday_sync.id::text AS monday_sync_operation_id,
        monday_sync.status::text AS monday_sync_operation_status,
        monday_sync.updated_at::text AS monday_sync_updated_at,
        monday_sync.last_error AS monday_sync_error,
        monday_sync.conflict_summary AS monday_sync_conflict_summary
      FROM school_work_item work_item
      JOIN organization
        ON organization.tenant_id = work_item.tenant_id
       AND organization.id = work_item.organization_id
      LEFT JOIN school_job
        ON school_job.tenant_id = work_item.tenant_id
       AND school_job.id = work_item.school_job_id
      LEFT JOIN shoot
        ON shoot.tenant_id = work_item.tenant_id
       AND shoot.id = work_item.linked_shoot_id
      LEFT JOIN shoot_location location
        ON location.tenant_id = work_item.tenant_id
       AND location.id = work_item.linked_location_id
      LEFT JOIN production_project project
        ON project.tenant_id = work_item.tenant_id
       AND project.id = work_item.linked_production_project_id
      LEFT JOIN external_object_map external_map
        ON external_map.tenant_id = work_item.tenant_id
       AND external_map.provider = 'monday'
       AND external_map.object_type = 'school_work_item'
       AND external_map.object_id = work_item.id
      LEFT JOIN LATERAL (
        SELECT id, status, updated_at, last_error, conflict_summary
        FROM integration_sync_operation
        WHERE tenant_id = work_item.tenant_id
          AND provider = 'monday'
          AND entity_type = 'school_work_item'
          AND entity_id = work_item.id
        ORDER BY created_at DESC
        LIMIT 1
      ) monday_sync ON true
      WHERE work_item.tenant_id = $1
        AND work_item.work_type = ANY($2::school_work_type[])
        AND work_item.status NOT IN ('completed', 'cancelled')
      ORDER BY COALESCE(work_item.due_date, work_item.sla_date) ASC NULLS LAST, work_item.updated_at DESC
      LIMIT 500
    `,
    [auth.tenantId, SCHOOL_INTAKE_WORK_TYPES]
  );

  const rows = workItemRows.rows;
  collector.counts.sources_considered += rows.length;

  const duplicateGroups = new Map<string, SchoolWorkIntakeRow[]>();
  for (const row of rows) {
    const key = buildSchoolWorkDedupeKey(row);
    if (!duplicateGroups.has(key)) {
      duplicateGroups.set(key, []);
    }
    duplicateGroups.get(key)?.push(row);
    collectSchoolSyncIssues(row, options.anchorDate, collector);
  }

  const primaryRows: SchoolWorkIntakeRow[] = [];
  for (const group of duplicateGroups.values()) {
    const sorted = [...group].sort(compareSchoolWorkPrimaryOrder);
    const primary = sorted[0];
    primaryRows.push(primary);

    if (sorted.length > 1) {
      collector.counts.duplicates += sorted.length - 1;
      const linkedProjects = new Set(sorted.map((item) => item.linked_production_project_id).filter(Boolean));
      if (linkedProjects.size > 1) {
        collector.counts.conflicts += 1;
      }
      pushIssue(collector, {
        id: `duplicate-school-work:${buildSchoolWorkDedupeKey(primary)}`,
        issue_kind: linkedProjects.size > 1 ? "conflicting_link" : "duplicate_source",
        title: `${primary.title} has duplicate upstream intake records`,
        summary:
          linkedProjects.size > 1
            ? "Multiple upstream work items look like the same production job and already point at different production records."
            : "Multiple upstream work items look like the same production job. The intake funnel will only auto-promote one until the duplicate is cleaned up.",
        source_label: labelForSchoolWorkType(primary.work_type),
        source_system_label: labelForSourceSystem(primary.source_system),
        source_reference: primary.source_reference,
        context_label: buildSchoolWorkContextLabel(primary),
        linked_project_id: primary.linked_production_project_id,
        linked_project_title: primary.linked_production_project_title,
        action_hash: `#schools?item=${primary.id}`,
        tone: linkedProjects.size > 1 ? "critical" : "warning",
        last_seen_at: primary.updated_at
      });
    }
  }

  const expectedSourceEventKeys = primaryRows.map((row) => buildSchoolWorkSourceEventKey(row.id));
  const existingSourceProjects = expectedSourceEventKeys.length
    ? await client.query<ExistingSourceProjectRow>(
        `
          SELECT
            id::text,
            title,
            status::text,
            stage::text,
            source_event_key,
            linked_organization_id::text,
            linked_shoot_id::text
          FROM production_project
          WHERE tenant_id = $1
            AND source_event_key = ANY($2::text[])
        `,
        [auth.tenantId, expectedSourceEventKeys]
      )
    : { rows: [] as ExistingSourceProjectRow[] };
  const existingSourceMap = new Map(existingSourceProjects.rows.map((row) => [row.source_event_key, row]));

  for (const row of primaryRows) {
    const expectedSourceEventKey = buildSchoolWorkSourceEventKey(row.id);
    const existingSourceProject = existingSourceMap.get(expectedSourceEventKey) ?? null;

    if (row.linked_production_project_id) {
      const missingLinkedProject = !row.linked_production_project_title;
      const closedLinkedProject =
        row.linked_production_project_status === "completed" || row.linked_production_project_stage === "released_complete";
      const mismatchedLinkedContext =
        Boolean(row.linked_project_organization_id && row.linked_project_organization_id !== row.organization_id) ||
        Boolean(row.linked_project_shoot_id && row.linked_shoot_id && row.linked_project_shoot_id !== row.linked_shoot_id);

      if (missingLinkedProject || closedLinkedProject || mismatchedLinkedContext) {
        collector.counts.conflicts += 1;
        pushIssue(collector, {
          id: `school-work-link:${row.id}`,
          issue_kind: "conflicting_link",
          title: `${row.title} is linked to the wrong production record`,
          summary: missingLinkedProject
            ? "The upstream work item still points at a production record that no longer exists."
            : closedLinkedProject
              ? "The upstream work item is still open, but its linked production record is already closed."
              : "The upstream work item is linked to a production record whose shoot or organization context no longer matches.",
          source_label: labelForSchoolWorkType(row.work_type),
          source_system_label: labelForSourceSystem(row.source_system),
          source_reference: row.source_reference,
          context_label: buildSchoolWorkContextLabel(row),
          linked_project_id: row.linked_production_project_id,
          linked_project_title: row.linked_production_project_title,
          action_hash: `#schools?item=${row.id}`,
          tone: "critical",
          last_seen_at: row.updated_at
        });
        continue;
      }

      if (existingSourceProject && existingSourceProject.id !== row.linked_production_project_id) {
        collector.counts.conflicts += 1;
        pushIssue(collector, {
          id: `school-work-source-conflict:${row.id}`,
          issue_kind: "conflicting_link",
          title: `${row.title} resolves to two different production records`,
          summary: "The upstream work item is manually linked to one production record, but the canonical intake source key resolves to another.",
          source_label: labelForSchoolWorkType(row.work_type),
          source_system_label: labelForSourceSystem(row.source_system),
          source_reference: row.source_reference,
          context_label: buildSchoolWorkContextLabel(row),
          linked_project_id: row.linked_production_project_id,
          linked_project_title: row.linked_production_project_title,
          action_hash: `#schools?item=${row.id}`,
          tone: "critical",
          last_seen_at: row.updated_at
        });
      }
      continue;
    }

    if (existingSourceProject) {
      const closedSourceProject =
        existingSourceProject.status === "completed" || existingSourceProject.stage === "released_complete";
      const mismatchedSourceContext =
        Boolean(existingSourceProject.linked_organization_id && existingSourceProject.linked_organization_id !== row.organization_id) ||
        Boolean(existingSourceProject.linked_shoot_id && row.linked_shoot_id && existingSourceProject.linked_shoot_id !== row.linked_shoot_id);
      if (closedSourceProject || mismatchedSourceContext) {
        collector.counts.conflicts += 1;
        pushIssue(collector, {
          id: `school-work-source-existing-conflict:${row.id}`,
          issue_kind: "conflicting_link",
          title: `${row.title} resolves to an unusable production record`,
          summary: closedSourceProject
            ? "The canonical intake key already resolves to a closed production job, so the funnel is refusing to relink this open work item automatically."
            : "The canonical intake key resolves to a production job whose shoot or organization context no longer matches this upstream record.",
          source_label: labelForSchoolWorkType(row.work_type),
          source_system_label: labelForSourceSystem(row.source_system),
          source_reference: row.source_reference,
          context_label: buildSchoolWorkContextLabel(row),
          linked_project_id: existingSourceProject.id,
          linked_project_title: existingSourceProject.title,
          action_hash: `#schools?item=${row.id}`,
          tone: "critical",
          last_seen_at: row.updated_at
        });
        continue;
      }
      if (!settings.allowMutation) {
        continue;
      }
      await linkSchoolWorkItemToProject(client, auth, row, existingSourceProject.id);
      collector.counts.linked += 1;
      continue;
    }

    if (!settings.allowMutation) {
      continue;
    }

    try {
      const created = await ensureTriggeredProductionProject(client, auth, {
        triggerKey: triggerKeyForSchoolWorkType(row.work_type),
        sourceEventKey: expectedSourceEventKey,
        title: row.title,
        summary:
          normalizeNullableText(row.description) ??
          `${row.organization_name} ${labelForSchoolWorkType(row.work_type).toLowerCase()} work is open and now needs canonical production tracking.`,
        createdReason: `${labelForSchoolWorkType(row.work_type)} now feeds the Production lead board automatically instead of relying on duplicate entry.`,
        anchorDate: options.anchorDate,
        ownerUserId: row.owner_user_id,
        priority: mapSchoolPriority(row.priority),
        jobType: jobTypeForSchoolWorkType(row.work_type),
        category: categoryForSchoolWorkType(row.work_type),
        stage: mapSchoolWorkToProductionStage(row),
        dueDate: row.due_date ?? row.sla_date ?? null,
        followUpDate: row.sla_date ?? row.due_date ?? null,
        linkedOrganizationId: row.organization_id,
        linkedLocationId: row.linked_location_id,
        linkedShootId: row.linked_shoot_id,
        latestNote: normalizeNullableText(row.notes)
      });

      if (created.created) {
        collector.counts.created += 1;
      }
      await linkSchoolWorkItemToProject(client, auth, row, created.project.project.id);
      collector.counts.linked += 1;
    } catch (error) {
      collector.counts.conflicts += 1;
      pushIssue(collector, {
        id: `school-work-backfill:${row.id}`,
        issue_kind: "backfill_failed",
        title: `${row.title} could not enter the production funnel`,
        summary: messageForIntakeError(error, "The canonical production record could not be created from this upstream work item."),
        source_label: labelForSchoolWorkType(row.work_type),
        source_system_label: labelForSourceSystem(row.source_system),
        source_reference: row.source_reference,
        context_label: buildSchoolWorkContextLabel(row),
        linked_project_id: null,
        linked_project_title: null,
        action_hash: `#schools?item=${row.id}`,
        tone: "critical",
        last_seen_at: row.updated_at
      });
    }
  }
}

async function linkSchoolWorkItemToProject(
  client: PoolClient,
  auth: AuthUser,
  row: SchoolWorkIntakeRow,
  projectId: string
) {
  const result = await client.query<{ id: string }>(
    `
      UPDATE school_work_item
      SET linked_production_project_id = $3::uuid,
          updated_by_user_id = $4::uuid,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2::uuid
        AND linked_production_project_id IS DISTINCT FROM $3::uuid
      RETURNING id::text AS id
    `,
    [auth.tenantId, row.id, projectId, auth.id]
  );

  if (!result.rows[0]) {
    return;
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "school_work_item.production_intake_linked",
    entityType: "school_work_item",
    entityId: row.id,
    metadata: {
      source_surface: "production_intake_funnel",
      source_reference: row.source_reference,
      work_type: row.work_type
    },
    previousValues: {
      linked_production_project_id: row.linked_production_project_id
    },
    newValues: {
      linked_production_project_id: projectId
    }
  });
}

function collectSchoolSyncIssues(row: SchoolWorkIntakeRow, anchorDate: string, collector: IntakeCollector) {
  if (row.monday_sync_operation_status === "failed") {
    collector.counts.sync_failures += 1;
    pushIssue(collector, {
      id: `school-sync-failed:${row.id}`,
      issue_kind: "sync_failed",
      title: `${row.title} has a failed Monday sync`,
      summary: row.monday_sync_error ?? "The last Monday coexistence import failed and this intake source may be stale.",
      source_label: labelForSchoolWorkType(row.work_type),
      source_system_label: "Monday coexistence",
      source_reference: row.source_reference,
      context_label: buildSchoolWorkContextLabel(row),
      linked_project_id: row.linked_production_project_id,
      linked_project_title: row.linked_production_project_title,
      action_hash: `#admin/integrations?entity_type=school_work_item&entity_id=${row.id}`,
      tone: "warning",
      last_seen_at: row.monday_sync_updated_at ?? row.updated_at
    });
  }

  if (row.monday_sync_operation_status === "conflict") {
    collector.counts.conflicts += 1;
    pushIssue(collector, {
      id: `school-sync-conflict:${row.id}`,
      issue_kind: "conflicting_link",
      title: `${row.title} has a Monday coexistence conflict`,
      summary: row.monday_sync_conflict_summary ?? "The last Monday coexistence run reported a conflict that needs admin review.",
      source_label: labelForSchoolWorkType(row.work_type),
      source_system_label: "Monday coexistence",
      source_reference: row.source_reference,
      context_label: buildSchoolWorkContextLabel(row),
      linked_project_id: row.linked_production_project_id,
      linked_project_title: row.linked_production_project_title,
      action_hash: `#admin/integrations?entity_type=school_work_item&entity_id=${row.id}`,
      tone: "critical",
      last_seen_at: row.monday_sync_updated_at ?? row.updated_at
    });
  }

  const lastSyncAt = row.monday_sync_updated_at ?? row.updated_at;
  if (
    row.source_system === "monday" &&
    row.monday_sync_operation_status !== "failed" &&
    row.monday_sync_operation_status !== "conflict" &&
    isOlderThanThreshold(lastSyncAt, anchorDate, STALE_SYNC_THRESHOLD_DAYS)
  ) {
    collector.counts.stale_syncs += 1;
    pushIssue(collector, {
      id: `school-sync-stale:${row.id}`,
      issue_kind: "sync_stale",
      title: `${row.title} is relying on a stale upstream sync`,
      summary: "This Monday-owned intake source has not been refreshed recently enough to trust without checking the owning workspace.",
      source_label: labelForSchoolWorkType(row.work_type),
      source_system_label: "Monday coexistence",
      source_reference: row.source_reference,
      context_label: buildSchoolWorkContextLabel(row),
      linked_project_id: row.linked_production_project_id,
      linked_project_title: row.linked_production_project_title,
      action_hash: `#admin/integrations?entity_type=school_work_item&entity_id=${row.id}`,
      tone: "warning",
      last_seen_at: lastSyncAt
    });
  }
}

function buildSchoolWorkSourceEventKey(workItemId: string) {
  return `school_work_item:${workItemId}`;
}

function buildSchoolWorkDedupeKey(row: SchoolWorkIntakeRow) {
  const normalizedTitle = normalizeTitle(row.title);
  if (row.source_reference) {
    return `source:${row.source_reference.trim().toLowerCase()}`;
  }
  if (row.linked_shoot_id) {
    return `shoot:${row.linked_shoot_id}:${row.work_type}:${normalizedTitle}`;
  }
  if (row.school_job_id) {
    return `job:${row.school_job_id}:${row.work_type}:${normalizedTitle}`;
  }
  return `organization:${row.organization_id}:${row.work_type}:${normalizedTitle}`;
}

function compareSchoolWorkPrimaryOrder(left: SchoolWorkIntakeRow, right: SchoolWorkIntakeRow) {
  const leftLinked = left.linked_production_project_id ? 0 : 1;
  const rightLinked = right.linked_production_project_id ? 0 : 1;
  if (leftLinked !== rightLinked) {
    return leftLinked - rightLinked;
  }
  const leftDue = left.due_date ?? left.sla_date ?? "";
  const rightDue = right.due_date ?? right.sla_date ?? "";
  if (leftDue !== rightDue) {
    if (!leftDue) {
      return 1;
    }
    if (!rightDue) {
      return -1;
    }
    return leftDue.localeCompare(rightDue);
  }
  return right.updated_at.localeCompare(left.updated_at);
}

function triggerKeyForSchoolWorkType(workType: SchoolWorkType) {
  switch (workType) {
    case "gallery_release":
      return "school_gallery_release_intake";
    case "id_production":
      return "school_id_production_intake";
    case "yearbook":
      return "school_yearbook_intake";
    default:
      return "school_gallery_release_intake";
  }
}

function jobTypeForSchoolWorkType(workType: SchoolWorkType): ProductionProjectJobType {
  switch (workType) {
    case "id_production":
      return "standard_school_production";
    case "yearbook":
      return "specialty_graphics";
    default:
      return "gallery_prep_upload";
  }
}

function categoryForSchoolWorkType(workType: SchoolWorkType): ProductionProjectCategory {
  switch (workType) {
    case "id_production":
      return "photography_production";
    default:
      return "digital_production";
  }
}

function mapSchoolWorkToProductionStage(row: SchoolWorkIntakeRow): ProductionProjectStage {
  if (row.status === "blocked" || normalizeNullableText(row.blocker_reason)) {
    return "blocked";
  }
  if (row.stage === "ready_for_delivery") {
    return "ready_to_release";
  }
  if (row.status === "in_progress" || row.stage === "active") {
    return "in_production";
  }
  if (row.stage === "waiting_on_school" || row.waiting_on === "school") {
    return "intake_pending";
  }
  if (row.stage === "waiting_on_internal" || row.waiting_on === "internal_production") {
    return "ready_for_production";
  }
  if (row.stage === "planning" || row.stage === "intake") {
    return "ready_for_production";
  }
  return "ready_for_production";
}

function mapSchoolPriority(priority: SchoolWorkPriority): ProductionProjectPriority {
  switch (priority) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "low":
      return "low";
    default:
      return "normal";
  }
}

function buildSchoolWorkContextLabel(row: SchoolWorkIntakeRow) {
  return [
    row.organization_name,
    labelForSchoolWorkType(row.work_type),
    row.linked_shoot_date ? `Shoot ${formatDateLabel(row.linked_shoot_date)}` : null
  ]
    .filter(Boolean)
    .join(" | ");
}

function labelForSchoolWorkType(workType: SchoolWorkType) {
  switch (workType) {
    case "gallery_release":
      return "Gallery release";
    case "id_production":
      return "ID production";
    case "yearbook":
      return "Yearbook";
    default:
      return humanizeValue(workType);
  }
}

function labelForSourceSystem(sourceSystem: SchoolWorkSourceSystem) {
  switch (sourceSystem) {
    case "mission_control":
      return "Mission Control";
    case "manual_import":
      return "Manual import / tracker compatibility";
    case "monday":
      return "Monday coexistence";
    default:
      return humanizeValue(sourceSystem);
  }
}

function messageForIntakeError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return fallback;
}

function pushIssue(
  collector: IntakeCollector,
  input: Omit<ProductionProjectIntakeIssue, "issue_kind_label" | "tone_label">
) {
  if (collector.issueIds.has(input.id)) {
    return;
  }
  collector.issueIds.add(input.id);
  collector.issues.push({
    ...input,
    issue_kind_label: labelForIssueKind(input.issue_kind),
    tone_label: labelForTone(input.tone)
  });
}

function buildIntakeSummaryLine(collector: IntakeCollector) {
  const { counts } = collector;
  const issueCount = counts.duplicates + counts.conflicts + counts.sync_failures + counts.stale_syncs;
  if (issueCount === 0) {
    if (counts.created > 0 || counts.linked > 0) {
      return `Production intake refreshed ${counts.sources_considered} upstream records, created ${counts.created} production job${counts.created === 1 ? "" : "s"}, and linked ${counts.linked} source record${counts.linked === 1 ? "" : "s"} without intake conflicts.`;
    }
    return `Production intake checked ${counts.sources_considered} upstream record${counts.sources_considered === 1 ? "" : "s"} and found no new backlog or source drift in this snapshot.`;
  }
  return `${issueCount} intake issue${issueCount === 1 ? "" : "s"} need review across duplicates, conflicts, or stale upstream syncs before production leadership can trust the board fully.`;
}

function labelForIssueKind(kind: ProductionProjectIntakeIssueKind) {
  switch (kind) {
    case "duplicate_source":
      return "Duplicate source";
    case "conflicting_link":
      return "Conflicting link";
    case "sync_failed":
      return "Sync failed";
    case "sync_stale":
      return "Sync stale";
    default:
      return "Backfill failed";
  }
}

function labelForTone(tone: ProductionProjectIntakeIssue["tone"]) {
  switch (tone) {
    case "critical":
      return "Critical";
    case "warning":
      return "Warning";
    case "success":
      return "Healthy";
    case "info":
      return "Heads up";
    default:
      return "Neutral";
  }
}

function toneRank(tone: ProductionProjectIntakeIssue["tone"]) {
  switch (tone) {
    case "critical":
      return 0;
    case "warning":
      return 1;
    case "info":
      return 2;
    case "success":
      return 3;
    default:
      return 4;
  }
}

function isOlderThanThreshold(dateText: string | null, anchorDate: string, thresholdDays: number) {
  if (!dateText) {
    return false;
  }
  const anchor = new Date(`${anchorDate}T00:00:00.000Z`);
  const candidate = new Date(dateText);
  if (Number.isNaN(anchor.getTime()) || Number.isNaN(candidate.getTime())) {
    return false;
  }
  const diffMs = anchor.getTime() - candidate.getTime();
  return diffMs > thresholdDays * 24 * 60 * 60 * 1000;
}

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeTitle(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function humanizeValue(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDateLabel(dateText: string) {
  const date = new Date(`${dateText}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return dateText;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(date);
}
