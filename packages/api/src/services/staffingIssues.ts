import type { PoolClient } from "pg";
import type {
  StaffingIssueEventRecord,
  StaffingIssueRecord,
  StaffingIssueSeverity,
  StaffingIssueStatus,
  StaffingIssueType
} from "../types/workflowDomain.js";

type StaffingIssueRow = {
  id: string;
  tenant_id: string;
  issue_type: StaffingIssueType;
  status: StaffingIssueStatus;
  severity: StaffingIssueSeverity;
  source_module: string;
  source_entity_type: string;
  source_entity_id: string;
  source_entity_label: string | null;
  department: string | null;
  shift_id: string | null;
  shoot_id: string | null;
  staffing_requirement_id: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  acknowledged_by_user_id: string | null;
  resolved_by_user_id: string | null;
  dedupe_key: string | null;
  title: string;
  summary: string | null;
  resolution_note: string | null;
  source_snapshot: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  detected_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

type StaffingIssueEventRow = {
  id: string;
  staffing_issue_id: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type CreateStaffingIssueInput = {
  tenantId: string;
  issueType: StaffingIssueType;
  sourceModule: string;
  sourceEntityType: string;
  sourceEntityId: string;
  title: string;
  status?: StaffingIssueStatus;
  severity?: StaffingIssueSeverity;
  sourceEntityLabel?: string | null;
  department?: string | null;
  shiftId?: string | null;
  shootId?: string | null;
  staffingRequirementId?: string | null;
  ownerUserId?: string | null;
  createdByUserId?: string | null;
  dedupeKey?: string | null;
  summary?: string | null;
  sourceSnapshot?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  note?: string | null;
};

export type UpdateStaffingIssueStatusInput = {
  tenantId: string;
  staffingIssueId: string;
  status: StaffingIssueStatus;
  actorUserId?: string | null;
  ownerUserId?: string | null;
  resolutionNote?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
};

export async function listStaffingIssues(
  client: PoolClient,
  tenantId: string,
  options: {
    status?: StaffingIssueStatus | null;
    shiftId?: string | null;
    shootId?: string | null;
    sourceModule?: string | null;
    limit?: number;
  } = {}
): Promise<StaffingIssueRecord[]> {
  const values: Array<string | number> = [tenantId];
  const where = ["issue.tenant_id = $1"];

  if (options.status) {
    values.push(options.status);
    where.push(`issue.status = $${values.length}::staffing_issue_status`);
  }

  if (options.shiftId) {
    values.push(options.shiftId);
    where.push(`issue.shift_id = $${values.length}::uuid`);
  }

  if (options.shootId) {
    values.push(options.shootId);
    where.push(`issue.shoot_id = $${values.length}::uuid`);
  }

  if (options.sourceModule) {
    values.push(options.sourceModule);
    where.push(`issue.source_module = $${values.length}`);
  }

  values.push(Math.max(1, Math.min(options.limit ?? 100, 500)));

  const { rows } = await client.query<StaffingIssueRow>(
    `
      SELECT
        issue.id,
        issue.tenant_id,
        issue.issue_type,
        issue.status,
        issue.severity,
        issue.source_module,
        issue.source_entity_type,
        issue.source_entity_id,
        issue.source_entity_label,
        issue.department,
        issue.shift_id,
        issue.shoot_id,
        issue.staffing_requirement_id,
        issue.owner_user_id,
        owner.full_name AS owner_name,
        issue.created_by_user_id,
        creator.full_name AS created_by_name,
        issue.acknowledged_by_user_id,
        issue.resolved_by_user_id,
        issue.dedupe_key,
        issue.title,
        issue.summary,
        issue.resolution_note,
        issue.source_snapshot,
        issue.metadata,
        issue.detected_at::text AS detected_at,
        issue.acknowledged_at::text AS acknowledged_at,
        issue.resolved_at::text AS resolved_at,
        issue.created_at::text AS created_at,
        issue.updated_at::text AS updated_at
      FROM staffing_issue issue
      LEFT JOIN app_user owner
        ON owner.id = issue.owner_user_id
      LEFT JOIN app_user creator
        ON creator.id = issue.created_by_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY issue.detected_at DESC, issue.created_at DESC
      LIMIT $${values.length}
    `,
    values
  );

  return rows.map(mapStaffingIssueRow);
}

export async function loadStaffingIssueById(
  client: PoolClient,
  tenantId: string,
  staffingIssueId: string
): Promise<StaffingIssueRecord | null> {
  const { rows: loaded } = await client.query<StaffingIssueRow>(
    `
      SELECT
        issue.id,
        issue.tenant_id,
        issue.issue_type,
        issue.status,
        issue.severity,
        issue.source_module,
        issue.source_entity_type,
        issue.source_entity_id,
        issue.source_entity_label,
        issue.department,
        issue.shift_id,
        issue.shoot_id,
        issue.staffing_requirement_id,
        issue.owner_user_id,
        owner.full_name AS owner_name,
        issue.created_by_user_id,
        creator.full_name AS created_by_name,
        issue.acknowledged_by_user_id,
        issue.resolved_by_user_id,
        issue.dedupe_key,
        issue.title,
        issue.summary,
        issue.resolution_note,
        issue.source_snapshot,
        issue.metadata,
        issue.detected_at::text AS detected_at,
        issue.acknowledged_at::text AS acknowledged_at,
        issue.resolved_at::text AS resolved_at,
        issue.created_at::text AS created_at,
        issue.updated_at::text AS updated_at
      FROM staffing_issue issue
      LEFT JOIN app_user owner
        ON owner.id = issue.owner_user_id
      LEFT JOIN app_user creator
        ON creator.id = issue.created_by_user_id
      WHERE issue.tenant_id = $1
        AND issue.id = $2::uuid
      LIMIT 1
    `,
    [tenantId, staffingIssueId]
  );

  return loaded[0] ? mapStaffingIssueRow(loaded[0]) : null;
}

export async function createStaffingIssue(client: PoolClient, input: CreateStaffingIssueInput): Promise<StaffingIssueRecord> {
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO staffing_issue (
        tenant_id,
        issue_type,
        status,
        severity,
        source_module,
        source_entity_type,
        source_entity_id,
        source_entity_label,
        department,
        shift_id,
        shoot_id,
        staffing_requirement_id,
        owner_user_id,
        created_by_user_id,
        dedupe_key,
        title,
        summary,
        source_snapshot,
        metadata
      )
      VALUES (
        $1,
        $2::staffing_issue_type,
        $3::staffing_issue_status,
        $4::staffing_issue_severity,
        $5,
        $6,
        $7,
        $8,
        $9::department_code,
        $10::uuid,
        $11::uuid,
        $12::uuid,
        $13::uuid,
        $14::uuid,
        $15,
        $16,
        $17,
        $18::jsonb,
        $19::jsonb
      )
      RETURNING id
    `,
    [
      input.tenantId,
      input.issueType,
      input.status ?? "open",
      input.severity ?? "medium",
      input.sourceModule,
      input.sourceEntityType,
      input.sourceEntityId,
      input.sourceEntityLabel ?? null,
      input.department ?? null,
      input.shiftId ?? null,
      input.shootId ?? null,
      input.staffingRequirementId ?? null,
      input.ownerUserId ?? null,
      input.createdByUserId ?? null,
      input.dedupeKey ?? null,
      input.title,
      input.summary ?? null,
      JSON.stringify(input.sourceSnapshot ?? {}),
      JSON.stringify(input.metadata ?? {})
    ]
  );

  const issueId = rows[0].id;
  await appendStaffingIssueEvent(client, {
    tenantId: input.tenantId,
    staffingIssueId: issueId,
    eventType: "staffing_issue.created",
    summary: "Staffing issue created.",
    note: input.note ?? null,
    actorUserId: input.createdByUserId ?? null,
    metadata: {
      issue_type: input.issueType,
      severity: input.severity ?? "medium",
      source_module: input.sourceModule
    }
  });

  const record = await loadStaffingIssueById(client, input.tenantId, issueId);
  if (!record) {
    throw new Error("Failed to load staffing issue after creation.");
  }
  return record;
}

export async function updateStaffingIssueStatus(
  client: PoolClient,
  input: UpdateStaffingIssueStatusInput
): Promise<StaffingIssueRecord> {
  await client.query(
    `
      UPDATE staffing_issue
      SET status = $3::staffing_issue_status,
          owner_user_id = COALESCE($4::uuid, owner_user_id),
          acknowledged_at = CASE
            WHEN $3::staffing_issue_status = 'acknowledged' AND acknowledged_at IS NULL THEN now()
            ELSE acknowledged_at
          END,
          acknowledged_by_user_id = CASE
            WHEN $3::staffing_issue_status = 'acknowledged' THEN COALESCE($5::uuid, acknowledged_by_user_id)
            ELSE acknowledged_by_user_id
          END,
          resolved_at = CASE
            WHEN $3::staffing_issue_status = 'resolved' THEN now()
            ELSE resolved_at
          END,
          resolved_by_user_id = CASE
            WHEN $3::staffing_issue_status = 'resolved' THEN COALESCE($5::uuid, resolved_by_user_id)
            ELSE resolved_by_user_id
          END,
          resolution_note = CASE
            WHEN $3::staffing_issue_status = 'resolved' THEN COALESCE($6, resolution_note)
            ELSE resolution_note
          END,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2::uuid
    `,
    [
      input.tenantId,
      input.staffingIssueId,
      input.status,
      input.ownerUserId ?? null,
      input.actorUserId ?? null,
      input.resolutionNote ?? null
    ]
  );

  await appendStaffingIssueEvent(client, {
    tenantId: input.tenantId,
    staffingIssueId: input.staffingIssueId,
    eventType: `staffing_issue.status_${input.status}`,
    summary: `Staffing issue marked ${input.status.replace(/_/g, " ")}.`,
    note: input.note ?? input.resolutionNote ?? null,
    actorUserId: input.actorUserId ?? null,
    metadata: input.metadata ?? {}
  });

  const record = await loadStaffingIssueById(client, input.tenantId, input.staffingIssueId);
  if (!record) {
    throw new Error("Failed to load staffing issue after update.");
  }
  return record;
}

export async function listStaffingIssueEvents(
  client: PoolClient,
  tenantId: string,
  staffingIssueId: string,
  limit = 100
): Promise<StaffingIssueEventRecord[]> {
  const { rows } = await client.query<StaffingIssueEventRow>(
    `
      SELECT
        event.id,
        event.staffing_issue_id,
        event.event_type,
        event.summary,
        event.note,
        event.actor_user_id,
        actor.full_name AS actor_name,
        event.metadata,
        event.created_at::text AS created_at
      FROM staffing_issue_event event
      LEFT JOIN app_user actor
        ON actor.id = event.actor_user_id
      WHERE event.tenant_id = $1
        AND event.staffing_issue_id = $2::uuid
      ORDER BY event.created_at DESC
      LIMIT $3
    `,
    [tenantId, staffingIssueId, Math.max(1, Math.min(limit, 500))]
  );

  return rows.map(mapStaffingIssueEventRow);
}

export async function appendStaffingIssueEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    staffingIssueId: string;
    eventType: string;
    summary: string;
    note?: string | null;
    actorUserId?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<StaffingIssueEventRecord> {
  const { rows } = await client.query<StaffingIssueEventRow>(
    `
      INSERT INTO staffing_issue_event (
        tenant_id,
        staffing_issue_id,
        event_type,
        summary,
        note,
        actor_user_id,
        metadata
      )
      VALUES ($1, $2::uuid, $3, $4, $5, $6::uuid, $7::jsonb)
      RETURNING
        id,
        staffing_issue_id,
        event_type,
        summary,
        note,
        actor_user_id,
        NULL::text AS actor_name,
        metadata,
        created_at::text
    `,
    [
      input.tenantId,
      input.staffingIssueId,
      input.eventType,
      input.summary,
      input.note ?? null,
      input.actorUserId ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );

  const event = rows[0];
  if (event.actor_user_id) {
    const actorResult = await client.query<{ full_name: string | null }>("SELECT full_name FROM app_user WHERE id = $1", [
      event.actor_user_id
    ]);
    event.actor_name = actorResult.rows[0]?.full_name ?? null;
  }
  return mapStaffingIssueEventRow(event);
}

function mapStaffingIssueRow(row: StaffingIssueRow): StaffingIssueRecord {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    issue_type: row.issue_type,
    status: row.status,
    severity: row.severity,
    source_module: row.source_module,
    source_entity_type: row.source_entity_type,
    source_entity_id: row.source_entity_id,
    source_entity_label: row.source_entity_label,
    department: row.department as StaffingIssueRecord["department"],
    shift_id: row.shift_id,
    shoot_id: row.shoot_id,
    staffing_requirement_id: row.staffing_requirement_id,
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_name,
    created_by_user_id: row.created_by_user_id,
    created_by_name: row.created_by_name,
    acknowledged_by_user_id: row.acknowledged_by_user_id,
    resolved_by_user_id: row.resolved_by_user_id,
    dedupe_key: row.dedupe_key,
    title: row.title,
    summary: row.summary,
    resolution_note: row.resolution_note,
    source_snapshot: row.source_snapshot ?? {},
    metadata: row.metadata ?? {},
    detected_at: row.detected_at,
    acknowledged_at: row.acknowledged_at,
    resolved_at: row.resolved_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapStaffingIssueEventRow(row: StaffingIssueEventRow): StaffingIssueEventRecord {
  return {
    id: row.id,
    staffing_issue_id: row.staffing_issue_id,
    event_type: row.event_type,
    summary: row.summary,
    note: row.note,
    actor_user_id: row.actor_user_id,
    actor_name: row.actor_name,
    metadata: row.metadata ?? {},
    created_at: row.created_at
  };
}
