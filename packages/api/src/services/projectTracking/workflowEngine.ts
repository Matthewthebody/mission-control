import type { PoolClient } from "pg";
import type { AuthUser } from "../../types/auth.js";
import type {
  ProjectWorkflowAssignmentStatus,
  ProjectWorkflowCommandCenterSummary,
  ProjectWorkflowDeadlineState,
  ProjectWorkflowFileStatus,
  ProjectWorkflowHandoffStatus,
  ProjectWorkflowHandoffSummary,
  ProjectWorkflowJobHealth,
  ProjectWorkflowJobRow,
  ProjectWorkflowQueueIntelligence,
  ProjectWorkflowProductionQueue,
  ProjectWorkflowProductionQueueItem,
  ProjectWorkflowClaimInput,
  ProjectWorkflowInstanceDetail,
  ProjectWorkflowReturnInput,
  ProjectWorkflowSendBackInput,
  ProjectWorkflowSendToProductionInput,
  ProjectWorkflowStepSummary,
  ProjectWorkflowWaitingInput,
  ProjectWorkflowWaitingOnParty,
  ProjectWorkflowTemplateInput,
  ProjectWorkflowTransitionInput,
  WorkflowTemplateBuilderDetail,
  WorkflowTemplateBuilderDependencyMode,
  WorkflowTemplateBuilderMilestoneInput,
  WorkflowTemplateBuilderOwnerType,
  WorkflowTemplateBuilderStepInput,
  WorkflowTemplateBuilderStepMoveDirection,
  WorkflowTemplateBuilderStepUpdateInput,
  WorkflowTemplateBuilderTemplateInput,
  WorkflowTemplateBuilderVersionStatus
} from "../../types/projectTracking.js";
import type { WorkDepartmentType } from "../../domain/jobTruth/index.js";
import { WORK_DEPARTMENT_TYPES } from "../../domain/jobTruth/index.js";
import type {
  ProjectWorkflowStepStatus,
  ProjectWorkflowTransitionType
} from "../../domain/projectTracking/index.js";
import { WORKFLOW_TERMINAL_STEP_STATUSES } from "../../domain/projectTracking/index.js";
import { ApiError } from "../../errors/apiError.js";
import { createAuditLog } from "../audit.js";
import { hasOperationalPermission } from "../policy/operationalAuthorization.js";
import { getRequestContext } from "../requestContext.js";
import { calculateStepTiming } from "./slaEngine.js";

type TemplateVersionRow = {
  template_id: string;
  template_key: string;
  template_name: string;
  template_description: string | null;
  template_version_id: string;
  version_number: number;
};

type TemplateMilestoneRow = {
  id: string;
  milestone_key: string;
  name: string;
  description: string | null;
  sort_order: number;
};

type TemplateStepRow = {
  id: string;
  template_milestone_id: string;
  milestone_key: string;
  step_key: string;
  name: string;
  description: string | null;
  department: WorkDepartmentType;
  role_key: string | null;
  assigned_user_id: string | null;
  required: boolean;
  skippable: boolean;
  blocking: boolean;
  expected_duration_minutes: number;
  sort_order: number;
};

type TemplateDependencyRow = {
  step_key: string;
  depends_on_step_key: string;
};

type StepRow = {
  id: string;
  tenant_id: string;
  workflow_run_id: string;
  workflow_run_milestone_id: string;
  job_id: string;
  milestone_key: string;
  step_key: string;
  name: string;
  description: string | null;
  department: WorkDepartmentType;
  role_key: string | null;
  assigned_user_id: string | null;
  assigned_user_name?: string | null;
  assignment_status?: ProjectWorkflowAssignmentStatus | null;
  assigned_queue?: WorkDepartmentType | null;
  assigned_by_user_id?: string | null;
  assigned_by_user_name?: string | null;
  assigned_at?: string | null;
  waiting_on_party?: ProjectWorkflowWaitingOnParty | null;
  waiting_detail?: string | null;
  status: ProjectWorkflowStepStatus;
  required: boolean;
  skippable: boolean;
  blocking: boolean;
  expected_duration_minutes: number;
  started_at: string | null;
  completed_at: string | null;
  completed_by_user_id: string | null;
  notes: string | null;
  exception_reason: string | null;
  rework_count: number;
  last_transition_at: string | null;
  updated_at: string;
  sort_order: number;
};

type WorkflowRunRow = {
  id: string;
  job_id: string;
  template_id: string;
  template_version_id: string;
  template_key: string;
  template_name: string | null;
  version_number: number;
  workflow_family: "project_tracking";
  status: string;
  started_at: string | null;
  completed_at: string | null;
  job_title: string;
  job_type: string | null;
  organization_id: string;
  organization_name: string | null;
  account_owner_user_id: string | null;
};

type WorkflowAssignableUserRow = {
  user_id: string;
  full_name: string;
  email: string | null;
  department: string | null;
  membership_status: string;
};

type CommandCenterJobSourceRow = {
  job_id: string;
  job_number: string | null;
  job_title: string;
  job_category: string | null;
  job_department_type: string;
  job_status: string;
  production_status: string;
  readiness_status: string;
  risk_status: string;
  production_required: boolean;
  organization_id: string | null;
  organization_name: string | null;
  account_owner_user_id: string | null;
  account_owner_name: string | null;
  scheduled_start_at: string | null;
  client_deadline_at: string | null;
  production_deadline_at: string | null;
  job_updated_at: string;
  workflow_run_id: string | null;
  workflow_template_id: string | null;
  workflow_template_name: string | null;
  workflow_template_version_id: string | null;
  workflow_template_version_number: number | null;
  workflow_run_status: string | null;
  workflow_started_at: string | null;
  workflow_completed_at: string | null;
  step_id: string | null;
  workflow_run_milestone_id: string | null;
  milestone_key: string | null;
  milestone_sort_order: number | null;
  step_key: string | null;
  step_name: string | null;
  step_description: string | null;
  step_department: WorkDepartmentType | null;
  role_key: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  assignment_status: ProjectWorkflowAssignmentStatus | null;
  assigned_queue: WorkDepartmentType | null;
  assigned_by_user_id: string | null;
  assigned_by_user_name: string | null;
  assigned_at: string | null;
  waiting_on_party: ProjectWorkflowWaitingOnParty | null;
  waiting_detail: string | null;
  step_status: ProjectWorkflowStepStatus | null;
  required: boolean | null;
  skippable: boolean | null;
  blocking: boolean | null;
  expected_duration_minutes: number | null;
  started_at: string | null;
  completed_at: string | null;
  completed_by_user_id: string | null;
  notes: string | null;
  exception_reason: string | null;
  rework_count: number | null;
  last_transition_at: string | null;
  step_updated_at: string | null;
  step_sort_order: number | null;
};

type WorkflowTemplateBuilderTemplateRow = {
  id: string;
  template_key: string;
  name: string;
  description: string | null;
  job_type: string | null;
  category: string | null;
  archived_at: string | null;
  updated_at: string;
  version_id: string | null;
  version_number: number | null;
  version_status: string | null;
  default_for_new_jobs: boolean | null;
  departments_involved: WorkDepartmentType[] | null;
  published_at: string | null;
  published_by_user_id: string | null;
};

type WorkflowTemplateBuilderMilestoneRow = {
  id: string;
  milestone_key: string;
  name: string;
  description: string | null;
  sort_order: number;
  default_owner_type: WorkflowTemplateBuilderOwnerType | null;
  default_owner_value: string | null;
};

type WorkflowTemplateBuilderStepRow = {
  id: string;
  template_milestone_id: string;
  step_key: string;
  name: string;
  description: string | null;
  sort_order: number;
  department: WorkDepartmentType;
  role_key: string | null;
  assigned_user_id: string | null;
  owner_type: WorkflowTemplateBuilderOwnerType | null;
  owner_value: string | null;
  required: boolean;
  skippable: boolean;
  blocking: boolean;
  expected_duration_minutes: number;
  due_offset_minutes: number | null;
  dependency_mode: WorkflowTemplateBuilderDependencyMode;
  blocked_behavior: string | null;
  checklist_template_id: string | null;
  checklist_template_name: string | null;
};

type MilestoneRow = {
  id: string;
  milestone_key: string;
  name: string;
  description: string | null;
  status: "WAITING" | "ACTIVE" | "COMPLETE" | "SKIPPED";
  sort_order: number;
};

type DependencySummaryRow = {
  workflow_step_id: string;
  depends_on_workflow_step_id: string;
};

type HandoffRow = {
  id: string;
  workflow_run_id: string;
  from_step_id: string | null;
  to_step_id: string;
  from_step_name: string | null;
  to_step_name: string;
  from_department: WorkDepartmentType | null;
  to_department: WorkDepartmentType;
  from_user_id: string | null;
  from_user_name: string | null;
  to_user_id: string | null;
  to_user_name: string | null;
  status: ProjectWorkflowHandoffStatus;
  reason: string | null;
  expectations: string | null;
  notes: string | null;
  issue_flag: boolean;
  return_reason: string | null;
  sent_by_user_id: string | null;
  sent_by_user_name: string | null;
  sent_at: string | null;
  accepted_by_user_id: string | null;
  accepted_by_user_name: string | null;
  accepted_at: string | null;
  returned_by_user_id: string | null;
  returned_by_user_name: string | null;
  returned_at: string | null;
  created_at: string;
  updated_at: string;
};

type WorkflowAuditRow = {
  workflow_step_id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  transition_type: ProjectWorkflowTransitionType;
  previous_status: ProjectWorkflowStepStatus | null;
  new_status: ProjectWorkflowStepStatus;
  previous_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  reason: string | null;
  created_at: string;
};

type ProductionQueueRow = {
  handoff_id: string;
  workflow_run_id: string;
  job_id: string;
  job_title: string;
  job_type: string | null;
  organization_id: string | null;
  organization_name: string | null;
  step_id: string;
  production_step: string;
  step_status: ProjectWorkflowStepStatus;
  needed_work: string | null;
  started_at: string | null;
  expected_duration_minutes: number;
  handoff_status: ProjectWorkflowHandoffStatus;
  assignment_status: ProjectWorkflowAssignmentStatus | null;
  assigned_queue: WorkDepartmentType | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  waiting_on_party: ProjectWorkflowWaitingOnParty | null;
  waiting_detail: string | null;
  step_notes: string | null;
  notes: string | null;
  reason: string | null;
  last_updated: string;
};

const ACTIVE_PRODUCTION_HANDOFF_STATUSES = new Set<ProjectWorkflowHandoffStatus>([
  "pending",
  "sent_to_production",
  "accepted_by_production",
  "waiting_on_info",
  "production_complete"
]);

const CLAIMED_ASSIGNMENT_STATUSES = new Set<ProjectWorkflowAssignmentStatus>([
  "claimed",
  "assigned",
  "in_progress",
  "completed",
  "returned"
]);

function normalizeText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function assertUnique(values: string[], label: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new ApiError(400, `Duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

function toBuilderVersionStatus(status: string | null): WorkflowTemplateBuilderVersionStatus {
  if (status === "active") {
    return "published";
  }
  if (status === "retired") {
    return "archived";
  }
  return "draft";
}

function formatTemplateBuilderSummary(row: WorkflowTemplateBuilderTemplateRow) {
  return {
    id: row.id,
    template_key: row.template_key,
    name: row.name,
    description: row.description,
    job_type: row.job_type,
    category: row.category,
    status: row.archived_at ? "archived" : "active",
    updated_at: row.updated_at,
    latest_version: row.version_id
      ? {
          id: row.version_id,
          version_number: row.version_number ?? 1,
          status: toBuilderVersionStatus(row.version_status),
          default_for_new_jobs: Boolean(row.default_for_new_jobs),
          departments_involved: row.departments_involved ?? [],
          published_at: row.published_at,
          published_by_user_id: row.published_by_user_id
        }
      : null
  };
}

async function loadTemplateBuilderVersionHeader(client: PoolClient, tenantId: string, templateVersionId: string) {
  const { rows } = await client.query<{
    id: string;
    template_id: string;
    version_number: number;
    status: string;
  }>(
    `
      SELECT
        version_row.id::text,
        version_row.template_id::text,
        version_row.version_number,
        version_row.status::text
      FROM workflow_template_version version_row
      JOIN workflow_template template ON template.id = version_row.template_id
      WHERE version_row.tenant_id = $1
        AND version_row.id = $2
        AND template.workflow_family = 'project_tracking'::shared_workflow_family_type
      LIMIT 1
    `,
    [tenantId, templateVersionId]
  );
  return rows[0] ?? null;
}

async function assertDraftTemplateBuilderVersion(client: PoolClient, tenantId: string, templateVersionId: string) {
  const version = await loadTemplateBuilderVersionHeader(client, tenantId, templateVersionId);
  if (!version) {
    throw new ApiError(404, "Workflow template version not found.");
  }
  if (version.status !== "draft") {
    throw new ApiError(400, "Published workflow template versions are locked. Create a new draft version before editing.");
  }
  return version;
}

function canOverride(auth: AuthUser) {
  return (
    auth.permissions.includes("workflow.step.override") ||
    auth.authorityTier === "super_admin" ||
    auth.authorityTier === "leadership" ||
    auth.authorityTier === "director_admin" ||
    auth.authorityTier === "supervisor"
  );
}

function matchesStepRole(auth: AuthUser, roleKey: string | null) {
  if (!roleKey) {
    return false;
  }
  return (
    auth.baseRole === roleKey ||
    auth.policyRoles.includes(roleKey) ||
    auth.primaryJobFunctionProfile === roleKey ||
    auth.jobFunctionProfiles.includes(roleKey as AuthUser["primaryJobFunctionProfile"])
  );
}

function canExecuteStep(auth: AuthUser, step: StepRow) {
  if (canOverride(auth)) {
    return true;
  }
  if (step.assigned_user_id === auth.id) {
    return true;
  }
  if (!hasOperationalPermission(auth, "workflow.step.execute", { departmentType: step.department })) {
    return false;
  }
  if (step.assigned_user_id) {
    return false;
  }
  if (matchesStepRole(auth, step.role_key)) {
    return true;
  }
  return auth.department === step.department;
}

function assertCanExecuteStep(auth: AuthUser, step: StepRow) {
  if (!canExecuteStep(auth, step)) {
    throw new ApiError(403, "Workflow step execution is limited to assigned users, matching roles, department owners, or override authorities.");
  }
}

function classifyTransition(previous: ProjectWorkflowStepStatus, next: ProjectWorkflowStepStatus): ProjectWorkflowTransitionType {
  if (previous === next) {
    if (next === "COMPLETE") {
      return "completed";
    }
    if (next === "SKIPPED") {
      return "skipped";
    }
    if (next === "BLOCKED") {
      return "blocked";
    }
    return "updated";
  }
  if (next === "IN_PROGRESS") {
    return previous === "COMPLETE" || previous === "SKIPPED" ? "reopened" : "started";
  }
  if (next === "COMPLETE") {
    return "completed";
  }
  if (next === "BLOCKED") {
    return "blocked";
  }
  if (next === "SKIPPED") {
    return "skipped";
  }
  return "updated";
}

function eventTypeForTransition(transitionType: ProjectWorkflowTransitionType) {
  switch (transitionType) {
    case "started":
      return "workflow.step_started";
    case "completed":
      return "workflow.step_completed";
    case "blocked":
      return "workflow.step_blocked";
    case "reopened":
      return "workflow.step_reopened";
    case "sent_back":
      return "workflow.step_sent_back";
    case "activated":
      return "workflow.step_activated";
    default:
      return "workflow.step_updated";
  }
}

function workflowEventDedupeKey(eventType: string, aggregateId: string, idempotencyKey?: string | null) {
  return idempotencyKey ? `workflow:${eventType}:${aggregateId}:${idempotencyKey}` : null;
}

async function hasWorkflowEventDedupe(
  client: PoolClient,
  tenantId: string,
  eventType: string,
  aggregateId: string,
  idempotencyKey?: string | null
) {
  const dedupeKey = workflowEventDedupeKey(eventType, aggregateId, idempotencyKey);
  if (!dedupeKey) {
    return false;
  }
  const { rows } = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM app_event
        WHERE tenant_id = $1
          AND dedupe_key = $2
          AND event_type = $3
          AND aggregate_id = $4
      ) AS exists
    `,
    [tenantId, dedupeKey, eventType, aggregateId]
  );
  return Boolean(rows[0]?.exists);
}

async function emitWorkflowEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    eventType: string;
    aggregateType?: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    idempotencyKey?: string | null;
  }
) {
  const dedupeKey = workflowEventDedupeKey(input.eventType, input.aggregateId, input.idempotencyKey);
  await client.query("SAVEPOINT project_tracking_event_emit");
  try {
    await client.query(
      `
        INSERT INTO app_event (tenant_id, event_type, aggregate_type, aggregate_id, payload, dedupe_key)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6)
        ON CONFLICT (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      `,
      [input.tenantId, input.eventType, input.aggregateType ?? "workflow_step", input.aggregateId, JSON.stringify(input.payload), dedupeKey]
    );
    await client.query("RELEASE SAVEPOINT project_tracking_event_emit");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT project_tracking_event_emit");
    await client.query("RELEASE SAVEPOINT project_tracking_event_emit");
    console.warn("[project_tracking.event_emit_failed]", {
      event_type: input.eventType,
      aggregate_type: input.aggregateType ?? "workflow_step",
      aggregate_id: input.aggregateId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function writeStepAudit(
  client: PoolClient,
  auth: AuthUser,
  input: {
    step: StepRow;
    previousStatus: ProjectWorkflowStepStatus | null;
    newStatus: ProjectWorkflowStepStatus;
    transitionType: ProjectWorkflowTransitionType;
    previousValues: Record<string, unknown>;
    newValues: Record<string, unknown>;
    reason?: string | null;
    conflictDetected?: boolean;
  }
) {
  const context = getRequestContext();
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
        reason,
        conflict_detected,
        request_id
      )
      VALUES ($1,$2,$3,$4,$5::workflow_step_transition_type,$6::workflow_step_status_type,$7::workflow_step_status_type,$8::jsonb,$9::jsonb,$10,$11,$12)
    `,
    [
      input.step.tenant_id,
      input.step.workflow_run_id,
      input.step.id,
      auth.id,
      input.transitionType,
      input.previousStatus,
      input.newStatus,
      JSON.stringify(input.previousValues),
      JSON.stringify(input.newValues),
      input.reason ?? null,
      Boolean(input.conflictDetected),
      context?.requestId ?? null
    ]
  );
  await createAuditLog(client, {
    tenantId: input.step.tenant_id,
    actorUserId: auth.id,
    action: `workflow.${input.transitionType}`,
    entityType: "workflow_step",
    entityId: input.step.id,
    previousValues: input.previousValues,
    newValues: input.newValues,
    reasonComment: input.reason ?? null,
    metadata: {
      workflow_run_id: input.step.workflow_run_id,
      job_id: input.step.job_id,
      step_key: input.step.step_key,
      conflict_detected: Boolean(input.conflictDetected)
    },
    sourceSurface: "project_tracking_workflow_engine"
  });
}

export async function createProjectWorkflowTemplate(
  client: PoolClient,
  auth: AuthUser,
  input: ProjectWorkflowTemplateInput
) {
  if (!input.milestones.length) {
    throw new ApiError(400, "Workflow templates require at least one milestone.");
  }
  assertUnique(input.milestones.map((milestone) => milestone.milestone_key), "milestone_key");
  const stepKeys = input.milestones.flatMap((milestone) => milestone.steps.map((step) => step.step_key));
  assertUnique(stepKeys, "step_key");
  const stepKeySet = new Set(stepKeys);
  for (const milestone of input.milestones) {
    if (!milestone.steps.length) {
      throw new ApiError(400, `Milestone ${milestone.milestone_key} requires at least one step.`);
    }
    for (const step of milestone.steps) {
      if (step.depends_on_step_keys?.some((dependency) => !stepKeySet.has(dependency))) {
        throw new ApiError(400, `Step ${step.step_key} depends on an unknown step.`);
      }
      if (step.depends_on_step_keys?.includes(step.step_key)) {
        throw new ApiError(400, `Step ${step.step_key} cannot depend on itself.`);
      }
    }
  }

  const templateResult = await client.query<{ id: string }>(
    `
      INSERT INTO workflow_template (tenant_id, template_key, name, description, workflow_family)
      VALUES ($1,$2,$3,$4,'project_tracking'::shared_workflow_family_type)
      ON CONFLICT (tenant_id, template_key) DO UPDATE
      SET name = EXCLUDED.name,
          description = EXCLUDED.description,
          updated_at = now()
      RETURNING id::text
    `,
    [auth.tenantId, input.template_key, input.name, normalizeText(input.description)]
  );
  const templateId = templateResult.rows[0]?.id;
  if (!templateId) {
    throw new ApiError(500, "Workflow template could not be created.");
  }

  const versionNumberResult = await client.query<{ next_version: number }>(
    `SELECT COALESCE(max(version_number), 0) + 1 AS next_version FROM workflow_template_version WHERE template_id = $1`,
    [templateId]
  );
  const versionNumber = versionNumberResult.rows[0]?.next_version ?? 1;
  await client.query(
    `
      UPDATE workflow_template_version
      SET default_for_new_jobs = false,
          updated_at = now()
      WHERE template_id = $1
        AND default_for_new_jobs = true
    `,
    [templateId]
  );

  const versionResult = await client.query<{ id: string }>(
    `
      INSERT INTO workflow_template_version (
        tenant_id,
        template_id,
        version_number,
        status,
        default_for_new_jobs,
        departments_involved,
        owner_defaults_json
      )
      VALUES ($1,$2,$3,'active'::shared_workflow_template_version_status_type,true,$4::work_department_type[],$5::jsonb)
      RETURNING id::text
    `,
    [auth.tenantId, templateId, versionNumber, input.departments_involved, JSON.stringify({ source: "project_tracking_foundation" })]
  );
  const templateVersionId = versionResult.rows[0]?.id;
  if (!templateVersionId) {
    throw new ApiError(500, "Workflow template version could not be created.");
  }

  const milestoneIds = new Map<string, string>();
  for (const [index, milestone] of input.milestones.entries()) {
    const result = await client.query<{ id: string }>(
      `
        INSERT INTO workflow_template_milestone (
          tenant_id,
          template_version_id,
          milestone_key,
          name,
          description,
          sort_order
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING id::text
      `,
      [auth.tenantId, templateVersionId, milestone.milestone_key, milestone.name, normalizeText(milestone.description), index]
    );
    milestoneIds.set(milestone.milestone_key, result.rows[0]?.id ?? "");
  }

  for (const [milestoneIndex, milestone] of input.milestones.entries()) {
    const milestoneId = milestoneIds.get(milestone.milestone_key);
    if (!milestoneId) {
      throw new ApiError(500, "Workflow milestone could not be created.");
    }
    for (const [stepIndex, step] of milestone.steps.entries()) {
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
            assigned_user_id,
            required,
            skippable,
            blocking,
            expected_duration_minutes,
            sort_order
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7::work_department_type,$8,$9,$10,$11,$12,$13,$14)
        `,
        [
          auth.tenantId,
          templateVersionId,
          milestoneId,
          step.step_key,
          step.name,
          normalizeText(step.description),
          step.department,
          normalizeText(step.role_key),
          step.assigned_user_id ?? null,
          step.required ?? true,
          step.skippable ?? false,
          step.blocking ?? true,
          step.expected_duration_minutes ?? 1440,
          milestoneIndex * 1000 + stepIndex
        ]
      );

      for (const dependency of step.depends_on_step_keys ?? []) {
        await client.query(
          `
            INSERT INTO workflow_template_step_dependency (
              tenant_id,
              template_version_id,
              step_key,
              depends_on_step_key
            )
            VALUES ($1,$2,$3,$4)
          `,
          [auth.tenantId, templateVersionId, step.step_key, dependency]
        );
      }
    }
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "workflow.template_version_created",
    entityType: "workflow_template_version",
    entityId: templateVersionId,
    newValues: {
      template_key: input.template_key,
      version_number: versionNumber,
      milestone_count: input.milestones.length,
      step_count: stepKeys.length
    },
    sourceSurface: "project_tracking_workflow_engine"
  });

  return {
    template: {
      id: templateId,
      template_key: input.template_key,
      name: input.name,
      description: normalizeText(input.description),
      workflow_family: "project_tracking",
      is_active: true
    },
    version: {
      id: templateVersionId,
      version_number: versionNumber,
      is_active: true,
      departments_involved: input.departments_involved
    }
  };
}

