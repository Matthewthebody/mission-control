import type { PoolClient } from "pg";
import { listStaffingIssueEvents, listStaffingIssues, loadStaffingIssueById } from "./staffingIssues.js";
import type {
  ApprovalRequestEventRecord,
  ApprovalRequestRecord,
  AssignmentEventRecord,
  AssignmentRecord,
  AttendanceEventRecord,
  AttendanceRecord,
  ProductionJobRecord,
  ProductionJobEventRecord,
  ProductionTaskEventRecord,
  ProductionTaskRecord,
  WatchItemEventRecord,
  WatchItemRecord,
  WorkflowEntityEventRecordMap,
  WorkflowEntityRecordMap,
  WorkflowEntityType,
  WorkflowHistoryRecord
} from "../types/workflowDomain.js";

type AssignmentRow = {
  id: string;
  tenant_id: string;
  shoot_id: string | null;
  studio_id: string | null;
  assigned_user_id: string;
  assigned_user_name: string | null;
  manager_user_id: string | null;
  manager_user_name: string | null;
  shift_kind: AssignmentRecord["shift_kind"];
  status: AssignmentRecord["status"];
  department: AssignmentRecord["department"];
  title: string;
  starts_at: string;
  ends_at: string;
  location_name: string;
  location_address: string;
  staffing_role: string | null;
  staffing_requirement_id: string | null;
  assignment_source: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
};