async function loadTemplateVersion(
  client: PoolClient,
  tenantId: string,
  input: { template_version_id?: string | null; template_key?: string | null }
) {
  const { rows } = await client.query<TemplateVersionRow>(
    `
      SELECT
        template.id::text AS template_id,
        template.template_key,
        template.name AS template_name,
        template.description AS template_description,
        version_row.id::text AS template_version_id,
        version_row.version_number
      FROM workflow_template template
      JOIN workflow_template_version version_row ON version_row.template_id = template.id
      WHERE template.tenant_id = $1
        AND template.workflow_family = 'project_tracking'::shared_workflow_family_type
        AND version_row.status = 'active'::shared_workflow_template_version_status_type
        AND (
          ($2::uuid IS NOT NULL AND version_row.id = $2::uuid)
          OR ($2::uuid IS NULL AND template.template_key = $3)
        )
      ORDER BY version_row.default_for_new_jobs DESC, version_row.version_number DESC
      LIMIT 1
    `,
    [tenantId, input.template_version_id ?? null, input.template_key ?? null]
  );
  return rows[0] ?? null;
}

export async function listProjectWorkflowTemplates(client: PoolClient, auth: AuthUser) {
  const { rows } = await client.query(
    `
      SELECT
        template.id::text,
        template.template_key,
        template.name,
        template.description,
        version_row.id::text AS active_version_id,
        version_row.version_number,
        version_row.departments_involved::text[] AS departments_involved,
        version_row.default_for_new_jobs,
        template.updated_at::text AS updated_at
      FROM workflow_template template
      JOIN workflow_template_version version_row ON version_row.template_id = template.id
      WHERE template.tenant_id = $1
        AND template.workflow_family = 'project_tracking'::shared_workflow_family_type
        AND version_row.status = 'active'::shared_workflow_template_version_status_type
      ORDER BY template.name ASC, version_row.version_number DESC
    `,
    [auth.tenantId]
  );
  return { templates: rows };
}

export async function listWorkflowAssignableUsers(client: PoolClient, auth: AuthUser) {
  const { rows } = await client.query<WorkflowAssignableUserRow>(
    `
      SELECT
        id::text AS user_id,
        full_name,
        email,
        department::text AS department,
        status::text AS membership_status
      FROM app_user
      WHERE tenant_id = $1
        AND status = 'active'::membership_status
        AND lower(email) !~ '^(ms|isolation|invite|suspend|demote|security|attendance-monitor)-'
      ORDER BY
        CASE WHEN id = $2 THEN 0 ELSE 1 END,
        COALESCE(department::text, 'zzzz') ASC,
        lower(full_name) ASC
    `,
    [auth.tenantId, auth.id]
  );
  return rows;
}

export async function listWorkflowTemplateBuilderTemplates(client: PoolClient, auth: AuthUser) {
  const { rows } = await client.query<WorkflowTemplateBuilderTemplateRow>(
    `
      SELECT
        template.id::text,
        template.template_key,
        template.name,
        template.description,
        template.job_type,
        template.category,
        template.archived_at::text,
        template.updated_at::text,
        latest_version.id::text AS version_id,
        latest_version.version_number,
        latest_version.status::text AS version_status,
        latest_version.default_for_new_jobs,
        latest_version.departments_involved::text[] AS departments_involved,
        latest_version.published_at::text,
        latest_version.published_by_user_id::text
      FROM workflow_template template
      LEFT JOIN LATERAL (
        SELECT *
        FROM workflow_template_version version_row
        WHERE version_row.template_id = template.id
        ORDER BY version_row.version_number DESC, version_row.created_at DESC
        LIMIT 1
      ) latest_version ON true
      WHERE template.tenant_id = $1
        AND template.workflow_family = 'project_tracking'::shared_workflow_family_type
      ORDER BY template.updated_at DESC, template.name ASC
      LIMIT 200
    `,
    [auth.tenantId]
  );
  return { templates: rows.map(formatTemplateBuilderSummary) };
}

export async function loadWorkflowTemplateBuilderDetail(
  client: PoolClient,
  auth: AuthUser,
  input: { template_id?: string | null; template_version_id?: string | null }
): Promise<WorkflowTemplateBuilderDetail> {
  const { rows } = await client.query<WorkflowTemplateBuilderTemplateRow>(
    `
      SELECT
        template.id::text,
        template.template_key,
        template.name,
        template.description,
        template.job_type,
        template.category,
        template.archived_at::text,
        template.updated_at::text,
        version_row.id::text AS version_id,
        version_row.version_number,
        version_row.status::text AS version_status,
        version_row.default_for_new_jobs,
        version_row.departments_involved::text[] AS departments_involved,
        version_row.published_at::text,
        version_row.published_by_user_id::text
      FROM workflow_template template
      JOIN workflow_template_version version_row ON version_row.template_id = template.id
      WHERE template.tenant_id = $1
        AND template.workflow_family = 'project_tracking'::shared_workflow_family_type
        AND (
          ($2::uuid IS NOT NULL AND template.id = $2::uuid)
          OR ($3::uuid IS NOT NULL AND version_row.id = $3::uuid)
        )
      ORDER BY
        CASE WHEN $3::uuid IS NOT NULL AND version_row.id = $3::uuid THEN 0 ELSE 1 END,
        version_row.version_number DESC
      LIMIT 1
    `,
    [auth.tenantId, input.template_id ?? null, input.template_version_id ?? null]
  );
  const templateRow = rows[0];
  if (!templateRow?.version_id) {
    throw new ApiError(404, "Workflow template not found.");
  }

  const milestoneRows = await client.query<WorkflowTemplateBuilderMilestoneRow>(
    `
      SELECT
        id::text,
        milestone_key,
        name,
        description,
        sort_order,
        default_owner_type,
        default_owner_value
      FROM workflow_template_milestone
      WHERE tenant_id = $1
        AND template_version_id = $2
      ORDER BY sort_order ASC, created_at ASC
    `,
    [auth.tenantId, templateRow.version_id]
  );
  const stepRows = await client.query<WorkflowTemplateBuilderStepRow>(
    `
      SELECT
        step.id::text,
        step.template_milestone_id::text,
        step.step_key,
        step.name,
        step.description,
        step.sort_order,
        step.department::text AS department,
        step.role_key,
        step.assigned_user_id::text,
        step.owner_type,
        step.owner_value,
        step.required,
        step.skippable,
        step.blocking,
        step.expected_duration_minutes,
        step.due_offset_minutes,
        step.dependency_mode,
        step.blocked_behavior,
        step.checklist_template_id::text,
        checklist.name AS checklist_template_name
      FROM workflow_template_step step
      LEFT JOIN checklist_templates checklist ON checklist.id = step.checklist_template_id
      WHERE step.tenant_id = $1
        AND step.template_version_id = $2
      ORDER BY step.sort_order ASC, step.created_at ASC
    `,
    [auth.tenantId, templateRow.version_id]
  );
  const dependencies = await client.query<TemplateDependencyRow>(
    `
      SELECT step_key, depends_on_step_key
      FROM workflow_template_step_dependency
      WHERE tenant_id = $1
        AND template_version_id = $2
      ORDER BY created_at ASC
    `,
    [auth.tenantId, templateRow.version_id]
  );

  const dependencyMap = new Map<string, string[]>();
  for (const dependency of dependencies.rows) {
    const list = dependencyMap.get(dependency.step_key) ?? [];
    list.push(dependency.depends_on_step_key);
    dependencyMap.set(dependency.step_key, list);
  }
  const stepsByMilestone = new Map<string, WorkflowTemplateBuilderDetail["milestones"][number]["steps"]>();
  for (const step of stepRows.rows) {
    const list = stepsByMilestone.get(step.template_milestone_id) ?? [];
    list.push({
      id: step.id,
      step_key: step.step_key,
      name: step.name,
      description: step.description,
      sort_order: step.sort_order,
      department: step.department,
      role_key: step.role_key,
      assigned_user_id: step.assigned_user_id,
      owner_type: step.owner_type,
      owner_value: step.owner_value,
      required: step.required,
      skippable: step.skippable,
      blocking: step.blocking,
      expected_duration_minutes: step.expected_duration_minutes,
      due_offset_minutes: step.due_offset_minutes,
      dependency_mode: step.dependency_mode ?? "waits_for_prior_step",
      blocked_behavior: step.blocked_behavior,
      checklist_template_id: step.checklist_template_id,
      checklist_template_name: step.checklist_template_name,
      depends_on_step_keys: dependencyMap.get(step.step_key) ?? []
    });
    stepsByMilestone.set(step.template_milestone_id, list);
  }

  return {
    template: {
      id: templateRow.id,
      template_key: templateRow.template_key,
      name: templateRow.name,
      description: templateRow.description,
      job_type: templateRow.job_type,
      category: templateRow.category,
      status: templateRow.archived_at ? "archived" : "active",
      updated_at: templateRow.updated_at
    },
    version: {
      id: templateRow.version_id,
      version_number: templateRow.version_number ?? 1,
      status: toBuilderVersionStatus(templateRow.version_status),
      default_for_new_jobs: Boolean(templateRow.default_for_new_jobs),
      departments_involved: templateRow.departments_involved ?? [],
      published_at: templateRow.published_at,
      published_by_user_id: templateRow.published_by_user_id
    },
    milestones: milestoneRows.rows.map((milestone) => ({
      id: milestone.id,
      milestone_key: milestone.milestone_key,
      name: milestone.name,
      description: milestone.description,
      sort_order: milestone.sort_order,
      default_owner_type: milestone.default_owner_type,
      default_owner_value: milestone.default_owner_value,
      steps: stepsByMilestone.get(milestone.id) ?? []
    }))
  };
}

export async function createWorkflowTemplateBuilderDraft(
  client: PoolClient,
  auth: AuthUser,
  input: WorkflowTemplateBuilderTemplateInput
) {
  const templateResult = await client.query<{ id: string }>(
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
      VALUES ($1,$2,$3,$4,'project_tracking'::shared_workflow_family_type,$5,$6,$7,$7)
      ON CONFLICT (tenant_id, template_key) DO UPDATE
      SET name = EXCLUDED.name,
          description = EXCLUDED.description,
          job_type = EXCLUDED.job_type,
          category = EXCLUDED.category,
          updated_by_user_id = EXCLUDED.updated_by_user_id,
          updated_at = now()
      RETURNING id::text
    `,
    [
      auth.tenantId,
      input.template_key,
      input.name,
      normalizeText(input.description),
      normalizeText(input.job_type),
      normalizeText(input.category),
      auth.id
    ]
  );
  const templateId = templateResult.rows[0]?.id;
  if (!templateId) {
    throw new ApiError(500, "Workflow template draft could not be created.");
  }
  const versionNumberResult = await client.query<{ next_version: number }>(
    `SELECT COALESCE(max(version_number), 0) + 1 AS next_version FROM workflow_template_version WHERE template_id = $1`,
    [templateId]
  );
  const versionNumber = versionNumberResult.rows[0]?.next_version ?? 1;
  const versionResult = await client.query<{ id: string }>(
    `
      INSERT INTO workflow_template_version (
        tenant_id,
        template_id,
        version_number,
        status,
        default_for_new_jobs,
        departments_involved,
        owner_defaults_json
      )
      VALUES ($1,$2,$3,'draft'::shared_workflow_template_version_status_type,false,$4::work_department_type[],$5::jsonb)
      RETURNING id::text
    `,
    [
      auth.tenantId,
      templateId,
      versionNumber,
      input.departments_involved,
      JSON.stringify({ source: "workflow_template_builder_v1", created_by_user_id: auth.id })
    ]
  );
  const templateVersionId = versionResult.rows[0]?.id;
  if (!templateVersionId) {
    throw new ApiError(500, "Workflow template draft version could not be created.");
  }
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "workflow.template_draft_created",
    entityType: "workflow_template_version",
    entityId: templateVersionId,
    newValues: {
      template_key: input.template_key,
      version_number: versionNumber,
      departments_involved: input.departments_involved
    },
    sourceSurface: "workflow_template_builder_v1"
  });
  return loadWorkflowTemplateBuilderDetail(client, auth, { template_version_id: templateVersionId });
}

export async function addWorkflowTemplateBuilderMilestone(
  client: PoolClient,
  auth: AuthUser,
  templateVersionId: string,
  input: WorkflowTemplateBuilderMilestoneInput
) {
  await assertDraftTemplateBuilderVersion(client, auth.tenantId, templateVersionId);
  const duplicate = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM workflow_template_milestone
      WHERE tenant_id = $1
        AND template_version_id = $2
        AND milestone_key = $3
      LIMIT 1
    `,
    [auth.tenantId, templateVersionId, input.milestone_key]
  );
  if (duplicate.rows[0]) {
    throw new ApiError(400, `Duplicate milestone_key: ${input.milestone_key}`);
  }
  const nextSort = await client.query<{ sort_order: number }>(
    `
      SELECT COALESCE(max(sort_order), -10) + 10 AS sort_order
      FROM workflow_template_milestone
      WHERE tenant_id = $1
        AND template_version_id = $2
    `,
    [auth.tenantId, templateVersionId]
  );
  await client.query(
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
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
    [
      auth.tenantId,
      templateVersionId,
      input.milestone_key,
      input.name,
      normalizeText(input.description),
      input.sort_order ?? nextSort.rows[0]?.sort_order ?? 0,
      input.default_owner_type ?? null,
      normalizeText(input.default_owner_value)
    ]
  );
  return loadWorkflowTemplateBuilderDetail(client, auth, { template_version_id: templateVersionId });
}

export async function addWorkflowTemplateBuilderStep(
  client: PoolClient,
  auth: AuthUser,
  templateVersionId: string,
  input: WorkflowTemplateBuilderStepInput
) {
  await assertDraftTemplateBuilderVersion(client, auth.tenantId, templateVersionId);
  const milestone = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM workflow_template_milestone
      WHERE tenant_id = $1
        AND template_version_id = $2
        AND id = $3
      LIMIT 1
    `,
    [auth.tenantId, templateVersionId, input.milestone_template_id]
  );
  if (!milestone.rows[0]) {
    throw new ApiError(404, "Workflow template milestone not found.");
  }
  const duplicate = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM workflow_template_step
      WHERE tenant_id = $1
        AND template_version_id = $2
        AND step_key = $3
      LIMIT 1
    `,
    [auth.tenantId, templateVersionId, input.step_key]
  );
  if (duplicate.rows[0]) {
    throw new ApiError(400, `Duplicate step_key: ${input.step_key}`);
  }
  const dependencyKeys = input.depends_on_step_keys ?? [];
  if (dependencyKeys.includes(input.step_key)) {
    throw new ApiError(400, `Step ${input.step_key} cannot depend on itself.`);
  }
  if (dependencyKeys.length) {
    const dependencyRows = await client.query<{ step_key: string }>(
      `
        SELECT step_key
        FROM workflow_template_step
        WHERE tenant_id = $1
          AND template_version_id = $2
          AND step_key = ANY($3::text[])
      `,
      [auth.tenantId, templateVersionId, dependencyKeys]
    );
    const existingKeys = new Set(dependencyRows.rows.map((row) => row.step_key));
    const missing = dependencyKeys.find((key) => !existingKeys.has(key));
    if (missing) {
      throw new ApiError(400, `Step ${input.step_key} depends on an unknown step: ${missing}`);
    }
  }
  const nextSort = await client.query<{ sort_order: number }>(
    `
      SELECT COALESCE(max(sort_order), -10) + 10 AS sort_order
      FROM workflow_template_step
      WHERE tenant_id = $1
        AND template_version_id = $2
        AND template_milestone_id = $3
    `,
    [auth.tenantId, templateVersionId, input.milestone_template_id]
  );
  if (input.owner_type === "user" && !input.assigned_user_id) {
    throw new ApiError(400, "User-owned workflow steps require assigned_user_id.");
  }
  const ownerValue =
    normalizeText(input.owner_value) ??
    (input.owner_type === "role" ? normalizeText(input.role_key) : null) ??
    (input.owner_type === "user" ? input.assigned_user_id ?? null : null) ??
    input.department;
  const roleKey = input.role_key ?? (input.owner_type === "role" ? ownerValue : null);
  const assignedUserId = input.assigned_user_id ?? null;
  const dependencyMode =
    input.dependency_mode ?? (dependencyKeys.length ? "waits_for_dependencies" : "waits_for_prior_step");

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
        assigned_user_id,
        required,
        skippable,
        blocking,
        expected_duration_minutes,
        sort_order,
        owner_type,
        owner_value,
        due_offset_minutes,
        dependency_mode,
        blocked_behavior,
        checklist_template_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::work_department_type,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
    `,
    [
      auth.tenantId,
      templateVersionId,
      input.milestone_template_id,
      input.step_key,
      input.name,
      normalizeText(input.description),
      input.department,
      normalizeText(roleKey),
      assignedUserId,
      input.required ?? true,
      input.skippable ?? false,
      input.blocking ?? true,
      input.expected_duration_minutes ?? 1440,
      input.sort_order ?? nextSort.rows[0]?.sort_order ?? 0,
      input.owner_type,
      ownerValue,
      input.due_offset_minutes ?? null,
      dependencyMode,
      normalizeText(input.blocked_behavior),
      input.checklist_template_id ?? null
    ]
  );
  for (const dependency of dependencyKeys) {
    await client.query(
      `
        INSERT INTO workflow_template_step_dependency (
          tenant_id,
          template_version_id,
          step_key,
          depends_on_step_key
        )
        VALUES ($1,$2,$3,$4)
      `,
      [auth.tenantId, templateVersionId, input.step_key, dependency]
    );
  }
  return loadWorkflowTemplateBuilderDetail(client, auth, { template_version_id: templateVersionId });
}

export async function updateWorkflowTemplateBuilderStep(
  client: PoolClient,
  auth: AuthUser,
  templateVersionId: string,
  stepId: string,
  input: WorkflowTemplateBuilderStepUpdateInput
) {
  await assertDraftTemplateBuilderVersion(client, auth.tenantId, templateVersionId);
  const existing = await client.query<{ id: string; step_key: string }>(
    `
      SELECT id::text, step_key
      FROM workflow_template_step
      WHERE tenant_id = $1
        AND template_version_id = $2
        AND id = $3
      LIMIT 1
    `,
    [auth.tenantId, templateVersionId, stepId]
  );
  const existingStep = existing.rows[0];
  if (!existingStep) {
    throw new ApiError(404, "Workflow template step not found.");
  }
  const milestone = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM workflow_template_milestone
      WHERE tenant_id = $1
        AND template_version_id = $2
        AND id = $3
      LIMIT 1
    `,
    [auth.tenantId, templateVersionId, input.milestone_template_id]
  );
  if (!milestone.rows[0]) {
    throw new ApiError(404, "Workflow template milestone not found.");
  }
  const duplicate = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM workflow_template_step
      WHERE tenant_id = $1
        AND template_version_id = $2
        AND step_key = $3
        AND id <> $4
      LIMIT 1
    `,
    [auth.tenantId, templateVersionId, input.step_key, stepId]
  );
  if (duplicate.rows[0]) {
    throw new ApiError(400, `Duplicate step_key: ${input.step_key}`);
  }
  const dependencyKeys = input.depends_on_step_keys ?? [];
  if (dependencyKeys.includes(input.step_key) || dependencyKeys.includes(existingStep.step_key)) {
    throw new ApiError(400, `Step ${input.step_key} cannot depend on itself.`);
  }
  if (dependencyKeys.length) {
    const dependencyRows = await client.query<{ step_key: string }>(
      `
        SELECT step_key
        FROM workflow_template_step
        WHERE tenant_id = $1
          AND template_version_id = $2
          AND step_key = ANY($3::text[])
          AND id <> $4
      `,
      [auth.tenantId, templateVersionId, dependencyKeys, stepId]
    );
    const existingKeys = new Set(dependencyRows.rows.map((row) => row.step_key));
    const missing = dependencyKeys.find((key) => !existingKeys.has(key));
    if (missing) {
      throw new ApiError(400, `Step ${input.step_key} depends on an unknown step: ${missing}`);
    }
  }
  if (input.owner_type === "user" && !input.assigned_user_id) {
    throw new ApiError(400, "User-owned workflow steps require assigned_user_id.");
  }
  const ownerValue =
    normalizeText(input.owner_value) ??
    (input.owner_type === "role" ? normalizeText(input.role_key) : null) ??
    (input.owner_type === "user" ? input.assigned_user_id ?? null : null) ??
    input.department;
  const roleKey = input.role_key ?? (input.owner_type === "role" ? ownerValue : null);
  const dependencyMode =
    input.dependency_mode ?? (dependencyKeys.length ? "waits_for_dependencies" : "waits_for_prior_step");

  await client.query(
    `
      UPDATE workflow_template_step
      SET template_milestone_id = $4,
          step_key = $5,
          name = $6,
          description = $7,
          department = $8::work_department_type,
          role_key = $9,
          assigned_user_id = $10,
          required = $11,
          skippable = $12,
          blocking = $13,
          expected_duration_minutes = $14,
          sort_order = $15,
          owner_type = $16,
          owner_value = $17,
          due_offset_minutes = $18,
          dependency_mode = $19,
          blocked_behavior = $20,
          checklist_template_id = $21,
          updated_at = now()
      WHERE tenant_id = $1
        AND template_version_id = $2
        AND id = $3
    `,
    [
      auth.tenantId,
      templateVersionId,
      stepId,
      input.milestone_template_id,
      input.step_key,
      input.name,
      normalizeText(input.description),
      input.department,
      normalizeText(roleKey),
      input.assigned_user_id ?? null,
      input.required ?? true,
      input.skippable ?? false,
      input.blocking ?? true,
      input.expected_duration_minutes ?? 1440,
      input.sort_order ?? 0,
      input.owner_type,
      ownerValue,
      input.due_offset_minutes ?? null,
      dependencyMode,
      normalizeText(input.blocked_behavior),
      input.checklist_template_id ?? null
    ]
  );
  await client.query(
    `
      UPDATE workflow_template_step_dependency
      SET depends_on_step_key = $4
      WHERE tenant_id = $1
        AND template_version_id = $2
        AND depends_on_step_key = $3
    `,
    [auth.tenantId, templateVersionId, existingStep.step_key, input.step_key]
  );
  await client.query(
    `
      DELETE FROM workflow_template_step_dependency
      WHERE tenant_id = $1
        AND template_version_id = $2
        AND step_key = $3
    `,
    [auth.tenantId, templateVersionId, existingStep.step_key]
  );
  for (const dependency of dependencyKeys) {
    await client.query(
      `
        INSERT INTO workflow_template_step_dependency (
          tenant_id,
          template_version_id,
          step_key,
          depends_on_step_key
        )
        VALUES ($1,$2,$3,$4)
      `,
      [auth.tenantId, templateVersionId, input.step_key, dependency]
    );
  }
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "workflow.template_step_updated",
    entityType: "workflow_template_step",
    entityId: stepId,
    newValues: {
      step_key: input.step_key,
      name: input.name,
      department: input.department,
      owner_type: input.owner_type,
      owner_value: ownerValue,
      sort_order: input.sort_order ?? 0
    },
    sourceSurface: "workflow_template_builder_v1"
  });
  return loadWorkflowTemplateBuilderDetail(client, auth, { template_version_id: templateVersionId });
}

async function loadWorkflowTemplateBuilderStepSiblings(
  client: PoolClient,
  tenantId: string,
  templateVersionId: string,
  milestoneId: string
) {
  const { rows } = await client.query<{
    id: string;
    step_key: string;
    name: string;
    sort_order: number;
  }>(
    `
      SELECT id::text, step_key, name, sort_order
      FROM workflow_template_step
      WHERE tenant_id = $1
        AND template_version_id = $2
        AND template_milestone_id = $3
      ORDER BY sort_order ASC, created_at ASC
    `,
    [tenantId, templateVersionId, milestoneId]
  );
  return rows;
}

async function rewriteWorkflowTemplateBuilderStepSortOrder(
  client: PoolClient,
  tenantId: string,
  templateVersionId: string,
  orderedStepIds: string[]
) {
  for (const [index, orderedStepId] of orderedStepIds.entries()) {
    await client.query(
      `
        UPDATE workflow_template_step
        SET sort_order = $4,
            updated_at = now()
        WHERE tenant_id = $1
          AND template_version_id = $2
          AND id = $3
      `,
      [tenantId, templateVersionId, orderedStepId, (index + 1) * 10]
    );
  }
}

export async function moveWorkflowTemplateBuilderStep(
  client: PoolClient,
  auth: AuthUser,
  templateVersionId: string,
  stepId: string,
  direction: WorkflowTemplateBuilderStepMoveDirection
) {
  await assertDraftTemplateBuilderVersion(client, auth.tenantId, templateVersionId);
  const existing = await client.query<{
    id: string;
    step_key: string;
    name: string;
    template_milestone_id: string;
    sort_order: number;
  }>(
    `
      SELECT id::text, step_key, name, template_milestone_id::text, sort_order
      FROM workflow_template_step
      WHERE tenant_id = $1
        AND template_version_id = $2
        AND id = $3
      LIMIT 1
    `,
    [auth.tenantId, templateVersionId, stepId]
  );
  const step = existing.rows[0];
  if (!step) {
    throw new ApiError(404, "Workflow template step not found.");
  }
  const siblings = await loadWorkflowTemplateBuilderStepSiblings(client, auth.tenantId, templateVersionId, step.template_milestone_id);
  const currentIndex = siblings.findIndex((candidate) => candidate.id === stepId);
  if (currentIndex < 0) {
    throw new ApiError(404, "Workflow template step not found in its stage.");
  }
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0) {
    throw new ApiError(400, "First workflow step cannot move up.");
  }
  if (targetIndex >= siblings.length) {
    throw new ApiError(400, "Last workflow step cannot move down.");
  }
  const orderedSiblings = [...siblings];
  [orderedSiblings[currentIndex], orderedSiblings[targetIndex]] = [orderedSiblings[targetIndex], orderedSiblings[currentIndex]];
  await rewriteWorkflowTemplateBuilderStepSortOrder(
    client,
    auth.tenantId,
    templateVersionId,
    orderedSiblings.map((candidate) => candidate.id)
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "workflow.template_step_moved",
    entityType: "workflow_template_step",
    entityId: stepId,
    previousValues: {
      sort_order: step.sort_order,
      stage_position: currentIndex + 1
    },
    newValues: {
      direction,
      sort_order: (targetIndex + 1) * 10,
      stage_position: targetIndex + 1
    },
    sourceSurface: "workflow_template_builder_v1"
  });
  return loadWorkflowTemplateBuilderDetail(client, auth, { template_version_id: templateVersionId });
}

export async function removeWorkflowTemplateBuilderStep(
  client: PoolClient,
  auth: AuthUser,
  templateVersionId: string,
  stepId: string
) {
  await assertDraftTemplateBuilderVersion(client, auth.tenantId, templateVersionId);
  const existing = await client.query<{
    id: string;
    step_key: string;
    name: string;
    template_milestone_id: string;
  }>(
    `
      SELECT id::text, step_key, name, template_milestone_id::text
      FROM workflow_template_step
      WHERE tenant_id = $1
        AND template_version_id = $2
        AND id = $3
      LIMIT 1
    `,
    [auth.tenantId, templateVersionId, stepId]
  );
  const step = existing.rows[0];
  if (!step) {
    throw new ApiError(404, "Workflow template step not found.");
  }
  const stepCount = await client.query<{ count: string }>(
    `
      SELECT count(*)::text AS count
      FROM workflow_template_step
      WHERE tenant_id = $1
        AND template_version_id = $2
    `,
    [auth.tenantId, templateVersionId]
  );
  if (Number(stepCount.rows[0]?.count ?? "0") <= 1) {
    throw new ApiError(400, "Workflow templates need at least one controlled step.");
  }
  const dependent = await client.query<{ step_key: string }>(
    `
      SELECT step_key
      FROM workflow_template_step_dependency
      WHERE tenant_id = $1
        AND template_version_id = $2
        AND depends_on_step_key = $3
      ORDER BY step_key ASC
      LIMIT 1
    `,
    [auth.tenantId, templateVersionId, step.step_key]
  );
  if (dependent.rows[0]) {
    throw new ApiError(409, `Step ${step.step_key} is required by ${dependent.rows[0].step_key}. Remove that dependency before deleting this step.`);
  }
  const siblingsBeforeDelete = await loadWorkflowTemplateBuilderStepSiblings(client, auth.tenantId, templateVersionId, step.template_milestone_id);
  await client.query(
    `
      DELETE FROM workflow_template_step_dependency
      WHERE tenant_id = $1
        AND template_version_id = $2
        AND step_key = $3
    `,
    [auth.tenantId, templateVersionId, step.step_key]
  );
  await client.query(
    `
      DELETE FROM workflow_template_step
      WHERE tenant_id = $1
        AND template_version_id = $2
        AND id = $3
    `,
    [auth.tenantId, templateVersionId, stepId]
  );
  await rewriteWorkflowTemplateBuilderStepSortOrder(
    client,
    auth.tenantId,
    templateVersionId,
    siblingsBeforeDelete.filter((candidate) => candidate.id !== stepId).map((candidate) => candidate.id)
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "workflow.template_step_removed",
    entityType: "workflow_template_step",
    entityId: stepId,
    previousValues: {
      step_key: step.step_key,
      name: step.name
    },
    newValues: {
      removed: true
    },
    sourceSurface: "workflow_template_builder_v1"
  });
  return loadWorkflowTemplateBuilderDetail(client, auth, { template_version_id: templateVersionId });
}

export async function publishWorkflowTemplateBuilderVersion(client: PoolClient, auth: AuthUser, templateVersionId: string) {
  const version = await assertDraftTemplateBuilderVersion(client, auth.tenantId, templateVersionId);
  const counts = await client.query<{ milestone_count: string; step_count: string }>(
    `
      SELECT
        (SELECT count(*)::text FROM workflow_template_milestone WHERE tenant_id = $1 AND template_version_id = $2) AS milestone_count,
        (SELECT count(*)::text FROM workflow_template_step WHERE tenant_id = $1 AND template_version_id = $2) AS step_count
    `,
    [auth.tenantId, templateVersionId]
  );
  if (Number(counts.rows[0]?.milestone_count ?? "0") < 1 || Number(counts.rows[0]?.step_count ?? "0") < 1) {
    throw new ApiError(400, "Workflow templates need at least one milestone and controlled step before publishing.");
  }
  await client.query(
    `
      UPDATE workflow_template_version
      SET default_for_new_jobs = false,
          updated_at = now()
      WHERE tenant_id = $1
        AND template_id = $2
        AND default_for_new_jobs = true
    `,
    [auth.tenantId, version.template_id]
  );
  await client.query(
    `
      UPDATE workflow_template_version
      SET status = 'active'::shared_workflow_template_version_status_type,
          default_for_new_jobs = true,
          published_at = now(),
          published_by_user_id = $3,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, templateVersionId, auth.id]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "workflow.template_version_published",
    entityType: "workflow_template_version",
    entityId: templateVersionId,
    newValues: {
      template_id: version.template_id,
      version_number: version.version_number,
      default_for_new_jobs: true
    },
    sourceSurface: "workflow_template_builder_v1"
  });
  await emitWorkflowEvent(client, {
    tenantId: auth.tenantId,
    eventType: "workflow.template_version_published",
    aggregateId: templateVersionId,
    payload: {
      template_id: version.template_id,
      version_number: version.version_number,
      published_by_user_id: auth.id,
      future_dispatch_ready: ["in_app", "email", "teams", "outlook"]
    },
    idempotencyKey: `workflow:template_version_published:${templateVersionId}`
  });
  return loadWorkflowTemplateBuilderDetail(client, auth, { template_version_id: templateVersionId });
}

export async function archiveWorkflowTemplateBuilderVersion(client: PoolClient, auth: AuthUser, templateVersionId: string) {
  const version = await loadTemplateBuilderVersionHeader(client, auth.tenantId, templateVersionId);
  if (!version) {
    throw new ApiError(404, "Workflow template version not found.");
  }
  await client.query(
    `
      UPDATE workflow_template_version
      SET status = 'retired'::shared_workflow_template_version_status_type,
          default_for_new_jobs = false,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, templateVersionId]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "workflow.template_version_archived",
    entityType: "workflow_template_version",
    entityId: templateVersionId,
    previousValues: { status: version.status },
    newValues: { status: "archived" },
    sourceSurface: "workflow_template_builder_v1"
  });
  return loadWorkflowTemplateBuilderDetail(client, auth, { template_version_id: templateVersionId });
}

export async function instantiateProjectWorkflow(
  client: PoolClient,
  auth: AuthUser,
  input: { job_id: string; template_version_id?: string | null; template_key?: string | null; idempotency_key?: string | null }
) {
  const jobResult = await client.query<{
    id: string;
    title: string;
    organization_id: string | null;
  }>(
    `
      SELECT id::text, title, organization_id::text
      FROM jobs
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, input.job_id]
  );
  const job = jobResult.rows[0];
  if (!job) {
    throw new ApiError(404, "Job not found.");
  }
  if (!job.organization_id) {
    throw new ApiError(400, "Project workflows require a job linked to an account.");
  }

  const existing = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM workflow_run
      WHERE tenant_id = $1
        AND job_id = $2
        AND workflow_family = 'project_tracking'::shared_workflow_family_type
      LIMIT 1
    `,
    [auth.tenantId, input.job_id]
  );
  if (existing.rows[0]) {
    return loadProjectWorkflowInstance(client, auth, existing.rows[0].id);
  }

  const template = await loadTemplateVersion(client, auth.tenantId, input);
  if (!template) {
    throw new ApiError(404, "Active project workflow template not found.");
  }

  const milestones = await client.query<TemplateMilestoneRow>(
    `
      SELECT id::text, milestone_key, name, description, sort_order
      FROM workflow_template_milestone
      WHERE tenant_id = $1
        AND template_version_id = $2
      ORDER BY sort_order ASC, created_at ASC
    `,
    [auth.tenantId, template.template_version_id]
  );
  const steps = await client.query<TemplateStepRow>(
    `
      SELECT
        step.id::text,
        step.template_milestone_id::text,
        milestone.milestone_key,
        step.step_key,
        step.name,
        step.description,
        step.department::text AS department,
        step.role_key,
        step.assigned_user_id::text,
        step.required,
        step.skippable,
        step.blocking,
        step.expected_duration_minutes,
        step.sort_order
      FROM workflow_template_step step
      JOIN workflow_template_milestone milestone ON milestone.id = step.template_milestone_id
      WHERE step.tenant_id = $1
        AND step.template_version_id = $2
      ORDER BY step.sort_order ASC, step.created_at ASC
    `,
    [auth.tenantId, template.template_version_id]
  );
  const dependencies = await client.query<TemplateDependencyRow>(
    `
      SELECT step_key, depends_on_step_key
      FROM workflow_template_step_dependency
      WHERE tenant_id = $1
        AND template_version_id = $2
    `,
    [auth.tenantId, template.template_version_id]
  );

  if (!milestones.rows.length || !steps.rows.length) {
    throw new ApiError(400, "Project workflow template has no executable structure.");
  }

  const runResult = await client.query<{ id: string }>(
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
      VALUES ($1,$2,$3,$4,$5,'project_tracking'::shared_workflow_family_type,'active'::shared_workflow_run_status_type,$6,$6,now(),$7::jsonb)
      RETURNING id::text
    `,
    [
      auth.tenantId,
      input.job_id,
      template.template_id,
      template.template_version_id,
      template.template_key,
      auth.id,
      JSON.stringify({ source: "project_tracking_foundation" })
    ]
  );
  const workflowRunId = runResult.rows[0]?.id;
  if (!workflowRunId) {
    throw new ApiError(500, "Workflow instance could not be created.");
  }

  const dependencyByStepKey = new Map<string, string[]>();
  for (const dependency of dependencies.rows) {
    const list = dependencyByStepKey.get(dependency.step_key) ?? [];
    list.push(dependency.depends_on_step_key);
    dependencyByStepKey.set(dependency.step_key, list);
  }

  const runtimeMilestoneIds = new Map<string, string>();
  for (const milestone of milestones.rows) {
    const hasRootStep = steps.rows.some(
      (step) => step.milestone_key === milestone.milestone_key && !(dependencyByStepKey.get(step.step_key)?.length)
    );
    const result = await client.query<{ id: string }>(
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
          started_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7::workflow_milestone_status_type,$8,CASE WHEN $7 = 'ACTIVE' THEN now() ELSE NULL END)
        RETURNING id::text
      `,
      [
        auth.tenantId,
        workflowRunId,
        milestone.id,
        milestone.milestone_key,
        milestone.name,
        milestone.description,
        hasRootStep ? "ACTIVE" : "WAITING",
        milestone.sort_order
      ]
    );
    runtimeMilestoneIds.set(milestone.milestone_key, result.rows[0]?.id ?? "");
  }

  const runtimeStepIds = new Map<string, string>();
  for (const step of steps.rows) {
    const runtimeMilestoneId = runtimeMilestoneIds.get(step.milestone_key);
    if (!runtimeMilestoneId) {
      throw new ApiError(500, "Workflow milestone instance could not be created.");
    }
    const hasDependencies = Boolean(dependencyByStepKey.get(step.step_key)?.length);
    const result = await client.query<{ id: string }>(
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
          last_transition_by_user_id,
          sort_order
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::work_department_type,$10,$11,$12::workflow_step_status_type,$13,$14,$15,$16,$17,$18)
        RETURNING id::text
      `,
      [
        auth.tenantId,
        workflowRunId,
        runtimeMilestoneId,
        step.id,
        input.job_id,
        step.step_key,
        step.name,
        step.description,
        step.department,
        step.role_key,
        step.assigned_user_id,
        hasDependencies ? "WAITING" : "NOT_STARTED",
        step.required,
        step.skippable,
        step.blocking,
        step.expected_duration_minutes,
        auth.id,
        step.sort_order
      ]
    );
    runtimeStepIds.set(step.step_key, result.rows[0]?.id ?? "");
  }

  for (const dependency of dependencies.rows) {
    const stepId = runtimeStepIds.get(dependency.step_key);
    const dependsOnStepId = runtimeStepIds.get(dependency.depends_on_step_key);
    if (!stepId || !dependsOnStepId) {
      throw new ApiError(500, "Workflow step dependency could not be created.");
    }
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
      [auth.tenantId, workflowRunId, stepId, dependsOnStepId]
    );
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "workflow.instance_created",
    entityType: "workflow_run",
    entityId: workflowRunId,
    newValues: {
      job_id: input.job_id,
      template_key: template.template_key,
      template_version_id: template.template_version_id,
      step_count: steps.rows.length
    },
    sourceSurface: "project_tracking_workflow_engine"
  });
  await emitWorkflowEvent(client, {
    tenantId: auth.tenantId,
    eventType: "workflow.instance_created",
    aggregateType: "workflow_run",
    aggregateId: workflowRunId,
    idempotencyKey: input.idempotency_key ?? null,
    payload: {
      workflow_run_id: workflowRunId,
      job_id: input.job_id,
      template_key: template.template_key,
      step_count: steps.rows.length
    }
  });

  return loadProjectWorkflowInstance(client, auth, workflowRunId);
}