type WatchItemRow = {
  id: string;
  tenant_id: string;
  source_module: WatchItemRecord["source_module"];
  source_entity_type: string;
  source_entity_id: string;
  source_entity_label: string | null;
  scope_department: string | null;
  watch_type: WatchItemRecord["watch_type"];
  status: WatchItemRecord["status"];
  severity: WatchItemRecord["severity"];
  title: string;
  summary: string;
  owner_user_id: string | null;
  owner_name: string | null;
  due_at: string | null;
  next_action_label: string;
  action_hash: string;
  operational_impact_score: number;
  source_snapshot: Record<string, unknown> | null;
  snoozed_until: string | null;
  handled_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

type WatchItemEventRow = {
  id: string;
  watch_item_id: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type ProductionJobRow = {
  id: string;
  tenant_id: string;
  title: string;
  summary: string | null;
  job_type: ProductionJobRecord["job_type"];
  stage: ProductionJobRecord["stage"];
  status: ProductionJobRecord["status"];
  priority: ProductionJobRecord["priority"];
  owner_user_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  follow_up_date: string | null;
  linked_organization_id: string | null;
  linked_location_id: string | null;
  linked_shoot_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type ProductionTaskRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  title: string;
  summary: string | null;
  status: ProductionTaskRecord["status"];
  task_type: ProductionTaskRecord["task_type"];
  owner_user_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  required: boolean;
  sort_order: number;
  handoff_required: boolean;
  blocks_release: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type ProductionTaskEventRow = {
  id: string;
  project_id: string;
  task_id: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type ProductionJobEventRow = {
  id: string;
  project_id: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type ApprovalRequestRow = {
  id: string;
  tenant_id: string;
  request_type: ApprovalRequestRecord["request_type"];
  status: ApprovalRequestRecord["status"];
  source_module: string;
  source_entity_type: string;
  source_entity_id: string;
  source_entity_label: string | null;
  blocking: boolean;
  requested_action_code: string;
  request_title: string;
  request_summary: string | null;
  reason: string;
  severity: string;
  requested_by_user_id: string;
  requested_by_name: string | null;
  current_approver_user_id: string | null;
  current_approver_name: string | null;
  current_step_status: ApprovalRequestRecord["current_step_status"];
  sla_due_at: string | null;
  escalation_level: number;
  decided_at: string | null;
  executed_at: string | null;
  created_at: string;
  updated_at: string;
};

type ApprovalRequestEventRow = {
  id: string;
  approval_request_id: string;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type AttendanceRecordRow = {
  shift_id: string;
  tenant_id: string;
  shoot_id: string | null;
  employee_id: string;
  employee_name: string | null;
  current_state: AttendanceRecord["current_state"];
  current_state_reason: string | null;
  signal_source: AttendanceRecord["signal_source"];
  last_signal_at: string | null;
  first_present_at: string | null;
  escalation_level: number;
  coverage_impact: boolean;
  critical_role_missing: boolean;
  understaffed_due_to_attendance: boolean;
  active_present_count: number;
  present_lead_count: number;
  last_evaluated_at: string | null;
  last_state_changed_at: string;
  created_at: string;
  updated_at: string;
};

type AttendanceEventRow = {
  id: string;
  attendance_record_id: string;
  event_type: string;
  from_state: AttendanceEventRecord["from_state"];
  to_state: AttendanceEventRecord["to_state"];
  signal_source: AttendanceEventRecord["signal_source"];
  escalation_level: number | null;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type WorkflowHistoryRow = WorkflowHistoryRecord;

function clampLimit(limit?: number) {
  return Math.max(1, Math.min(limit ?? 100, 500));
}

function humanizeAuditAction(action: string) {
  return action
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function humanizeEventType(eventType: string) {
  return eventType
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function firstOrNull<T>(rows: T[]) {
  return rows[0] ?? null;
}

export async function listAssignmentRecords(
  client: PoolClient,
  tenantId: string,
  options: {
    limit?: number;
    assignmentId?: string | null;
    assignedUserId?: string | null;
    shootId?: string | null;
    status?: AssignmentRecord["status"] | null;
  } = {}
): Promise<AssignmentRecord[]> {
  const values: Array<string | number> = [tenantId];
  const where = ["ws.tenant_id = $1"];

  if (options.assignmentId) {
    values.push(options.assignmentId);
    where.push(`ws.id = $${values.length}::uuid`);
  }

  if (options.assignedUserId) {
    values.push(options.assignedUserId);
    where.push(`ws.assigned_user_id = $${values.length}::uuid`);
  }

  if (options.shootId) {
    values.push(options.shootId);
    where.push(`ws.shoot_id = $${values.length}::uuid`);
  }

  if (options.status) {
    values.push(options.status);
    where.push(`ws.status = $${values.length}::work_shift_status`);
  }

  values.push(clampLimit(options.limit));

  const { rows } = await client.query<AssignmentRow>(
    `
      SELECT
        ws.id,
        ws.tenant_id,
        ws.shoot_id,
        ws.studio_id,
        ws.assigned_user_id,
        assigned.full_name AS assigned_user_name,
        ws.manager_user_id,
        manager.full_name AS manager_user_name,
        ws.shift_kind,
        ws.status,
        ws.department,
        ws.title,
        ws.starts_at::text AS starts_at,
        ws.ends_at::text AS ends_at,
        ws.location_name,
        ws.location_address,
        ws.staffing_role::text AS staffing_role,
        ws.staffing_requirement_id,
        ws.assignment_source,
        ws.created_at::text AS created_at,
        ws.updated_at::text AS updated_at,
        ws.cancelled_at::text AS cancelled_at
      FROM work_shift ws
      LEFT JOIN app_user assigned
        ON assigned.id = ws.assigned_user_id
      LEFT JOIN app_user manager
        ON manager.id = ws.manager_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY ws.starts_at DESC, ws.created_at DESC
      LIMIT $${values.length}
    `,
    values
  );

  return rows.map((row) => ({
    id: row.id,
    tenant_id: row.tenant_id,
    shoot_id: row.shoot_id,
    studio_id: row.studio_id,
    assigned_user_id: row.assigned_user_id,
    assigned_user_name: row.assigned_user_name,
    manager_user_id: row.manager_user_id,
    manager_user_name: row.manager_user_name,
    shift_kind: row.shift_kind,
    status: row.status,
    department: row.department,
    title: row.title,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    location_name: row.location_name,
    location_address: row.location_address,
    staffing_role: row.staffing_role,
    staffing_requirement_id: row.staffing_requirement_id,
    assignment_source: row.assignment_source,
    created_at: row.created_at,
    updated_at: row.updated_at,
    cancelled_at: row.cancelled_at
  }));
}

export async function listAssignmentEvents(
  client: PoolClient,
  tenantId: string,
  assignmentId: string,
  limit = 100
): Promise<AssignmentEventRecord[]> {
  const { rows } = await client.query<
    {
      id: string;
      assignment_id: string;
      action: string;
      reason_comment: string | null;
      actor_user_id: string | null;
      actor_name: string | null;
      metadata: Record<string, unknown> | null;
      created_at: string;
      event_type: string;
    }
  >(
    `
      SELECT
        audit.id,
        audit.entity_id AS assignment_id,
        audit.action,
        audit.reason_comment,
        audit.actor_user_id,
        actor.full_name AS actor_name,
        audit.metadata,
        audit.created_at::text AS created_at,
        audit.action AS event_type
      FROM audit_log audit
      LEFT JOIN app_user actor
        ON actor.id = audit.actor_user_id
      WHERE audit.tenant_id = $1
        AND audit.entity_type = 'work_shift'
        AND audit.entity_id = $2
      ORDER BY audit.created_at DESC
      LIMIT $3
    `,
    [tenantId, assignmentId, clampLimit(limit)]
  );

  return rows.map((row) => ({
    id: row.id,
    assignment_id: row.assignment_id,
    event_type: row.event_type,
    summary: humanizeAuditAction(row.action),
    note: row.reason_comment,
    actor_user_id: row.actor_user_id,
    actor_name: row.actor_name,
    metadata: row.metadata ?? {},
    created_at: row.created_at
  }));
}

export async function listStaffingIssueRecords(
  client: PoolClient,
  tenantId: string,
  options: Parameters<typeof listStaffingIssues>[2] = {}
) {
  return listStaffingIssues(client, tenantId, options);
}

export async function listWatchItemRecords(
  client: PoolClient,
  tenantId: string,
  options: {
    limit?: number;
    watchItemId?: string | null;
    status?: WatchItemRecord["status"] | null;
    sourceModule?: WatchItemRecord["source_module"] | null;
  } = {}
): Promise<WatchItemRecord[]> {
  const values: Array<string | number> = [tenantId];
  const where = ["item.tenant_id = $1"];

  if (options.watchItemId) {
    values.push(options.watchItemId);
    where.push(`item.id = $${values.length}::uuid`);
  }

  if (options.status) {
    values.push(options.status);
    where.push(`item.status = $${values.length}::urgent_watch_status`);
  }

  if (options.sourceModule) {
    values.push(options.sourceModule);
    where.push(`item.source_module = $${values.length}`);
  }

  values.push(clampLimit(options.limit));

  const { rows } = await client.query<WatchItemRow>(
    `
      SELECT
        item.id,
        item.tenant_id,
        item.source_module,
        item.source_entity_type,
        item.source_entity_id,
        item.source_entity_label,
        item.scope_department,
        item.watch_type,
        item.status,
        item.severity,
        item.title,
        item.summary,
        item.owner_user_id,
        owner.full_name AS owner_name,
        item.due_at::text AS due_at,
        item.next_action_label,
        item.action_hash,
        item.operational_impact_score,
        item.source_snapshot,
        item.snoozed_until::text AS snoozed_until,
        item.handled_at::text AS handled_at,
        item.resolved_at::text AS resolved_at,
        item.created_at::text AS created_at,
        item.updated_at::text AS updated_at
      FROM urgent_watch_item item
      LEFT JOIN app_user owner
        ON owner.id = item.owner_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY item.updated_at DESC, item.created_at DESC
      LIMIT $${values.length}
    `,
    values
  );

  return rows.map((row) => ({
    id: row.id,
    tenant_id: row.tenant_id,
    source_module: row.source_module,
    source_entity_type: row.source_entity_type,
    source_entity_id: row.source_entity_id,
    source_entity_label: row.source_entity_label,
    scope_department: row.scope_department,
    watch_type: row.watch_type,
    status: row.status,
    severity: row.severity,
    title: row.title,
    summary: row.summary,
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_name,
    due_at: row.due_at,
    next_action_label: row.next_action_label,
    action_hash: row.action_hash,
    operational_impact_score: row.operational_impact_score,
    source_snapshot: row.source_snapshot ?? {},
    snoozed_until: row.snoozed_until,
    handled_at: row.handled_at,
    resolved_at: row.resolved_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  }));
}

export async function listWatchItemEvents(
  client: PoolClient,
  tenantId: string,
  watchItemId: string,
  limit = 100
): Promise<WatchItemEventRecord[]> {
  const { rows } = await client.query<WatchItemEventRow>(
    `
      SELECT
        event.id,
        event.urgent_watch_item_id AS watch_item_id,
        event.event_type,
        event.summary,
        event.note,
        event.actor_user_id,
        actor.full_name AS actor_name,
        event.metadata,
        event.created_at::text AS created_at
      FROM urgent_watch_event event
      LEFT JOIN app_user actor
        ON actor.id = event.actor_user_id
      WHERE event.tenant_id = $1
        AND event.urgent_watch_item_id = $2::uuid
      ORDER BY event.created_at DESC
      LIMIT $3
    `,
    [tenantId, watchItemId, clampLimit(limit)]
  );

  return rows.map((row) => ({
    id: row.id,
    watch_item_id: row.watch_item_id,
    event_type: row.event_type,
    summary: row.summary,
    note: row.note,
    actor_user_id: row.actor_user_id,
    actor_name: row.actor_name,
    metadata: row.metadata ?? {},
    created_at: row.created_at
  }));
}

export async function listProductionJobRecords(
  client: PoolClient,
  tenantId: string,
  options: {
    limit?: number;
    productionJobId?: string | null;
    status?: ProductionJobRecord["status"] | null;
    ownerUserId?: string | null;
  } = {}
): Promise<ProductionJobRecord[]> {
  const values: Array<string | number> = [tenantId];
  const where = ["project.tenant_id = $1"];

  if (options.productionJobId) {
    values.push(options.productionJobId);
    where.push(`project.id = $${values.length}::uuid`);
  }

  if (options.status) {
    values.push(options.status);
    where.push(`project.status = $${values.length}::production_project_status`);
  }

  if (options.ownerUserId) {
    values.push(options.ownerUserId);
    where.push(`project.owner_user_id = $${values.length}::uuid`);
  }

  values.push(clampLimit(options.limit));

  const { rows } = await client.query<ProductionJobRow>(
    `
      SELECT
        project.id,
        project.tenant_id,
        project.title,
        project.summary,
        project.job_type,
        project.stage,
        project.status,
        project.priority,
        project.owner_user_id,
        owner.full_name AS owner_name,
        project.due_date::text AS due_date,
        project.follow_up_date::text AS follow_up_date,
        project.linked_organization_id,
        project.linked_location_id,
        project.linked_shoot_id,
        project.created_at::text AS created_at,
        project.updated_at::text AS updated_at,
        project.completed_at::text AS completed_at
      FROM production_project project
      LEFT JOIN app_user owner
        ON owner.id = project.owner_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY project.updated_at DESC, project.created_at DESC
      LIMIT $${values.length}
    `,
    values
  );

  return rows.map((row) => ({
    id: row.id,
    tenant_id: row.tenant_id,
    title: row.title,
    summary: row.summary,
    job_type: row.job_type,
    stage: row.stage,
    status: row.status,
    priority: row.priority,
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_name,
    due_date: row.due_date,
    follow_up_date: row.follow_up_date,
    linked_organization_id: row.linked_organization_id,
    linked_location_id: row.linked_location_id,
    linked_shoot_id: row.linked_shoot_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at
  }));
}

export async function listProductionTaskRecords(
  client: PoolClient,
  tenantId: string,
  options: {
    limit?: number;
    productionJobId?: string | null;
    productionTaskId?: string | null;
    status?: ProductionTaskRecord["status"] | null;
  } = {}
): Promise<ProductionTaskRecord[]> {
  const values: Array<string | number> = [tenantId];
  const where = ["task.tenant_id = $1"];

  if (options.productionJobId) {
    values.push(options.productionJobId);
    where.push(`task.project_id = $${values.length}::uuid`);
  }

  if (options.productionTaskId) {
    values.push(options.productionTaskId);
    where.push(`task.id = $${values.length}::uuid`);
  }

  if (options.status) {
    values.push(options.status);
    where.push(`task.status = $${values.length}::production_project_task_status`);
  }

  values.push(clampLimit(options.limit));

  const { rows } = await client.query<ProductionTaskRow>(
    `
      SELECT
        task.id,
        task.tenant_id,
        task.project_id,
        task.title,
        task.summary,
        task.status,
        task.task_type,
        task.owner_user_id,
        owner.full_name AS owner_name,
        task.due_date::text AS due_date,
        task.required,
        task.sort_order,
        task.handoff_required,
        task.blocks_release,
        task.created_at::text AS created_at,
        task.updated_at::text AS updated_at,
        task.completed_at::text AS completed_at
      FROM production_project_task task
      LEFT JOIN app_user owner
        ON owner.id = task.owner_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY task.sort_order ASC, task.created_at ASC
      LIMIT $${values.length}
    `,
    values
  );

  return rows.map((row) => ({
    id: row.id,
    tenant_id: row.tenant_id,
    production_job_id: row.project_id,
    title: row.title,
    summary: row.summary,
    status: row.status,
    task_type: row.task_type,
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_name,
    due_date: row.due_date,
    required: row.required,
    sort_order: row.sort_order,
    handoff_required: row.handoff_required,
    blocks_release: row.blocks_release,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at
  }));
}

export async function listProductionJobEvents(
  client: PoolClient,
  tenantId: string,
  productionJobId: string,
  limit = 100
): Promise<ProductionJobEventRecord[]> {
  const { rows } = await client.query<ProductionJobEventRow>(
    `
      SELECT
        event.id,
        event.project_id,
        event.event_type,
        event.summary,
        event.note,
        event.actor_user_id,
        actor.full_name AS actor_name,
        event.metadata,
        event.created_at::text AS created_at
      FROM production_project_event event
      LEFT JOIN app_user actor
        ON actor.id = event.actor_user_id
      WHERE event.tenant_id = $1
        AND event.project_id = $2::uuid
      ORDER BY event.created_at DESC
      LIMIT $3
    `,
    [tenantId, productionJobId, clampLimit(limit)]
  );

  return rows.map((row) => ({
    id: row.id,
    production_job_id: row.project_id,
    event_type: row.event_type,
    summary: row.summary,
    note: row.note,
    actor_user_id: row.actor_user_id,
    actor_name: row.actor_name,
    metadata: row.metadata ?? {},
    created_at: row.created_at
  }));
}

export async function listProductionTaskEvents(
  client: PoolClient,
  tenantId: string,
  productionTaskId: string,
  limit = 100
): Promise<ProductionTaskEventRecord[]> {
  const { rows } = await client.query<ProductionTaskEventRow>(
    `
      SELECT
        event.id,
        event.project_id,
        event.task_id,
        event.event_type,
        event.summary,
        event.note,
        event.actor_user_id,
        actor.full_name AS actor_name,
        event.metadata,
        event.created_at::text AS created_at
      FROM production_project_task_event event
      LEFT JOIN app_user actor
        ON actor.id = event.actor_user_id
      WHERE event.tenant_id = $1
        AND event.task_id = $2::uuid
      ORDER BY event.created_at DESC
      LIMIT $3
    `,
    [tenantId, productionTaskId, clampLimit(limit)]
  );

  return rows.map((row) => ({
    id: row.id,
    production_job_id: row.project_id,
    production_task_id: row.task_id,
    event_type: row.event_type,
    summary: row.summary,
    note: row.note,
    actor_user_id: row.actor_user_id,
    actor_name: row.actor_name,
    metadata: row.metadata ?? {},
    created_at: row.created_at
  }));
}

export async function listApprovalRequestRecords(
  client: PoolClient,
  tenantId: string,
  options: {
    limit?: number;
    approvalRequestId?: string | null;
    status?: ApprovalRequestRecord["status"] | null;
    requesterUserId?: string | null;
  } = {}
): Promise<ApprovalRequestRecord[]> {
  const values: Array<string | number> = [tenantId];
  const where = ["req.tenant_id = $1"];

  if (options.approvalRequestId) {
    values.push(options.approvalRequestId);
    where.push(`req.id = $${values.length}::uuid`);
  }

  if (options.status) {
    values.push(options.status);
    where.push(`req.status = $${values.length}::operational_approval_status`);
  }

  if (options.requesterUserId) {
    values.push(options.requesterUserId);
    where.push(`req.requested_by_user_id = $${values.length}::uuid`);
  }

  values.push(clampLimit(options.limit));

  const { rows } = await client.query<ApprovalRequestRow>(
    `
      SELECT
        req.id,
        req.tenant_id,
        req.request_type,
        req.status,
        req.source_module,
        req.source_entity_type,
        req.source_entity_id,
        req.source_entity_label,
        req.blocking,
        req.requested_action_code,
        req.request_title,
        req.request_summary,
        req.reason,
        req.severity,
        req.requested_by_user_id,
        requester.full_name AS requested_by_name,
        current_step.approver_user_id AS current_approver_user_id,
        current_step.approver_name AS current_approver_name,
        current_step.status AS current_step_status,
        req.sla_due_at::text AS sla_due_at,
        req.escalation_level,
        req.decided_at::text AS decided_at,
        req.executed_at::text AS executed_at,
        req.created_at::text AS created_at,
        req.updated_at::text AS updated_at
      FROM operational_approval_request req
      LEFT JOIN app_user requester
        ON requester.id = req.requested_by_user_id
      LEFT JOIN LATERAL (
        SELECT
          step.approver_user_id,
          approver.full_name AS approver_name,
          step.status
        FROM operational_approval_step step
        LEFT JOIN app_user approver
          ON approver.id = step.approver_user_id
        WHERE step.tenant_id = req.tenant_id
          AND step.approval_request_id = req.id
          AND step.status IN ('queued', 'pending')
        ORDER BY step.step_order ASC
        LIMIT 1
      ) current_step ON true
      WHERE ${where.join(" AND ")}
      ORDER BY req.created_at DESC
      LIMIT $${values.length}
    `,
    values
  );

  return rows.map((row) => ({
    id: row.id,
    tenant_id: row.tenant_id,
    request_type: row.request_type,
    status: row.status,
    source_module: row.source_module,
    source_entity_type: row.source_entity_type,
    source_entity_id: row.source_entity_id,
    source_entity_label: row.source_entity_label,
    blocking: row.blocking,
    requested_action_code: row.requested_action_code,
    request_title: row.request_title,
    request_summary: row.request_summary,
    reason: row.reason,
    severity: row.severity,
    requested_by_user_id: row.requested_by_user_id,
    requested_by_name: row.requested_by_name,
    current_approver_user_id: row.current_approver_user_id,
    current_approver_name: row.current_approver_name,
    current_step_status: row.current_step_status,
    sla_due_at: row.sla_due_at,
    escalation_level: row.escalation_level,
    decided_at: row.decided_at,
    executed_at: row.executed_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  }));
}

export async function listApprovalRequestEvents(
  client: PoolClient,
  tenantId: string,
  approvalRequestId: string,
  limit = 100
): Promise<ApprovalRequestEventRecord[]> {
  const { rows } = await client.query<ApprovalRequestEventRow>(
    `
      SELECT
        event.id,
        event.approval_request_id,
        event.event_type,
        event.summary,
        event.note,
        event.actor_user_id,
        actor.full_name AS actor_name,
        event.metadata,
        event.created_at::text AS created_at
      FROM operational_approval_event event
      LEFT JOIN app_user actor
        ON actor.id = event.actor_user_id
      WHERE event.tenant_id = $1
        AND event.approval_request_id = $2::uuid
      ORDER BY event.created_at DESC
      LIMIT $3
    `,
    [tenantId, approvalRequestId, clampLimit(limit)]
  );

  return rows.map((row) => ({
    id: row.id,
    approval_request_id: row.approval_request_id,
    event_type: row.event_type,
    summary: row.summary,
    note: row.note,
    actor_user_id: row.actor_user_id,
    actor_name: row.actor_name,
    metadata: row.metadata ?? {},
    created_at: row.created_at
  }));
}

export async function listAttendanceRecords(
  client: PoolClient,
  tenantId: string,
  options: {
    limit?: number;
    shiftId?: string | null;
    employeeId?: string | null;
    currentState?: AttendanceRecord["current_state"] | null;
  } = {}
): Promise<AttendanceRecord[]> {
  const values: Array<string | number> = [tenantId];
  const where = ["runtime.tenant_id = $1"];

  if (options.shiftId) {
    values.push(options.shiftId);
    where.push(`runtime.shift_id = $${values.length}::uuid`);
  }

  if (options.employeeId) {
    values.push(options.employeeId);
    where.push(`runtime.employee_id = $${values.length}::uuid`);
  }

  if (options.currentState) {
    values.push(options.currentState);
    where.push(`runtime.current_state = $${values.length}::attendance_live_state`);
  }

  values.push(clampLimit(options.limit));

  const { rows } = await client.query<AttendanceRecordRow>(
    `
      SELECT
        runtime.shift_id,
        runtime.tenant_id,
        runtime.shoot_id,
        runtime.employee_id,
        employee.full_name AS employee_name,
        runtime.current_state,
        runtime.current_state_reason,
        runtime.signal_source,
        runtime.last_signal_at::text AS last_signal_at,
        runtime.first_present_at::text AS first_present_at,
        runtime.escalation_level,
        runtime.coverage_impact,
        runtime.critical_role_missing,
        runtime.understaffed_due_to_attendance,
        runtime.active_present_count,
        runtime.present_lead_count,
        runtime.last_evaluated_at::text AS last_evaluated_at,
        runtime.last_state_changed_at::text AS last_state_changed_at,
        runtime.created_at::text AS created_at,
        runtime.updated_at::text AS updated_at
      FROM shift_attendance_runtime runtime
      LEFT JOIN app_user employee
        ON employee.id = runtime.employee_id
      WHERE ${where.join(" AND ")}
      ORDER BY runtime.updated_at DESC, runtime.created_at DESC
      LIMIT $${values.length}
    `,
    values
  );

  return rows.map((row) => ({
    shift_id: row.shift_id,
    tenant_id: row.tenant_id,
    shoot_id: row.shoot_id,
    employee_id: row.employee_id,
    employee_name: row.employee_name,
    current_state: row.current_state,
    current_state_reason: row.current_state_reason,
    signal_source: row.signal_source,
    last_signal_at: row.last_signal_at,
    first_present_at: row.first_present_at,
    escalation_level: row.escalation_level,
    coverage_impact: row.coverage_impact,
    critical_role_missing: row.critical_role_missing,
    understaffed_due_to_attendance: row.understaffed_due_to_attendance,
    active_present_count: row.active_present_count,
    present_lead_count: row.present_lead_count,
    last_evaluated_at: row.last_evaluated_at,
    last_state_changed_at: row.last_state_changed_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  }));
}

export async function listAttendanceEvents(
  client: PoolClient,
  tenantId: string,
  attendanceRecordId: string,
  limit = 100
): Promise<AttendanceEventRecord[]> {
  const { rows } = await client.query<AttendanceEventRow>(
    `
      SELECT
        history.id,
        history.shift_id AS attendance_record_id,
        history.event_type,
        history.from_state,
        history.to_state,
        history.signal_source,
        history.escalation_level,
        history.note,
        history.actor_user_id,
        actor.full_name AS actor_name,
        history.metadata,
        history.created_at::text AS created_at
      FROM shift_attendance_history history
      LEFT JOIN app_user actor
        ON actor.id = history.actor_user_id
      WHERE history.tenant_id = $1
        AND history.shift_id = $2::uuid
      ORDER BY history.created_at DESC
      LIMIT $3
    `,
    [tenantId, attendanceRecordId, clampLimit(limit)]
  );

  return rows.map((row) => ({
    id: row.id,
    attendance_record_id: row.attendance_record_id,
    event_type: row.event_type,
    from_state: row.from_state,
    to_state: row.to_state,
    signal_source: row.signal_source,
    escalation_level: row.escalation_level,
    summary: humanizeEventType(row.event_type),
    note: row.note,
    actor_user_id: row.actor_user_id,
    actor_name: row.actor_name,
    metadata: row.metadata ?? {},
    created_at: row.created_at
  }));
}

export async function loadAssignmentRecordById(client: PoolClient, tenantId: string, assignmentId: string) {
  return firstOrNull(
    await listAssignmentRecords(client, tenantId, {
      assignmentId,
      limit: 1
    })
  );
}

export async function loadStaffingIssueRecordById(client: PoolClient, tenantId: string, staffingIssueId: string) {
  return loadStaffingIssueById(client, tenantId, staffingIssueId);
}

export async function loadWatchItemRecordById(client: PoolClient, tenantId: string, watchItemId: string) {
  return firstOrNull(
    await listWatchItemRecords(client, tenantId, {
      watchItemId,
      limit: 1
    })
  );
}

export async function loadProductionJobRecordById(client: PoolClient, tenantId: string, productionJobId: string) {
  return firstOrNull(
    await listProductionJobRecords(client, tenantId, {
      productionJobId,
      limit: 1
    })
  );
}

export async function loadProductionTaskRecordById(client: PoolClient, tenantId: string, productionTaskId: string) {
  return firstOrNull(
    await listProductionTaskRecords(client, tenantId, {
      productionTaskId,
      limit: 1
    })
  );
}

export async function loadApprovalRequestRecordById(client: PoolClient, tenantId: string, approvalRequestId: string) {
  return firstOrNull(
    await listApprovalRequestRecords(client, tenantId, {
      approvalRequestId,
      limit: 1
    })
  );
}

export async function loadAttendanceRecordById(client: PoolClient, tenantId: string, attendanceRecordId: string) {
  return firstOrNull(
    await listAttendanceRecords(client, tenantId, {
      shiftId: attendanceRecordId,
      limit: 1
    })
  );
}

export async function loadWorkflowEntityRecord<T extends WorkflowEntityType>(
  client: PoolClient,
  tenantId: string,
  entityType: T,
  entityId: string
): Promise<WorkflowEntityRecordMap[T] | null> {
  switch (entityType) {
    case "assignment":
      return (await loadAssignmentRecordById(client, tenantId, entityId)) as WorkflowEntityRecordMap[T] | null;
    case "staffing_issue":
      return (await loadStaffingIssueRecordById(client, tenantId, entityId)) as WorkflowEntityRecordMap[T] | null;
    case "watch_item":
      return (await loadWatchItemRecordById(client, tenantId, entityId)) as WorkflowEntityRecordMap[T] | null;
    case "production_job":
      return (await loadProductionJobRecordById(client, tenantId, entityId)) as WorkflowEntityRecordMap[T] | null;
    case "production_task":
      return (await loadProductionTaskRecordById(client, tenantId, entityId)) as WorkflowEntityRecordMap[T] | null;
    case "approval_request":
      return (await loadApprovalRequestRecordById(client, tenantId, entityId)) as WorkflowEntityRecordMap[T] | null;
    case "attendance_record":
      return (await loadAttendanceRecordById(client, tenantId, entityId)) as WorkflowEntityRecordMap[T] | null;
    default:
      return null;
  }
}

export async function listWorkflowEntityEvents<T extends WorkflowEntityType>(
  client: PoolClient,
  tenantId: string,
  entityType: T,
  entityId: string,
  limit = 100
): Promise<WorkflowEntityEventRecordMap[T][]> {
  switch (entityType) {
    case "assignment":
      return (await listAssignmentEvents(client, tenantId, entityId, limit)) as WorkflowEntityEventRecordMap[T][];
    case "staffing_issue":
      return (await listStaffingIssueEvents(client, tenantId, entityId, limit)) as WorkflowEntityEventRecordMap[T][];
    case "watch_item":
      return (await listWatchItemEvents(client, tenantId, entityId, limit)) as WorkflowEntityEventRecordMap[T][];
    case "production_job":
      return (await listProductionJobEvents(client, tenantId, entityId, limit)) as WorkflowEntityEventRecordMap[T][];
    case "production_task":
      return (await listProductionTaskEvents(client, tenantId, entityId, limit)) as WorkflowEntityEventRecordMap[T][];
    case "approval_request":
      return (await listApprovalRequestEvents(client, tenantId, entityId, limit)) as WorkflowEntityEventRecordMap[T][];
    case "attendance_record":
      return (await listAttendanceEvents(client, tenantId, entityId, limit)) as WorkflowEntityEventRecordMap[T][];
    default:
      return [];
  }
}

export async function listWorkflowHistory(
  client: PoolClient,
  tenantId: string,
  options: {
    limit?: number;
    entityType?: WorkflowEntityType | null;
    entityId?: string | null;
    department?: string | null;
  } = {}
): Promise<WorkflowHistoryRecord[]> {
  const values: Array<string | number | null> = [
    tenantId,
    options.entityType ?? null,
    options.entityId ?? null,
    options.department ?? null
  ];
  const filters: string[] = [];

  if (options.entityType) {
    filters.push("history.entity_type = $2");
  }

  if (options.entityId) {
    filters.push("history.entity_id = $3");
  }

  if (options.department) {
    filters.push("history.scope_department = $4");
  }

  values.push(clampLimit(options.limit));

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const { rows } = await client.query<WorkflowHistoryRow>(
    `
      WITH history AS (
        SELECT
          audit.id,
          'assignments'::text AS module,
          ws.department::text AS scope_department,
          'assignment'::text AS entity_type,
          audit.entity_id AS entity_id,
          NULL::text AS parent_entity_type,
          NULL::text AS parent_entity_id,
          audit.action AS event_type,
          ${"'Assignment audit event'"}::text AS summary,
          audit.reason_comment AS note,
          audit.actor_user_id,
          actor.full_name AS actor_name,
          audit.metadata,
          audit.created_at::text AS created_at
        FROM audit_log audit
        JOIN work_shift ws
          ON ws.tenant_id = audit.tenant_id
         AND ws.id::text = audit.entity_id
        LEFT JOIN app_user actor
          ON actor.id = audit.actor_user_id
        WHERE audit.tenant_id = $1
          AND audit.entity_type = 'work_shift'
          AND ($2::text IS NULL OR $2::text = 'assignment')
          AND ($3::text IS NULL OR audit.entity_id = $3::text)
          AND ($4::text IS NULL OR ws.department::text = $4::text)

        UNION ALL

        SELECT
          event.id,
          'staffing'::text AS module,
          issue.department::text AS scope_department,
          'staffing_issue'::text AS entity_type,
          event.staffing_issue_id::text AS entity_id,
          NULL::text AS parent_entity_type,
          NULL::text AS parent_entity_id,
          event.event_type,
          event.summary,
          event.note,
          event.actor_user_id,
          actor.full_name AS actor_name,
          event.metadata,
          event.created_at::text AS created_at
        FROM staffing_issue_event event
        JOIN staffing_issue issue
          ON issue.tenant_id = event.tenant_id
         AND issue.id = event.staffing_issue_id
        LEFT JOIN app_user actor
          ON actor.id = event.actor_user_id
        WHERE event.tenant_id = $1
          AND ($2::text IS NULL OR $2::text = 'staffing_issue')
          AND ($3::uuid IS NULL OR event.staffing_issue_id = $3::uuid)
          AND ($4::text IS NULL OR issue.department::text = $4::text)

        UNION ALL

        SELECT
          event.id,
          'watch'::text AS module,
          item.scope_department::text AS scope_department,
          'watch_item'::text AS entity_type,
          event.urgent_watch_item_id::text AS entity_id,
          NULL::text AS parent_entity_type,
          NULL::text AS parent_entity_id,
          event.event_type,
          event.summary,
          event.note,
          event.actor_user_id,
          actor.full_name AS actor_name,
          event.metadata,
          event.created_at::text AS created_at
        FROM urgent_watch_event event
        JOIN urgent_watch_item item
          ON item.tenant_id = event.tenant_id
         AND item.id = event.urgent_watch_item_id
        LEFT JOIN app_user actor
          ON actor.id = event.actor_user_id
        WHERE event.tenant_id = $1
          AND ($2::text IS NULL OR $2::text = 'watch_item')
          AND ($3::uuid IS NULL OR event.urgent_watch_item_id = $3::uuid)
          AND ($4::text IS NULL OR item.scope_department::text = $4::text)

        UNION ALL

        SELECT
          event.id,
          'production'::text AS module,
          COALESCE(shoot.department::text, owner.department::text) AS scope_department,
          'production_job'::text AS entity_type,
          event.project_id::text AS entity_id,
          NULL::text AS parent_entity_type,
          NULL::text AS parent_entity_id,
          event.event_type,
          event.summary,
          event.note,
          event.actor_user_id,
          actor.full_name AS actor_name,
          event.metadata,
          event.created_at::text AS created_at
        FROM production_project_event event
        JOIN production_project project
          ON project.tenant_id = event.tenant_id
         AND project.id = event.project_id
        LEFT JOIN shoot shoot
          ON shoot.id = project.linked_shoot_id
        LEFT JOIN app_user owner
          ON owner.id = project.owner_user_id
        LEFT JOIN app_user actor
          ON actor.id = event.actor_user_id
        WHERE event.tenant_id = $1
          AND ($2::text IS NULL OR $2::text = 'production_job')
          AND ($3::uuid IS NULL OR event.project_id = $3::uuid)
          AND ($4::text IS NULL OR COALESCE(shoot.department::text, owner.department::text) = $4::text)

        UNION ALL

        SELECT
          event.id,
          'production'::text AS module,
          COALESCE(shoot.department::text, owner.department::text) AS scope_department,
          'production_task'::text AS entity_type,
          event.task_id::text AS entity_id,
          'production_job'::text AS parent_entity_type,
          event.project_id::text AS parent_entity_id,
          event.event_type,
          event.summary,
          event.note,
          event.actor_user_id,
          actor.full_name AS actor_name,
          event.metadata,
          event.created_at::text AS created_at
        FROM production_project_task_event event
        JOIN production_project project
          ON project.tenant_id = event.tenant_id
         AND project.id = event.project_id
        LEFT JOIN shoot shoot
          ON shoot.id = project.linked_shoot_id
        LEFT JOIN app_user owner
          ON owner.id = project.owner_user_id
        LEFT JOIN app_user actor
          ON actor.id = event.actor_user_id
        WHERE event.tenant_id = $1
          AND ($2::text IS NULL OR $2::text = 'production_task')
          AND ($3::uuid IS NULL OR event.task_id = $3::uuid)
          AND ($4::text IS NULL OR COALESCE(shoot.department::text, owner.department::text) = $4::text)

        UNION ALL

        SELECT
          event.id,
          'approvals'::text AS module,
          requester.department::text AS scope_department,
          'approval_request'::text AS entity_type,
          event.approval_request_id::text AS entity_id,
          NULL::text AS parent_entity_type,
          NULL::text AS parent_entity_id,
          event.event_type,
          event.summary,
          event.note,
          event.actor_user_id,
          actor.full_name AS actor_name,
          event.metadata,
          event.created_at::text AS created_at
        FROM operational_approval_event event
        JOIN operational_approval_request request
          ON request.tenant_id = event.tenant_id
         AND request.id = event.approval_request_id
        LEFT JOIN app_user requester
          ON requester.id = request.requested_by_user_id
        LEFT JOIN app_user actor
          ON actor.id = event.actor_user_id
        WHERE event.tenant_id = $1
          AND ($2::text IS NULL OR $2::text = 'approval_request')
          AND ($3::uuid IS NULL OR event.approval_request_id = $3::uuid)
          AND ($4::text IS NULL OR requester.department::text = $4::text)

        UNION ALL

        SELECT
          history.id,
          'attendance'::text AS module,
          ws.department::text AS scope_department,
          'attendance_record'::text AS entity_type,
          history.shift_id::text AS entity_id,
          'assignment'::text AS parent_entity_type,
          history.shift_id::text AS parent_entity_id,
          history.event_type,
          COALESCE(history.note, history.event_type) AS summary,
          history.note,
          history.actor_user_id,
          actor.full_name AS actor_name,
          history.metadata,
          history.created_at::text AS created_at
        FROM shift_attendance_history history
        JOIN work_shift ws
          ON ws.tenant_id = history.tenant_id
         AND ws.id = history.shift_id
        LEFT JOIN app_user actor
          ON actor.id = history.actor_user_id
        WHERE history.tenant_id = $1
          AND ($2::text IS NULL OR $2::text = 'attendance_record')
          AND ($3::uuid IS NULL OR history.shift_id = $3::uuid)
          AND ($4::text IS NULL OR ws.department::text = $4::text)
      )
      SELECT
        history.id,
        history.module,
        history.scope_department,
        history.entity_type,
        history.entity_id,
        history.parent_entity_type,
        history.parent_entity_id,
        history.event_type,
        history.summary,
        history.note,
        history.actor_user_id,
        history.actor_name,
        history.metadata,
        history.created_at
      FROM history
      ${whereClause}
      ORDER BY history.created_at DESC
      LIMIT $${values.length}
    `,
    values
  );

  return rows.map((row) => ({
    id: row.id,
    module: row.module,
    scope_department: row.scope_department,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    parent_entity_type: row.parent_entity_type,
    parent_entity_id: row.parent_entity_id,
    event_type: row.event_type,
    summary: row.entity_type === "assignment" ? humanizeAuditAction(row.event_type) : row.summary,
    note: row.note,
    actor_user_id: row.actor_user_id,
    actor_name: row.actor_name,
    metadata: row.metadata ?? {},
    created_at: row.created_at
  }));
}

export { listStaffingIssueEvents };