async function loadStepById(client: PoolClient, tenantId: string, stepId: string): Promise<StepRow | null> {
  const { rows } = await client.query<StepRow>(
    `
      SELECT
        step.id::text,
        step.tenant_id::text,
        step.workflow_run_id::text,
        step.workflow_run_milestone_id::text,
        step.job_id::text,
        milestone.milestone_key,
        step.step_key,
        step.name,
        step.description,
        step.department::text AS department,
        step.role_key,
        step.assigned_user_id::text,
        assigned_user.full_name AS assigned_user_name,
        step.assignment_status::text AS assignment_status,
        step.assigned_queue::text AS assigned_queue,
        step.assigned_by_user_id::text,
        assigned_by.full_name AS assigned_by_user_name,
        step.assigned_at::text,
        step.waiting_on_party::text AS waiting_on_party,
        step.waiting_detail,
        step.status::text AS status,
        step.required,
        step.skippable,
        step.blocking,
        step.expected_duration_minutes,
        step.started_at::text,
        step.completed_at::text,
        step.completed_by_user_id::text,
        step.notes,
        step.exception_reason,
        step.rework_count,
        step.last_transition_at::text,
        step.updated_at::text,
        step.sort_order
      FROM workflow_step step
      JOIN workflow_run_milestone milestone ON milestone.id = step.workflow_run_milestone_id
      LEFT JOIN app_user assigned_user ON assigned_user.id = step.assigned_user_id
      LEFT JOIN app_user assigned_by ON assigned_by.id = step.assigned_by_user_id
      WHERE step.tenant_id = $1
        AND step.id = $2
      LIMIT 1
      FOR UPDATE OF step
    `,
    [tenantId, stepId]
  );
  return rows[0] ?? null;
}

async function loadStepDependencies(client: PoolClient, tenantId: string, workflowRunId: string, stepId: string) {
  const { rows } = await client.query<{
    dependency_id: string;
    dependency_status: ProjectWorkflowStepStatus;
  }>(
    `
      SELECT
        depends_on.id::text AS dependency_id,
        depends_on.status::text AS dependency_status
      FROM workflow_step_dependency dependency
      JOIN workflow_step depends_on ON depends_on.id = dependency.depends_on_workflow_step_id
      WHERE dependency.tenant_id = $1
        AND dependency.workflow_run_id = $2
        AND dependency.workflow_step_id = $3
    `,
    [tenantId, workflowRunId, stepId]
  );
  return rows;
}

function needsReasonForTransition(
  step: StepRow,
  nextStatus: ProjectWorkflowStepStatus,
  dependenciesSatisfied: boolean,
  now: Date,
  input: ProjectWorkflowTransitionInput
) {
  const assignedUserChanged = Boolean(input.assigned_user_id && input.assigned_user_id !== step.assigned_user_id);
  const expectedDurationChanged = Boolean(
    input.expected_duration_minutes && input.expected_duration_minutes !== step.expected_duration_minutes
  );
  if (assignedUserChanged && step.assigned_user_id) {
    return true;
  }
  if (expectedDurationChanged && step.status !== "NOT_STARTED") {
    return true;
  }
  if (nextStatus === step.status) {
    return false;
  }
  if (nextStatus === "BLOCKED" || nextStatus === "SKIPPED") {
    return true;
  }
  if (nextStatus === "WAITING" || nextStatus === "NOT_STARTED" || nextStatus === "OVERDUE") {
    return true;
  }
  if ((step.status === "COMPLETE" || step.status === "SKIPPED") && nextStatus !== step.status) {
    return true;
  }
  if ((nextStatus === "IN_PROGRESS" || nextStatus === "COMPLETE") && !dependenciesSatisfied) {
    return true;
  }
  if (nextStatus === "COMPLETE") {
    if (step.status !== "IN_PROGRESS") {
      return true;
    }
    if (step.started_at) {
      const elapsedMinutes = Math.floor((now.getTime() - new Date(step.started_at).getTime()) / 60000);
      return elapsedMinutes < step.expected_duration_minutes;
    }
  }
  return false;
}

async function activateDependentSteps(client: PoolClient, auth: AuthUser, completedStep: StepRow, idempotencyKey?: string | null) {
  const dependents = await client.query<StepRow>(
    `
      SELECT
        dependent.id::text,
        dependent.tenant_id::text,
        dependent.workflow_run_id::text,
        dependent.workflow_run_milestone_id::text,
        dependent.job_id::text,
        milestone.milestone_key,
        dependent.step_key,
        dependent.name,
        dependent.description,
        dependent.department::text AS department,
        dependent.role_key,
        dependent.assigned_user_id::text,
        dependent.status::text AS status,
        dependent.required,
        dependent.skippable,
        dependent.blocking,
        dependent.expected_duration_minutes,
        dependent.started_at::text,
        dependent.completed_at::text,
        dependent.completed_by_user_id::text,
        dependent.notes,
        dependent.exception_reason,
        dependent.rework_count,
        dependent.last_transition_at::text,
        dependent.updated_at::text,
        dependent.sort_order
      FROM workflow_step_dependency dependency
      JOIN workflow_step dependent ON dependent.id = dependency.workflow_step_id
      JOIN workflow_run_milestone milestone ON milestone.id = dependent.workflow_run_milestone_id
      WHERE dependency.tenant_id = $1
        AND dependency.depends_on_workflow_step_id = $2
        AND dependent.status = 'WAITING'::workflow_step_status_type
    `,
    [auth.tenantId, completedStep.id]
  );

  for (const dependent of dependents.rows) {
    const dependencies = await loadStepDependencies(client, auth.tenantId, dependent.workflow_run_id, dependent.id);
    if (!dependencies.every((dependency) => WORKFLOW_TERMINAL_STEP_STATUSES.has(dependency.dependency_status))) {
      continue;
    }
    const update = await client.query<StepRow>(
      `
        UPDATE workflow_step
        SET status = 'NOT_STARTED'::workflow_step_status_type,
            last_transition_at = now(),
            last_transition_by_user_id = $3,
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
        RETURNING
          id::text,
          tenant_id::text,
          workflow_run_id::text,
          workflow_run_milestone_id::text,
          job_id::text,
          $4::text AS milestone_key,
          step_key,
          name,
          description,
          department::text AS department,
          role_key,
          assigned_user_id::text,
          status::text AS status,
          required,
          skippable,
          blocking,
          expected_duration_minutes,
          started_at::text,
          completed_at::text,
          completed_by_user_id::text,
          notes,
          exception_reason,
          rework_count,
          last_transition_at::text,
          updated_at::text,
          sort_order
      `,
      [auth.tenantId, dependent.id, auth.id, dependent.milestone_key]
    );
    const activated = update.rows[0] ?? dependent;
    await writeStepAudit(client, auth, {
      step: activated,
      previousStatus: "WAITING",
      newStatus: "NOT_STARTED",
      transitionType: "activated",
      previousValues: { status: "WAITING" },
      newValues: { status: "NOT_STARTED" }
    });
    if (completedStep.department !== activated.department || completedStep.assigned_user_id !== activated.assigned_user_id) {
      const handoff = await client.query<{ id: string }>(
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
            sla_started_at,
            created_by_user_id
          )
          VALUES ($1,$2,$3,$4,$5::work_department_type,$6::work_department_type,$7,$8,'pending'::workflow_handoff_status_type,now(),$9)
          RETURNING id::text
        `,
        [
          auth.tenantId,
          completedStep.workflow_run_id,
          completedStep.id,
          activated.id,
          completedStep.department,
          activated.department,
          completedStep.assigned_user_id,
          activated.assigned_user_id,
          auth.id
        ]
      );
      const handoffId = handoff.rows[0]?.id;
      if (handoffId) {
        await emitWorkflowEvent(client, {
          tenantId: auth.tenantId,
          eventType: "workflow.handoff_created",
          aggregateType: "workflow_handoff",
          aggregateId: handoffId,
          idempotencyKey,
          payload: {
            workflow_run_id: activated.workflow_run_id,
            job_id: activated.job_id,
            from_step_id: completedStep.id,
            to_step_id: activated.id,
            from_department: completedStep.department,
            to_department: activated.department
          }
        });
      }
    }
    await emitWorkflowEvent(client, {
      tenantId: auth.tenantId,
      eventType: "workflow.step_activated",
      aggregateId: activated.id,
      idempotencyKey,
      payload: {
        workflow_run_id: activated.workflow_run_id,
        job_id: activated.job_id,
        step_id: activated.id,
        step_key: activated.step_key,
        activated_by_step_id: completedStep.id
      }
    });
  }
}

async function refreshMilestoneStatuses(client: PoolClient, tenantId: string, workflowRunId: string) {
  await client.query(
    `
      WITH milestone_state AS (
        SELECT
          milestone.id,
          CASE
            WHEN bool_and(step.status IN ('COMPLETE'::workflow_step_status_type, 'SKIPPED'::workflow_step_status_type)) THEN 'COMPLETE'::workflow_milestone_status_type
            WHEN bool_or(step.status <> 'WAITING'::workflow_step_status_type) THEN 'ACTIVE'::workflow_milestone_status_type
            ELSE 'WAITING'::workflow_milestone_status_type
          END AS status
        FROM workflow_run_milestone milestone
        JOIN workflow_step step ON step.workflow_run_milestone_id = milestone.id
        WHERE milestone.tenant_id = $1
          AND milestone.workflow_run_id = $2
        GROUP BY milestone.id
      )
      UPDATE workflow_run_milestone milestone
      SET status = milestone_state.status,
          started_at = CASE WHEN milestone_state.status = 'ACTIVE'::workflow_milestone_status_type THEN COALESCE(milestone.started_at, now()) ELSE milestone.started_at END,
          completed_at = CASE WHEN milestone_state.status = 'COMPLETE'::workflow_milestone_status_type THEN COALESCE(milestone.completed_at, now()) ELSE NULL END,
          updated_at = now()
      FROM milestone_state
      WHERE milestone.id = milestone_state.id
    `,
    [tenantId, workflowRunId]
  );
}

export async function transitionWorkflowStep(
  client: PoolClient,
  auth: AuthUser,
  stepId: string,
  input: ProjectWorkflowTransitionInput & { idempotency_key?: string | null }
) {
  const step = await loadStepById(client, auth.tenantId, stepId);
  if (!step) {
    throw new ApiError(404, "Workflow step not found.");
  }
  assertCanExecuteStep(auth, step);
  const assignedUserChanged = Boolean(input.assigned_user_id && input.assigned_user_id !== step.assigned_user_id);
  if (assignedUserChanged && input.assigned_user_id !== auth.id && !canOverride(auth)) {
    throw new ApiError(403, "Assigning workflow steps to another user requires override authority.");
  }
  const assignedQueueChanged = Boolean(input.assigned_queue && input.assigned_queue !== step.assigned_queue);
  if (assignedQueueChanged && !canOverride(auth)) {
    throw new ApiError(403, "Assigning workflow steps to another queue requires override authority.");
  }
  if (input.expected_duration_minutes && input.expected_duration_minutes !== step.expected_duration_minutes && !canOverride(auth)) {
    throw new ApiError(403, "Changing workflow step timing expectations requires override authority.");
  }
  if (input.status === "SKIPPED" && step.required && !step.skippable && !canOverride(auth)) {
    throw new ApiError(400, "Required workflow steps cannot be skipped without override authority.");
  }
  const dependencies = await loadStepDependencies(client, auth.tenantId, step.workflow_run_id, step.id);
  const dependenciesSatisfied = dependencies.every((dependency) => WORKFLOW_TERMINAL_STEP_STATUSES.has(dependency.dependency_status));
  const now = new Date();
  const reason = normalizeText(input.reason);
  const transitionType = classifyTransition(step.status, input.status);
  const eventType = eventTypeForTransition(transitionType);
  if (await hasWorkflowEventDedupe(client, auth.tenantId, eventType, step.id, input.idempotency_key ?? null)) {
    return loadProjectWorkflowInstance(client, auth, step.workflow_run_id);
  }
  const conflictDetected = Boolean(input.last_seen_updated_at && input.last_seen_updated_at !== step.updated_at);
  if (conflictDetected && !reason) {
    throw new ApiError(409, "Workflow step changed since it was loaded. Retry with a reason to overwrite.");
  }
  if (needsReasonForTransition(step, input.status, dependenciesSatisfied, now, input) && !reason) {
    throw new ApiError(400, "This workflow transition requires a reason.");
  }
  const previousValues = {
    status: step.status,
    assigned_user_id: step.assigned_user_id,
    assigned_queue: step.assigned_queue,
    assignment_status: step.assignment_status,
    expected_duration_minutes: step.expected_duration_minutes,
    notes: step.notes
  };
  const update = await client.query<StepRow>(
    `
      UPDATE workflow_step
      SET status = $3::workflow_step_status_type,
          assigned_user_id = COALESCE($4::uuid, assigned_user_id),
          assigned_queue = COALESCE($9::work_department_type, assigned_queue),
          active_owner_user_id = CASE WHEN $3 = 'IN_PROGRESS'::workflow_step_status_type THEN COALESCE($4::uuid, assigned_user_id, $5::uuid) ELSE active_owner_user_id END,
          expected_duration_minutes = COALESCE($6, expected_duration_minutes),
          started_at = CASE WHEN $3 = 'IN_PROGRESS'::workflow_step_status_type THEN COALESCE(started_at, now()) ELSE started_at END,
          completed_at = CASE WHEN $3 IN ('COMPLETE'::workflow_step_status_type, 'SKIPPED'::workflow_step_status_type) THEN now() WHEN $3 IN ('IN_PROGRESS'::workflow_step_status_type, 'BLOCKED'::workflow_step_status_type) THEN NULL ELSE completed_at END,
          completed_by_user_id = CASE WHEN $3 IN ('COMPLETE'::workflow_step_status_type, 'SKIPPED'::workflow_step_status_type) THEN $5::uuid ELSE completed_by_user_id END,
          notes = COALESCE($7, notes),
          exception_reason = COALESCE($8, exception_reason),
          assignment_status = CASE
            WHEN $3 IN ('COMPLETE'::workflow_step_status_type, 'SKIPPED'::workflow_step_status_type) THEN 'completed'::workflow_assignment_status_type
            WHEN $3 = 'WAITING'::workflow_step_status_type THEN 'waiting_on_info'::workflow_assignment_status_type
            WHEN $4::uuid IS NOT NULL THEN CASE WHEN $4::uuid = $5::uuid THEN 'claimed'::workflow_assignment_status_type ELSE 'assigned'::workflow_assignment_status_type END
            WHEN $9::work_department_type IS NOT NULL THEN 'queued'::workflow_assignment_status_type
            WHEN $3 = 'IN_PROGRESS'::workflow_step_status_type THEN COALESCE(assignment_status, 'in_progress'::workflow_assignment_status_type)
            ELSE assignment_status
          END,
          assigned_by_user_id = CASE WHEN $4::uuid IS NOT NULL OR $9::work_department_type IS NOT NULL THEN $5::uuid ELSE assigned_by_user_id END,
          assigned_at = CASE WHEN $4::uuid IS NOT NULL OR $9::work_department_type IS NOT NULL THEN now() ELSE assigned_at END,
          waiting_on_party = CASE WHEN $3 = 'WAITING'::workflow_step_status_type THEN COALESCE(waiting_on_party, 'unknown') ELSE waiting_on_party END,
          waiting_detail = CASE WHEN $3 = 'WAITING'::workflow_step_status_type THEN COALESCE($8, waiting_detail) ELSE waiting_detail END,
          last_transition_at = now(),
          last_transition_by_user_id = $5,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING
        id::text,
        tenant_id::text,
        workflow_run_id::text,
        workflow_run_milestone_id::text,
        job_id::text,
        $10::text AS milestone_key,
        step_key,
        name,
        description,
        department::text AS department,
        role_key,
        assigned_user_id::text,
        assignment_status::text AS assignment_status,
        assigned_queue::text AS assigned_queue,
        assigned_by_user_id::text,
        assigned_at::text,
        waiting_on_party::text AS waiting_on_party,
        waiting_detail,
        status::text AS status,
        required,
        skippable,
        blocking,
        expected_duration_minutes,
        started_at::text,
        completed_at::text,
        completed_by_user_id::text,
        notes,
        exception_reason,
        rework_count,
        last_transition_at::text,
        updated_at::text,
        sort_order
    `,
    [
      auth.tenantId,
      step.id,
      input.status,
      input.assigned_user_id ?? null,
      auth.id,
      input.expected_duration_minutes ?? null,
      normalizeText(input.notes),
      reason,
      input.assigned_queue ?? null,
      step.milestone_key
    ]
  );
  const updated = update.rows[0];
  if (!updated) {
    throw new ApiError(500, "Workflow step could not be updated.");
  }
  const newValues = {
    status: updated.status,
    assigned_user_id: updated.assigned_user_id,
    assigned_queue: updated.assigned_queue,
    assignment_status: updated.assignment_status,
    expected_duration_minutes: updated.expected_duration_minutes,
    notes: updated.notes
  };
  await writeStepAudit(client, auth, {
    step: updated,
    previousStatus: step.status,
    newStatus: updated.status,
    transitionType,
    previousValues,
    newValues,
    reason,
    conflictDetected
  });
  await emitWorkflowEvent(client, {
    tenantId: auth.tenantId,
    eventType,
    aggregateId: updated.id,
    idempotencyKey: input.idempotency_key ?? null,
    payload: {
      workflow_run_id: updated.workflow_run_id,
      job_id: updated.job_id,
      step_id: updated.id,
      step_key: updated.step_key,
      previous_status: step.status,
      status: updated.status,
      reason
    }
  });
  if (updated.status === "COMPLETE" || updated.status === "SKIPPED") {
    await activateDependentSteps(client, auth, updated, input.idempotency_key ?? null);
  }
  await refreshMilestoneStatuses(client, auth.tenantId, updated.workflow_run_id);
  return loadProjectWorkflowInstance(client, auth, updated.workflow_run_id);
}

export async function sendWorkflowStepBackward(client: PoolClient, auth: AuthUser, stepId: string, input: ProjectWorkflowSendBackInput) {
  const sourceStep = await loadStepById(client, auth.tenantId, stepId);
  const targetStep = await loadStepById(client, auth.tenantId, input.target_step_id);
  if (!sourceStep || !targetStep || sourceStep.workflow_run_id !== targetStep.workflow_run_id) {
    throw new ApiError(404, "Workflow send-back step target not found.");
  }
  if (!canOverride(auth)) {
    throw new ApiError(403, "Workflow send-back requires override authority.");
  }
  const reason = normalizeText(input.reason);
  if (!reason) {
    throw new ApiError(400, "Send-back requires a reason.");
  }
  const update = await client.query<StepRow>(
    `
      UPDATE workflow_step
      SET status = 'IN_PROGRESS'::workflow_step_status_type,
          assigned_user_id = $3,
          active_owner_user_id = $3,
          expected_duration_minutes = $4,
          started_at = now(),
          completed_at = NULL,
          completed_by_user_id = NULL,
          exception_reason = $5,
          rework_count = rework_count + 1,
          last_transition_at = now(),
          last_transition_by_user_id = $6,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING
        id::text,
        tenant_id::text,
        workflow_run_id::text,
        workflow_run_milestone_id::text,
        job_id::text,
        $7::text AS milestone_key,
        step_key,
        name,
        description,
        department::text AS department,
        role_key,
        assigned_user_id::text,
        status::text AS status,
        required,
        skippable,
        blocking,
        expected_duration_minutes,
        started_at::text,
        completed_at::text,
        completed_by_user_id::text,
        notes,
        exception_reason,
        rework_count,
        last_transition_at::text,
        updated_at::text,
        sort_order
    `,
    [
      auth.tenantId,
      targetStep.id,
      input.assigned_user_id,
      input.expected_duration_minutes,
      reason,
      auth.id,
      targetStep.milestone_key
    ]
  );
  const updatedTarget = update.rows[0];
  if (!updatedTarget) {
    throw new ApiError(500, "Workflow send-back target could not be updated.");
  }
  const handoff = await client.query<{ id: string }>(
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
        sla_started_at,
        created_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5::work_department_type,$6::work_department_type,$7,$8,'pending'::workflow_handoff_status_type,$9,$10,now(),$11)
      RETURNING id::text
    `,
    [
      auth.tenantId,
      sourceStep.workflow_run_id,
      sourceStep.id,
      updatedTarget.id,
      sourceStep.department,
      updatedTarget.department,
      sourceStep.assigned_user_id,
      input.assigned_user_id,
      reason,
      normalizeText(input.expectations),
      auth.id
    ]
  );
  const handoffId = handoff.rows[0]?.id;
  if (handoffId) {
    await emitWorkflowEvent(client, {
      tenantId: auth.tenantId,
      eventType: "workflow.handoff_created",
      aggregateType: "workflow_handoff",
      aggregateId: handoffId,
      payload: {
        workflow_run_id: updatedTarget.workflow_run_id,
        job_id: updatedTarget.job_id,
        from_step_id: sourceStep.id,
        to_step_id: updatedTarget.id,
        from_department: sourceStep.department,
        to_department: updatedTarget.department,
        reason
      }
    });
  }
  await writeStepAudit(client, auth, {
    step: updatedTarget,
    previousStatus: targetStep.status,
    newStatus: "IN_PROGRESS",
    transitionType: "sent_back",
    previousValues: {
      status: targetStep.status,
      assigned_user_id: targetStep.assigned_user_id,
      expected_duration_minutes: targetStep.expected_duration_minutes
    },
    newValues: {
      status: "IN_PROGRESS",
      assigned_user_id: input.assigned_user_id,
      expected_duration_minutes: input.expected_duration_minutes
    },
    reason
  });
  await emitWorkflowEvent(client, {
    tenantId: auth.tenantId,
    eventType: "workflow.step_sent_back",
    aggregateId: updatedTarget.id,
    payload: {
      workflow_run_id: updatedTarget.workflow_run_id,
      job_id: updatedTarget.job_id,
      from_step_id: sourceStep.id,
      target_step_id: updatedTarget.id,
      reason
    }
  });
  await refreshMilestoneStatuses(client, auth.tenantId, updatedTarget.workflow_run_id);
  return loadProjectWorkflowInstance(client, auth, updatedTarget.workflow_run_id);
}

async function loadHandoffById(client: PoolClient, tenantId: string, handoffId: string, lock = false): Promise<HandoffRow | null> {
  const { rows } = await client.query<HandoffRow>(
    `
      SELECT
        handoff.id::text,
        handoff.workflow_run_id::text,
        handoff.from_step_id::text,
        handoff.to_step_id::text,
        from_step.name AS from_step_name,
        to_step.name AS to_step_name,
        handoff.from_department::text AS from_department,
        handoff.to_department::text AS to_department,
        handoff.from_user_id::text,
        from_user.full_name AS from_user_name,
        handoff.to_user_id::text,
        to_user.full_name AS to_user_name,
        handoff.status::text AS status,
        handoff.reason,
        handoff.expectations,
        handoff.notes,
        handoff.issue_flag,
        handoff.return_reason,
        handoff.sent_by_user_id::text,
        sent_by.full_name AS sent_by_user_name,
        COALESCE(handoff.sent_at, handoff.sla_started_at, handoff.created_at)::text AS sent_at,
        handoff.accepted_by_user_id::text,
        accepted_by.full_name AS accepted_by_user_name,
        COALESCE(handoff.accepted_at, handoff.acknowledged_at)::text AS accepted_at,
        handoff.returned_by_user_id::text,
        returned_by.full_name AS returned_by_user_name,
        handoff.returned_at::text,
        handoff.created_at::text,
        handoff.updated_at::text
      FROM workflow_handoff handoff
      JOIN workflow_step to_step ON to_step.id = handoff.to_step_id
      LEFT JOIN workflow_step from_step ON from_step.id = handoff.from_step_id
      LEFT JOIN app_user from_user ON from_user.id = handoff.from_user_id
      LEFT JOIN app_user to_user ON to_user.id = handoff.to_user_id
      LEFT JOIN app_user sent_by ON sent_by.id = handoff.sent_by_user_id
      LEFT JOIN app_user accepted_by ON accepted_by.id = handoff.accepted_by_user_id
      LEFT JOIN app_user returned_by ON returned_by.id = handoff.returned_by_user_id
      WHERE handoff.tenant_id = $1
        AND handoff.id = $2
      LIMIT 1
      ${lock ? "FOR UPDATE OF handoff" : ""}
    `,
    [tenantId, handoffId]
  );
  return rows[0] ?? null;
}

async function loadActiveProductionHandoffForSource(client: PoolClient, tenantId: string, workflowRunId: string, sourceStepId: string) {
  const existing = await client.query<{ id: string; to_step_id: string; status: ProjectWorkflowHandoffStatus }>(
    `
      SELECT id::text, to_step_id::text, status::text AS status
      FROM workflow_handoff
      WHERE tenant_id = $1
        AND workflow_run_id = $2
        AND from_step_id = $3
        AND to_department = 'production'::work_department_type
        AND status = ANY($4::workflow_handoff_status_type[])
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `,
    [tenantId, workflowRunId, sourceStepId, Array.from(ACTIVE_PRODUCTION_HANDOFF_STATUSES)]
  );
  return existing.rows[0] ?? null;
}

function requireHandoffStatus(handoff: HandoffRow, allowed: ProjectWorkflowHandoffStatus[], actionLabel: string) {
  if (!allowed.includes(handoff.status)) {
    throw new ApiError(409, `${actionLabel} is not available while this handoff is ${handoff.status}.`);
  }
}

function requireProductionHandoff(handoff: HandoffRow) {
  if (handoff.to_department !== "production" || handoff.from_department === handoff.to_department || !handoff.sent_at) {
    throw new ApiError(409, "This action is only available for sent Schools-to-Production handoffs.");
  }
}

async function findProductionHandoffTarget(client: PoolClient, auth: AuthUser, sourceStep: StepRow) {
  const existing = await client.query<{ id: string; to_step_id: string }>(
    `
      SELECT id::text, to_step_id::text
      FROM workflow_handoff
      WHERE tenant_id = $1
        AND workflow_run_id = $2
        AND from_step_id = $3
        AND to_department = 'production'::work_department_type
        AND status = 'pending'::workflow_handoff_status_type
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [auth.tenantId, sourceStep.workflow_run_id, sourceStep.id]
  );
  if (existing.rows[0]) {
    return existing.rows[0];
  }
  const target = await client.query<{ to_step_id: string }>(
    `
      SELECT id::text AS to_step_id
      FROM workflow_step
      WHERE tenant_id = $1
        AND workflow_run_id = $2
        AND department = 'production'::work_department_type
        AND status NOT IN ('COMPLETE'::workflow_step_status_type, 'SKIPPED'::workflow_step_status_type)
      ORDER BY sort_order ASC, created_at ASC
      LIMIT 1
    `,
    [auth.tenantId, sourceStep.workflow_run_id]
  );
  const toStepId = target.rows[0]?.to_step_id;
  if (!toStepId) {
    throw new ApiError(400, "No active Production step is available for this workflow.");
  }
  return { id: null, to_step_id: toStepId };
}

async function loadCurrentStepForHandoff(client: PoolClient, auth: AuthUser, handoff: HandoffRow) {
  const activeStep = await client.query<{ id: string }>(
    `
      SELECT id::text
      FROM workflow_step
      WHERE tenant_id = $1
        AND workflow_run_id = $2
        AND department = $3::work_department_type
        AND status NOT IN ('COMPLETE'::workflow_step_status_type, 'SKIPPED'::workflow_step_status_type)
      ORDER BY
        CASE
          WHEN status IN ('IN_PROGRESS'::workflow_step_status_type, 'BLOCKED'::workflow_step_status_type, 'OVERDUE'::workflow_step_status_type) THEN 0
          WHEN status = 'NOT_STARTED'::workflow_step_status_type THEN 1
          WHEN status = 'WAITING'::workflow_step_status_type THEN 2
          ELSE 3
        END ASC,
        sort_order ASC,
        created_at ASC
      LIMIT 1
    `,
    [auth.tenantId, handoff.workflow_run_id, handoff.to_department]
  );
  return loadStepById(client, auth.tenantId, activeStep.rows[0]?.id ?? handoff.to_step_id);
}

function requireProductionReadiness(input: ProjectWorkflowSendToProductionInput) {
  const readiness = input.readiness ?? {};
  if (!readiness.files_confirmed || !readiness.data_confirmed || !readiness.job_type_confirmed || !readiness.due_date_confirmed) {
    throw new ApiError(400, "Confirm files, data, job type, and due date before sending to Production.");
  }
}

async function writeHandoffStepAudit(
  client: PoolClient,
  auth: AuthUser,
  step: StepRow,
  previousValues: Record<string, unknown>,
  newValues: Record<string, unknown>,
  reason: string | null
) {
  await writeStepAudit(client, auth, {
    step,
    previousStatus: step.status,
    newStatus: step.status,
    transitionType: "updated",
    previousValues,
    newValues,
    reason
  });
}

export async function sendWorkflowToProduction(
  client: PoolClient,
  auth: AuthUser,
  workflowRunId: string,
  input: ProjectWorkflowSendToProductionInput
) {
  requireProductionReadiness(input);
  const sourceStep = await loadStepById(client, auth.tenantId, input.step_id);
  if (!sourceStep || sourceStep.workflow_run_id !== workflowRunId) {
    throw new ApiError(404, "Workflow step not found for this workflow.");
  }
  assertCanExecuteStep(auth, sourceStep);
  const existingActiveHandoff = await loadActiveProductionHandoffForSource(client, auth.tenantId, workflowRunId, sourceStep.id);
  if (existingActiveHandoff && existingActiveHandoff.status !== "pending") {
    throw new ApiError(409, "This workflow is already with Production. Open the existing Production handoff instead of sending it again.");
  }
  if (existingActiveHandoff?.status === "pending" && !WORKFLOW_TERMINAL_STEP_STATUSES.has(sourceStep.status)) {
    throw new ApiError(409, "This workflow already has a pending Production handoff. Refresh the workflow before sending it again.");
  }
  if (!WORKFLOW_TERMINAL_STEP_STATUSES.has(sourceStep.status)) {
    await transitionWorkflowStep(client, auth, sourceStep.id, {
      status: "COMPLETE",
      notes: normalizeText(input.notes) ?? "Sent to Production.",
      reason: "Schools sent this job to Production.",
      idempotency_key: `send-to-production:${sourceStep.id}:${Date.now()}`
    });
  }
  const target = await findProductionHandoffTarget(client, auth, sourceStep);
  const targetStep = await loadStepById(client, auth.tenantId, target.to_step_id);
  if (!targetStep) {
    throw new ApiError(404, "Production handoff target step not found.");
  }
  let handoffId = target.id;
  if (handoffId) {
    await client.query(
      `
        UPDATE workflow_handoff
        SET status = 'sent_to_production'::workflow_handoff_status_type,
            reason = COALESCE($4, reason),
            notes = COALESCE($5, notes),
            sent_by_user_id = $6,
            sent_at = now(),
            sla_started_at = COALESCE(sla_started_at, now()),
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
          AND workflow_run_id = $3
      `,
      [auth.tenantId, handoffId, workflowRunId, "Schools sent this job to Production.", normalizeText(input.notes), auth.id]
    );
  } else {
    const created = await client.query<{ id: string }>(
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
          created_by_user_id
        )
        VALUES ($1,$2,$3,$4,$5::work_department_type,'production'::work_department_type,$6,$7,'sent_to_production'::workflow_handoff_status_type,$8,$9,$10,now(),$11,now(),$11)
        RETURNING id::text
      `,
      [
        auth.tenantId,
        workflowRunId,
        sourceStep.id,
        targetStep.id,
        sourceStep.department,
        sourceStep.assigned_user_id,
        targetStep.assigned_user_id,
        "Schools sent this job to Production.",
        "Production accepts the job, claims or assigns the step, and returns it to Schools when ready.",
        normalizeText(input.notes),
        auth.id
      ]
    );
    handoffId = created.rows[0]?.id ?? null;
  }
  const previousValues = {
    assignment_status: targetStep.assignment_status,
    assigned_queue: targetStep.assigned_queue,
    waiting_on_party: targetStep.waiting_on_party
  };
  const updatedTarget = await client.query<StepRow>(
    `
      UPDATE workflow_step
      SET assignment_status = CASE WHEN assigned_user_id IS NULL THEN 'needs_assignment'::workflow_assignment_status_type ELSE 'queued'::workflow_assignment_status_type END,
          assigned_queue = 'production'::work_department_type,
          waiting_on_party = NULL,
          waiting_detail = NULL,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING
        id::text,
        tenant_id::text,
        workflow_run_id::text,
        workflow_run_milestone_id::text,
        job_id::text,
        $3::text AS milestone_key,
        step_key,
        name,
        description,
        department::text AS department,
        role_key,
        assigned_user_id::text,
        assignment_status::text AS assignment_status,
        assigned_queue::text AS assigned_queue,
        assigned_by_user_id::text,
        assigned_at::text,
        waiting_on_party::text AS waiting_on_party,
        waiting_detail,
        status::text AS status,
        required,
        skippable,
        blocking,
        expected_duration_minutes,
        started_at::text,
        completed_at::text,
        completed_by_user_id::text,
        notes,
        exception_reason,
        rework_count,
        last_transition_at::text,
        updated_at::text,
        sort_order
    `,
    [auth.tenantId, targetStep.id, targetStep.milestone_key]
  );
  const auditedStep = updatedTarget.rows[0] ?? targetStep;
  await writeHandoffStepAudit(
    client,
    auth,
    auditedStep,
    { ...previousValues, handoff_status: "pending" },
    {
      assignment_status: auditedStep.assignment_status,
      assigned_queue: auditedStep.assigned_queue,
      handoff_status: "sent_to_production",
      handoff_id: handoffId
    },
    "Schools sent this job to Production."
  );
  return loadProjectWorkflowInstance(client, auth, workflowRunId);
}

export async function acceptWorkflowHandoff(client: PoolClient, auth: AuthUser, handoffId: string) {
  const handoff = await loadHandoffById(client, auth.tenantId, handoffId, true);
  if (!handoff) {
    throw new ApiError(404, "Workflow handoff not found.");
  }
  requireProductionHandoff(handoff);
  requireHandoffStatus(handoff, ["sent_to_production"], "Accept handoff");
  const step = await loadCurrentStepForHandoff(client, auth, handoff);
  if (!step) {
    throw new ApiError(404, "Workflow handoff step not found.");
  }
  assertCanExecuteStep(auth, step);
  await client.query(
    `
      UPDATE workflow_handoff
      SET status = 'accepted_by_production'::workflow_handoff_status_type,
          accepted_by_user_id = $3,
          accepted_at = now(),
          acknowledged_at = COALESCE(acknowledged_at, now()),
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, handoffId, auth.id]
  );
  await client.query(
    `
      UPDATE workflow_step
      SET assignment_status = COALESCE(assignment_status, 'needs_assignment'::workflow_assignment_status_type),
          assigned_queue = COALESCE(assigned_queue, $3::work_department_type),
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, step.id, handoff.to_department]
  );
  await writeHandoffStepAudit(
    client,
    auth,
    step,
    { handoff_status: handoff.status },
    { handoff_status: "accepted_by_production", handoff_id: handoff.id },
    "Production accepted the handoff."
  );
  return loadProjectWorkflowInstance(client, auth, handoff.workflow_run_id);
}

export async function claimWorkflowHandoff(client: PoolClient, auth: AuthUser, handoffId: string, input: ProjectWorkflowClaimInput) {
  const handoff = await loadHandoffById(client, auth.tenantId, handoffId, true);
  if (!handoff) {
    throw new ApiError(404, "Workflow handoff not found.");
  }
  requireProductionHandoff(handoff);
  requireHandoffStatus(handoff, ["accepted_by_production"], "Claim handoff");
  const step = await loadCurrentStepForHandoff(client, auth, handoff);
  if (!step) {
    throw new ApiError(404, "Workflow handoff step not found.");
  }
  assertCanExecuteStep(auth, step);
  if (step.assigned_user_id || (step.assignment_status && CLAIMED_ASSIGNMENT_STATUSES.has(step.assignment_status))) {
    throw new ApiError(409, "This Production work is already claimed or assigned.");
  }
  const targetUserId = input.assigned_user_id ?? auth.id;
  if (targetUserId !== auth.id && !canOverride(auth)) {
    throw new ApiError(403, "Assigning Production work to another user requires override authority.");
  }
  const queue = input.assigned_queue ?? handoff.to_department;
  const assignmentStatus: ProjectWorkflowAssignmentStatus = targetUserId === auth.id ? "claimed" : "assigned";
  const previousValues = {
    assignment_status: step.assignment_status,
    assigned_queue: step.assigned_queue,
    assigned_user_id: step.assigned_user_id
  };
  const updated = await client.query<StepRow>(
    `
      UPDATE workflow_step
      SET assignment_status = $3::workflow_assignment_status_type,
          assigned_queue = $4::work_department_type,
          assigned_user_id = $5::uuid,
          active_owner_user_id = $5::uuid,
          assigned_by_user_id = $6::uuid,
          assigned_at = now(),
          notes = COALESCE($7, notes),
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING
        id::text,
        tenant_id::text,
        workflow_run_id::text,
        workflow_run_milestone_id::text,
        job_id::text,
        $8::text AS milestone_key,
        step_key,
        name,
        description,
        department::text AS department,
        role_key,
        assigned_user_id::text,
        assignment_status::text AS assignment_status,
        assigned_queue::text AS assigned_queue,
        assigned_by_user_id::text,
        assigned_at::text,
        waiting_on_party::text AS waiting_on_party,
        waiting_detail,
        status::text AS status,
        required,
        skippable,
        blocking,
        expected_duration_minutes,
        started_at::text,
        completed_at::text,
        completed_by_user_id::text,
        notes,
        exception_reason,
        rework_count,
        last_transition_at::text,
        updated_at::text,
        sort_order
    `,
    [auth.tenantId, step.id, assignmentStatus, queue, targetUserId, auth.id, normalizeText(input.notes), step.milestone_key]
  );
  const auditedStep = updated.rows[0] ?? step;
  await client.query(
    `
      UPDATE workflow_handoff
      SET status = CASE WHEN status = 'sent_to_production'::workflow_handoff_status_type THEN 'accepted_by_production'::workflow_handoff_status_type ELSE status END,
          to_user_id = $3,
          accepted_by_user_id = COALESCE(accepted_by_user_id, $4),
          accepted_at = COALESCE(accepted_at, now()),
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, handoff.id, targetUserId, auth.id]
  );
  await writeHandoffStepAudit(
    client,
    auth,
    auditedStep,
    previousValues,
    {
      assignment_status: auditedStep.assignment_status,
      assigned_queue: auditedStep.assigned_queue,
      assigned_user_id: auditedStep.assigned_user_id,
      handoff_id: handoff.id
    },
    "Production claimed or assigned the handoff."
  );
  return loadProjectWorkflowInstance(client, auth, handoff.workflow_run_id);
}

export async function markWorkflowHandoffWaiting(client: PoolClient, auth: AuthUser, handoffId: string, input: ProjectWorkflowWaitingInput) {
  const handoff = await loadHandoffById(client, auth.tenantId, handoffId, true);
  if (!handoff) {
    throw new ApiError(404, "Workflow handoff not found.");
  }
  requireProductionHandoff(handoff);
  requireHandoffStatus(handoff, ["accepted_by_production"], "Mark missing info");
  const step = await loadCurrentStepForHandoff(client, auth, handoff);
  if (!step) {
    throw new ApiError(404, "Workflow handoff step not found.");
  }
  assertCanExecuteStep(auth, step);
  const detail = normalizeText(input.waiting_detail);
  if (!detail) {
    throw new ApiError(400, "Add what Production is waiting on before marking missing info.");
  }
  if (handoff.status === "waiting_on_info" || step.assignment_status === "waiting_on_info") {
    throw new ApiError(409, "This Production handoff is already marked waiting on information.");
  }
  await client.query(
    `
      UPDATE workflow_handoff
      SET status = 'waiting_on_info'::workflow_handoff_status_type,
          notes = $3,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, handoff.id, detail]
  );
  const previousValues = {
    status: step.status,
    assignment_status: step.assignment_status,
    waiting_on_party: step.waiting_on_party,
    waiting_detail: step.waiting_detail
  };
  const updated = await client.query<StepRow>(
    `
      UPDATE workflow_step
      SET status = 'WAITING'::workflow_step_status_type,
          assignment_status = 'waiting_on_info'::workflow_assignment_status_type,
          waiting_on_party = $3,
          waiting_detail = $4,
          exception_reason = $4,
          notes = $4,
          last_transition_at = now(),
          last_transition_by_user_id = $5,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING
        id::text,
        tenant_id::text,
        workflow_run_id::text,
        workflow_run_milestone_id::text,
        job_id::text,
        $6::text AS milestone_key,
        step_key,
        name,
        description,
        department::text AS department,
        role_key,
        assigned_user_id::text,
        assignment_status::text AS assignment_status,
        assigned_queue::text AS assigned_queue,
        assigned_by_user_id::text,
        assigned_at::text,
        waiting_on_party::text AS waiting_on_party,
        waiting_detail,
        status::text AS status,
        required,
        skippable,
        blocking,
        expected_duration_minutes,
        started_at::text,
        completed_at::text,
        completed_by_user_id::text,
        notes,
        exception_reason,
        rework_count,
        last_transition_at::text,
        updated_at::text,
        sort_order
    `,
    [auth.tenantId, step.id, input.waiting_on_party, detail, auth.id, step.milestone_key]
  );
  const auditedStep = updated.rows[0] ?? step;
  await writeStepAudit(client, auth, {
    step: auditedStep,
    previousStatus: step.status,
    newStatus: auditedStep.status,
    transitionType: "updated",
    previousValues,
    newValues: {
      status: auditedStep.status,
      assignment_status: auditedStep.assignment_status,
      waiting_on_party: auditedStep.waiting_on_party,
      waiting_detail: auditedStep.waiting_detail,
      handoff_status: "waiting_on_info",
      handoff_id: handoff.id
    },
    reason: detail
  });
  return loadProjectWorkflowInstance(client, auth, handoff.workflow_run_id);
}

export async function markWorkflowHandoffProductionComplete(client: PoolClient, auth: AuthUser, handoffId: string) {
  const handoff = await loadHandoffById(client, auth.tenantId, handoffId, true);
  if (!handoff) {
    throw new ApiError(404, "Workflow handoff not found.");
  }
  requireProductionHandoff(handoff);
  requireHandoffStatus(handoff, ["accepted_by_production", "waiting_on_info"], "Mark Production Complete");
  const step = await loadCurrentStepForHandoff(client, auth, handoff);
  if (!step) {
    throw new ApiError(404, "Workflow handoff step not found.");
  }
  assertCanExecuteStep(auth, step);
  if (step.status !== "COMPLETE" && step.status !== "SKIPPED") {
    await transitionWorkflowStep(client, auth, step.id, {
      status: "COMPLETE",
      reason: "Production marked this work complete.",
      notes: "Production work complete.",
      idempotency_key: `production-complete:${step.id}:${Date.now()}`
    });
  }
  const latestStep = (await loadStepById(client, auth.tenantId, step.id)) ?? step;
  await client.query(
    `
      UPDATE workflow_handoff
      SET status = 'production_complete'::workflow_handoff_status_type,
          notes = COALESCE(notes, 'Production work complete.'),
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, handoff.id]
  );
  await writeHandoffStepAudit(
    client,
    auth,
    latestStep,
    { handoff_status: handoff.status },
    { handoff_status: "production_complete", handoff_id: handoff.id },
    "Production work is complete and ready to return."
  );
  return loadProjectWorkflowInstance(client, auth, handoff.workflow_run_id);
}

export async function returnWorkflowHandoffToSchools(client: PoolClient, auth: AuthUser, handoffId: string, input: ProjectWorkflowReturnInput) {
  const handoff = await loadHandoffById(client, auth.tenantId, handoffId, true);
  if (!handoff) {
    throw new ApiError(404, "Workflow handoff not found.");
  }
  requireProductionHandoff(handoff);
  requireHandoffStatus(handoff, ["production_complete"], "Return to Schools");
  const step = await loadCurrentStepForHandoff(client, auth, handoff);
  if (!step) {
    throw new ApiError(404, "Workflow handoff step not found.");
  }
  assertCanExecuteStep(auth, step);
  const returnReason = normalizeText(input.return_reason);
  if (!returnReason) {
    throw new ApiError(400, "Add a return note before returning to Schools.");
  }
  if (step.status !== "COMPLETE" && step.status !== "SKIPPED") {
    await transitionWorkflowStep(client, auth, step.id, {
      status: "COMPLETE",
      reason: returnReason,
      notes: `Returned to Schools. ${returnReason}`,
      idempotency_key: `return-to-schools:${step.id}:${Date.now()}`
    });
  }
  const status: ProjectWorkflowHandoffStatus = input.issue_flag ? "returned_with_issue" : "returned_to_schools";
  await client.query(
    `
      UPDATE workflow_handoff
      SET status = $3::workflow_handoff_status_type,
          returned_by_user_id = $4,
          returned_at = now(),
          return_reason = $5,
          issue_flag = $6,
          notes = $5,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, handoff.id, status, auth.id, returnReason, Boolean(input.issue_flag)]
  );
  const latestStep = (await loadStepById(client, auth.tenantId, step.id)) ?? step;
  await client.query(
    `
      UPDATE workflow_step
      SET assignment_status = 'returned'::workflow_assignment_status_type,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, latestStep.id]
  );
  await writeHandoffStepAudit(
    client,
    auth,
    latestStep,
    { handoff_status: handoff.status },
    { handoff_status: status, handoff_id: handoff.id, return_reason: returnReason },
    returnReason
  );
  return loadProjectWorkflowInstance(client, auth, handoff.workflow_run_id);
}

function dueAtIsoForQueueRow(row: ProductionQueueRow) {
  if (!row.started_at || row.expected_duration_minutes <= 0) {
    return null;
  }
  const startedAt = Date.parse(row.started_at);
  if (Number.isNaN(startedAt)) {
    return null;
  }
  return new Date(startedAt + row.expected_duration_minutes * 60_000).toISOString();
}

function toProductionQueueItem(row: ProductionQueueRow): ProjectWorkflowProductionQueueItem {
  const visibleNotes = row.step_notes ?? row.notes;
  return {
    source: "handoff",
    handoff_id: row.handoff_id,
    workflow_run_id: row.workflow_run_id,
    job_id: row.job_id,
    job_title: row.job_title,
    job_type: row.job_type,
    organization_id: row.organization_id,
    organization_name: row.organization_name,
    step_id: row.step_id,
    production_step: row.production_step,
    step_status: row.step_status,
    needed_work: row.needed_work ?? row.production_step,
    due_at: dueAtIsoForQueueRow(row),
    status: row.handoff_status,
    assignment_status: row.assignment_status,
    assigned_queue: row.assigned_queue,
    assigned_user_id: row.assigned_user_id,
    assigned_user_name: row.assigned_user_name,
    waiting_on_party: row.waiting_on_party,
    waiting_detail: row.waiting_detail,
    missing_info: row.waiting_detail ?? visibleNotes ?? row.reason,
    notes: visibleNotes,
    lane_reason: "Here by Production handoff",
    next_action: nextActionForProductionQueueHandoff(row),
    clear_condition: clearConditionForProductionQueueHandoff(row),
    operational_status: operationalStatusForProductionQueueHandoff(row),
    last_updated: row.last_updated
  };
}

function nextActionForProductionQueueHandoff(row: ProductionQueueRow) {
  if (row.handoff_status === "sent_to_production") {
    return "Accept the Production handoff and confirm the next owner.";
  }
  if (row.handoff_status === "waiting_on_info" || row.assignment_status === "waiting_on_info") {
    return row.waiting_detail ?? "Get the missing information before Production continues.";
  }
  if (row.handoff_status === "production_complete") {
    return "Return the completed Production work to Schools for follow-up.";
  }
  if (!row.assigned_user_id && row.assignment_status === "needs_assignment") {
    return "Assign or claim the Production step.";
  }
  return row.needed_work ?? `Work the current Production step: ${row.production_step}.`;
}

function clearConditionForProductionQueueHandoff(row: ProductionQueueRow) {
  if (row.handoff_status === "sent_to_production") {
    return "Clears when Production accepts the handoff.";
  }
  if (row.handoff_status === "waiting_on_info" || row.assignment_status === "waiting_on_info") {
    return "Clears when the missing information is received and the handoff can continue.";
  }
  if (row.handoff_status === "production_complete") {
    return "Clears when the work is returned to Schools.";
  }
  return "Clears when the current Production step completes or advances.";
}

function operationalStatusForProductionQueueHandoff(row: ProductionQueueRow): ProjectWorkflowProductionQueueItem["operational_status"] {
  if (row.handoff_status === "waiting_on_info" || row.assignment_status === "waiting_on_info") {
    return "waiting";
  }
  if (row.assignment_status === "needs_assignment" || !row.assigned_user_id) {
    return "missing_owner";
  }
  const dueAt = dueAtIsoForQueueRow(row);
  if (dueAt && Date.parse(dueAt) < Date.now()) {
    return "overdue";
  }
  return "active";
}

function laneReasonForProductionWorkflowAssignment(row: ProjectWorkflowJobRow) {
  if (row.current_step?.assigned_queue === "production" && row.current_step.department !== "production") {
    return `Here by Production queue assignment from ${operationalName(row.current_step.department)} step`;
  }
  if (row.current_step?.assigned_queue === "production") {
    return "Here by Production queue assignment";
  }
  return "Here by current Production workflow step";
}

function toProductionQueueItemFromWorkflowRow(row: ProjectWorkflowJobRow): ProjectWorkflowProductionQueueItem | null {
  const step = row.current_step;
  if (!row.workflow_run_id || !step) {
    return null;
  }
  return {
    source: "live_workflow_assignment",
    handoff_id: null,
    workflow_run_id: row.workflow_run_id,
    job_id: row.job_id,
    job_title: row.job_title,
    job_type: row.job_code ?? row.phase,
    organization_id: row.organization_id,
    organization_name: row.organization_name,
    step_id: step.id,
    production_step: step.name,
    step_status: step.status,
    needed_work: row.queue_intelligence.next_action,
    due_at: row.next_deadline_at,
    status: step.assignment_status === "waiting_on_info" ? "waiting_on_info" : "accepted_by_production",
    assignment_status: step.assignment_status,
    assigned_queue: step.assigned_queue,
    assigned_user_id: step.assigned_user_id,
    assigned_user_name: step.assigned_user_name ?? null,
    waiting_on_party: step.waiting_on_party ?? row.waiting_on_party,
    waiting_detail: step.waiting_detail,
    missing_info: row.blocked_reason ?? step.waiting_detail ?? row.queue_intelligence.trigger,
    notes: step.notes,
    lane_reason: laneReasonForProductionWorkflowAssignment(row),
    next_action: row.queue_intelligence.next_action,
    clear_condition: row.queue_intelligence.clear_condition,
    operational_status: row.queue_intelligence.operational_status,
    last_updated: step.updated_at ?? row.updated_at
  };
}

export async function listProjectWorkflowProductionQueue(client: PoolClient, auth: AuthUser, input: { limit?: number } = {}): Promise<ProjectWorkflowProductionQueue> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const rows = await client.query<ProductionQueueRow>(
    `
      SELECT
        handoff.id::text AS handoff_id,
        handoff.workflow_run_id::text,
        job.id::text AS job_id,
        job.title AS job_title,
        job.job_category::text AS job_type,
        job.organization_id::text,
        organization.display_name AS organization_name,
        COALESCE(active_step.id, target_step.id)::text AS step_id,
        COALESCE(active_step.name, target_step.name) AS production_step,
        COALESCE(active_step.status, target_step.status)::text AS step_status,
        COALESCE(active_step.description, target_step.description) AS needed_work,
        COALESCE(active_step.started_at, target_step.started_at)::text AS started_at,
        COALESCE(active_step.expected_duration_minutes, target_step.expected_duration_minutes) AS expected_duration_minutes,
        handoff.status::text AS handoff_status,
        COALESCE(active_step.assignment_status, target_step.assignment_status)::text AS assignment_status,
        COALESCE(active_step.assigned_queue, target_step.assigned_queue)::text AS assigned_queue,
        COALESCE(active_step.assigned_user_id, target_step.assigned_user_id)::text AS assigned_user_id,
        assigned_user.full_name AS assigned_user_name,
        COALESCE(active_step.waiting_on_party, target_step.waiting_on_party)::text AS waiting_on_party,
        COALESCE(active_step.waiting_detail, target_step.waiting_detail) AS waiting_detail,
        COALESCE(active_step.notes, target_step.notes) AS step_notes,
        handoff.notes,
        handoff.reason,
        GREATEST(handoff.updated_at, COALESCE(active_step.updated_at, target_step.updated_at), job.updated_at)::text AS last_updated
      FROM workflow_handoff handoff
      JOIN workflow_step target_step ON target_step.id = handoff.to_step_id
      LEFT JOIN LATERAL (
        SELECT active_step.*
        FROM workflow_step active_step
        WHERE active_step.tenant_id = handoff.tenant_id
          AND active_step.workflow_run_id = handoff.workflow_run_id
          AND active_step.department = handoff.to_department
          AND active_step.status NOT IN ('COMPLETE'::workflow_step_status_type, 'SKIPPED'::workflow_step_status_type)
        ORDER BY
          CASE
            WHEN active_step.status IN ('IN_PROGRESS'::workflow_step_status_type, 'BLOCKED'::workflow_step_status_type, 'OVERDUE'::workflow_step_status_type) THEN 0
            WHEN active_step.status = 'NOT_STARTED'::workflow_step_status_type THEN 1
            WHEN active_step.status = 'WAITING'::workflow_step_status_type THEN 2
            ELSE 3
          END ASC,
          active_step.sort_order ASC,
          active_step.created_at ASC
        LIMIT 1
      ) active_step ON true
      JOIN workflow_run run ON run.id = handoff.workflow_run_id
      JOIN jobs job ON job.id = run.job_id
      LEFT JOIN organization ON organization.id = job.organization_id
      LEFT JOIN app_user assigned_user ON assigned_user.id = COALESCE(active_step.assigned_user_id, target_step.assigned_user_id)
      WHERE handoff.tenant_id = $1
        AND handoff.to_department = 'production'::work_department_type
        AND handoff.sent_at IS NOT NULL
        AND handoff.from_department IS DISTINCT FROM handoff.to_department
        AND handoff.status IN (
          'sent_to_production'::workflow_handoff_status_type,
          'accepted_by_production'::workflow_handoff_status_type,
          'waiting_on_info'::workflow_handoff_status_type,
          'production_complete'::workflow_handoff_status_type
        )
        AND job.archived_at IS NULL
        AND job.job_status <> 'cancelled'::job_status_type
      ORDER BY
        CASE
          WHEN handoff.status = 'sent_to_production'::workflow_handoff_status_type THEN 0
          WHEN COALESCE(active_step.assignment_status, target_step.assignment_status) = 'needs_assignment'::workflow_assignment_status_type THEN 1
          WHEN handoff.status = 'waiting_on_info'::workflow_handoff_status_type THEN 2
          WHEN handoff.status = 'production_complete'::workflow_handoff_status_type THEN 3
          ELSE 4
        END ASC,
        last_updated DESC
      LIMIT $2
    `,
    [auth.tenantId, limit]
  );
  const handoffItems = rows.rows.map(toProductionQueueItem);
  const handoffJobIds = new Set(handoffItems.map((item) => item.job_id));
  const commandCenter = await listProjectWorkflowCommandCenter(client, auth, { view: "department", department: "production", limit: 100 });
  const workflowAssignmentItems = commandCenter.job_rows
    .filter((row) => row.current_step && row.workflow_run_id)
    .filter((row) => row.current_step?.assigned_queue === "production" || row.current_step?.department === "production")
    .filter((row) => !handoffJobIds.has(row.job_id))
    .map(toProductionQueueItemFromWorkflowRow)
    .filter((item): item is ProjectWorkflowProductionQueueItem => Boolean(item));
  const items = [...handoffItems, ...workflowAssignmentItems]
    .sort((left, right) => {
      const leftRank = left.status === "sent_to_production" ? 0 : left.operational_status === "missing_owner" ? 1 : left.operational_status === "waiting" ? 2 : 3;
      const rightRank = right.status === "sent_to_production" ? 0 : right.operational_status === "missing_owner" ? 1 : right.operational_status === "waiting" ? 2 : 3;
      return leftRank - rightRank || Date.parse(right.last_updated) - Date.parse(left.last_updated);
    })
    .slice(0, limit);
  const now = Date.now();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  return {
    generated_at: new Date().toISOString(),
    summary: {
      ready_for_production: items.filter((item) => item.status === "sent_to_production").length,
      needs_assignment: items.filter((item) => item.assignment_status === "needs_assignment" || !item.assigned_user_id).length,
      waiting_on_info: items.filter((item) => item.status === "waiting_on_info" || item.assignment_status === "waiting_on_info").length,
      due_today: items.filter((item) => item.due_at && Date.parse(item.due_at) <= endOfToday.getTime() && Date.parse(item.due_at) >= now).length,
      overdue: items.filter((item) => item.due_at && Date.parse(item.due_at) < now).length
    },
    items
  };
}

function toStepSummary(step: StepRow, dependencyMap: Map<string, string[]>): ProjectWorkflowStepSummary {
  return {
    id: step.id,
    workflow_run_id: step.workflow_run_id,
    job_id: step.job_id,
    milestone_key: step.milestone_key,
    step_key: step.step_key,
    name: step.name,
    description: step.description,
    department: step.department,
    role_key: step.role_key,
    assigned_user_id: step.assigned_user_id,
    assigned_user_name: step.assigned_user_name ?? null,
    assignment_status: step.assignment_status ?? null,
    assigned_queue: step.assigned_queue ?? null,
    assigned_by_user_id: step.assigned_by_user_id ?? null,
    assigned_by_user_name: step.assigned_by_user_name ?? null,
    assigned_at: step.assigned_at ?? null,
    waiting_on_party: step.waiting_on_party ?? null,
    waiting_detail: step.waiting_detail ?? null,
    status: step.status,
    required: step.required,
    skippable: step.skippable,
    blocking: step.blocking,
    expected_duration_minutes: step.expected_duration_minutes,
    started_at: step.started_at,
    completed_at: step.completed_at,
    completed_by_user_id: step.completed_by_user_id,
    notes: step.notes,
    exception_reason: step.exception_reason,
    rework_count: step.rework_count,
    dependency_step_ids: dependencyMap.get(step.id) ?? [],
    timing: calculateStepTiming({
      status: step.status,
      expectedDurationMinutes: step.expected_duration_minutes,
      startedAt: step.started_at,
      completedAt: step.completed_at,
      lastTransitionAt: step.last_transition_at
    }),
    updated_at: step.updated_at
  };
}

function dueAtMillisForStep(step: Pick<ProjectWorkflowStepSummary, "started_at" | "expected_duration_minutes">) {
  if (!step.started_at || step.expected_duration_minutes <= 0) {
    return null;
  }
  const startedAt = Date.parse(step.started_at);
  if (Number.isNaN(startedAt)) {
    return null;
  }
  return startedAt + step.expected_duration_minutes * 60_000;
}

function dueAtIsoForStep(step: ProjectWorkflowStepSummary | null) {
  if (!step) {
    return null;
  }
  const dueAtMs = dueAtMillisForStep(step);
  return dueAtMs === null ? null : new Date(dueAtMs).toISOString();
}

function phaseForStep(step: ProjectWorkflowStepSummary | null) {
  if (!step) {
    return "unknown";
  }
  const combined = `${step.milestone_key} ${step.step_key} ${step.name} ${step.department}`.toLowerCase();
  if (step.status === "COMPLETE" || combined.includes("complete") || combined.includes("sent") || combined.includes("approved")) {
    return "complete";
  }
  if (step.status === "WAITING") {
    return "waiting";
  }
  if (combined.includes("intake") || combined.includes("scope") || combined.includes("schedule") || combined.includes("setup")) {
    return "intake";
  }
  if (combined.includes("production") || combined.includes("edit") || combined.includes("files") || combined.includes("gallery")) {
    return "production";
  }
  if (combined.includes("qa") || combined.includes("verify") || combined.includes("review")) {
    return "qa";
  }
  if (step.status === "NOT_STARTED") {
    return "not_started";
  }
  return "active";
}

function ownerForStep(step: ProjectWorkflowStepSummary | null, row: CommandCenterJobSourceRow) {
  if (step?.assigned_user_name) {
    return { owner_display: step.assigned_user_name, owner_type: "user" as const };
  }
  if (step?.role_key) {
    return { owner_display: step.role_key.replace(/_/g, " "), owner_type: "role" as const };
  }
  if (row.account_owner_name) {
    return { owner_display: row.account_owner_name, owner_type: "account_owner" as const };
  }
  if (step?.department) {
    return { owner_display: `${step.department} team`, owner_type: "department" as const };
  }
  return { owner_display: "Owner not set", owner_type: "unknown" as const };
}

function deadlineStateForStep(step: ProjectWorkflowStepSummary | null, health: ProjectWorkflowJobHealth): ProjectWorkflowDeadlineState {
  if (health === "blocked") {
    return "blocked";
  }
  if (health === "complete") {
    return "complete";
  }
  if (!step?.started_at) {
    return "unknown";
  }
  if (step.status === "OVERDUE" || step.timing.overdue_minutes > 0 || step.timing.alert_level === "overdue") {
    return "running_late";
  }
  if (step.timing.health_state === "yellow" || step.timing.alert_level === "early_warning") {
    return "due_soon";
  }
  return "none";
}

function waitingOnPartyForStep(step: ProjectWorkflowStepSummary | null): ProjectWorkflowWaitingOnParty {
  if (!step || step.status === "COMPLETE" || step.status === "SKIPPED") {
    return "none";
  }
  if (step.waiting_on_party) {
    return step.waiting_on_party;
  }
  if (step.status === "WAITING" || step.status === "BLOCKED") {
    return "unknown";
  }
  return "none";
}

function fileStatusForJob(row: CommandCenterJobSourceRow): ProjectWorkflowFileStatus {
  if (!row.production_required || row.production_status === "not_created") {
    return "not_connected";
  }
  switch (row.production_status) {
    case "queued":
      return "not_started";
    case "awaiting_ingest":
      return "waiting_for_files";
    case "ingest_complete":
      return "count_images";
    case "editing":
    case "proof_build":
    case "in_final_production":
      return "in_production";
    case "awaiting_internal_review":
      return "qa_review";
    case "approved_for_final":
    case "approved_for_production":
    case "packaged":
      return "ready_to_release";
    case "proof_sent":
    case "ordered_or_sent":
    case "ordered_or_printed":
    case "delivered":
    case "complete":
      return "released";
    default:
      return "unknown";
  }
}

function stepFromCommandCenterRow(row: CommandCenterJobSourceRow): ProjectWorkflowStepSummary | null {
  if (!row.step_id || !row.workflow_run_id || !row.workflow_run_milestone_id || !row.milestone_key || !row.step_key || !row.step_name || !row.step_department || !row.step_status) {
    return null;
  }
  return toStepSummary(
    {
      id: row.step_id,
      tenant_id: "",
      workflow_run_id: row.workflow_run_id,
      workflow_run_milestone_id: row.workflow_run_milestone_id,
      job_id: row.job_id,
      milestone_key: row.milestone_key,
      step_key: row.step_key,
      name: row.step_name,
      description: row.step_description,
      department: row.step_department,
      role_key: row.role_key,
      assigned_user_id: row.assigned_user_id,
      assigned_user_name: row.assigned_user_name,
      assignment_status: row.assignment_status,
      assigned_queue: row.assigned_queue,
      assigned_by_user_id: row.assigned_by_user_id,
      assigned_by_user_name: row.assigned_by_user_name,
      assigned_at: row.assigned_at,
      waiting_on_party: row.waiting_on_party,
      waiting_detail: row.waiting_detail,
      status: row.step_status,
      required: Boolean(row.required),
      skippable: Boolean(row.skippable),
      blocking: Boolean(row.blocking),
      expected_duration_minutes: row.expected_duration_minutes ?? 1440,
      started_at: row.started_at,
      completed_at: row.completed_at,
      completed_by_user_id: row.completed_by_user_id,
      notes: row.notes,
      exception_reason: row.exception_reason,
      rework_count: row.rework_count ?? 0,
      last_transition_at: row.last_transition_at,
      updated_at: row.step_updated_at ?? row.job_updated_at,
      sort_order: row.step_sort_order ?? 0
    },
    new Map()
  );
}

function currentStepForJob(steps: ProjectWorkflowStepSummary[]) {
  const sorted = [...steps].sort((left, right) => {
    const leftPriority =
      left.status === "BLOCKED" ? 0 :
      left.status === "IN_PROGRESS" ? 1 :
      !WORKFLOW_TERMINAL_STEP_STATUSES.has(left.status) && (left.required || left.blocking) ? 2 :
      left.status === "WAITING" ? 3 :
      WORKFLOW_TERMINAL_STEP_STATUSES.has(left.status) ? 5 :
      4;
    const rightPriority =
      right.status === "BLOCKED" ? 0 :
      right.status === "IN_PROGRESS" ? 1 :
      !WORKFLOW_TERMINAL_STEP_STATUSES.has(right.status) && (right.required || right.blocking) ? 2 :
      right.status === "WAITING" ? 3 :
      WORKFLOW_TERMINAL_STEP_STATUSES.has(right.status) ? 5 :
      4;
    return leftPriority - rightPriority;
  });
  return sorted[0] ?? null;
}

function healthForJob(input: {
  row: CommandCenterJobSourceRow;
  currentStep: ProjectWorkflowStepSummary | null;
  steps: ProjectWorkflowStepSummary[];
  missingInfoFlags: string[];
}) {
  const reasons: string[] = [];
  const { row, currentStep, steps, missingInfoFlags } = input;
  const hasWorkflow = Boolean(row.workflow_run_id);
  const hasOpenSteps = steps.some((step) => !WORKFLOW_TERMINAL_STEP_STATUSES.has(step.status));
  const hasBlockedStep = steps.some((step) => step.status === "BLOCKED");
  const hasLateStep = steps.some((step) => step.status === "OVERDUE" || step.timing.overdue_minutes > 0 || step.timing.alert_level === "overdue");
  const hasDueSoonStep = steps.some((step) => step.timing.health_state === "yellow" || step.timing.alert_level === "early_warning");
  const hasRework = steps.some((step) => step.rework_count > 0);

  if (!hasWorkflow) {
    reasons.push("No workflow linked");
    return { health: "no_workflow" as const, health_reasons: reasons };
  }
  if (row.workflow_run_status === "completed" || (steps.length > 0 && !hasOpenSteps)) {
    reasons.push("Workflow is complete");
    return { health: "complete" as const, health_reasons: reasons };
  }
  if (hasBlockedStep) {
    reasons.push("Current step is blocked");
    return { health: "blocked" as const, health_reasons: reasons };
  }
  if (hasLateStep) {
    reasons.push("Next deadline is overdue");
    return { health: "running_late" as const, health_reasons: reasons };
  }
  if (hasDueSoonStep) {
    reasons.push("Due within 72 hours");
    return { health: "due_soon" as const, health_reasons: reasons };
  }
  if (hasRework) {
    reasons.push("Returned for fixes");
    return { health: "at_risk" as const, health_reasons: reasons };
  }
  if (missingInfoFlags.length > 0) {
    reasons.push("Missing required information");
    return { health: "at_risk" as const, health_reasons: reasons };
  }
  if (currentStep) {
    reasons.push("Current step is moving");
    return { health: "on_track" as const, health_reasons: reasons };
  }
  reasons.push("Workflow state is unavailable");
  return { health: "unknown" as const, health_reasons: reasons };
}

function missingInfoFlagsForJob(input: {
  row: CommandCenterJobSourceRow;
  currentStep: ProjectWorkflowStepSummary | null;
  waitingOnParty: ProjectWorkflowWaitingOnParty;
  nextDeadlineAt: string | null;
  fileStatus: ProjectWorkflowFileStatus;
  ownerDisplay: string;
}) {
  const flags: string[] = [];
  if (!input.row.scheduled_start_at) {
    flags.push("missing_job_date");
  }
  if (!input.ownerDisplay || input.ownerDisplay === "Owner not set") {
    flags.push("missing_owner");
  }
  if (!input.row.organization_id) {
    flags.push("missing_account");
  }
  if (!input.row.workflow_run_id) {
    flags.push("missing_workflow");
  }
  if (input.row.workflow_run_id && !input.nextDeadlineAt && input.currentStep && !WORKFLOW_TERMINAL_STEP_STATUSES.has(input.currentStep.status)) {
    flags.push("missing_due_date");
  }
  if (input.currentStep && (input.currentStep.status === "WAITING" || input.currentStep.status === "BLOCKED") && input.waitingOnParty === "unknown") {
    flags.push("missing_waiting_on_party");
  }
  if (input.row.production_required && input.fileStatus === "unknown") {
    flags.push("missing_file_status");
  }
  return flags;
}

function operationalName(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ownerLaneForJob(input: {
  currentStep: ProjectWorkflowStepSummary | null;
  owner: ReturnType<typeof ownerForStep>;
}) {
  const { currentStep, owner } = input;
  if (currentStep?.assigned_user_name) {
    return currentStep.assigned_user_name;
  }
  if (currentStep?.assigned_queue) {
    return `${operationalName(currentStep.assigned_queue)} Queue`;
  }
  if (currentStep?.department) {
    return `${operationalName(currentStep.department)} Queue`;
  }
  return owner.owner_display || "Owner not set";
}

function buildQueueIntelligence(input: {
  currentStep: ProjectWorkflowStepSummary | null;
  owner: ReturnType<typeof ownerForStep>;
  health: ReturnType<typeof healthForJob>;
  waitingOnParty: ProjectWorkflowWaitingOnParty;
  missingInfoFlags: string[];
  blockedReason: string | null;
  deadlineState: ProjectWorkflowDeadlineState;
}): ProjectWorkflowQueueIntelligence {
  const { currentStep, owner, health, waitingOnParty, missingInfoFlags, blockedReason, deadlineState } = input;
  const stepName = currentStep?.name ?? "workflow";
  const ownerLane = ownerLaneForJob({ currentStep, owner });
  const waitingParty = waitingOnParty && waitingOnParty !== "none" ? operationalName(waitingOnParty) : null;

  if (health.health === "blocked") {
    return {
      reason: blockedReason ? `Blocked: ${blockedReason}` : `${stepName} is blocked.`,
      trigger: "Current workflow step is blocked.",
      owner_lane: ownerLane,
      next_action: `Resolve the blocker on ${stepName}.`,
      clear_condition: "Clear when the blocker is removed or the step leaves Blocked.",
      operational_status: "blocked"
    };
  }
  if (deadlineState === "running_late" || health.health === "running_late") {
    return {
      reason: `${stepName} is overdue.`,
      trigger: "Next workflow deadline has passed.",
      owner_lane: ownerLane,
      next_action: `Open the workflow and move, complete, or replan ${stepName}.`,
      clear_condition: "Clear when the step completes or the workflow deadline is replanned.",
      operational_status: "overdue"
    };
  }
  if (waitingParty) {
    return {
      reason: `Waiting on ${waitingParty}.`,
      trigger: currentStep?.waiting_detail ?? "Current step has an explicit waiting state.",
      owner_lane: ownerLane,
      next_action: `Follow up with ${waitingParty} and update the waiting state.`,
      clear_condition: "Clear when waiting is set to No wait or the step advances.",
      operational_status: "waiting"
    };
  }
  if (missingInfoFlags.includes("missing_owner") || currentStep?.assignment_status === "needs_assignment") {
    return {
      reason: `${stepName} needs an owner or queue assignment.`,
      trigger: "Current step has no trusted owner.",
      owner_lane: ownerLane,
      next_action: "Assign an owner or queue before this can move cleanly.",
      clear_condition: "Clear when the current step has an owner, role, or queue.",
      operational_status: "missing_owner"
    };
  }
  if (missingInfoFlags.length > 0) {
    return {
      reason: `Missing data: ${missingInfoFlags.map(operationalName).join(", ")}.`,
      trigger: "Project Tracking row is missing required operating data.",
      owner_lane: ownerLane,
      next_action: "Fill in the missing job or workflow data.",
      clear_condition: "Clear when the missing fields are complete.",
      operational_status: "missing_next_action"
    };
  }
  if (health.health === "due_soon") {
    return {
      reason: `${stepName} is due soon.`,
      trigger: "Workflow timing is approaching its deadline.",
      owner_lane: ownerLane,
      next_action: `Confirm ${stepName} is actively moving before the deadline.`,
      clear_condition: "Clear when the step completes or is no longer near its deadline.",
      operational_status: "at_risk"
    };
  }
  if (health.health === "at_risk") {
    return {
      reason: health.health_reasons[0] ?? `${stepName} needs review.`,
      trigger: "Workflow health is at risk.",
      owner_lane: ownerLane,
      next_action: `Review ${stepName} and decide the next move.`,
      clear_condition: "Clear when the risk reason is resolved.",
      operational_status: "at_risk"
    };
  }
  if (health.health === "no_workflow") {
    return {
      reason: "No project-tracking workflow is linked.",
      trigger: "Job is visible but has no workflow run.",
      owner_lane: ownerLane,
      next_action: "Link or start a workflow before this can route cleanly.",
      clear_condition: "Clear when a Project Tracking workflow is attached.",
      operational_status: "missing_next_action"
    };
  }
  if (health.health === "complete") {
    return {
      reason: "Workflow is complete.",
      trigger: "All required workflow steps are complete.",
      owner_lane: ownerLane,
      next_action: "No queue action needed.",
      clear_condition: "Already clear.",
      operational_status: "ready_to_advance"
    };
  }
  return {
    reason: currentStep ? `${stepName} is active.` : "Workflow state needs review.",
    trigger: currentStep ? "Current workflow step is moving." : "No current step could be selected.",
    owner_lane: ownerLane,
    next_action: currentStep ? `Work the current step: ${stepName}.` : "Open the workflow and confirm the next step.",
    clear_condition: currentStep ? "Clear when the current step completes or advances." : "Clear when the workflow has a current step.",
    operational_status: currentStep ? "active" : "needs_action"
  };
}

function buildProjectWorkflowJobRows(rows: CommandCenterJobSourceRow[], limit: number) {
  const grouped = new Map<string, { base: CommandCenterJobSourceRow; steps: ProjectWorkflowStepSummary[] }>();
  for (const row of rows) {
    const group = grouped.get(row.job_id) ?? { base: row, steps: [] };
    const step = stepFromCommandCenterRow(row);
    if (step) {
      group.steps.push(step);
    }
    grouped.set(row.job_id, group);
  }

  const allRows: ProjectWorkflowJobRow[] = Array.from(grouped.values()).map(({ base, steps }) => {
    const currentStep = currentStepForJob(steps);
    const owner = ownerForStep(currentStep, base);
    const fileStatus = fileStatusForJob(base);
    const nextDeadlineAt = dueAtIsoForStep(currentStep);
    const waitingOnParty = waitingOnPartyForStep(currentStep);
    const missingInfoFlags = missingInfoFlagsForJob({
      row: base,
      currentStep,
      waitingOnParty,
      nextDeadlineAt,
      fileStatus,
      ownerDisplay: owner.owner_display
    });
    const health = healthForJob({ row: base, currentStep, steps, missingInfoFlags });
    const deadlineState = deadlineStateForStep(currentStep, health.health);
    const phase = phaseForStep(currentStep);
    const blockedReason = steps.find((step) => step.status === "BLOCKED")?.exception_reason ?? null;
    const queueIntelligence = buildQueueIntelligence({
      currentStep,
      owner,
      health,
      waitingOnParty,
      missingInfoFlags,
      blockedReason,
      deadlineState
    });
    return {
      job_id: base.job_id,
      job_number: base.job_number,
      job_code: base.job_number,
      job_title: base.job_title,
      organization_id: base.organization_id,
      organization_name: base.organization_name,
      account_id: null,
      account_name: null,
      workflow_run_id: base.workflow_run_id,
      workflow_template_id: base.workflow_template_id,
      workflow_template_name: base.workflow_template_name,
      workflow_template_version: base.workflow_template_version_number ? `v${base.workflow_template_version_number}` : null,
      current_step: currentStep ? { ...currentStep, phase } : null,
      phase,
      owner_display: owner.owner_display,
      owner_type: owner.owner_type,
      job_date: base.scheduled_start_at,
      next_deadline_at: nextDeadlineAt,
      deadline_state: deadlineState,
      waiting_on_party: waitingOnParty,
      health: health.health,
      health_reasons: health.health_reasons,
      file_status: fileStatus,
      missing_info_flags: missingInfoFlags,
      rework_count: steps.reduce((count, step) => count + step.rework_count, 0),
      blocked_reason: blockedReason,
      queue_intelligence: queueIntelligence,
      updated_at: steps.reduce((latest, step) => latest > step.updated_at ? latest : step.updated_at, base.job_updated_at)
    };
  });

  const sortedRows = [...allRows].sort((left, right) => {
    const rank: Record<ProjectWorkflowJobHealth, number> = {
      blocked: 0,
      running_late: 1,
      at_risk: 2,
      due_soon: 3,
      on_track: 4,
      unknown: 5,
      no_workflow: 6,
      complete: 7
    };
    return rank[left.health] - rank[right.health] || String(left.next_deadline_at ?? "").localeCompare(String(right.next_deadline_at ?? ""));
  });
  return {
    allRows: sortedRows,
    visibleRows: sortedRows.slice(0, limit)
  };
}

function summarizeProjectWorkflowJobRows(jobRows: ProjectWorkflowJobRow[], steps: ProjectWorkflowStepSummary[]): ProjectWorkflowCommandCenterSummary {
  const nowMs = Date.now();
  const isStepOverdue = (step: ProjectWorkflowStepSummary) => {
    const dueAt = dueAtMillisForStep(step);
    return step.status === "OVERDUE" || step.timing.alert_level === "overdue" || (dueAt !== null && dueAt <= nowMs);
  };
  const isStepDueSoon = (step: ProjectWorkflowStepSummary) => {
    const dueAt = dueAtMillisForStep(step);
    return !isStepOverdue(step) && (step.timing.alert_level !== "none" || (dueAt !== null && dueAt <= nowMs + 3 * 24 * 60 * 60_000));
  };
  return {
    open_steps: steps.filter((step) => !WORKFLOW_TERMINAL_STEP_STATUSES.has(step.status)).length,
    overdue_steps: steps.filter(isStepOverdue).length,
    due_soon_steps: steps.filter(isStepDueSoon).length,
    blocked_steps: steps.filter((step) => step.status === "BLOCKED").length,
    assigned_steps: steps.filter((step) => Boolean(step.assigned_user_id)).length,
    rework_steps: steps.filter((step) => step.rework_count > 0).length,
    at_risk_steps: steps.filter((step) => step.status === "BLOCKED" || step.timing.health_state !== "green").length,
    total_active_workflows: jobRows.filter((row) => row.workflow_run_id && row.health !== "complete").length,
    total_open_work: steps.filter((step) => !WORKFLOW_TERMINAL_STEP_STATUSES.has(step.status)).length,
    total_needs_attention: jobRows.filter((row) => ["blocked", "running_late", "due_soon", "at_risk"].includes(row.health)).length,
    total_blocked: jobRows.filter((row) => row.health === "blocked").length,
    total_running_late: jobRows.filter((row) => row.health === "running_late").length,
    total_due_soon: jobRows.filter((row) => row.health === "due_soon").length,
    total_returned_for_fixes: jobRows.filter((row) => row.rework_count > 0).length,
    total_waiting_on_school: jobRows.filter((row) => row.waiting_on_party === "school").length,
    total_waiting_on_kp: jobRows.filter((row) => row.waiting_on_party === "kp").length,
    total_missing_info: jobRows.filter((row) => row.missing_info_flags.length > 0).length,
    total_complete: jobRows.filter((row) => row.health === "complete").length,
    total_no_workflow_linked: jobRows.filter((row) => row.health === "no_workflow").length,
    source: "true_totals",
    confidence: jobRows.some((row) => row.waiting_on_party === "unknown" || row.file_status === "unknown") ? "mixed" : "explicit"
  };
}

export async function loadProjectWorkflowInstance(
  client: PoolClient,
  auth: AuthUser,
  workflowRunId: string
): Promise<ProjectWorkflowInstanceDetail> {
  const runResult = await client.query<WorkflowRunRow>(
    `
      SELECT
        run.id::text,
        run.job_id::text,
        run.template_id::text,
        run.template_version_id::text,
        run.template_key,
        template.name AS template_name,
        version_row.version_number,
        run.workflow_family::text AS workflow_family,
        run.status::text AS status,
        run.started_at::text,
        run.completed_at::text,
        job.title AS job_title,
        job.job_category::text AS job_type,
        job.organization_id::text,
        organization.display_name AS organization_name,
        job.account_owner_user_id::text
      FROM workflow_run run
      JOIN jobs job ON job.id = run.job_id
      JOIN workflow_template template ON template.id = run.template_id
      JOIN workflow_template_version version_row ON version_row.id = run.template_version_id
      LEFT JOIN organization ON organization.id = job.organization_id
      WHERE run.tenant_id = $1
        AND run.id = $2
        AND run.workflow_family = 'project_tracking'::shared_workflow_family_type
      LIMIT 1
    `,
    [auth.tenantId, workflowRunId]
  );
  const run = runResult.rows[0];
  if (!run) {
    throw new ApiError(404, "Workflow instance not found.");
  }

  const milestones = await client.query<MilestoneRow>(
    `
      SELECT id::text, milestone_key, name, description, status::text AS status, sort_order
      FROM workflow_run_milestone
      WHERE tenant_id = $1
        AND workflow_run_id = $2
      ORDER BY sort_order ASC, created_at ASC
    `,
    [auth.tenantId, workflowRunId]
  );
  const steps = await client.query<StepRow>(
    `
      SELECT
        step.id::text,
        step.tenant_id::text,
        step.workflow_run_id::text,
        step.workflow_run_milestone_id::text,
        step.job_id::text,
        milestone.milestone_key,
        step.step_key,
        step.name,
        step.description,
        step.department::text AS department,
        step.role_key,
        step.assigned_user_id::text,
        assigned_user.full_name AS assigned_user_name,
        step.assignment_status::text AS assignment_status,
        step.assigned_queue::text AS assigned_queue,
        step.assigned_by_user_id::text,
        assigned_by.full_name AS assigned_by_user_name,
        step.assigned_at::text,
        step.waiting_on_party::text AS waiting_on_party,
        step.waiting_detail,
        step.status::text AS status,
        step.required,
        step.skippable,
        step.blocking,
        step.expected_duration_minutes,
        step.started_at::text,
        step.completed_at::text,
        step.completed_by_user_id::text,
        step.notes,
        step.exception_reason,
        step.rework_count,
        step.last_transition_at::text,
        step.updated_at::text,
        step.sort_order
      FROM workflow_step step
      JOIN workflow_run_milestone milestone ON milestone.id = step.workflow_run_milestone_id
      LEFT JOIN app_user assigned_user ON assigned_user.id = step.assigned_user_id
      LEFT JOIN app_user assigned_by ON assigned_by.id = step.assigned_by_user_id
      WHERE step.tenant_id = $1
        AND step.workflow_run_id = $2
      ORDER BY milestone.sort_order ASC, step.sort_order ASC, step.created_at ASC
    `,
    [auth.tenantId, workflowRunId]
  );
  const dependencies = await client.query<DependencySummaryRow>(
    `
      SELECT
        workflow_step_id::text,
        depends_on_workflow_step_id::text
      FROM workflow_step_dependency
      WHERE tenant_id = $1
        AND workflow_run_id = $2
    `,
    [auth.tenantId, workflowRunId]
  );
  const dependencyMap = new Map<string, string[]>();
  for (const dependency of dependencies.rows) {
    const list = dependencyMap.get(dependency.workflow_step_id) ?? [];
    list.push(dependency.depends_on_workflow_step_id);
    dependencyMap.set(dependency.workflow_step_id, list);
  }
  const stepsByMilestone = new Map<string, ProjectWorkflowStepSummary[]>();
  for (const step of steps.rows) {
    const list = stepsByMilestone.get(step.workflow_run_milestone_id) ?? [];
    list.push(toStepSummary(step, dependencyMap));
    stepsByMilestone.set(step.workflow_run_milestone_id, list);
  }
  const handoffs = await client.query<HandoffRow>(
    `
      SELECT
        handoff.id::text,
        handoff.workflow_run_id::text,
        handoff.from_step_id::text,
        handoff.to_step_id::text,
        from_step.name AS from_step_name,
        to_step.name AS to_step_name,
        handoff.from_department::text AS from_department,
        handoff.to_department::text AS to_department,
        handoff.from_user_id::text,
        from_user.full_name AS from_user_name,
        handoff.to_user_id::text,
        to_user.full_name AS to_user_name,
        handoff.status::text AS status,
        handoff.reason,
        handoff.expectations,
        handoff.notes,
        handoff.issue_flag,
        handoff.return_reason,
        handoff.sent_by_user_id::text,
        sent_by.full_name AS sent_by_user_name,
        COALESCE(handoff.sent_at, handoff.sla_started_at, handoff.created_at)::text AS sent_at,
        handoff.accepted_by_user_id::text,
        accepted_by.full_name AS accepted_by_user_name,
        COALESCE(handoff.accepted_at, handoff.acknowledged_at)::text AS accepted_at,
        handoff.returned_by_user_id::text,
        returned_by.full_name AS returned_by_user_name,
        handoff.returned_at::text,
        handoff.created_at::text,
        handoff.updated_at::text
      FROM workflow_handoff handoff
      JOIN workflow_step to_step ON to_step.id = handoff.to_step_id
      LEFT JOIN workflow_step from_step ON from_step.id = handoff.from_step_id
      LEFT JOIN app_user from_user ON from_user.id = handoff.from_user_id
      LEFT JOIN app_user to_user ON to_user.id = handoff.to_user_id
      LEFT JOIN app_user sent_by ON sent_by.id = handoff.sent_by_user_id
      LEFT JOIN app_user accepted_by ON accepted_by.id = handoff.accepted_by_user_id
      LEFT JOIN app_user returned_by ON returned_by.id = handoff.returned_by_user_id
      WHERE handoff.tenant_id = $1
        AND handoff.workflow_run_id = $2
      ORDER BY handoff.created_at ASC
    `,
    [auth.tenantId, workflowRunId]
  );
  const auditEvents = await client.query<WorkflowAuditRow>(
    `
      SELECT
        audit.workflow_step_id::text,
        audit.actor_user_id::text,
        actor.full_name AS actor_name,
        audit.transition_type::text AS transition_type,
        audit.previous_status::text AS previous_status,
        audit.new_status::text AS new_status,
        audit.previous_values,
        audit.new_values,
        audit.reason,
        audit.created_at::text
      FROM workflow_step_audit_log audit
      LEFT JOIN app_user actor ON actor.id = audit.actor_user_id
      WHERE audit.tenant_id = $1
        AND audit.workflow_run_id = $2
      ORDER BY audit.created_at DESC
      LIMIT 40
    `,
    [auth.tenantId, workflowRunId]
  );

  return {
    workflow_run: {
      id: run.id,
      job_id: run.job_id,
      template_id: run.template_id,
      template_version_id: run.template_version_id,
      template_key: run.template_key,
      template_name: run.template_name,
      template_version_label: `${run.template_key} v${run.version_number}`,
      workflow_family: "project_tracking",
      status: run.status,
      started_at: run.started_at,
      completed_at: run.completed_at
    },
    job: {
      id: run.job_id,
      title: run.job_title,
      job_type: run.job_type,
      organization_id: run.organization_id,
      organization_name: run.organization_name,
      account_owner_user_id: run.account_owner_user_id
    },
    milestones: milestones.rows.map((milestone) => ({
      id: milestone.id,
      milestone_key: milestone.milestone_key,
      name: milestone.name,
      description: milestone.description,
      status: milestone.status,
      steps: stepsByMilestone.get(milestone.id) ?? []
    })),
    handoffs: handoffs.rows.map((handoff) => ({
      id: handoff.id,
      workflow_run_id: handoff.workflow_run_id,
      from_step_id: handoff.from_step_id,
      to_step_id: handoff.to_step_id,
      from_step_name: handoff.from_step_name,
      to_step_name: handoff.to_step_name,
      from_department: handoff.from_department,
      to_department: handoff.to_department,
      from_user_id: handoff.from_user_id,
      from_user_name: handoff.from_user_name,
      to_user_id: handoff.to_user_id,
      to_user_name: handoff.to_user_name,
      status: handoff.status,
      reason: handoff.reason,
      expectations: handoff.expectations,
      notes: handoff.notes,
      issue_flag: handoff.issue_flag,
      return_reason: handoff.return_reason,
      sent_by_user_id: handoff.sent_by_user_id,
      sent_by_user_name: handoff.sent_by_user_name,
      sent_at: handoff.sent_at,
      accepted_by_user_id: handoff.accepted_by_user_id,
      accepted_by_user_name: handoff.accepted_by_user_name,
      accepted_at: handoff.accepted_at,
      returned_by_user_id: handoff.returned_by_user_id,
      returned_by_user_name: handoff.returned_by_user_name,
      returned_at: handoff.returned_at,
      created_at: handoff.created_at,
      updated_at: handoff.updated_at
    })),
    audit_events: auditEvents.rows.map((event) => ({
      workflow_step_id: event.workflow_step_id,
      actor_user_id: event.actor_user_id,
      actor_name: event.actor_name,
      transition_type: event.transition_type,
      previous_status: event.previous_status,
      new_status: event.new_status,
      previous_values: event.previous_values,
      new_values: event.new_values,
      reason: event.reason,
      created_at: event.created_at
    }))
  };
}

export async function listProjectWorkflowCommandCenter(
  client: PoolClient,
  auth: AuthUser,
  input: { view?: "personal" | "department" | "global"; department?: WorkDepartmentType | null; limit?: number }
) {
  const view = input.view ?? "personal";
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const authDepartment = WORK_DEPARTMENT_TYPES.includes(auth.department as WorkDepartmentType)
    ? (auth.department as WorkDepartmentType)
    : null;
  const department = input.department ?? authDepartment;
  const rows = await client.query<StepRow & { job_title: string; organization_name: string | null }>(
    `
      SELECT
        step.id::text,
        step.tenant_id::text,
        step.workflow_run_id::text,
        step.workflow_run_milestone_id::text,
        step.job_id::text,
        milestone.milestone_key,
        step.step_key,
        step.name,
        step.description,
        step.department::text AS department,
        step.role_key,
        step.assigned_user_id::text,
        assigned_user.full_name AS assigned_user_name,
        step.assignment_status::text AS assignment_status,
        step.assigned_queue::text AS assigned_queue,
        step.assigned_by_user_id::text,
        assigned_by.full_name AS assigned_by_user_name,
        step.assigned_at::text,
        step.waiting_on_party::text AS waiting_on_party,
        step.waiting_detail,
        step.status::text AS status,
        step.required,
        step.skippable,
        step.blocking,
        step.expected_duration_minutes,
        step.started_at::text,
        step.completed_at::text,
        step.completed_by_user_id::text,
        step.notes,
        step.exception_reason,
        step.rework_count,
        step.last_transition_at::text,
        step.updated_at::text,
        step.sort_order,
        job.title AS job_title,
        organization.display_name AS organization_name
      FROM workflow_step step
      JOIN workflow_run_milestone milestone ON milestone.id = step.workflow_run_milestone_id
      JOIN jobs job ON job.id = step.job_id
      LEFT JOIN organization ON organization.id = job.organization_id
      LEFT JOIN app_user assigned_user ON assigned_user.id = step.assigned_user_id
      LEFT JOIN app_user assigned_by ON assigned_by.id = step.assigned_by_user_id
      WHERE step.tenant_id = $1
        AND step.status NOT IN ('COMPLETE'::workflow_step_status_type, 'SKIPPED'::workflow_step_status_type)
        AND (
          $2::text <> 'personal'
          OR step.assigned_user_id = $3::uuid
        )
        AND (
          $2::text <> 'department'
          OR step.department = $4::work_department_type
          OR step.assigned_queue = $4::work_department_type
        )
      ORDER BY
        CASE
          WHEN step.status = 'OVERDUE'::workflow_step_status_type THEN 0
          WHEN step.started_at IS NOT NULL AND step.started_at + (step.expected_duration_minutes || ' minutes')::interval <= now() THEN 0
          WHEN step.started_at IS NOT NULL AND step.started_at + (step.expected_duration_minutes || ' minutes')::interval <= now() + interval '24 hours' THEN 1
          WHEN step.status = 'BLOCKED'::workflow_step_status_type THEN 2
          WHEN step.started_at IS NOT NULL AND step.started_at + (step.expected_duration_minutes || ' minutes')::interval <= now() + interval '3 days' THEN 3
          ELSE 4
        END ASC,
        step.last_transition_at ASC,
        step.sort_order ASC
      LIMIT $5
    `,
    [auth.tenantId, view, auth.id, department, limit]
  );
  const steps = rows.rows.map((step) => ({
    ...toStepSummary(step, new Map()),
    job_title: step.job_title,
    organization_name: step.organization_name
  }));
  const jobSourceRows = await client.query<CommandCenterJobSourceRow>(
    `
      SELECT
        job.id::text AS job_id,
        job.job_number,
        job.title AS job_title,
        job.job_category::text AS job_category,
        job.department_type::text AS job_department_type,
        job.job_status::text AS job_status,
        job.production_status::text AS production_status,
        job.readiness_status::text AS readiness_status,
        job.risk_status::text AS risk_status,
        job.production_required,
        job.organization_id::text,
        organization.display_name AS organization_name,
        job.account_owner_user_id::text,
        account_owner.full_name AS account_owner_name,
        job.scheduled_start_at::text,
        job.client_deadline_at::text,
        job.production_deadline_at::text,
        job.updated_at::text AS job_updated_at,
        run.id::text AS workflow_run_id,
        run.template_id::text AS workflow_template_id,
        template.name AS workflow_template_name,
        run.template_version_id::text AS workflow_template_version_id,
        version_row.version_number AS workflow_template_version_number,
        run.status::text AS workflow_run_status,
        run.started_at::text AS workflow_started_at,
        run.completed_at::text AS workflow_completed_at,
        step.id::text AS step_id,
        step.workflow_run_milestone_id::text,
        milestone.milestone_key,
        milestone.sort_order AS milestone_sort_order,
        step.step_key,
        step.name AS step_name,
        step.description AS step_description,
        step.department::text AS step_department,
        step.role_key,
        step.assigned_user_id::text,
        assigned_user.full_name AS assigned_user_name,
        step.assignment_status::text AS assignment_status,
        step.assigned_queue::text AS assigned_queue,
        step.assigned_by_user_id::text,
        assigned_by.full_name AS assigned_by_user_name,
        step.assigned_at::text,
        step.waiting_on_party::text AS waiting_on_party,
        step.waiting_detail,
        step.status::text AS step_status,
        step.required,
        step.skippable,
        step.blocking,
        step.expected_duration_minutes,
        step.started_at::text,
        step.completed_at::text,
        step.completed_by_user_id::text,
        step.notes,
        step.exception_reason,
        step.rework_count,
        step.last_transition_at::text,
        step.updated_at::text AS step_updated_at,
        step.sort_order AS step_sort_order
      FROM jobs job
      LEFT JOIN organization ON organization.id = job.organization_id
      LEFT JOIN app_user account_owner ON account_owner.id = job.account_owner_user_id
      LEFT JOIN workflow_run run
        ON run.tenant_id = job.tenant_id
       AND run.job_id = job.id
       AND run.workflow_family = 'project_tracking'::shared_workflow_family_type
       AND run.status <> 'cancelled'::shared_workflow_run_status_type
      LEFT JOIN workflow_template template ON template.id = run.template_id
      LEFT JOIN workflow_template_version version_row ON version_row.id = run.template_version_id
      LEFT JOIN workflow_run_milestone milestone ON milestone.workflow_run_id = run.id
      LEFT JOIN workflow_step step ON step.workflow_run_milestone_id = milestone.id
      LEFT JOIN app_user assigned_user ON assigned_user.id = step.assigned_user_id
      LEFT JOIN app_user assigned_by ON assigned_by.id = step.assigned_by_user_id
      WHERE job.tenant_id = $1
        AND job.archived_at IS NULL
        AND job.job_status <> 'cancelled'::job_status_type
        AND (
          $2::text <> 'personal'
          OR job.account_owner_user_id = $3::uuid
          OR step.assigned_user_id = $3::uuid
        )
      ORDER BY
        job.scheduled_start_at ASC NULLS LAST,
        run.created_at DESC NULLS LAST,
        milestone.sort_order ASC NULLS LAST,
        step.sort_order ASC NULLS LAST,
        step.created_at ASC NULLS LAST
    `,
    [auth.tenantId, view, auth.id]
  );
  const { allRows: candidateJobRows } = buildProjectWorkflowJobRows(jobSourceRows.rows, Number.MAX_SAFE_INTEGER);
  const allJobRows = view === "department" && department
    ? candidateJobRows.filter((row) => row.current_step?.department === department || row.current_step?.assigned_queue === department)
    : candidateJobRows;
  const jobRows = allJobRows.slice(0, limit);
  const allJobSteps = jobSourceRows.rows
    .map((row) => stepFromCommandCenterRow(row))
    .filter((step): step is ProjectWorkflowStepSummary => Boolean(step));
  const scopedJobIds = new Set(allJobRows.map((row) => row.job_id));
  const summarySteps = view === "department" && department
    ? allJobSteps.filter((step) => scopedJobIds.has(step.job_id) && (step.department === department || step.assigned_queue === department))
    : allJobSteps;
  const summary = summarizeProjectWorkflowJobRows(allJobRows, summarySteps);
  const alerts = steps
    .filter((step) => step.status === "BLOCKED" || step.timing.alert_level !== "none")
    .slice(0, 25)
    .map((step) => {
      const level = step.status === "BLOCKED" ? ("blocked" as const) : step.timing.alert_level;
      return {
        step_id: step.id,
        workflow_run_id: step.workflow_run_id,
        job_id: step.job_id,
        level,
        title: step.name,
        summary:
          level === "blocked"
            ? step.exception_reason ?? "Step is blocked and needs owner review."
            : `${step.timing.sla_percent}% of expected duration elapsed.`,
        department: step.department,
        assigned_user_id: step.assigned_user_id,
        job_title: step.job_title,
        organization_name: step.organization_name
      };
    });

  return {
    generated_at: new Date().toISOString(),
    view,
    summary,
    alerts,
    steps,
    job_rows: jobRows
  };
}
