import type { PoolClient, QueryResultRow } from "pg";
import { hasAuthorityTier } from "../../authz/authority.js";
import { connectGuardedClient, pool } from "../../db/pool.js";
import { ApiError } from "../../errors/apiError.js";
import type {
  ChecklistApprovalDecision,
  ChecklistAssignmentRoleKey,
  ChecklistBlockingLevel,
  ChecklistCommentVisibility,
  ChecklistConditionEffect,
  ChecklistConditionLogic,
  ChecklistInstanceStatus,
  ChecklistItemType,
  ChecklistReminderType,
  ChecklistScopeType,
  ChecklistTriggerType,
  JobDepartmentType,
  JobWatchFlagSeverity,
  WorkflowBlockResourceType
} from "../../domain/jobTruth/index.js";
import { assertManagedUploadStorageKey } from "../s3.js";
import { createAuditLog } from "../audit.js";
import { queueNotificationDispatch } from "../opsNotifications.js";
import { queueApprovalNeededOperationalAlert } from "../operationalAlerting.js";
import { assertShootAccess } from "../shootAccess.js";
import { canSharedPolicy } from "../policy/index.js";
import { writeJobActivity } from "./activityLogService.js";
import { syncWatchFlagAlertById } from "./alertEventService.js";
import type { AuthUser } from "../../types/auth.js";
import type {
  ChecklistApprovalRecord,
  ChecklistAttentionItem,
  ChecklistAttentionState,
  ChecklistAttentionSummary,
  ChecklistAssignmentDefaults,
  ChecklistAttachmentRecord,
  ChecklistCommentRecord,
  ChecklistDisplayTarget,
  ChecklistInstanceDetail,
  ChecklistInstanceRecord,
  ChecklistItemBundle,
  ChecklistItemConditionRecord,
  ChecklistProgressSummary,
  ChecklistResponseRecord,
  ChecklistRuntimeItemView,
  ChecklistRuntimeSectionView,
  ChecklistSectionBundle,
  ChecklistTemplateDetail,
  ChecklistTemplateRecord,
  ChecklistTemplateSummary,
  ChecklistTemplateVersionRecord,
  ChecklistTransitionBlockingIssue,
  ChecklistTransitionValidation,
  ChecklistReminderRuleRecord,
  WorkflowBlockRuleRecord
} from "../../types/checklists.js";

type ChecklistTemplateFilters = {
  department_type?: JobDepartmentType | "all" | null;
  scope_type?: ChecklistScopeType | null;
  include_archived?: boolean;
};

export type ChecklistTemplateVersionInput = {
  name?: string | null;
  description?: string | null;
  code?: string | null;
  department_type?: JobDepartmentType | null;
  scope_type?: ChecklistScopeType;
  trigger_type?: ChecklistTriggerType;
  due_rule_json?: Record<string, unknown> | null;
  approval_required?: boolean;
  blocking_level?: ChecklistBlockingLevel;
  assignment_defaults_json?: ChecklistAssignmentDefaults | null;
  summary?: string | null;
  sections: Array<{
    section_key?: string | null;
    title: string;
    description?: string | null;
    sort_order?: number | null;
    items: Array<{
      item_key?: string | null;
      label: string;
      help_text?: string | null;
      item_type: ChecklistItemType;
      required?: boolean;
      proof_required?: boolean;
      validation_json?: Record<string, unknown> | null;
      options_json?: unknown[] | null;
      sort_order?: number | null;
      conditions?: Array<{
        condition_group_key?: string | null;
        logic_operator?: ChecklistConditionLogic;
        source_item_key: string;
        comparison_operator?: string | null;
        expected_value_json?: unknown;
        effect: ChecklistConditionEffect;
        sort_order?: number | null;
      }>;
    }>;
  }>;
};

export type CreateChecklistInstanceInput = {
  template_id?: string | null;
  template_code?: string | null;
  template_version_id?: string | null;
  scope_type: ChecklistScopeType;
  scope_id: string;
  title?: string | null;
  owner_user_id?: string | null;
  reviewer_user_id?: string | null;
  approver_user_id?: string | null;
  due_at?: string | null;
  created_from_trigger_key?: string | null;
  trigger_type?: ChecklistTriggerType;
  source_metadata_json?: Record<string, unknown> | null;
};

export type EnsureTriggeredChecklistInstancesInput = {
  scope_type: ChecklistScopeType;
  scope_id: string;
  trigger_types: ChecklistTriggerType[];
  template_codes?: string[] | null;
  created_from_trigger_key?: string | null;
  source_metadata_json?: Record<string, unknown> | null;
};

export type ChecklistResponseInput = {
  checklist_item_id: string;
  response_json: unknown;
};

export type ChecklistAttachmentInput = {
  checklist_response_id?: string | null;
  attachment_type: string;
  file_name: string;
  content_type: string;
  storage_key: string;
  object_url: string;
};

export type ChecklistCommentInput = {
  checklist_response_id?: string | null;
  checklist_item_id?: string | null;
  body: string;
  visibility?: ChecklistCommentVisibility;
};

export type ChecklistTransitionValidationInput = {
  resource_type: WorkflowBlockResourceType;
  from_stage?: string | null;
  to_stage: string;
  department_type?: JobDepartmentType | null;
  job_id?: string | null;
  shoot_id?: string | null;
  production_item_id?: string | null;
  location_id?: string | null;
  allow_soft_override?: boolean;
  override_reason?: string | null;
};

export type ChecklistReminderSweepResult = {
  scanned_instance_count: number;
  alert_count: number;
  watch_flag_count: number;
};

export type ChecklistAttentionQuery = {
  department_type?: JobDepartmentType | null;
  overdue?: boolean;
  awaiting_approval?: boolean;
  rejected?: boolean;
  blocked?: boolean;
  assigned_to_me?: boolean;
  limit?: number;
};

type ScopeContext = ChecklistDisplayTarget & {
  tenant_id: string;
  scope_type: ChecklistScopeType;
  scope_id: string;
  department_type: JobDepartmentType | null;
  account_owner_user_id?: string | null;
  readiness_owner_user_id?: string | null;
  production_owner_user_id?: string | null;
  department_owner_user_id?: string | null;
  peer_reviewer_user_id?: string | null;
  release_reviewer_user_id?: string | null;
  escalation_owner_user_id?: string | null;
  created_by_user_id?: string | null;
  owner_user_ids: string[];
  reviewer_user_ids: string[];
  approver_user_ids: string[];
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  shoot_showtime?: string | null;
  shoot_start_at?: string | null;
  shoot_end_at?: string | null;
  production_due_at?: string | null;
  production_release_due_at?: string | null;
  production_delivery_deadline_at?: string | null;
};

function resolveChecklistScopeId(
  scopeType: ChecklistScopeType,
  input: {
    job_id?: string | null;
    shoot_id?: string | null;
    production_item_id?: string | null;
    location_id?: string | null;
  }
) {
  switch (scopeType) {
    case "job":
      return input.job_id ?? "";
    case "shoot":
      return input.shoot_id ?? "";
    case "production_item":
      return input.production_item_id ?? "";
    case "location":
    default:
      return input.location_id ?? "";
  }
}

type ReminderCandidate = ChecklistInstanceRecord & {
  template_code: string;
  template_name: string;
};

type ChecklistInstanceDetailInternal = {
  instance: ChecklistInstanceRecord;
  template: ChecklistTemplateRecord;
  version: ChecklistTemplateVersionRecord;
  target: ScopeContext;
  progress: ChecklistProgressSummary;
  sections: ChecklistRuntimeSectionView[];
  approvals: ChecklistApprovalRecord[];
  comments: ChecklistCommentRecord[];
};

type TriggerTemplateRow = {
  template_id: string;
  template_code: string;
  template_name: string;
  template_version_id: string;
  trigger_type: ChecklistTriggerType;
};

type ChecklistAttentionCandidate = {
  id: string;
};

function normalizeText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeTimestamp(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function isChecklistAttentionClosed(status: ChecklistInstanceStatus) {
  return status === "approved" || status === "waived";
}

function buildChecklistAttentionState(detail: ChecklistInstanceDetailInternal): ChecklistAttentionState {
  if (detail.instance.status === "overdue") {
    return "overdue";
  }
  if (detail.instance.status === "rejected") {
    return "rejected";
  }
  if (detail.progress.approval_required && detail.progress.missing_approval && detail.instance.status === "submitted") {
    return "awaiting_approval";
  }
  if (detail.progress.missing_proof_item_ids.length) {
    return "missing_proof";
  }
  if (
    detail.instance.blocking_level !== "none" &&
    (detail.progress.missing_item_ids.length || detail.progress.missing_proof_item_ids.length || detail.progress.missing_approval)
  ) {
    return "blocked";
  }
  return "open";
}

function buildChecklistAttentionSortRank(item: ChecklistAttentionItem) {
  if (item.overdue && item.blocked_transition) {
    return 0;
  }
  if (item.blocked_transition) {
    return 1;
  }
  if (item.rejected) {
    return 2;
  }
  if (item.awaiting_approval) {
    return 3;
  }
  if (item.missing_proof_count > 0) {
    return 4;
  }
  return 5;
}

function buildChecklistAttentionSummary(items: ChecklistAttentionItem[], auth: AuthUser): ChecklistAttentionSummary {
  return {
    total_count: items.length,
    overdue_count: items.filter((item) => item.overdue).length,
    awaiting_approval_count: items.filter((item) => item.awaiting_approval).length,
    rejected_count: items.filter((item) => item.rejected).length,
    blocked_count: items.filter((item) => item.blocked_transition).length,
    missing_proof_count: items.filter((item) => item.missing_proof_count > 0).length,
    assigned_to_me_count: items.filter(
      (item) => item.owner_user_id === auth.id || item.reviewer_user_id === auth.id || item.approver_user_id === auth.id
    ).length
  };
}

function matchesChecklistAttentionQuery(item: ChecklistAttentionItem, auth: AuthUser, query: ChecklistAttentionQuery) {
  if (query.department_type && item.department_type !== query.department_type) {
    return false;
  }
  if (
    query.assigned_to_me &&
    item.owner_user_id !== auth.id &&
    item.reviewer_user_id !== auth.id &&
    item.approver_user_id !== auth.id
  ) {
    return false;
  }
  if (query.overdue && !item.overdue) {
    return false;
  }
  if (query.awaiting_approval && !item.awaiting_approval) {
    return false;
  }
  if (query.rejected && !item.rejected) {
    return false;
  }
  if (query.blocked && !item.blocked_transition) {
    return false;
  }
  return true;
}

function normalizeChecklistAssignmentRole(value: unknown): ChecklistAssignmentRoleKey | null {
  switch (value) {
    case "context_owner":
    case "context_reviewer":
    case "context_approver":
    case "account_owner":
    case "readiness_owner":
    case "production_owner":
    case "department_owner":
    case "peer_reviewer":
    case "release_reviewer":
    case "escalation_owner":
    case "created_by_user":
    case "department_manager":
    case "production_manager":
      return value;
    default:
      return null;
  }
}

function sanitizeChecklistAssignmentDefaults(value: unknown): ChecklistAssignmentDefaults {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    owner_assignment_role: normalizeChecklistAssignmentRole(record.owner_assignment_role),
    reviewer_assignment_role: normalizeChecklistAssignmentRole(record.reviewer_assignment_role),
    approver_assignment_role: normalizeChecklistAssignmentRole(record.approver_assignment_role)
  };
}

function isChecklistTerminalStatus(status: ChecklistInstanceStatus) {
  return status === "approved" || status === "waived";
}

function canApproveChecklistStatus(status: ChecklistInstanceStatus) {
  return status === "submitted" || status === "overdue";
}

function canRejectChecklistStatus(status: ChecklistInstanceStatus) {
  return status === "submitted" || status === "overdue";
}

function canManageChecklistTemplates(auth: AuthUser) {
  return canSharedPolicy(auth, "checklist.template.manage") || hasAuthorityTier(auth, ["leadership", "super_admin"]);
}

function canReadChecklistTemplates(auth: AuthUser) {
  return canManageChecklistTemplates(auth) || canSharedPolicy(auth, "checklist.template.read");
}

function canApproveChecklist(auth: AuthUser) {
  return canSharedPolicy(auth, "checklist.approve") || hasAuthorityTier(auth, ["leadership", "super_admin"]);
}

function canWaiveChecklist(auth: AuthUser) {
  return canSharedPolicy(auth, "checklist.waive") || hasAuthorityTier(auth, ["leadership", "super_admin"]);
}

function canOverrideSoftBlock(auth: AuthUser) {
  return canSharedPolicy(auth, "checklist.override.soft_block") || hasAuthorityTier(auth, ["leadership", "super_admin"]);
}

function buildChecklistPrincipalIds(context: ScopeContext, instance?: ChecklistInstanceRecord | null) {
  return [
    ...context.owner_user_ids,
    ...context.reviewer_user_ids,
    ...context.approver_user_ids,
    instance?.owner_user_id ?? null,
    instance?.reviewer_user_id ?? null,
    instance?.approver_user_id ?? null
  ].filter((value): value is string => Boolean(value));
}

function canReviewChecklistInstance(auth: AuthUser, context: ScopeContext, instance: ChecklistInstanceRecord) {
  if (canApproveChecklist(auth)) {
    return true;
  }
  const reviewerPrincipalIds = [
    ...context.reviewer_user_ids,
    ...context.approver_user_ids,
    instance.reviewer_user_id,
    instance.approver_user_id
  ].filter((value): value is string => Boolean(value));
  if (reviewerPrincipalIds.includes(auth.id)) {
    return true;
  }
  const assignedUserIds = buildChecklistPrincipalIds(context, instance);
  return Boolean(
    context.job_id &&
      (canSharedPolicy(auth, "qa.manage", {
        departmentType: context.department_type,
        assignedUserIds
      }) ||
        canSharedPolicy(auth, "approval.manage", {
          departmentType: context.department_type,
          assignedUserIds
        }) ||
        canSharedPolicy(auth, "production.release_approve", {
          departmentType: context.department_type,
          assignedUserIds
        }))
  );
}

function canWriteChecklistComment(auth: AuthUser, context: ScopeContext, instance: ChecklistInstanceRecord) {
  return (
    canManageChecklistScope(auth, context, instance) ||
    canReviewChecklistInstance(auth, context, instance) ||
    canWaiveChecklist(auth) ||
    hasAuthorityTier(auth, ["supervisor", "director_admin", "leadership", "super_admin"])
  );
}

async function listRows<T extends QueryResultRow>(client: PoolClient, text: string, values: unknown[] = []) {
  const { rows } = await client.query<T>(text, values);
  return rows;
}

async function writeChecklistAudit(
  client: PoolClient,
  auth: Pick<AuthUser, "tenantId" | "id"> | null,
  input: {
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
    previousValues?: Record<string, unknown> | null;
    newValues?: Record<string, unknown> | null;
    reasonComment?: string | null;
  }
) {
  await createAuditLog(client, {
    tenantId: auth?.tenantId ?? "",
    actorUserId: auth?.id ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: input.metadata,
    previousValues: input.previousValues ?? undefined,
    newValues: input.newValues ?? undefined,
    reasonComment: input.reasonComment ?? null,
    sourceSurface: "workflow_checklist_engine"
  });
}

async function writeChecklistDeniedAudit(
  _client: PoolClient,
  auth: Pick<AuthUser, "tenantId" | "id">,
  input: {
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
    reasonComment?: string | null;
  }
) {
  const auditClient = await connectGuardedClient();
  try {
    await writeChecklistAudit(auditClient, auth, {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: { denied: true, ...(input.metadata ?? {}) },
      reasonComment: input.reasonComment ?? null
    });
  } finally {
    auditClient.release();
  }
}

async function assertChecklistItemBelongsToInstance(client: PoolClient, tenantId: string, instanceId: string, itemId: string) {
  const row = (
    await client.query<{ id: string }>(
      `
        SELECT item.id::text
        FROM checklist_items item
        JOIN checklist_sections section ON section.id = item.section_id
        JOIN checklist_instances instance ON instance.template_version_id = section.template_version_id
        WHERE instance.tenant_id = $1
          AND instance.id = $2
          AND item.id = $3
        LIMIT 1
      `,
      [tenantId, instanceId, itemId]
    )
  ).rows[0];
  if (!row?.id) {
    throw new ApiError(400, "Checklist item does not belong to this checklist.");
  }
  return row.id;
}

async function assertChecklistResponseBelongsToInstance(client: PoolClient, tenantId: string, instanceId: string, responseId: string) {
  const row = (
    await client.query<{ id: string; checklist_item_id: string }>(
      `
        SELECT
          id::text,
          checklist_item_id::text
        FROM checklist_responses
        WHERE tenant_id = $1
          AND checklist_instance_id = $2
          AND id = $3
        LIMIT 1
      `,
      [tenantId, instanceId, responseId]
    )
  ).rows[0];
  if (!row?.id) {
    throw new ApiError(400, "Checklist response does not belong to this checklist.");
  }
  return row;
}

async function enqueueChecklistLifecycleNotification(
  client: PoolClient,
  auth: Pick<AuthUser, "tenantId" | "id">,
  context: ScopeContext,
  instance: ChecklistInstanceRecord,
  input: {
    notificationType: string;
    title: string;
    body: string;
    recipientUserIds: string[];
    groupKey: string;
    category?: "approval_needed" | "follow_up_task";
    severity?: "medium" | "high";
    actionOwnerUserId?: string | null;
    requiresAcknowledgement?: boolean;
  }
) {
  const recipientUserIds = [...new Set(input.recipientUserIds.filter((value): value is string => Boolean(value) && value !== auth.id))];
  if (!recipientUserIds.length) {
    return;
  }
  await queueNotificationDispatch(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    recipientUserIds,
    notificationType: input.notificationType,
    title: input.title,
    body: input.body,
    deepLink: buildChecklistReminderDeepLink(context),
    metadata: {
      checklist_instance_id: instance.id,
      checklist_scope_type: context.scope_type,
      checklist_scope_id: context.scope_id,
      production_item_id: context.production_item_id,
      shoot_id: context.shoot_id,
      job_id: context.job_id
    },
    category: input.category ?? "follow_up_task",
    severity: input.severity ?? "medium",
    actionRequired: true,
    actionOwnerUserId: input.actionOwnerUserId ?? recipientUserIds[0] ?? null,
    dueAt: normalizeTimestamp(instance.due_at),
    requiresAcknowledgement: input.requiresAcknowledgement ?? false,
    allowSnooze: true,
    digestEligible: false,
    sourceEvent: input.notificationType,
    groupKey: input.groupKey,
    channels: ["in_app"]
  });
}

function buildChecklistReminderAutoKey(instanceId: string, reminderType: ChecklistReminderType) {
  return `checklist:${instanceId}:${reminderType}`;
}

function buildChecklistScopeLinks(context: ScopeContext, scopeType: ChecklistScopeType) {
  switch (scopeType) {
    case "job":
      return {
        jobId: context.job_id ?? null,
        shootId: null,
        productionItemId: null,
        locationId: null
      };
    case "shoot":
      return {
        jobId: null,
        shootId: context.shoot_id ?? null,
        productionItemId: null,
        locationId: null
      };
    case "production_item":
      return {
        jobId: null,
        shootId: null,
        productionItemId: context.production_item_id ?? null,
        locationId: null
      };
    case "location":
    default:
      return {
        jobId: null,
        shootId: null,
        productionItemId: null,
        locationId: context.location_id ?? null
      };
  }
}

function timestampToMs(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

function reminderTriggerFloorMs(reminderType: ChecklistReminderType, dueMs: number, offsetMinutes: number) {
  switch (reminderType) {
    case "before_due":
      return dueMs - offsetMinutes * 60_000;
    case "at_due":
      return dueMs;
    case "overdue":
    case "escalation":
      return dueMs + offsetMinutes * 60_000;
    default:
      return dueMs;
  }
}

function reminderAlreadyTriggered(instance: Pick<ChecklistInstanceRecord, "last_reminded_at" | "escalated_at">, reminderType: ChecklistReminderType, floorMs: number) {
  const trackedAt = reminderType === "escalation" ? timestampToMs(instance.escalated_at) : timestampToMs(instance.last_reminded_at);
  return trackedAt != null && trackedAt >= floorMs;
}

function deriveChecklistReminderFlagType(reminderType: ChecklistReminderType, status: ChecklistInstanceStatus) {
  if (reminderType === "escalation") {
    return "checklist_escalation";
  }
  if (status === "overdue" || reminderType === "overdue") {
    return "checklist_overdue";
  }
  if (reminderType === "at_due") {
    return "checklist_due_now";
  }
  return "checklist_due_soon";
}

function deriveChecklistReminderSeverity(
  instance: Pick<ChecklistInstanceRecord, "blocking_level" | "approval_required" | "status">,
  reminderType: ChecklistReminderType
): JobWatchFlagSeverity {
  if (reminderType === "escalation") {
    return instance.blocking_level === "hard_block" ? "critical" : "high";
  }
  if (instance.status === "overdue" || reminderType === "overdue") {
    return instance.blocking_level === "hard_block" || instance.approval_required ? "high" : "medium";
  }
  if (reminderType === "at_due") {
    return instance.blocking_level === "hard_block" ? "high" : "medium";
  }
  return instance.blocking_level === "hard_block" ? "medium" : "low";
}

type ChecklistSystemActor = {
  tenantId: string;
  id?: string | null;
};

type ChecklistReminderSweepCaches = {
  scopeContexts: Map<string, ScopeContext>;
  reminderRules: Map<string, ChecklistReminderRuleRecord[]>;
  escalationRecipients: Map<string, string[]>;
};

function buildChecklistReminderScopeCacheKey(scopeType: ChecklistScopeType, scopeId: string) {
  return `${scopeType}:${scopeId}`;
}

function buildChecklistReminderRuleCacheKey(candidate: Pick<ReminderCandidate, "template_id" | "template_version_id" | "department_type" | "scope_type">) {
  return [candidate.template_id, candidate.template_version_id, candidate.department_type ?? "", candidate.scope_type].join(":");
}

function buildChecklistEscalationRecipientCacheKey(tenantId: string, roleCodes: string[], departmentType: string | null) {
  return `${tenantId}:${roleCodes.join("|")}:${departmentType ?? ""}`;
}

async function createChecklistWatchFlag(
  client: PoolClient,
  auth: ChecklistSystemActor | null,
  context: ScopeContext,
  instance: ChecklistInstanceRecord,
  templateCode: string,
  templateName: string,
  reminderType: ChecklistReminderType,
  escalationRole?: string | null
) {
  if (!context.job_id) {
    return null;
  }

  const tenantId = auth?.tenantId ?? context.tenant_id;
  const actorUserId = auth?.id ?? null;
  const autoKey = buildChecklistReminderAutoKey(instance.id, reminderType);
  const flagType = deriveChecklistReminderFlagType(reminderType, instance.status);
  const severity = deriveChecklistReminderSeverity(instance, reminderType);
  const title =
    reminderType === "escalation"
      ? `${templateName} needs escalation`
      : instance.status === "overdue" || reminderType === "overdue"
        ? `${templateName} is overdue`
        : `${templateName} needs attention`;
  const description =
    reminderType === "escalation"
      ? `${instance.title} has remained unresolved past its escalation threshold.`
      : `${instance.title} is blocking or delaying workflow progress until the checklist is complete.`;
  const existing = await client.query<{ id: string; status: string }>(
    `
      SELECT id::text AS id, status::text AS status
      FROM job_watch_flags
      WHERE tenant_id = $1
        AND auto_key = $2
      LIMIT 1
    `,
    [tenantId, autoKey]
  );

  let watchFlagId = existing.rows[0]?.id ?? null;
  if (watchFlagId) {
    await client.query(
      `
        UPDATE job_watch_flags
        SET severity = $3::job_watch_flag_severity_type,
            flag_type = $4,
            title = $5,
            description = $6,
            status = CASE
              WHEN status = 'resolved'::job_watch_flag_status_type OR status = 'dismissed'::job_watch_flag_status_type
                THEN 'open'::job_watch_flag_status_type
              ELSE status
            END,
            owner_user_id = COALESCE($7, owner_user_id),
            due_at = COALESCE($8, due_at),
            escalated_at = CASE WHEN $9 THEN now() ELSE escalated_at END,
            escalated_to_role = COALESCE($10, escalated_to_role),
            resolved_at = NULL,
            resolved_by_user_id = NULL,
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [
        tenantId,
        watchFlagId,
        severity,
        flagType,
        title,
        description,
        instance.owner_user_id ?? instance.approver_user_id ?? context.owner_user_ids[0] ?? null,
        instance.due_at ?? null,
        reminderType === "escalation",
        escalationRole ?? null
      ]
    );
  } else {
    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO job_watch_flags (
          tenant_id,
          job_id,
          production_item_id,
          source_entity_type,
          source_entity_id,
          severity,
          flag_type,
          title,
          description,
          status,
          owner_user_id,
          due_at,
          created_by_user_id,
          auto_key,
          escalated_at,
          escalated_to_role
        )
        VALUES ($1,$2,$3,'checklist_instance',$4,$5::job_watch_flag_severity_type,$6,$7,$8,'open'::job_watch_flag_status_type,$9,$10,$11,$12,CASE WHEN $13 THEN now() ELSE NULL END,$14)
        RETURNING id::text AS id
      `,
      [
        tenantId,
        context.job_id,
        context.production_item_id,
        instance.id,
        severity,
        flagType,
        title,
        description,
        instance.owner_user_id ?? instance.approver_user_id ?? context.owner_user_ids[0] ?? null,
        instance.due_at ?? null,
        actorUserId,
        autoKey,
        reminderType === "escalation",
        escalationRole ?? null
      ]
    );
    watchFlagId = inserted.rows[0]?.id ?? null;
  }

  if (watchFlagId) {
    await syncWatchFlagAlertById(
      client,
      tenantId,
      watchFlagId,
      actorUserId,
      reminderType === "escalation" ? "escalated" : existing.rows[0]?.status === "resolved" ? "reopened" : "updated"
    );
    if (context.job_id) {
      await writeJobActivity(client, {
        tenantId,
        actorUserId,
        jobId: context.job_id,
        productionItemId: context.production_item_id,
        watchFlagId,
        eventType: reminderType === "escalation" ? "checklist_escalated" : "checklist_reminder_flagged",
        summary: title,
        metadata: {
          checklist_instance_id: instance.id,
          checklist_template_code: templateCode,
          reminder_type: reminderType
        },
        resourceType: "checklist_instance",
        resourceId: instance.id
      });
    }
  }
  return watchFlagId;
}

async function resolveChecklistWatchFlag(client: PoolClient, tenantId: string, instanceId: string, reminderType?: ChecklistReminderType | null, actorUserId?: string | null) {
  const autoKeys =
    reminderType != null
      ? [buildChecklistReminderAutoKey(instanceId, reminderType)]
      : (["before_due", "at_due", "overdue", "escalation"] as ChecklistReminderType[]).map((type) => buildChecklistReminderAutoKey(instanceId, type));

  const rows = await client.query<{ id: string }>(
    `
      UPDATE job_watch_flags
      SET status = 'resolved'::job_watch_flag_status_type,
          resolved_at = now(),
          resolved_by_user_id = COALESCE($3, resolved_by_user_id),
          updated_at = now()
      WHERE tenant_id = $1
        AND auto_key = ANY($2::text[])
        AND status <> 'resolved'::job_watch_flag_status_type
      RETURNING id::text AS id
    `,
    [tenantId, autoKeys, actorUserId ?? null]
  );

  for (const row of rows.rows) {
    await syncWatchFlagAlertById(client, tenantId, row.id, actorUserId ?? null, "updated");
  }
}

function compareConditionValue(actual: unknown, operator: string, expected: unknown) {
  switch (operator) {
    case "not_equals":
      return JSON.stringify(actual) !== JSON.stringify(expected);
    case "contains":
      return Array.isArray(actual) ? actual.some((value) => JSON.stringify(value) === JSON.stringify(expected)) : String(actual ?? "").includes(String(expected ?? ""));
    case "not_contains":
      return Array.isArray(actual) ? !actual.some((value) => JSON.stringify(value) === JSON.stringify(expected)) : !String(actual ?? "").includes(String(expected ?? ""));
    case "truthy":
      return Boolean(actual);
    case "falsy":
      return !actual;
    case "in":
      return Array.isArray(expected) && expected.some((value) => JSON.stringify(value) === JSON.stringify(actual));
    case "equals":
    default:
      return JSON.stringify(actual) === JSON.stringify(expected);
  }
}

function isResponseValuePresent(itemType: ChecklistItemType, value: unknown) {
  if (value == null) {
    return false;
  }
  switch (itemType) {
    case "checkbox":
    case "yes_no":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "multi_select":
      return Array.isArray(value) && value.length > 0;
    case "photo_upload":
    case "file_upload":
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    default:
      return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
  }
}

function extractChecklistOptionValues(options: unknown[]) {
  return options.map((option) => {
    if (option && typeof option === "object" && !Array.isArray(option) && "value" in option) {
      return (option as { value: unknown }).value;
    }
    return option;
  });
}

function validateChecklistResponseValue(item: ChecklistItemBundle, value: unknown) {
  if (value == null) {
    return;
  }
  const validation = item.validation_json ?? {};
  if (item.item_type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ApiError(400, `${item.label} must be a number.`);
    }
    const minimum = Number(validation.minimum ?? Number.NaN);
    const maximum = Number(validation.maximum ?? Number.NaN);
    if (Number.isFinite(minimum) && value < minimum) {
      throw new ApiError(400, `${item.label} must be at least ${minimum}.`);
    }
    if (Number.isFinite(maximum) && value > maximum) {
      throw new ApiError(400, `${item.label} must be ${maximum} or less.`);
    }
    if (validation.integer === true && !Number.isInteger(value)) {
      throw new ApiError(400, `${item.label} must be a whole number.`);
    }
  }
  if ((item.item_type === "text" || item.item_type === "textarea" || item.item_type === "signature") && typeof value === "string") {
    const minLength = Number(validation.min_length ?? Number.NaN);
    const maxLength = Number(validation.max_length ?? Number.NaN);
    if (Number.isFinite(minLength) && value.trim().length < minLength) {
      throw new ApiError(400, `${item.label} must be at least ${minLength} characters.`);
    }
    if (Number.isFinite(maxLength) && value.trim().length > maxLength) {
      throw new ApiError(400, `${item.label} must be ${maxLength} characters or fewer.`);
    }
  }
  if (item.item_type === "select") {
    const values = extractChecklistOptionValues(item.options_json ?? []);
    if (values.length > 0 && !values.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
      throw new ApiError(400, `${item.label} has an invalid selection.`);
    }
  }
  if (item.item_type === "multi_select") {
    if (!Array.isArray(value)) {
      throw new ApiError(400, `${item.label} must be a list of selections.`);
    }
    const values = extractChecklistOptionValues(item.options_json ?? []);
    if (values.length > 0 && value.some((entry) => !values.some((option) => JSON.stringify(option) === JSON.stringify(entry)))) {
      throw new ApiError(400, `${item.label} includes an invalid selection.`);
    }
  }
}

function applyDueRule(triggerAt: Date, dueRuleJson: Record<string, unknown>) {
  const offsetMinutes = Number(dueRuleJson.offset_minutes ?? 0);
  const offsetHours = Number(dueRuleJson.offset_hours ?? 0);
  const offsetDays = Number(dueRuleJson.offset_days ?? 0);
  const totalMinutes = offsetMinutes + offsetHours * 60 + offsetDays * 24 * 60;
  if (!Number.isFinite(totalMinutes) || totalMinutes === 0) {
    return null;
  }
  return new Date(triggerAt.getTime() + totalMinutes * 60_000).toISOString();
}

function firstValidChecklistAnchor(...values: Array<string | Date | null | undefined>) {
  for (const value of values) {
    const normalized = normalizeTimestamp(value);
    if (!normalized) {
      continue;
    }
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return null;
}

function resolveChecklistTriggerAnchor(context: ScopeContext, triggerType: ChecklistTriggerType) {
  switch (triggerType) {
    case "job_publish":
      return firstValidChecklistAnchor(context.scheduled_start_at, context.scheduled_end_at);
    case "shoot_status_transition":
      return firstValidChecklistAnchor(context.shoot_showtime, context.shoot_start_at, context.scheduled_start_at);
    case "shoot_complete":
      return firstValidChecklistAnchor(context.shoot_end_at, context.shoot_start_at, context.shoot_showtime, context.scheduled_end_at);
    case "upload_verified":
      return firstValidChecklistAnchor(
        context.production_release_due_at,
        context.production_due_at,
        context.production_delivery_deadline_at,
        context.scheduled_end_at
      );
    case "release_review":
      return firstValidChecklistAnchor(
        context.production_release_due_at,
        context.production_delivery_deadline_at,
        context.production_due_at,
        context.scheduled_end_at
      );
    case "production_status_transition":
      return firstValidChecklistAnchor(
        context.production_due_at,
        context.production_release_due_at,
        context.production_delivery_deadline_at,
        context.scheduled_end_at,
        context.scheduled_start_at
      );
    case "manual":
    default:
      return firstValidChecklistAnchor(
        context.production_due_at,
        context.production_release_due_at,
        context.production_delivery_deadline_at,
        context.shoot_showtime,
        context.shoot_start_at,
        context.scheduled_end_at,
        context.scheduled_start_at
      );
  }
}

function resolveChecklistDueRuleAnchor(context: ScopeContext, triggerType: ChecklistTriggerType, dueRuleJson: Record<string, unknown>) {
  const anchorKey = normalizeText(typeof dueRuleJson.anchor_key === "string" ? dueRuleJson.anchor_key : null);
  if (!anchorKey) {
    return resolveChecklistTriggerAnchor(context, triggerType);
  }
  if (anchorKey === "triggered_at") {
    return new Date();
  }
  switch (anchorKey) {
    case "job_scheduled_start_at":
      return firstValidChecklistAnchor(context.scheduled_start_at);
    case "job_scheduled_end_at":
      return firstValidChecklistAnchor(context.scheduled_end_at);
    case "shoot_showtime":
      return firstValidChecklistAnchor(context.shoot_showtime);
    case "shoot_start_at":
      return firstValidChecklistAnchor(context.shoot_start_at);
    case "shoot_end_at":
      return firstValidChecklistAnchor(context.shoot_end_at);
    case "production_due_at":
      return firstValidChecklistAnchor(context.production_due_at);
    case "production_release_due_at":
      return firstValidChecklistAnchor(context.production_release_due_at);
    case "production_delivery_deadline_at":
      return firstValidChecklistAnchor(context.production_delivery_deadline_at);
    default:
      return resolveChecklistTriggerAnchor(context, triggerType);
  }
}

function buildChecklistTitle(template: ChecklistTemplateRecord, context: ScopeContext, explicitTitle?: string | null) {
  return explicitTitle?.trim() || `${template.name} | ${context.title ?? context.organization_name ?? context.scope_type}`;
}

function statusSatisfiesRequirement(currentStatus: ChecklistInstanceStatus | null, requiredStatus: ChecklistInstanceStatus) {
  const rank: Record<ChecklistInstanceStatus, number> = {
    not_started: 0,
    in_progress: 1,
    rejected: 1,
    submitted: 2,
    overdue: 2,
    approved: 3,
    waived: 4
  };
  return currentStatus ? rank[currentStatus] >= rank[requiredStatus] : false;
}

function visibilityAllowsComment(
  auth: AuthUser,
  context: ScopeContext,
  instance: ChecklistInstanceRecord,
  visibility: ChecklistCommentVisibility
) {
  if (visibility === "standard_internal") {
    return true;
  }
  if (visibility === "manager_only") {
    return (
      canReviewChecklistInstance(auth, context, instance) ||
      canWaiveChecklist(auth) ||
      hasAuthorityTier(auth, ["supervisor", "director_admin", "leadership", "super_admin"])
    );
  }
  return hasAuthorityTier(auth, ["leadership", "super_admin"]);
}

function filterChecklistCommentsForAuth(
  auth: AuthUser,
  context: ScopeContext,
  instance: ChecklistInstanceRecord,
  comments: ChecklistCommentRecord[]
) {
  return comments.filter((comment) => visibilityAllowsComment(auth, context, instance, comment.visibility));
}

function mapChecklistSeverityToNotificationSeverity(severity: JobWatchFlagSeverity) {
  switch (severity) {
    case "critical":
      return "critical" as const;
    case "high":
      return "high" as const;
    case "medium":
      return "medium" as const;
    case "low":
    case "info":
    default:
      return "low" as const;
  }
}

function mapChecklistSeverityToNotificationPriority(severity: JobWatchFlagSeverity) {
  switch (severity) {
    case "critical":
      return "critical" as const;
    case "high":
      return "high" as const;
    case "medium":
    case "low":
    case "info":
    default:
      return "normal" as const;
  }
}

async function loadScopeContext(client: PoolClient, tenantId: string, scopeType: ChecklistScopeType, scopeId: string): Promise<ScopeContext> {
  switch (scopeType) {
    case "job": {
      const row = (
        await client.query<ScopeContext>(
          `
            SELECT
              job.tenant_id::text,
              'job'::text AS scope_type,
              job.id::text AS scope_id,
              job.id::text AS job_id,
              job.job_number,
              NULL::text AS shoot_id,
              NULL::text AS production_item_id,
              NULL::text AS location_id,
              org.display_name AS organization_name,
              job.title,
              owner.full_name AS owner_name,
              NULL::text AS reviewer_name,
              NULL::text AS approver_name,
              job.department_type::text AS department_type,
              job.account_owner_user_id::text,
              NULL::text AS readiness_owner_user_id,
              NULL::text AS production_owner_user_id,
              NULL::text AS department_owner_user_id,
              NULL::text AS peer_reviewer_user_id,
              NULL::text AS release_reviewer_user_id,
              NULL::text AS escalation_owner_user_id,
              job.created_by_user_id::text,
              array_remove(ARRAY[job.account_owner_user_id::text], NULL) AS owner_user_ids,
              ARRAY[]::text[] AS reviewer_user_ids,
              ARRAY[]::text[] AS approver_user_ids,
              job.scheduled_start_at::text,
              job.scheduled_end_at::text,
              NULL::text AS shoot_showtime,
              NULL::text AS shoot_start_at,
              NULL::text AS shoot_end_at,
              NULL::text AS production_due_at,
              NULL::text AS production_release_due_at,
              NULL::text AS production_delivery_deadline_at
            FROM jobs job
            LEFT JOIN organization org ON org.id = job.organization_id
            LEFT JOIN app_user owner ON owner.id = job.account_owner_user_id
            WHERE job.tenant_id = $1
              AND job.id = $2
            LIMIT 1
          `,
          [tenantId, scopeId]
        )
      ).rows[0];
      if (!row) {
        throw new ApiError(404, "Checklist target not found.");
      }
      return row;
    }
    case "production_item": {
      const row = (
        await client.query<ScopeContext>(
          `
            SELECT
              item.tenant_id::text,
              'production_item'::text AS scope_type,
              item.id::text AS scope_id,
              item.job_id::text AS job_id,
              job.job_number,
              NULL::text AS shoot_id,
              item.id::text AS production_item_id,
              NULL::text AS location_id,
              org.display_name AS organization_name,
              item.title,
              owner.full_name AS owner_name,
              reviewer.full_name AS reviewer_name,
              approver.full_name AS approver_name,
              item.department_type::text AS department_type,
              item.account_owner_user_id::text,
              NULL::text AS readiness_owner_user_id,
              item.assigned_to_user_id::text AS production_owner_user_id,
              item.department_owner_user_id::text,
              item.assigned_peer_reviewer_user_id::text AS peer_reviewer_user_id,
              item.assigned_release_reviewer_user_id::text AS release_reviewer_user_id,
              item.escalation_owner_user_id::text,
              job.created_by_user_id::text,
              array_remove(
                ARRAY[
                  item.assigned_to_user_id::text,
                  item.department_owner_user_id::text,
                  item.account_owner_user_id::text,
                  item.escalation_owner_user_id::text
                ],
                NULL
              ) AS owner_user_ids,
              array_remove(ARRAY[item.assigned_peer_reviewer_user_id::text], NULL) AS reviewer_user_ids,
              array_remove(ARRAY[item.assigned_release_reviewer_user_id::text], NULL) AS approver_user_ids,
              job.scheduled_start_at::text,
              job.scheduled_end_at::text,
              NULL::text AS shoot_showtime,
              NULL::text AS shoot_start_at,
              NULL::text AS shoot_end_at,
              item.due_at::text AS production_due_at,
              item.release_due_at::text AS production_release_due_at,
              item.delivery_deadline_at::text AS production_delivery_deadline_at
            FROM production_items item
            JOIN jobs job ON job.id = item.job_id
            LEFT JOIN organization org ON org.id = item.organization_id
            LEFT JOIN app_user owner ON owner.id = item.assigned_to_user_id
            LEFT JOIN app_user reviewer ON reviewer.id = item.assigned_peer_reviewer_user_id
            LEFT JOIN app_user approver ON approver.id = item.assigned_release_reviewer_user_id
            WHERE item.tenant_id = $1
              AND item.id = $2
            LIMIT 1
          `,
          [tenantId, scopeId]
        )
      ).rows[0];
      if (!row) {
        throw new ApiError(404, "Checklist target not found.");
      }
      return row;
    }
    case "shoot": {
      const row = (
        await client.query<ScopeContext>(
          `
            SELECT
              shoot.tenant_id::text,
              'shoot'::text AS scope_type,
              shoot.id::text AS scope_id,
              job.id::text AS job_id,
              job.job_number,
              shoot.id::text AS shoot_id,
              NULL::text AS production_item_id,
              shoot.location_id::text AS location_id,
              org.display_name AS organization_name,
              shoot.title,
              owner.full_name AS owner_name,
              NULL::text AS reviewer_name,
              NULL::text AS approver_name,
              CASE
                WHEN shoot.department = 'schools'::department_code THEN 'schools'::job_department_type
                WHEN shoot.department = 'sports'::department_code THEN 'sports'::job_department_type
                ELSE 'other'::job_department_type
              END AS department_type,
              shoot.account_owner_user_id::text,
              shoot.readiness_owner_user_id::text,
              NULL::text AS production_owner_user_id,
              NULL::text AS department_owner_user_id,
              NULL::text AS peer_reviewer_user_id,
              NULL::text AS release_reviewer_user_id,
              NULL::text AS escalation_owner_user_id,
              shoot.created_by::text AS created_by_user_id,
              array_remove(
                ARRAY[
                  shoot.account_owner_user_id::text,
                  shoot.readiness_owner_user_id::text,
                  shoot.created_by::text
                ],
                NULL
              ) AS owner_user_ids,
              ARRAY[]::text[] AS reviewer_user_ids,
              ARRAY[]::text[] AS approver_user_ids,
              job.scheduled_start_at::text,
              job.scheduled_end_at::text,
              shoot.showtime::text AS shoot_showtime,
              shoot.start_time::text AS shoot_start_at,
              shoot.end_time_est::text AS shoot_end_at,
              NULL::text AS production_due_at,
              NULL::text AS production_release_due_at,
              NULL::text AS production_delivery_deadline_at
            FROM shoot
            LEFT JOIN jobs job ON job.legacy_shoot_id = shoot.id
            LEFT JOIN organization org ON org.id = shoot.organization_id
            LEFT JOIN app_user owner ON owner.id = shoot.account_owner_user_id
            WHERE shoot.tenant_id = $1
              AND shoot.id = $2
              AND shoot.deleted_at IS NULL
            LIMIT 1
          `,
          [tenantId, scopeId]
        )
      ).rows[0];
      if (!row) {
        throw new ApiError(404, "Checklist target not found.");
      }
      return row;
    }
    case "location":
    default: {
      const row = (
        await client.query<ScopeContext>(
          `
            SELECT
              location.tenant_id::text,
              'location'::text AS scope_type,
              location.id::text AS scope_id,
              NULL::text AS job_id,
              NULL::text AS job_number,
              NULL::text AS shoot_id,
              NULL::text AS production_item_id,
              location.id::text AS location_id,
              org.display_name AS organization_name,
              location.name AS title,
              owner.full_name AS owner_name,
              NULL::text AS reviewer_name,
              NULL::text AS approver_name,
              NULL::job_department_type AS department_type,
              NULL::text AS account_owner_user_id,
              NULL::text AS readiness_owner_user_id,
              NULL::text AS production_owner_user_id,
              NULL::text AS department_owner_user_id,
              NULL::text AS peer_reviewer_user_id,
              NULL::text AS release_reviewer_user_id,
              NULL::text AS escalation_owner_user_id,
              NULL::text AS created_by_user_id,
              ARRAY[]::text[] AS owner_user_ids,
              ARRAY[]::text[] AS reviewer_user_ids,
              ARRAY[]::text[] AS approver_user_ids,
              NULL::text AS scheduled_start_at,
              NULL::text AS scheduled_end_at,
              NULL::text AS shoot_showtime,
              NULL::text AS shoot_start_at,
              NULL::text AS shoot_end_at,
              NULL::text AS production_due_at,
              NULL::text AS production_release_due_at,
              NULL::text AS production_delivery_deadline_at
            FROM shoot_location location
            LEFT JOIN organization org ON org.id = location.organization_id
            LEFT JOIN app_user owner ON owner.id = location.primary_owner_user_id
            WHERE location.tenant_id = $1
              AND location.id = $2
            LIMIT 1
          `,
          [tenantId, scopeId]
        )
      ).rows[0];
      if (!row) {
        throw new ApiError(404, "Checklist target not found.");
      }
      return row;
    }
  }
}

async function resolveChecklistScopedRoleUserId(client: PoolClient, tenantId: string, context: ScopeContext, roleCode: string) {
  const result = await client.query<{ user_id: string }>(
    `
      SELECT assignment.user_id::text AS user_id
      FROM user_role_assignment assignment
      JOIN role ON role.id = assignment.role_id
      WHERE assignment.tenant_id = $1
        AND role.code = $2
        AND (assignment.starts_at IS NULL OR assignment.starts_at <= now())
        AND (assignment.ends_at IS NULL OR assignment.ends_at >= now())
        AND (
          assignment.scope_type = 'global'::policy_scope_type
          OR (
            assignment.scope_type = 'department'::policy_scope_type
            AND $3::text IS NOT NULL
            AND assignment.scope_value = $3
          )
        )
      ORDER BY CASE assignment.scope_type
        WHEN 'department'::policy_scope_type THEN 0
        ELSE 1
      END, assignment.created_at ASC
      LIMIT 1
    `,
    [tenantId, roleCode, context.department_type ?? null]
  );
  return result.rows[0]?.user_id ?? null;
}

async function resolveChecklistTemplateAssignee(
  client: PoolClient,
  tenantId: string,
  context: ScopeContext,
  assignmentRole: ChecklistAssignmentRoleKey | null | undefined,
  fallbackUserId: string | null
) {
  switch (assignmentRole) {
    case "context_owner":
      return context.owner_user_ids[0] ?? fallbackUserId;
    case "context_reviewer":
      return context.reviewer_user_ids[0] ?? fallbackUserId;
    case "context_approver":
      return context.approver_user_ids[0] ?? fallbackUserId;
    case "account_owner":
      return context.account_owner_user_id ?? fallbackUserId;
    case "readiness_owner":
      return context.readiness_owner_user_id ?? fallbackUserId;
    case "production_owner":
      return context.production_owner_user_id ?? fallbackUserId;
    case "department_owner":
      return context.department_owner_user_id ?? fallbackUserId;
    case "peer_reviewer":
      return context.peer_reviewer_user_id ?? context.reviewer_user_ids[0] ?? fallbackUserId;
    case "release_reviewer":
      return context.release_reviewer_user_id ?? context.approver_user_ids[0] ?? fallbackUserId;
    case "escalation_owner":
      return context.escalation_owner_user_id ?? fallbackUserId;
    case "created_by_user":
      return context.created_by_user_id ?? fallbackUserId;
    case "department_manager":
      if (context.department_type === "schools") {
        return (await resolveChecklistScopedRoleUserId(client, tenantId, context, "schools_manager")) ?? fallbackUserId;
      }
      if (context.department_type === "sports") {
        return (await resolveChecklistScopedRoleUserId(client, tenantId, context, "sports_manager")) ?? fallbackUserId;
      }
      return fallbackUserId;
    case "production_manager":
      return (await resolveChecklistScopedRoleUserId(client, tenantId, context, "production_manager")) ?? fallbackUserId;
    default:
      return fallbackUserId;
  }
}

async function assertCanReadChecklistScope(client: PoolClient, auth: AuthUser, context: ScopeContext, instance?: ChecklistInstanceRecord | null) {
  if (hasAuthorityTier(auth, ["leadership", "super_admin"])) {
    return;
  }
  const principalIds = buildChecklistPrincipalIds(context, instance);
  if (principalIds.includes(auth.id)) {
    return;
  }
  if (context.scope_type === "shoot" && context.shoot_id) {
    await assertShootAccess(client, auth, context.shoot_id);
    return;
  }
  if (
    context.job_id &&
    (canSharedPolicy(auth, "job.read", {
      departmentType: context.department_type,
      ownerUserIds: context.owner_user_ids.length ? context.owner_user_ids : principalIds
    }) ||
      canSharedPolicy(auth, "production.read", {
        departmentType: context.department_type,
        ownerUserIds: context.owner_user_ids,
        assignedUserIds: principalIds
      }))
  ) {
    return;
  }
  if (context.location_id && canSharedPolicy(auth, "location.read", { locationId: context.location_id })) {
    return;
  }
  throw new ApiError(403, "Forbidden");
}

function canManageChecklistScope(auth: AuthUser, context: ScopeContext, instance?: ChecklistInstanceRecord | null) {
  if (hasAuthorityTier(auth, ["leadership", "super_admin"])) {
    return true;
  }
  const principalIds = buildChecklistPrincipalIds(context, instance);
  if (principalIds.includes(auth.id)) {
    return true;
  }
  if (
    context.job_id &&
    (canSharedPolicy(auth, "job.update", {
      departmentType: context.department_type,
      ownerUserIds: context.owner_user_ids
    }) ||
      canSharedPolicy(auth, "production.update", {
        departmentType: context.department_type,
        ownerUserIds: context.owner_user_ids,
        assignedUserIds: principalIds
      }) ||
      canSharedPolicy(auth, "qa.manage", {
        departmentType: context.department_type,
        assignedUserIds: principalIds
      }) ||
      canSharedPolicy(auth, "approval.manage", {
        departmentType: context.department_type,
        assignedUserIds: principalIds
      }))
  ) {
    return true;
  }
  if (context.location_id && canSharedPolicy(auth, "location.update", { locationId: context.location_id })) {
    return true;
  }
  return false;
}

async function loadTemplateSummaryRows(client: PoolClient, tenantId: string, filters: ChecklistTemplateFilters) {
  const params: unknown[] = [tenantId];
  let sql = `
    SELECT
      template.id::text,
      template.tenant_id::text,
      template.code,
      template.name,
      template.description,
      template.department_type::text,
      template.scope_type::text,
      template.active_version_id::text,
      template.created_by_user_id::text,
      template.updated_by_user_id::text,
      template.archived_at::text,
      template.created_at::text,
      template.updated_at::text,
      version.version_number AS active_version_number,
      version.status::text AS active_version_status,
      version.trigger_type::text AS active_trigger_type,
      coalesce(version.approval_required, false) AS active_approval_required,
      coalesce(version.blocking_level::text, 'none') AS active_blocking_level,
      count(instance.id)::int AS usage_count,
      max(instance.created_at)::text AS last_used_at
    FROM checklist_templates template
    LEFT JOIN checklist_template_versions version ON version.id = template.active_version_id
    LEFT JOIN checklist_instances instance
      ON instance.template_id = template.id
     AND instance.tenant_id = template.tenant_id
    WHERE template.tenant_id = $1
  `;
  if (!filters.include_archived) {
    sql += ` AND template.archived_at IS NULL`;
  }
  if (filters.department_type && filters.department_type !== "all") {
    params.push(filters.department_type);
    sql += ` AND (template.department_type = $${params.length}::job_department_type OR template.department_type IS NULL)`;
  }
  if (filters.scope_type) {
    params.push(filters.scope_type);
    sql += ` AND template.scope_type = $${params.length}::checklist_scope_type`;
  }
  sql += `
    GROUP BY template.id, version.id
    ORDER BY template.updated_at DESC, template.name ASC
  `;
  return listRows<ChecklistTemplateSummary>(client, sql, params);
}

async function loadTemplateDetail(client: PoolClient, tenantId: string, templateId: string): Promise<ChecklistTemplateDetail> {
  const summaries = await loadTemplateSummaryRows(client, tenantId, { include_archived: true });
  const summary = summaries.find((row) => row.id === templateId);
  if (!summary) {
    throw new ApiError(404, "Checklist template not found.");
  }
  const versions = await listRows<ChecklistTemplateVersionRecord>(
    client,
    `
      SELECT
        id::text,
        tenant_id::text,
        template_id::text,
        version_number,
        status::text,
        trigger_type::text,
        due_rule_json,
        approval_required,
        blocking_level::text,
        assignment_defaults_json,
        summary,
        created_by_user_id::text,
        published_by_user_id::text,
        published_at::text,
        created_at::text,
        updated_at::text
      FROM checklist_template_versions
      WHERE tenant_id = $1
        AND template_id = $2
      ORDER BY version_number DESC
    `,
    [tenantId, templateId]
  );
  const versionIds = versions.map((version) => version.id);
  const sections = versionIds.length
    ? await listRows<ChecklistSectionBundle>(
        client,
        `
          SELECT
            id::text,
            tenant_id::text,
            template_version_id::text,
            section_key,
            title,
            description,
            sort_order,
            created_at::text,
            updated_at::text
          FROM checklist_sections
          WHERE tenant_id = $1
            AND template_version_id = ANY($2::uuid[])
          ORDER BY template_version_id, sort_order, created_at
        `,
        [tenantId, versionIds]
      )
    : [];
  const items = versionIds.length
    ? await listRows<ChecklistItemBundle>(
        client,
        `
          SELECT
            id::text,
            tenant_id::text,
            template_version_id::text,
            section_id::text,
            item_key,
            label,
            help_text,
            item_type::text,
            required,
            proof_required,
            validation_json,
            options_json,
            sort_order,
            created_at::text,
            updated_at::text
          FROM checklist_items
          WHERE tenant_id = $1
            AND template_version_id = ANY($2::uuid[])
          ORDER BY template_version_id, section_id, sort_order, created_at
        `,
        [tenantId, versionIds]
      )
    : [];
  const itemIds = items.map((item) => item.id);
  const conditions = itemIds.length
    ? await listRows<ChecklistItemConditionRecord>(
        client,
        `
          SELECT
            id::text,
            tenant_id::text,
            template_version_id::text,
            checklist_item_id::text,
            condition_group_key,
            logic_operator::text,
            source_item_key,
            comparison_operator,
            expected_value_json,
            effect::text,
            sort_order,
            created_at::text
          FROM checklist_item_conditions
          WHERE tenant_id = $1
            AND checklist_item_id = ANY($2::uuid[])
          ORDER BY checklist_item_id, condition_group_key, sort_order, created_at
        `,
        [tenantId, itemIds]
      )
    : [];

  const conditionsByItem = new Map<string, ChecklistItemConditionRecord[]>();
  for (const condition of conditions) {
    const bucket = conditionsByItem.get(condition.checklist_item_id) ?? [];
    bucket.push(condition);
    conditionsByItem.set(condition.checklist_item_id, bucket);
  }
  const itemsBySection = new Map<string, ChecklistItemBundle[]>();
  for (const item of items) {
    const bucket = itemsBySection.get(item.section_id) ?? [];
    bucket.push({ ...item, conditions: conditionsByItem.get(item.id) ?? [] });
    itemsBySection.set(item.section_id, bucket);
  }
  const sectionsByVersion = new Map<string, ChecklistSectionBundle[]>();
  for (const section of sections) {
    const bucket = sectionsByVersion.get(section.template_version_id) ?? [];
    bucket.push({ ...section, items: itemsBySection.get(section.id) ?? [] });
    sectionsByVersion.set(section.template_version_id, bucket);
  }

  return {
    ...summary,
    versions: versions.map((version) => ({
      ...version,
      assignment_defaults_json: sanitizeChecklistAssignmentDefaults(version.assignment_defaults_json),
      sections: sectionsByVersion.get(version.id) ?? []
    }))
  };
}

async function nextTemplateVersionNumber(client: PoolClient, tenantId: string, templateId: string) {
  const result = await client.query<{ next_version: number }>(
    `
      SELECT coalesce(max(version_number), 0) + 1 AS next_version
      FROM checklist_template_versions
      WHERE tenant_id = $1
        AND template_id = $2
    `,
    [tenantId, templateId]
  );
  return Number(result.rows[0]?.next_version ?? 1);
}

function evaluateItemVisibility(
  item: ChecklistItemBundle,
  responseByItemId: Map<string, ChecklistResponseRecord>,
  responseByItemKey: Map<string, ChecklistResponseRecord>
) {
  let visible = true;
  let disabled = false;
  let effectiveRequired = item.required;
  const showMatches: boolean[] = [];
  const groups = new Map<string, ChecklistItemConditionRecord[]>();

  for (const condition of item.conditions ?? []) {
    const bucket = groups.get(condition.condition_group_key) ?? [];
    bucket.push(condition);
    groups.set(condition.condition_group_key, bucket);
  }

  for (const [, group] of groups) {
    const logic = group[0]?.logic_operator ?? "AND";
    const evaluations = group.map((condition) => {
      const sourceResponse =
        responseByItemKey.get(condition.source_item_key) ??
        [...responseByItemId.values()].find((response) => response.checklist_item_id === condition.source_item_key) ??
        null;
      return compareConditionValue(sourceResponse?.response_json ?? null, condition.comparison_operator, condition.expected_value_json);
    });
    const matched = logic === "OR" ? evaluations.some(Boolean) : evaluations.every(Boolean);
    for (const condition of group) {
      if (condition.effect === "show") {
        showMatches.push(matched);
      }
      if (!matched) {
        continue;
      }
      if (condition.effect === "hide") {
        visible = false;
      } else if (condition.effect === "disable") {
        disabled = true;
      } else if (condition.effect === "require") {
        effectiveRequired = true;
      }
    }
  }

  if (showMatches.length > 0) {
    visible = showMatches.some(Boolean) && visible;
  }

  return { visible, disabled, effectiveRequired };
}

function buildChecklistProgressSummary(
  version: ChecklistTemplateVersionRecord,
  sections: ChecklistSectionBundle[],
  responses: ChecklistResponseRecord[],
  attachments: ChecklistAttachmentRecord[]
): ChecklistProgressSummary {
  const responseByItemId = new Map(responses.map((response) => [response.checklist_item_id, response]));
  const responseByItemKey = new Map<string, ChecklistResponseRecord>();
  for (const section of sections) {
    for (const item of section.items) {
      const response = responseByItemId.get(item.id);
      if (response) {
        responseByItemKey.set(item.item_key, response);
      }
    }
  }
  const attachmentCounts = new Map<string, number>();
  for (const attachment of attachments) {
    if (!attachment.checklist_response_id) {
      continue;
    }
    attachmentCounts.set(attachment.checklist_response_id, (attachmentCounts.get(attachment.checklist_response_id) ?? 0) + 1);
  }

  let totalItems = 0;
  let visibleItems = 0;
  let requiredItems = 0;
  let completedItems = 0;
  let completedRequiredItems = 0;
  let proofRequiredItems = 0;
  let proofSatisfiedItems = 0;
  const missingItemIds: string[] = [];
  const missingProofItemIds: string[] = [];

  for (const section of sections) {
    for (const item of section.items) {
      totalItems += 1;
      const visibility = evaluateItemVisibility(item, responseByItemId, responseByItemKey);
      const response = responseByItemId.get(item.id) ?? null;
      const responsePresent = isResponseValuePresent(item.item_type, response?.response_json ?? null);
      const proofCount = response?.id ? attachmentCounts.get(response.id) ?? 0 : 0;
      const proofSatisfied = !item.proof_required || proofCount > 0;
      if (!visibility.visible) {
        continue;
      }
      visibleItems += 1;
      if (visibility.effectiveRequired) {
        requiredItems += 1;
      }
      if (item.proof_required) {
        proofRequiredItems += 1;
      }
      if (responsePresent) {
        completedItems += 1;
      }
      if (item.proof_required && proofSatisfied) {
        proofSatisfiedItems += 1;
      }
      if (visibility.effectiveRequired && responsePresent && proofSatisfied) {
        completedRequiredItems += 1;
      }
      if (visibility.effectiveRequired && !responsePresent) {
        missingItemIds.push(item.id);
      }
      if (item.proof_required && !proofSatisfied) {
        missingProofItemIds.push(item.id);
      }
    }
  }

  return {
    total_items: totalItems,
    visible_items: visibleItems,
    required_items: requiredItems,
    completed_items: completedItems,
    completed_required_items: completedRequiredItems,
    proof_required_items: proofRequiredItems,
    proof_satisfied_items: proofSatisfiedItems,
    approval_required: version.approval_required,
    approval_complete: false,
    progress_percent: visibleItems > 0 ? Math.round((completedItems / visibleItems) * 100) : 0,
    missing_item_ids: missingItemIds,
    missing_proof_item_ids: missingProofItemIds,
    missing_approval: false
  };
}

async function loadInstanceRaw(client: PoolClient, tenantId: string, instanceId: string) {
  const instance = (
    await client.query<ChecklistInstanceRecord>(
      `
        SELECT
          id::text,
          tenant_id::text,
          template_id::text,
          template_version_id::text,
          scope_type::text,
          job_id::text,
          shoot_id::text,
          production_item_id::text,
          location_id::text,
          department_type::text,
          title,
          trigger_type::text,
          status::text,
          approval_required,
          blocking_level::text,
          owner_user_id::text,
          reviewer_user_id::text,
          approver_user_id::text,
          due_at::text,
          submitted_at::text,
          approved_at::text,
          rejected_at::text,
          waived_at::text,
          rejection_note,
          waiver_note,
          progress_percent,
          created_from_trigger_key,
          source_metadata_json,
          last_reminded_at::text,
          escalated_at::text,
          created_by_user_id::text,
          updated_by_user_id::text,
          created_at::text,
          updated_at::text
        FROM checklist_instances
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [tenantId, instanceId]
    )
  ).rows[0];
  if (!instance) {
    throw new ApiError(404, "Checklist instance not found.");
  }
  return instance;
}

async function loadInstanceDetailInternal(client: PoolClient, tenantId: string, instanceId: string): Promise<ChecklistInstanceDetailInternal> {
  const instance = await loadInstanceRaw(client, tenantId, instanceId);
  const template = (
    await client.query<ChecklistTemplateRecord>(
      `
        SELECT
          id::text,
          tenant_id::text,
          code,
          name,
          description,
          department_type::text,
          scope_type::text,
          active_version_id::text,
          created_by_user_id::text,
          updated_by_user_id::text,
          archived_at::text,
          created_at::text,
          updated_at::text
        FROM checklist_templates
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [tenantId, instance.template_id]
    )
  ).rows[0];
  const versionRow = (
    await client.query<ChecklistTemplateVersionRecord>(
      `
        SELECT
          id::text,
          tenant_id::text,
          template_id::text,
          version_number,
          status::text,
          trigger_type::text,
          due_rule_json,
          approval_required,
          blocking_level::text,
          assignment_defaults_json,
          summary,
          created_by_user_id::text,
          published_by_user_id::text,
          published_at::text,
          created_at::text,
          updated_at::text
        FROM checklist_template_versions
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [tenantId, instance.template_version_id]
    )
  ).rows[0];
  const version = versionRow
    ? {
        ...versionRow,
        assignment_defaults_json: sanitizeChecklistAssignmentDefaults(versionRow.assignment_defaults_json)
      }
    : null;
  if (!template || !version) {
    throw new ApiError(404, "Checklist template version not found.");
  }

  const templateDetail = await loadTemplateDetail(client, tenantId, template.id);
  const sections = templateDetail.versions.find((candidate) => candidate.id === version.id)?.sections ?? [];
  const responses = await listRows<ChecklistResponseRecord>(
    client,
    `
      SELECT
        id::text,
        tenant_id::text,
        checklist_instance_id::text,
        checklist_item_id::text,
        checklist_section_id::text,
        response_json,
        is_complete,
        answered_by_user_id::text,
        answered_at::text,
        created_at::text,
        updated_at::text
      FROM checklist_responses
      WHERE tenant_id = $1
        AND checklist_instance_id = $2
      ORDER BY created_at
    `,
    [tenantId, instanceId]
  );
  const attachments = await listRows<ChecklistAttachmentRecord>(
    client,
    `
      SELECT
        id::text,
        tenant_id::text,
        checklist_instance_id::text,
        checklist_response_id::text,
        attachment_type,
        file_name,
        content_type,
        storage_key,
        object_url,
        uploaded_by_user_id::text,
        created_at::text
      FROM checklist_attachments
      WHERE tenant_id = $1
        AND checklist_instance_id = $2
      ORDER BY created_at DESC
    `,
    [tenantId, instanceId]
  );
  const approvals = await listRows<ChecklistApprovalRecord>(
    client,
    `
      SELECT
        id::text,
        tenant_id::text,
        checklist_instance_id::text,
        decision::text,
        actor_user_id::text,
        note,
        metadata_json,
        created_at::text
      FROM checklist_approvals
      WHERE tenant_id = $1
        AND checklist_instance_id = $2
      ORDER BY created_at DESC
    `,
    [tenantId, instanceId]
  );
  const comments = await listRows<ChecklistCommentRecord>(
    client,
    `
      SELECT
        id::text,
        tenant_id::text,
        checklist_instance_id::text,
        checklist_response_id::text,
        checklist_item_id::text,
        author_user_id::text,
        body,
        visibility::text,
        created_at::text,
        updated_at::text
      FROM checklist_comments
      WHERE tenant_id = $1
        AND checklist_instance_id = $2
      ORDER BY created_at DESC
    `,
    [tenantId, instanceId]
  );
  const target = await loadScopeContext(
    client,
    tenantId,
    instance.scope_type,
    resolveChecklistScopeId(instance.scope_type, instance)
  );
  const progress = buildChecklistProgressSummary(version, sections, responses, attachments);
  progress.approval_complete = !version.approval_required || approvals.some((approval) => approval.decision === "approved") || instance.status === "approved" || instance.status === "waived";
  progress.missing_approval = Boolean(version.approval_required && !progress.approval_complete && instance.status !== "waived");

  const responseByItemId = new Map(responses.map((response) => [response.checklist_item_id, response]));
  const responseByItemKey = new Map<string, ChecklistResponseRecord>();
  for (const section of sections) {
    for (const item of section.items) {
      const response = responseByItemId.get(item.id);
      if (response) {
        responseByItemKey.set(item.item_key, response);
      }
    }
  }
  const attachmentsByResponse = new Map<string, ChecklistAttachmentRecord[]>();
  for (const attachment of attachments) {
    if (!attachment.checklist_response_id) {
      continue;
    }
    const bucket = attachmentsByResponse.get(attachment.checklist_response_id) ?? [];
    bucket.push(attachment);
    attachmentsByResponse.set(attachment.checklist_response_id, bucket);
  }
  const commentsByResponse = new Map<string, ChecklistCommentRecord[]>();
  const commentsByItem = new Map<string, ChecklistCommentRecord[]>();
  for (const comment of comments) {
    if (comment.checklist_response_id) {
      const bucket = commentsByResponse.get(comment.checklist_response_id) ?? [];
      bucket.push(comment);
      commentsByResponse.set(comment.checklist_response_id, bucket);
    }
    if (comment.checklist_item_id) {
      const bucket = commentsByItem.get(comment.checklist_item_id) ?? [];
      bucket.push(comment);
      commentsByItem.set(comment.checklist_item_id, bucket);
    }
  }
  const runtimeSections: ChecklistRuntimeSectionView[] = sections.map((section) => ({
    ...section,
    items: section.items.map((item) => {
      const response = responseByItemId.get(item.id) ?? null;
      const visibility = evaluateItemVisibility(item, responseByItemId, responseByItemKey);
      const itemAttachments = response?.id ? attachmentsByResponse.get(response.id) ?? [] : [];
      return {
        ...item,
        response,
        attachments: itemAttachments,
        comments: [...(commentsByItem.get(item.id) ?? []), ...(response?.id ? commentsByResponse.get(response.id) ?? [] : [])],
        visible: visibility.visible,
        effective_required: visibility.effectiveRequired,
        disabled: visibility.disabled,
        missing_required: visibility.visible && visibility.effectiveRequired && !isResponseValuePresent(item.item_type, response?.response_json ?? null),
        missing_proof: visibility.visible && item.proof_required && itemAttachments.length === 0
      } satisfies ChecklistRuntimeItemView;
    })
  }));

  return {
    instance,
    template,
    version,
    target,
    progress,
    sections: runtimeSections,
    approvals,
    comments
  };
}

async function touchChecklistInstanceProgress(
  client: PoolClient,
  tenantId: string,
  instanceId: string,
  nextStatus?: ChecklistInstanceStatus | null,
  actorUserId?: string | null
) {
  const detail = await loadInstanceDetailInternal(client, tenantId, instanceId);
  const resolvedStatus =
    nextStatus ??
    (isChecklistTerminalStatus(detail.instance.status)
      ? detail.instance.status
      : detail.progress.completed_items > 0
        ? "in_progress"
        : "not_started");
  await client.query(
    `
      UPDATE checklist_instances
      SET progress_percent = $3,
          status = $4::checklist_instance_status_type,
          updated_by_user_id = $5,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [tenantId, instanceId, detail.progress.progress_percent, resolvedStatus, actorUserId ?? null]
  );
  return loadInstanceDetailInternal(client, tenantId, instanceId);
}

export async function listChecklistTemplates(client: PoolClient, auth: AuthUser, filters: ChecklistTemplateFilters = {}) {
  if (!canReadChecklistTemplates(auth)) {
    throw new ApiError(403, "Forbidden");
  }
  return loadTemplateSummaryRows(client, auth.tenantId, filters);
}

async function listTriggerTemplatesForScope(
  client: PoolClient,
  tenantId: string,
  scopeType: ChecklistScopeType,
  departmentType: JobDepartmentType | null,
  triggerTypes: ChecklistTriggerType[],
  templateCodes?: string[] | null
) {
  if (!triggerTypes.length) {
    return [] as TriggerTemplateRow[];
  }
  return listRows<TriggerTemplateRow>(
    client,
    `
      SELECT
        template.id::text AS template_id,
        template.code AS template_code,
        template.name AS template_name,
        version.id::text AS template_version_id,
        version.trigger_type::text AS trigger_type
      FROM checklist_templates template
      JOIN checklist_template_versions version
        ON version.id = template.active_version_id
       AND version.tenant_id = template.tenant_id
      WHERE template.tenant_id = $1
        AND template.archived_at IS NULL
        AND template.scope_type = $2::checklist_scope_type
        AND version.status = 'published'::checklist_template_version_status_type
        AND version.trigger_type = ANY($3::checklist_trigger_type[])
        AND ($4::job_department_type IS NULL OR template.department_type IS NULL OR template.department_type = $4::job_department_type)
        AND ($5::text[] IS NULL OR template.code = ANY($5::text[]))
      ORDER BY template.name ASC
    `,
    [tenantId, scopeType, triggerTypes, departmentType, templateCodes?.length ? [...new Set(templateCodes)] : null]
  );
}

export async function ensureTriggeredChecklistInstances(client: PoolClient, auth: AuthUser, input: EnsureTriggeredChecklistInstancesInput) {
  const triggerTypes = [...new Set(input.trigger_types)];
  if (!triggerTypes.length) {
    return [] as ChecklistInstanceDetail[];
  }
  const context = await loadScopeContext(client, auth.tenantId, input.scope_type, input.scope_id);
  const templates = await listTriggerTemplatesForScope(
    client,
    auth.tenantId,
    input.scope_type,
    context.department_type,
    triggerTypes,
    input.template_codes ?? null
  );
  const instances: ChecklistInstanceDetail[] = [];
  for (const template of templates) {
    const created = await instantiateChecklistFromTrigger(client, auth, {
      template_id: template.template_id,
      template_version_id: template.template_version_id,
      scope_type: input.scope_type,
      scope_id: input.scope_id,
      trigger_type: template.trigger_type,
      created_from_trigger_key: [normalizeText(input.created_from_trigger_key), template.template_code].filter(Boolean).join(":") || template.template_code,
      source_metadata_json: input.source_metadata_json ?? null
    });
    instances.push(created);
  }
  return instances;
}

export async function getChecklistTemplateDetail(client: PoolClient, auth: AuthUser, templateId: string) {
  if (!canReadChecklistTemplates(auth)) {
    throw new ApiError(403, "Forbidden");
  }
  return loadTemplateDetail(client, auth.tenantId, templateId);
}

export async function saveChecklistTemplateDraft(
  client: PoolClient,
  auth: AuthUser,
  templateId: string | null,
  input: ChecklistTemplateVersionInput
) {
  if (!canManageChecklistTemplates(auth)) {
    throw new ApiError(403, "Forbidden");
  }
  if (!normalizeText(input.name) || !normalizeText(input.code) || !input.scope_type) {
    throw new ApiError(400, "Template name, code, and scope are required.");
  }

  const normalizedCode = normalizeText(input.code)!.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  let resolvedTemplateId = templateId;

  if (!resolvedTemplateId) {
    const createdTemplate = await client.query<{ id: string }>(
      `
        INSERT INTO checklist_templates (
          tenant_id,
          code,
          name,
          description,
          department_type,
          scope_type,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES ($1,$2,$3,$4,$5::job_department_type,$6::checklist_scope_type,$7,$7)
        RETURNING id::text
      `,
      [auth.tenantId, normalizedCode, normalizeText(input.name), normalizeText(input.description), input.department_type ?? null, input.scope_type, auth.id]
    );
    resolvedTemplateId = createdTemplate.rows[0]?.id ?? null;
  } else {
    await client.query(
      `
        UPDATE checklist_templates
        SET code = $3,
            name = $4,
            description = $5,
            department_type = $6::job_department_type,
            scope_type = $7::checklist_scope_type,
            updated_by_user_id = $8,
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [auth.tenantId, resolvedTemplateId, normalizedCode, normalizeText(input.name), normalizeText(input.description), input.department_type ?? null, input.scope_type, auth.id]
    );
  }

  if (!resolvedTemplateId) {
    throw new ApiError(500, "We could not save that checklist template.");
  }

  const existingTemplateDetail = await loadTemplateDetail(client, auth.tenantId, resolvedTemplateId);
  const assignmentDefaults = sanitizeChecklistAssignmentDefaults(
    input.assignment_defaults_json ??
      existingTemplateDetail.versions.find((version) => version.status === "draft")?.assignment_defaults_json ??
      existingTemplateDetail.versions.find((version) => version.id === existingTemplateDetail.active_version_id)?.assignment_defaults_json ??
      existingTemplateDetail.versions[0]?.assignment_defaults_json ??
      {}
  );

  const existingDraft = (
    await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM checklist_template_versions
        WHERE tenant_id = $1
          AND template_id = $2
          AND status = 'draft'::checklist_template_version_status_type
        ORDER BY version_number DESC
        LIMIT 1
      `,
      [auth.tenantId, resolvedTemplateId]
    )
  ).rows[0];

  let versionId = existingDraft?.id ?? null;
  if (!versionId) {
    const createdVersion = await client.query<{ id: string }>(
      `
        INSERT INTO checklist_template_versions (
          tenant_id,
          template_id,
          version_number,
          status,
          trigger_type,
          due_rule_json,
          approval_required,
          blocking_level,
          assignment_defaults_json,
          summary,
          created_by_user_id
        )
        VALUES ($1,$2,$3,'draft'::checklist_template_version_status_type,$4::checklist_trigger_type,$5::jsonb,$6,$7::checklist_blocking_level_type,$8::jsonb,$9,$10)
        RETURNING id::text
      `,
      [
        auth.tenantId,
        resolvedTemplateId,
        await nextTemplateVersionNumber(client, auth.tenantId, resolvedTemplateId),
        input.trigger_type ?? "manual",
        JSON.stringify(input.due_rule_json ?? {}),
        input.approval_required ?? false,
        input.blocking_level ?? "none",
        JSON.stringify(assignmentDefaults),
        normalizeText(input.summary),
        auth.id
      ]
    );
    versionId = createdVersion.rows[0]?.id ?? null;
  }

  if (!versionId) {
    throw new ApiError(500, "We could not save that checklist template version.");
  }

  await client.query(
    `
      UPDATE checklist_template_versions
      SET trigger_type = $3::checklist_trigger_type,
          due_rule_json = $4::jsonb,
          approval_required = $5,
          blocking_level = $6::checklist_blocking_level_type,
          assignment_defaults_json = $7::jsonb,
          summary = $8,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      auth.tenantId,
      versionId,
      input.trigger_type ?? "manual",
      JSON.stringify(input.due_rule_json ?? {}),
      input.approval_required ?? false,
      input.blocking_level ?? "none",
      JSON.stringify(assignmentDefaults),
      normalizeText(input.summary)
    ]
  );

  await client.query(`DELETE FROM checklist_item_conditions WHERE tenant_id = $1 AND template_version_id = $2`, [auth.tenantId, versionId]);
  await client.query(`DELETE FROM checklist_items WHERE tenant_id = $1 AND template_version_id = $2`, [auth.tenantId, versionId]);
  await client.query(`DELETE FROM checklist_sections WHERE tenant_id = $1 AND template_version_id = $2`, [auth.tenantId, versionId]);

  for (let sectionIndex = 0; sectionIndex < input.sections.length; sectionIndex += 1) {
    const section = input.sections[sectionIndex];
    const sectionKey = normalizeText(section.section_key)?.toLowerCase().replace(/[^a-z0-9_]+/g, "_") ?? `section_${sectionIndex + 1}`;
    const createdSection = await client.query<{ id: string }>(
      `
        INSERT INTO checklist_sections (
          tenant_id,
          template_version_id,
          section_key,
          title,
          description,
          sort_order
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING id::text
      `,
      [auth.tenantId, versionId, sectionKey, normalizeText(section.title), normalizeText(section.description), section.sort_order ?? sectionIndex]
    );
    const sectionId = createdSection.rows[0]?.id;
    if (!sectionId) {
      continue;
    }
    for (let itemIndex = 0; itemIndex < section.items.length; itemIndex += 1) {
      const item = section.items[itemIndex];
      const itemKey = normalizeText(item.item_key)?.toLowerCase().replace(/[^a-z0-9_]+/g, "_") ?? `${sectionKey}_item_${itemIndex + 1}`;
      const createdItem = await client.query<{ id: string }>(
        `
          INSERT INTO checklist_items (
            tenant_id,
            template_version_id,
            section_id,
            item_key,
            label,
            help_text,
            item_type,
            required,
            proof_required,
            validation_json,
            options_json,
            sort_order
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7::checklist_item_type,$8,$9,$10::jsonb,$11::jsonb,$12)
          RETURNING id::text
        `,
        [
          auth.tenantId,
          versionId,
          sectionId,
          itemKey,
          normalizeText(item.label),
          normalizeText(item.help_text),
          item.item_type,
          item.required ?? false,
          item.proof_required ?? false,
          JSON.stringify(item.validation_json ?? {}),
          JSON.stringify(item.options_json ?? []),
          item.sort_order ?? itemIndex
        ]
      );
      const itemId = createdItem.rows[0]?.id;
      if (!itemId) {
        continue;
      }
      for (let conditionIndex = 0; conditionIndex < (item.conditions ?? []).length; conditionIndex += 1) {
        const condition = item.conditions?.[conditionIndex];
        if (!condition) {
          continue;
        }
        await client.query(
          `
            INSERT INTO checklist_item_conditions (
              tenant_id,
              template_version_id,
              checklist_item_id,
              condition_group_key,
              logic_operator,
              source_item_key,
              comparison_operator,
              expected_value_json,
              effect,
              sort_order
            )
            VALUES ($1,$2,$3,$4,$5::checklist_condition_logic_type,$6,$7,$8::jsonb,$9::checklist_condition_effect_type,$10)
          `,
          [
            auth.tenantId,
            versionId,
            itemId,
            normalizeText(condition.condition_group_key) ?? "default",
            condition.logic_operator ?? "AND",
            normalizeText(condition.source_item_key),
            normalizeText(condition.comparison_operator) ?? "equals",
            JSON.stringify(condition.expected_value_json ?? null),
            condition.effect,
            condition.sort_order ?? conditionIndex
          ]
        );
      }
    }
  }

  await writeChecklistAudit(client, auth, {
    action: "checklist.template_saved",
    entityType: "checklist_template",
    entityId: resolvedTemplateId,
    metadata: {
      template_version_id: versionId,
      code: normalizedCode,
      scope_type: input.scope_type
    }
  });

  return loadTemplateDetail(client, auth.tenantId, resolvedTemplateId);
}

export async function publishChecklistTemplateVersion(client: PoolClient, auth: AuthUser, templateId: string, versionId: string) {
  if (!canManageChecklistTemplates(auth)) {
    throw new ApiError(403, "Forbidden");
  }
  const detail = await loadTemplateDetail(client, auth.tenantId, templateId);
  const version = detail.versions.find((candidate) => candidate.id === versionId);
  if (!version) {
    throw new ApiError(404, "Checklist template version not found.");
  }
  if (!version.sections.length || version.sections.every((section) => section.items.length === 0)) {
    throw new ApiError(400, "A checklist version needs at least one section and one item before publish.");
  }

  await client.query(
    `
      UPDATE checklist_template_versions
      SET status = CASE WHEN id = $3 THEN 'published'::checklist_template_version_status_type ELSE 'archived'::checklist_template_version_status_type END,
          published_at = CASE WHEN id = $3 THEN now() ELSE published_at END,
          published_by_user_id = CASE WHEN id = $3 THEN $4 ELSE published_by_user_id END,
          updated_at = now()
      WHERE tenant_id = $1
        AND template_id = $2
        AND status <> 'archived'::checklist_template_version_status_type
    `,
    [auth.tenantId, templateId, versionId, auth.id]
  );
  await client.query(
    `
      UPDATE checklist_templates
      SET active_version_id = $3,
          updated_by_user_id = $4,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, templateId, versionId, auth.id]
  );
  await writeChecklistAudit(client, auth, {
    action: "checklist.template_published",
    entityType: "checklist_template_version",
    entityId: versionId,
    metadata: {
      template_id: templateId,
      version_number: version.version_number
    }
  });
  return loadTemplateDetail(client, auth.tenantId, templateId);
}

async function createChecklistInstanceInternal(
  client: PoolClient,
  auth: AuthUser | null,
  input: CreateChecklistInstanceInput,
  options: {
    dedupeExisting: boolean;
    creationMode: "manual" | "trigger";
  }
) {
  const tenantId = auth?.tenantId;
  if (!tenantId) {
    throw new ApiError(500, "Checklist trigger requires tenant context.");
  }
  const template = input.template_id
    ? (
        await client.query<ChecklistTemplateRecord>(
          `
            SELECT
              id::text,
              tenant_id::text,
              code,
              name,
              description,
              department_type::text,
              scope_type::text,
              active_version_id::text,
              created_by_user_id::text,
              updated_by_user_id::text,
              archived_at::text,
              created_at::text,
              updated_at::text
            FROM checklist_templates
            WHERE tenant_id = $1
              AND id = $2
            LIMIT 1
          `,
          [tenantId, input.template_id]
        )
      ).rows[0]
    : (
        await client.query<ChecklistTemplateRecord>(
          `
            SELECT
              id::text,
              tenant_id::text,
              code,
              name,
              description,
              department_type::text,
              scope_type::text,
              active_version_id::text,
              created_by_user_id::text,
              updated_by_user_id::text,
              archived_at::text,
              created_at::text,
              updated_at::text
            FROM checklist_templates
            WHERE tenant_id = $1
              AND code = $2
            LIMIT 1
          `,
          [tenantId, input.template_code]
        )
      ).rows[0];
  if (!template) {
    throw new ApiError(404, "Checklist template not found.");
  }
  const versionRow = (
    await client.query<ChecklistTemplateVersionRecord>(
      `
        SELECT
          id::text,
          tenant_id::text,
          template_id::text,
          version_number,
          status::text,
          trigger_type::text,
          due_rule_json,
          approval_required,
          blocking_level::text,
          assignment_defaults_json,
          summary,
          created_by_user_id::text,
          published_by_user_id::text,
          published_at::text,
          created_at::text,
          updated_at::text
        FROM checklist_template_versions
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [tenantId, input.template_version_id ?? template.active_version_id]
    )
  ).rows[0];
  const version = versionRow
    ? {
        ...versionRow,
        assignment_defaults_json: sanitizeChecklistAssignmentDefaults(versionRow.assignment_defaults_json)
      }
    : null;
  if (!version) {
    throw new ApiError(400, "This checklist template does not have a published version yet.");
  }
  const context = await loadScopeContext(client, tenantId, input.scope_type, input.scope_id);
  if (auth && !canManageChecklistScope(auth, context)) {
    await writeChecklistDeniedAudit(client, auth, {
      action: "checklist.instance_create_denied",
      entityType: input.scope_type,
      entityId: input.scope_id,
      metadata: {
        template_id: template.id,
        template_code: template.code
      }
    });
    throw new ApiError(403, "Forbidden");
  }
  const scopeLinks = buildChecklistScopeLinks(context, input.scope_type);
  const resolvedTriggerType = input.trigger_type ?? version.trigger_type;
  const assignmentDefaults = sanitizeChecklistAssignmentDefaults(version.assignment_defaults_json);
  const resolvedDueAt =
    normalizeTimestamp(input.due_at) ??
    (version.due_rule_json && Object.keys(version.due_rule_json).length
      ? applyDueRule(resolveChecklistDueRuleAnchor(context, resolvedTriggerType, version.due_rule_json) ?? new Date(), version.due_rule_json)
      : null);
  if (options.dedupeExisting) {
    const existing = (
      await client.query<{ id: string }>(
        `
          SELECT id::text
          FROM checklist_instances
          WHERE tenant_id = $1
            AND template_id = $2
            AND scope_type = $3::checklist_scope_type
            AND (
              ($3 = 'job'::checklist_scope_type AND job_id = $4::uuid) OR
              ($3 = 'shoot'::checklist_scope_type AND shoot_id = $4::uuid) OR
              ($3 = 'production_item'::checklist_scope_type AND production_item_id = $4::uuid) OR
              ($3 = 'location'::checklist_scope_type AND location_id = $4::uuid)
            )
            AND status NOT IN ('approved'::checklist_instance_status_type, 'waived'::checklist_instance_status_type)
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [tenantId, template.id, input.scope_type, input.scope_id]
      )
    ).rows[0];
    if (existing?.id) {
      return getChecklistInstanceDetail(client, auth ?? ({ tenantId, id: context.owner_user_ids[0] ?? "" } as AuthUser), existing.id);
    }
  }
  const resolvedOwnerUserId =
    normalizeText(input.owner_user_id) ??
    (await resolveChecklistTemplateAssignee(
      client,
      tenantId,
      context,
      assignmentDefaults.owner_assignment_role,
      context.owner_user_ids[0] ?? null
    ));
  const resolvedReviewerUserId =
    normalizeText(input.reviewer_user_id) ??
    (await resolveChecklistTemplateAssignee(
      client,
      tenantId,
      context,
      assignmentDefaults.reviewer_assignment_role,
      context.reviewer_user_ids[0] ?? null
    ));
  const resolvedApproverUserId =
    normalizeText(input.approver_user_id) ??
    (await resolveChecklistTemplateAssignee(
      client,
      tenantId,
      context,
      assignmentDefaults.approver_assignment_role,
      context.approver_user_ids[0] ?? null
    ));
  const created = await client.query<{ id: string }>(
    `
      INSERT INTO checklist_instances (
        tenant_id,
        template_id,
        template_version_id,
        scope_type,
        job_id,
        shoot_id,
        production_item_id,
        location_id,
        department_type,
        title,
        trigger_type,
        status,
        approval_required,
        blocking_level,
        owner_user_id,
        reviewer_user_id,
        approver_user_id,
        due_at,
        created_from_trigger_key,
        source_metadata_json,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES ($1,$2,$3,$4::checklist_scope_type,$5,$6,$7,$8,$9::job_department_type,$10,$11::checklist_trigger_type,'not_started'::checklist_instance_status_type,$12,$13::checklist_blocking_level_type,$14,$15,$16,$17,$18,$19::jsonb,$20,$20)
      RETURNING id::text
    `,
    [
      tenantId,
      template.id,
      version.id,
      input.scope_type,
      scopeLinks.jobId,
      scopeLinks.shootId,
      scopeLinks.productionItemId,
      scopeLinks.locationId,
      context.department_type,
      buildChecklistTitle(template, context, input.title),
      resolvedTriggerType,
      version.approval_required,
      version.blocking_level,
      resolvedOwnerUserId,
      resolvedReviewerUserId,
      resolvedApproverUserId,
      resolvedDueAt,
      normalizeText(input.created_from_trigger_key),
      JSON.stringify(input.source_metadata_json ?? {}),
      auth?.id ?? null
    ]
  );
  await writeChecklistAudit(client, auth ?? { tenantId, id: "" }, {
    action: "checklist.instance_created",
    entityType: "checklist_instance",
    entityId: created.rows[0]?.id ?? null,
    metadata: {
      template_id: template.id,
      template_code: template.code,
      creation_mode: options.creationMode,
      scope_type: input.scope_type,
      scope_id: input.scope_id
    }
  });
  return getChecklistInstanceDetail(client, auth ?? ({ tenantId, id: context.owner_user_ids[0] ?? "" } as AuthUser), created.rows[0]?.id ?? "");
}

export async function createChecklistInstanceManual(client: PoolClient, auth: AuthUser, input: CreateChecklistInstanceInput) {
  return createChecklistInstanceInternal(
    client,
    auth,
    {
      ...input,
      created_from_trigger_key: null
    },
    {
      dedupeExisting: false,
      creationMode: "manual"
    }
  );
}

export async function instantiateChecklistFromTrigger(client: PoolClient, auth: AuthUser | null, input: CreateChecklistInstanceInput) {
  return createChecklistInstanceInternal(client, auth, input, {
    dedupeExisting: true,
    creationMode: "trigger"
  });
}

export async function listChecklistInstancesForScope(client: PoolClient, auth: AuthUser, scopeType: ChecklistScopeType, scopeId: string) {
  const context = await loadScopeContext(client, auth.tenantId, scopeType, scopeId);
  const rows = await listRows<ChecklistInstanceRecord>(
    client,
    `
      SELECT
        id::text,
        tenant_id::text,
        template_id::text,
        template_version_id::text,
        scope_type::text,
        job_id::text,
        shoot_id::text,
        production_item_id::text,
        location_id::text,
        department_type::text,
        title,
        trigger_type::text,
        status::text,
        approval_required,
        blocking_level::text,
        owner_user_id::text,
        reviewer_user_id::text,
        approver_user_id::text,
        due_at::text,
        submitted_at::text,
        approved_at::text,
        rejected_at::text,
        waived_at::text,
        rejection_note,
        waiver_note,
        progress_percent,
        created_from_trigger_key,
        source_metadata_json,
        last_reminded_at::text,
        escalated_at::text,
        created_by_user_id::text,
        updated_by_user_id::text,
        created_at::text,
        updated_at::text
      FROM checklist_instances
      WHERE tenant_id = $1
        AND scope_type = $2::checklist_scope_type
        AND (
          ($2 = 'job'::checklist_scope_type AND job_id = $3::uuid)
          OR ($2 = 'shoot'::checklist_scope_type AND shoot_id = $3::uuid)
          OR ($2 = 'production_item'::checklist_scope_type AND production_item_id = $3::uuid)
          OR ($2 = 'location'::checklist_scope_type AND location_id = $3::uuid)
        )
      ORDER BY due_at ASC NULLS LAST, updated_at DESC
    `,
    [auth.tenantId, scopeType, scopeId]
  );
  let visibleRows = rows;
  try {
    await assertCanReadChecklistScope(client, auth, context);
  } catch {
    visibleRows = rows.filter((instance) => buildChecklistPrincipalIds(context, instance).includes(auth.id));
    if (!visibleRows.length) {
      throw new ApiError(403, "Forbidden");
    }
  }
  return Promise.all(visibleRows.map((row) => getChecklistInstanceDetail(client, auth, row.id)));
}

export async function listChecklistAttention(
  client: PoolClient,
  auth: AuthUser,
  query: ChecklistAttentionQuery = {}
): Promise<{ items: ChecklistAttentionItem[]; summary: ChecklistAttentionSummary }> {
  const limit = Math.max(1, Math.min(query.limit ?? 160, 250));
  const params: unknown[] = [auth.tenantId, limit];
  let sql = `
    SELECT instance.id::text AS id
    FROM checklist_instances instance
    WHERE instance.tenant_id = $1
      AND instance.status <> ALL($3::checklist_instance_status_type[])
  `;

  params.push(["approved", "waived"]);
  if (query.department_type) {
    params.push(query.department_type);
    sql += ` AND instance.department_type = $${params.length}::job_department_type`;
  }

  sql += `
    ORDER BY
      CASE
        WHEN instance.status = 'overdue'::checklist_instance_status_type THEN 0
        WHEN instance.status = 'rejected'::checklist_instance_status_type THEN 1
        WHEN instance.blocking_level = 'hard_block'::checklist_blocking_level_type THEN 2
        WHEN instance.blocking_level = 'soft_block'::checklist_blocking_level_type THEN 3
        ELSE 4
      END,
      instance.due_at ASC NULLS LAST,
      instance.updated_at DESC
    LIMIT $2
  `;

  const candidateRows = await listRows<ChecklistAttentionCandidate>(client, sql, params);
  if (!candidateRows.length) {
    return {
      items: [],
      summary: buildChecklistAttentionSummary([], auth)
    };
  }

  const items: ChecklistAttentionItem[] = [];
  for (const candidate of candidateRows) {
    let detail: ChecklistInstanceDetailInternal;
    try {
      detail = await loadInstanceDetailInternal(client, auth.tenantId, candidate.id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        continue;
      }
      throw error;
    }
    try {
      await assertCanReadChecklistScope(client, auth, detail.target, detail.instance);
    } catch {
      continue;
    }
    if (isChecklistAttentionClosed(detail.instance.status)) {
      continue;
    }
    const blockedTransition =
      detail.instance.blocking_level !== "none" &&
      (detail.progress.missing_item_ids.length > 0 || detail.progress.missing_proof_item_ids.length > 0 || detail.progress.missing_approval);
    const item: ChecklistAttentionItem = {
      instance_id: detail.instance.id,
      scope_type: detail.target.scope_type,
      scope_id: detail.target.scope_id,
      department_type: detail.target.department_type,
      job_id: detail.target.job_id,
      shoot_id: detail.target.shoot_id,
      production_item_id: detail.target.production_item_id,
      title: detail.instance.title,
      template_name: detail.template.name,
      target_title: detail.target.title,
      organization_name: detail.target.organization_name,
      owner_user_id: detail.instance.owner_user_id,
      owner_name: detail.target.owner_name,
      reviewer_user_id: detail.instance.reviewer_user_id,
      approver_user_id: detail.instance.approver_user_id,
      status: detail.instance.status,
      attention_state: buildChecklistAttentionState(detail),
      blocking_level: detail.instance.blocking_level,
      due_at: normalizeTimestamp(detail.instance.due_at),
      progress_percent: detail.progress.progress_percent,
      missing_required_count: detail.progress.missing_item_ids.length,
      missing_proof_count: detail.progress.missing_proof_item_ids.length,
      missing_approval: detail.progress.missing_approval,
      blocked_transition: blockedTransition,
      awaiting_approval: detail.progress.approval_required && detail.progress.missing_approval && detail.instance.status === "submitted",
      rejected: detail.instance.status === "rejected",
      overdue: detail.instance.status === "overdue"
    };
    if (!matchesChecklistAttentionQuery(item, auth, query)) {
      continue;
    }
    items.push(item);
  }

  const sorted = [...items].sort((left, right) => {
    const rankDelta = buildChecklistAttentionSortRank(left) - buildChecklistAttentionSortRank(right);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    const leftDue = left.due_at ? new Date(left.due_at).getTime() : Number.MAX_SAFE_INTEGER;
    const rightDue = right.due_at ? new Date(right.due_at).getTime() : Number.MAX_SAFE_INTEGER;
    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }
    return left.progress_percent - right.progress_percent;
  });

  return {
    items: sorted,
    summary: buildChecklistAttentionSummary(sorted, auth)
  };
}

export async function getChecklistInstanceDetail(client: PoolClient, auth: AuthUser, instanceId: string): Promise<ChecklistInstanceDetail> {
  const detail = await loadInstanceDetailInternal(client, auth.tenantId, instanceId);
  await assertCanReadChecklistScope(client, auth, detail.target, detail.instance);
  return {
    ...detail.instance,
    template: detail.template,
    template_version: detail.version,
    progress: detail.progress,
    sections: detail.sections.map((section): ChecklistRuntimeSectionView => ({
      ...section,
      items: section.items.map((item) => {
        const runtimeItem = item as ChecklistRuntimeItemView;
        return {
          ...runtimeItem,
          comments: filterChecklistCommentsForAuth(auth, detail.target, detail.instance, runtimeItem.comments)
        };
      })
    })),
    approvals: detail.approvals,
    comments: filterChecklistCommentsForAuth(auth, detail.target, detail.instance, detail.comments),
    target: detail.target
  };
}

export async function saveChecklistResponses(client: PoolClient, auth: AuthUser, instanceId: string, responses: ChecklistResponseInput[]) {
  const instance = await loadInstanceRaw(client, auth.tenantId, instanceId);
  const context = await loadScopeContext(client, auth.tenantId, instance.scope_type, resolveChecklistScopeId(instance.scope_type, instance));
  await assertCanReadChecklistScope(client, auth, context, instance);
  if (!canManageChecklistScope(auth, context, instance)) {
    throw new ApiError(403, "Forbidden");
  }
  const templateDetail = await loadTemplateDetail(client, auth.tenantId, instance.template_id);
  const version = templateDetail.versions.find((candidate) => candidate.id === instance.template_version_id);
  if (!version) {
    throw new ApiError(404, "Checklist template version not found.");
  }
  const itemMap = new Map<string, ChecklistItemBundle>();
  for (const section of version.sections) {
    for (const item of section.items) {
      itemMap.set(item.id, item);
    }
  }
  for (const response of responses) {
    const item = itemMap.get(response.checklist_item_id);
    if (!item) {
      throw new ApiError(400, "Checklist response referenced an unknown item.");
    }
    validateChecklistResponseValue(item, response.response_json);
    await client.query(
      `
        INSERT INTO checklist_responses (
          tenant_id,
          checklist_instance_id,
          checklist_item_id,
          checklist_section_id,
          response_json,
          is_complete,
          answered_by_user_id,
          answered_at
        )
        VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,now())
        ON CONFLICT (checklist_instance_id, checklist_item_id)
        DO UPDATE SET
          response_json = EXCLUDED.response_json,
          is_complete = EXCLUDED.is_complete,
          answered_by_user_id = EXCLUDED.answered_by_user_id,
          answered_at = now(),
          updated_at = now()
      `,
      [auth.tenantId, instanceId, item.id, item.section_id, JSON.stringify(response.response_json ?? null), isResponseValuePresent(item.item_type, response.response_json), auth.id]
    );
  }
  await writeChecklistAudit(client, auth, {
    action: "checklist.responses_saved",
    entityType: "checklist_instance",
    entityId: instanceId,
    metadata: { response_count: responses.length }
  });
  return touchChecklistInstanceProgress(client, auth.tenantId, instanceId, "in_progress", auth.id);
}

export async function addChecklistAttachment(client: PoolClient, auth: AuthUser, instanceId: string, input: ChecklistAttachmentInput) {
  const instance = await loadInstanceRaw(client, auth.tenantId, instanceId);
  const context = await loadScopeContext(client, auth.tenantId, instance.scope_type, resolveChecklistScopeId(instance.scope_type, instance));
  await assertCanReadChecklistScope(client, auth, context, instance);
  if (!canManageChecklistScope(auth, context, instance)) {
    throw new ApiError(403, "Forbidden");
  }
  assertManagedUploadStorageKey(auth.tenantId, input.storage_key);
  if (input.checklist_response_id) {
    await assertChecklistResponseBelongsToInstance(client, auth.tenantId, instanceId, input.checklist_response_id);
  }
  await client.query(
    `
      INSERT INTO checklist_attachments (
        tenant_id,
        checklist_instance_id,
        checklist_response_id,
        attachment_type,
        file_name,
        content_type,
        storage_key,
        object_url,
        uploaded_by_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `,
    [auth.tenantId, instanceId, input.checklist_response_id ?? null, normalizeText(input.attachment_type), normalizeText(input.file_name), normalizeText(input.content_type), input.storage_key, input.object_url, auth.id]
  );
  await writeChecklistAudit(client, auth, {
    action: "checklist.attachment_added",
    entityType: "checklist_instance",
    entityId: instanceId,
    metadata: { checklist_response_id: input.checklist_response_id ?? null, attachment_type: input.attachment_type }
  });
  return touchChecklistInstanceProgress(client, auth.tenantId, instanceId, instance.status === "not_started" ? "in_progress" : instance.status, auth.id);
}

export async function addChecklistComment(client: PoolClient, auth: AuthUser, instanceId: string, input: ChecklistCommentInput) {
  const instance = await loadInstanceRaw(client, auth.tenantId, instanceId);
  const context = await loadScopeContext(client, auth.tenantId, instance.scope_type, resolveChecklistScopeId(instance.scope_type, instance));
  await assertCanReadChecklistScope(client, auth, context, instance);
  if (!canWriteChecklistComment(auth, context, instance)) {
    await writeChecklistDeniedAudit(client, auth, {
      action: "checklist.comment_denied",
      entityType: "checklist_instance",
      entityId: instanceId,
      metadata: {
        visibility: input.visibility ?? "standard_internal",
        checklist_response_id: input.checklist_response_id ?? null,
        checklist_item_id: input.checklist_item_id ?? null,
        reason: "insufficient_comment_permissions"
      }
    });
    throw new ApiError(403, "Forbidden");
  }
  if (!normalizeText(input.body)) {
    throw new ApiError(400, "A comment is required.");
  }
  const visibility = input.visibility ?? "standard_internal";
  if (!visibilityAllowsComment(auth, context, instance, visibility)) {
    await writeChecklistDeniedAudit(client, auth, {
      action: "checklist.comment_denied",
      entityType: "checklist_instance",
      entityId: instanceId,
      metadata: {
        visibility,
        checklist_response_id: input.checklist_response_id ?? null,
        checklist_item_id: input.checklist_item_id ?? null
      }
    });
    throw new ApiError(403, "Forbidden");
  }
  const response = input.checklist_response_id
    ? await assertChecklistResponseBelongsToInstance(client, auth.tenantId, instanceId, input.checklist_response_id)
    : null;
  if (input.checklist_item_id) {
    await assertChecklistItemBelongsToInstance(client, auth.tenantId, instanceId, input.checklist_item_id);
    if (response?.checklist_item_id && response.checklist_item_id !== input.checklist_item_id) {
      throw new ApiError(400, "Checklist response and checklist item must refer to the same checklist entry.");
    }
  }
  await client.query(
    `
      INSERT INTO checklist_comments (
        tenant_id,
        checklist_instance_id,
        checklist_response_id,
        checklist_item_id,
        author_user_id,
        body,
        visibility
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::checklist_comment_visibility_type)
    `,
    [auth.tenantId, instanceId, input.checklist_response_id ?? null, input.checklist_item_id ?? null, auth.id, normalizeText(input.body), visibility]
  );
  await writeChecklistAudit(client, auth, {
    action: "checklist.comment_added",
    entityType: "checklist_instance",
    entityId: instanceId,
    metadata: { checklist_response_id: input.checklist_response_id ?? null, checklist_item_id: input.checklist_item_id ?? null }
  });
  return getChecklistInstanceDetail(client, auth, instanceId);
}

export async function validateChecklistCompleteness(client: PoolClient, auth: AuthUser, instanceId: string) {
  const detail = await getChecklistInstanceDetail(client, auth, instanceId);
  return detail.progress;
}

export async function submitChecklistInstance(client: PoolClient, auth: AuthUser, instanceId: string) {
  const instance = await loadInstanceRaw(client, auth.tenantId, instanceId);
  const context = await loadScopeContext(client, auth.tenantId, instance.scope_type, resolveChecklistScopeId(instance.scope_type, instance));
  await assertCanReadChecklistScope(client, auth, context, instance);
  if (!canManageChecklistScope(auth, context, instance)) {
    throw new ApiError(403, "Forbidden");
  }
  const detail = await loadInstanceDetailInternal(client, auth.tenantId, instanceId);
  if (detail.progress.missing_item_ids.length || detail.progress.missing_proof_item_ids.length) {
    throw new ApiError(400, "This checklist is still missing required fields or proof.", {
      missing_item_ids: detail.progress.missing_item_ids,
      missing_proof_item_ids: detail.progress.missing_proof_item_ids
    });
  }
  await client.query(
    `
      UPDATE checklist_instances
      SET status = 'submitted'::checklist_instance_status_type,
          submitted_at = now(),
          updated_by_user_id = $3,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, instanceId, auth.id]
  );
  const submissionApproval = (
    await client.query<{ id: string }>(
      `
        INSERT INTO checklist_approvals (
          tenant_id,
          checklist_instance_id,
          decision,
          actor_user_id,
          note
        )
        VALUES ($1,$2,'submitted'::checklist_approval_decision_type,$3,NULL)
        RETURNING id::text
      `,
      [auth.tenantId, instanceId, auth.id]
    )
  ).rows[0];
  await writeChecklistAudit(client, auth, {
    action: "checklist.submitted",
    entityType: "checklist_instance",
    entityId: instanceId
  });
  if (detail.version.approval_required || instance.approval_required) {
    await enqueueChecklistLifecycleNotification(client, auth, context, instance, {
      notificationType: "workflow.checklist.approval_requested",
      title: `${instance.title} submitted for approval`,
      body: `${instance.title} is ready for reviewer approval.`,
      recipientUserIds: [instance.reviewer_user_id ?? null, instance.approver_user_id ?? null].filter((value): value is string => Boolean(value)),
      groupKey: `checklist:${instanceId}:submitted:${submissionApproval?.id ?? "event"}`,
      category: "approval_needed",
      severity: "medium",
      actionOwnerUserId: instance.approver_user_id ?? instance.reviewer_user_id ?? null
    });
    await queueApprovalNeededOperationalAlert(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      approvalEntityType: "checklist_instance",
      approvalEntityId: instanceId,
      title: `${instance.title} submitted for approval`,
      summary: `${instance.title} is ready for reviewer approval.`,
      deepLink: buildChecklistReminderDeepLink(context),
      department: context.department_type ?? null,
      dueAt: normalizeTimestamp(instance.due_at)
    });
  }
  if (context.job_id) {
    await writeJobActivity(client, {
      tenantId: auth.tenantId,
      jobId: context.job_id,
      productionItemId: context.production_item_id,
      actorUserId: auth.id,
      eventType: "checklist_submitted",
      summary: `${instance.title} submitted`,
      metadata: { checklist_instance_id: instanceId },
      resourceType: "checklist_instance",
      resourceId: instanceId
    });
  }
  if (!detail.version.approval_required && !instance.approval_required) {
    await resolveChecklistWatchFlag(client, auth.tenantId, instanceId, null, auth.id);
  }
  return getChecklistInstanceDetail(client, auth, instanceId);
}

async function decideChecklistInstance(client: PoolClient, auth: AuthUser, instanceId: string, decision: Exclude<ChecklistApprovalDecision, "submitted">, note: string) {
  const normalizedNote = normalizeText(note);
  if (decision !== "approved" && !normalizedNote) {
    throw new ApiError(400, "A note is required.");
  }
  const instance = await loadInstanceRaw(client, auth.tenantId, instanceId);
  const context = await loadScopeContext(client, auth.tenantId, instance.scope_type, resolveChecklistScopeId(instance.scope_type, instance));
  await assertCanReadChecklistScope(client, auth, context, instance);
  if (decision === "waived") {
    if (!canWaiveChecklist(auth)) {
      await writeChecklistDeniedAudit(client, auth, {
        action: "checklist.waive_denied",
        entityType: "checklist_instance",
        entityId: instanceId
      });
      throw new ApiError(403, "Forbidden");
    }
  } else if (!canReviewChecklistInstance(auth, context, instance)) {
    await writeChecklistDeniedAudit(client, auth, {
      action: decision === "approved" ? "checklist.approve_denied" : "checklist.reject_denied",
      entityType: "checklist_instance",
      entityId: instanceId
    });
    throw new ApiError(403, "Forbidden");
  }
  if (decision === "approved" && !canApproveChecklistStatus(instance.status)) {
    throw new ApiError(409, "Only submitted or overdue checklists can be approved.");
  }
  if (decision === "rejected" && !canRejectChecklistStatus(instance.status)) {
    throw new ApiError(409, "Only submitted or overdue checklists can be rejected.");
  }
  const nextStatus: ChecklistInstanceStatus = decision === "approved" ? "approved" : decision === "waived" ? "waived" : "in_progress";
  await client.query(
    `
      UPDATE checklist_instances
      SET status = $3::checklist_instance_status_type,
          approved_at = CASE WHEN $4 = 'approved' THEN now() ELSE approved_at END,
          rejected_at = CASE WHEN $4 = 'rejected' THEN now() ELSE rejected_at END,
          waived_at = CASE WHEN $4 = 'waived' THEN now() ELSE waived_at END,
          rejection_note = CASE WHEN $4 = 'rejected' THEN $5 ELSE rejection_note END,
          waiver_note = CASE WHEN $4 = 'waived' THEN $5 ELSE waiver_note END,
          updated_by_user_id = $6,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, instanceId, nextStatus, decision, normalizedNote, auth.id]
  );
  const approvalEvent = (
    await client.query<{ id: string }>(
      `
        INSERT INTO checklist_approvals (
          tenant_id,
          checklist_instance_id,
          decision,
          actor_user_id,
          note
        )
        VALUES ($1,$2,$3::checklist_approval_decision_type,$4,$5)
        RETURNING id::text
      `,
      [auth.tenantId, instanceId, decision, auth.id, normalizedNote]
    )
  ).rows[0];
  await writeChecklistAudit(client, auth, {
    action: `checklist.${decision}`,
    entityType: "checklist_instance",
    entityId: instanceId,
    reasonComment: normalizedNote
  });
  if (decision === "rejected") {
    await enqueueChecklistLifecycleNotification(client, auth, context, instance, {
      notificationType: "workflow.checklist.rejected",
      title: `${instance.title} sent back for changes`,
      body: normalizedNote ? `${instance.title} was rejected. ${normalizedNote}` : `${instance.title} was rejected and returned for rework.`,
      recipientUserIds: [instance.owner_user_id ?? null].filter((value): value is string => Boolean(value)),
      groupKey: `checklist:${instanceId}:rejected:${approvalEvent?.id ?? "event"}`,
      severity: "high",
      actionOwnerUserId: instance.owner_user_id ?? null
    });
  } else {
    await enqueueChecklistLifecycleNotification(client, auth, context, instance, {
      notificationType: decision === "approved" ? "workflow.checklist.approved" : "workflow.checklist.waived",
      title: decision === "approved" ? `${instance.title} approved` : `${instance.title} waived`,
      body:
        decision === "approved"
          ? `${instance.title} was approved for the next workflow step.`
          : normalizedNote
            ? `${instance.title} was waived. ${normalizedNote}`
            : `${instance.title} was waived.`,
      recipientUserIds: [instance.owner_user_id ?? null].filter((value): value is string => Boolean(value)),
      groupKey: `checklist:${instanceId}:${decision}:${approvalEvent?.id ?? "event"}`,
      severity: "medium",
      actionOwnerUserId: instance.owner_user_id ?? null
    });
  }
  if (decision === "approved" || decision === "waived") {
    await resolveChecklistWatchFlag(client, auth.tenantId, instanceId, null, auth.id);
  }
  return getChecklistInstanceDetail(client, auth, instanceId);
}

export async function approveChecklistInstance(client: PoolClient, auth: AuthUser, instanceId: string, note: string) {
  return decideChecklistInstance(client, auth, instanceId, "approved", note);
}

export async function rejectChecklistInstance(client: PoolClient, auth: AuthUser, instanceId: string, note: string) {
  return decideChecklistInstance(client, auth, instanceId, "rejected", note);
}

export async function waiveChecklistInstance(client: PoolClient, auth: AuthUser, instanceId: string, note: string) {
  return decideChecklistInstance(client, auth, instanceId, "waived", note);
}

export async function validateChecklistTargetTransition(client: PoolClient, auth: AuthUser, input: ChecklistTransitionValidationInput): Promise<ChecklistTransitionValidation> {
  const scopeType: ChecklistScopeType =
    input.resource_type === "shoot" ? "shoot" : input.production_item_id ? "production_item" : input.job_id ? "job" : "location";
  const scopeId = input.shoot_id ?? input.production_item_id ?? input.job_id ?? input.location_id;
  if (!scopeId) {
    throw new ApiError(400, "A checklist transition target is required.");
  }
  const context = await loadScopeContext(client, auth.tenantId, scopeType, scopeId);
  await assertCanReadChecklistScope(client, auth, context);
  const rules = await listRows<WorkflowBlockRuleRecord>(
    client,
    `
      SELECT
        id::text,
        tenant_id::text,
        name,
        department_type::text,
        resource_type::text,
        from_stage,
        to_stage,
        required_template_code,
        required_instance_status::text,
        approval_required,
        blocking_level::text,
        allow_override,
        active_status,
        created_at::text,
        updated_at::text
      FROM workflow_block_rules
      WHERE tenant_id = $1
        AND resource_type = $2::workflow_block_resource_type
        AND active_status = true
        AND to_stage = $3
        AND (from_stage IS NULL OR from_stage = $4)
        AND (department_type IS NULL OR department_type = $5::job_department_type)
      ORDER BY created_at ASC
    `,
    [auth.tenantId, input.resource_type, input.to_stage, input.from_stage ?? null, input.department_type ?? context.department_type ?? null]
  );
  const issues: ChecklistTransitionBlockingIssue[] = [];
  for (const rule of rules) {
    const template = (
      await client.query<ChecklistTemplateRecord>(
        `
          SELECT
            id::text,
            tenant_id::text,
            code,
            name,
            description,
            department_type::text,
            scope_type::text,
            active_version_id::text,
            created_by_user_id::text,
            updated_by_user_id::text,
            archived_at::text,
            created_at::text,
            updated_at::text
          FROM checklist_templates
          WHERE tenant_id = $1
            AND code = $2
          LIMIT 1
        `,
        [auth.tenantId, rule.required_template_code]
      )
    ).rows[0];
    if (!template) {
      issues.push({
        template_code: rule.required_template_code,
        template_name: rule.required_template_code,
        instance_id: null,
        blocking_level: "hard_block",
        required_status: rule.required_instance_status,
        current_status: null,
        approval_required: rule.approval_required,
        progress_percent: 0,
        missing_item_ids: [],
        missing_proof_item_ids: [],
        missing_item_labels: [],
        missing_proof_item_labels: [],
        missing_approval: false,
        message: `Checklist configuration for ${rule.required_template_code} is missing and must be repaired before this transition can continue.`
      });
      continue;
    }
    const existing = (
      await client.query<{ id: string }>(
        `
          SELECT id::text
          FROM checklist_instances
          WHERE tenant_id = $1
            AND template_id = $2
            AND scope_type = $3::checklist_scope_type
            AND (
              ($3 = 'shoot'::checklist_scope_type AND shoot_id = $4::uuid) OR
              ($3 = 'production_item'::checklist_scope_type AND production_item_id = $4::uuid) OR
              ($3 = 'job'::checklist_scope_type AND job_id = $4::uuid) OR
              ($3 = 'location'::checklist_scope_type AND location_id = $4::uuid)
            )
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [auth.tenantId, template.id, template.scope_type, scopeId]
      )
    ).rows[0];
    const detail =
      existing?.id
        ? await loadInstanceDetailInternal(client, auth.tenantId, existing.id)
        : await instantiateChecklistFromTrigger(client, auth, {
            template_id: template.id,
            scope_type: template.scope_type,
            scope_id: scopeId,
            created_from_trigger_key: `${input.resource_type}:${input.from_stage ?? "none"}:${input.to_stage}`
          }).then((created) => loadInstanceDetailInternal(client, auth.tenantId, created.id));
    const missingApproval = (rule.approval_required || detail.version.approval_required) && !detail.progress.approval_complete;
    const meetsRequirement =
      statusSatisfiesRequirement(detail.instance.status, rule.required_instance_status) &&
      detail.progress.missing_item_ids.length === 0 &&
      detail.progress.missing_proof_item_ids.length === 0 &&
      !missingApproval;
    if (meetsRequirement) {
      continue;
    }
    const checklistItemLabelById = new Map(detail.sections.flatMap((section) => section.items).map((item) => [item.id, item.label]));
    issues.push({
      template_code: template.code,
      template_name: template.name,
      instance_id: detail.instance.id,
      blocking_level: rule.blocking_level,
      required_status: rule.required_instance_status,
      current_status: detail.instance.status,
      approval_required: rule.approval_required || detail.version.approval_required,
      progress_percent: detail.progress.progress_percent,
      missing_item_ids: detail.progress.missing_item_ids,
      missing_proof_item_ids: detail.progress.missing_proof_item_ids,
      missing_item_labels: detail.progress.missing_item_ids.map((itemId) => checklistItemLabelById.get(itemId) ?? itemId),
      missing_proof_item_labels: detail.progress.missing_proof_item_ids.map((itemId) => checklistItemLabelById.get(itemId) ?? itemId),
      missing_approval: missingApproval,
      message: `${template.name} is required before this step can move to ${input.to_stage}.`
    });
  }
  const hardBlocked = issues.some((issue) => issue.blocking_level === "hard_block");
  const softBlocked = issues.some((issue) => issue.blocking_level === "soft_block");
  if (softBlocked && !hardBlocked && input.allow_soft_override) {
    if (!canOverrideSoftBlock(auth)) {
      await writeChecklistDeniedAudit(client, auth, {
        action: "checklist.soft_block_override_denied",
        entityType: input.resource_type,
        entityId: scopeId,
        metadata: { issues, from_stage: input.from_stage ?? null, to_stage: input.to_stage }
      });
      throw new ApiError(403, "Forbidden");
    }
    if (!normalizeText(input.override_reason)) {
      throw new ApiError(400, "An override reason is required for soft checklist blocks.");
    }
    await writeChecklistAudit(client, auth, {
      action: "checklist.soft_block_override",
      entityType: input.resource_type,
      entityId: scopeId,
      metadata: { issues, from_stage: input.from_stage ?? null, to_stage: input.to_stage },
      reasonComment: normalizeText(input.override_reason)
    });
    return { allowed: true, hard_blocked: false, soft_blocked: true, issues };
  }
  return { allowed: issues.length === 0, hard_blocked: hardBlocked, soft_blocked: softBlocked, issues };
}

export function buildChecklistBlockError(validation: ChecklistTransitionValidation) {
  return new ApiError(
    validation.hard_blocked ? 409 : 428,
    validation.hard_blocked ? "This transition is blocked by required checklist work." : "This transition requires a checklist override.",
    { checklist_block_validation: validation }
  );
}

async function resolveChecklistReminderRecipients(
  client: PoolClient,
  tenantId: string,
  context: ScopeContext,
  instance: ChecklistInstanceRecord,
  escalationRole?: string | null,
  caches?: ChecklistReminderSweepCaches
) {
  const recipients = new Set<string>();
  for (const userId of [
    instance.owner_user_id,
    instance.reviewer_user_id,
    instance.approver_user_id,
    ...context.owner_user_ids,
    ...context.reviewer_user_ids,
    ...context.approver_user_ids
  ]) {
    if (userId) {
      recipients.add(userId);
    }
  }

  if (escalationRole) {
    const roleCodes =
      escalationRole === "department_manager"
        ? context.department_type === "schools"
          ? ["schools_manager"]
          : context.department_type === "sports"
            ? ["sports_manager"]
            : []
        : [escalationRole];
    if (roleCodes.length) {
      const cacheKey = buildChecklistEscalationRecipientCacheKey(tenantId, roleCodes, context.department_type ?? null);
      const cached = caches?.escalationRecipients.get(cacheKey);
      const scopedRoleUserIds =
        cached ??
        (
          await listRows<{ user_id: string }>(
            client,
            `
              SELECT DISTINCT assignment.user_id::text AS user_id
              FROM user_role_assignment assignment
              JOIN role ON role.id = assignment.role_id
              WHERE assignment.tenant_id = $1
                AND role.code = ANY($2::text[])
                AND (assignment.starts_at IS NULL OR assignment.starts_at <= now())
                AND (assignment.ends_at IS NULL OR assignment.ends_at >= now())
                AND (
                  assignment.scope_type = 'global'::policy_scope_type
                  OR (
                    assignment.scope_type = 'department'::policy_scope_type
                    AND $3::text IS NOT NULL
                    AND assignment.scope_value = $3
                  )
              )
            `,
            [tenantId, roleCodes, context.department_type ?? null]
          )
        ).map((row) => row.user_id);
      if (caches && !cached) {
        caches.escalationRecipients.set(cacheKey, scopedRoleUserIds);
      }
      for (const userId of scopedRoleUserIds) {
        recipients.add(userId);
      }
    }
  }

  return [...recipients];
}

function buildChecklistReminderDeepLink(context: ScopeContext) {
  if (context.production_item_id) {
    return `#/production?item=${context.production_item_id}`;
  }
  if (context.job_id) {
    return `#/jobs/${context.job_id}`;
  }
  if (context.shoot_id) {
    return `#/sports/shoots/${context.shoot_id}`;
  }
  if (context.location_id) {
    return `#/locations/${context.location_id}`;
  }
  return "#/dashboard";
}

async function enqueueChecklistReminderNotifications(
  client: PoolClient,
  auth: ChecklistSystemActor | null,
  context: ScopeContext,
  instance: ChecklistInstanceRecord,
  templateCode: string,
  templateName: string,
  reminderType: ChecklistReminderType,
  deliveryChannel: ChecklistReminderRuleRecord["delivery_channel"],
  escalationRole?: string | null,
  caches?: ChecklistReminderSweepCaches
) {
  const recipientUserIds = await resolveChecklistReminderRecipients(client, context.tenant_id, context, instance, escalationRole, caches);
  if (!recipientUserIds.length) {
    return false;
  }

  const severity = deriveChecklistReminderSeverity(instance, reminderType);
  const notificationSeverity = mapChecklistSeverityToNotificationSeverity(severity);
  const dueLabel = instance.due_at ? new Date(normalizeTimestamp(instance.due_at) ?? instance.due_at).toLocaleString("en-US", { timeZone: "America/Chicago" }) : null;
  const title =
    reminderType === "escalation"
      ? `${templateName} escalated`
      : reminderType === "overdue" || instance.status === "overdue"
        ? `${templateName} overdue`
        : reminderType === "at_due"
          ? `${templateName} due now`
          : `${templateName} due soon`;
  const bodyParts = [
    `${instance.title} requires checklist attention.`,
    dueLabel ? `Due ${dueLabel}.` : null,
    escalationRole ? `Escalated to ${escalationRole}.` : null
  ].filter((value): value is string => Boolean(value));

  await queueNotificationDispatch(client, {
    tenantId: context.tenant_id,
    actorUserId: auth?.id ?? null,
    recipientUserIds,
    notificationType: `workflow.checklist.${reminderType}`,
    title,
    body: bodyParts.join(" "),
    priority: mapChecklistSeverityToNotificationPriority(severity),
    deepLink: buildChecklistReminderDeepLink(context),
    shootId: context.shoot_id,
    metadata: {
      checklist_instance_id: instance.id,
      checklist_template_code: templateCode,
      checklist_template_name: templateName,
      checklist_reminder_type: reminderType,
      checklist_scope_type: context.scope_type,
      checklist_scope_id: context.scope_id,
      production_item_id: context.production_item_id,
      job_id: context.job_id
    },
    category: instance.approval_required ? "approval_needed" : "follow_up_task",
    severity: notificationSeverity,
    actionRequired: true,
    actionOwnerUserId: instance.owner_user_id ?? context.owner_user_ids[0] ?? null,
    dueAt: normalizeTimestamp(instance.due_at),
    requiresAcknowledgement: reminderType === "escalation" || reminderType === "overdue",
    allowSnooze: reminderType !== "escalation",
    digestEligible: false,
    sourceEvent: `checklist.reminder_${reminderType}`,
    groupKey: `checklist:${instance.id}:${reminderType}`,
    channels: [deliveryChannel]
  });
  return true;
}

export async function sweepChecklistReminders(client: PoolClient, auth: ChecklistSystemActor | null, options: { limit?: number } = {}): Promise<ChecklistReminderSweepResult> {
  const tenantId = auth?.tenantId;
  if (!tenantId) {
    throw new ApiError(500, "Checklist reminders require tenant context.");
  }
  const caches: ChecklistReminderSweepCaches = {
    scopeContexts: new Map(),
    reminderRules: new Map(),
    escalationRecipients: new Map()
  };
  const candidates = await listRows<ReminderCandidate>(
    client,
    `
      SELECT
        instance.id::text,
        instance.tenant_id::text,
        instance.template_id::text,
        instance.template_version_id::text,
        instance.scope_type::text,
        instance.job_id::text,
        instance.shoot_id::text,
        instance.production_item_id::text,
        instance.location_id::text,
        instance.department_type::text,
        instance.title,
        instance.trigger_type::text,
        CASE WHEN instance.status = 'submitted'::checklist_instance_status_type AND instance.due_at IS NOT NULL AND instance.due_at < now()
          THEN 'overdue'::checklist_instance_status_type
          ELSE instance.status
        END::text AS status,
        instance.approval_required,
        instance.blocking_level::text,
        instance.owner_user_id::text,
        instance.reviewer_user_id::text,
        instance.approver_user_id::text,
        instance.due_at::text,
        instance.submitted_at::text,
        instance.approved_at::text,
        instance.rejected_at::text,
        instance.waived_at::text,
        instance.rejection_note,
        instance.waiver_note,
        instance.progress_percent,
        instance.created_from_trigger_key,
        instance.source_metadata_json,
        instance.last_reminded_at::text,
        instance.escalated_at::text,
        instance.created_by_user_id::text,
        instance.updated_by_user_id::text,
        instance.created_at::text,
        instance.updated_at::text,
        template.code AS template_code,
        template.name AS template_name
        FROM checklist_instances instance
        JOIN checklist_templates template ON template.id = instance.template_id
        WHERE instance.tenant_id = $1
          AND instance.status IN ('not_started'::checklist_instance_status_type,'in_progress'::checklist_instance_status_type,'submitted'::checklist_instance_status_type,'overdue'::checklist_instance_status_type)
          AND instance.due_at IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM checklist_reminder_rules rule
            WHERE rule.tenant_id = instance.tenant_id
              AND rule.active_status = true
              AND (rule.template_id IS NULL OR rule.template_id = instance.template_id)
              AND (rule.template_version_id IS NULL OR rule.template_version_id = instance.template_version_id)
              AND (rule.department_type IS NULL OR rule.department_type = instance.department_type)
              AND (rule.scope_type IS NULL OR rule.scope_type = instance.scope_type)
              AND (
                (
                  rule.reminder_type = 'before_due'::checklist_reminder_type
                  AND now() >= instance.due_at - make_interval(mins => rule.offset_minutes)
                  AND now() < instance.due_at
                  AND (
                    instance.last_reminded_at IS NULL
                    OR instance.last_reminded_at < instance.due_at - make_interval(mins => rule.offset_minutes)
                  )
                )
                OR (
                  rule.reminder_type = 'at_due'::checklist_reminder_type
                  AND now() >= instance.due_at
                  AND now() < instance.due_at + make_interval(mins => GREATEST(rule.offset_minutes, 60))
                  AND (
                    instance.last_reminded_at IS NULL
                    OR instance.last_reminded_at < instance.due_at
                  )
                )
                OR (
                  rule.reminder_type = 'overdue'::checklist_reminder_type
                  AND now() >= instance.due_at + make_interval(mins => rule.offset_minutes)
                  AND (
                    instance.last_reminded_at IS NULL
                    OR instance.last_reminded_at < instance.due_at + make_interval(mins => rule.offset_minutes)
                  )
                )
                OR (
                  rule.reminder_type = 'escalation'::checklist_reminder_type
                  AND now() >= instance.due_at + make_interval(mins => rule.offset_minutes)
                  AND (
                    instance.escalated_at IS NULL
                    OR instance.escalated_at < instance.due_at + make_interval(mins => rule.offset_minutes)
                  )
                )
              )
          )
        ORDER BY
          CASE
            WHEN instance.due_at <= now() AND instance.last_reminded_at IS NULL THEN 0
            WHEN instance.due_at > now() AND instance.last_reminded_at IS NULL THEN 1
            WHEN instance.due_at <= now() AND instance.escalated_at IS NULL THEN 2
            ELSE 3
          END ASC,
          CASE WHEN instance.due_at <= now() THEN instance.due_at END DESC NULLS LAST,
          CASE WHEN instance.due_at > now() THEN instance.due_at END ASC NULLS LAST,
          coalesce(instance.last_reminded_at, instance.updated_at) ASC NULLS LAST,
          instance.updated_at DESC
        LIMIT $2
      `,
      [tenantId, options.limit ?? 250]
    );
  let alertCount = 0;
  let watchFlagCount = 0;
  for (const candidate of candidates) {
    const scopeId = resolveChecklistScopeId(candidate.scope_type, candidate);
    const scopeCacheKey = buildChecklistReminderScopeCacheKey(candidate.scope_type, scopeId);
    let context: ScopeContext;
    const cachedContext = caches.scopeContexts.get(scopeCacheKey);
    if (cachedContext) {
      context = cachedContext;
    } else {
      try {
        context = await loadScopeContext(client, tenantId, candidate.scope_type, scopeId);
        caches.scopeContexts.set(scopeCacheKey, context);
      } catch (error) {
        // A stale checklist instance should not stop the entire reminder sweep.
        if (error instanceof ApiError && error.status === 404) {
          continue;
        }
        throw error;
      }
    }
    const reminderRuleCacheKey = buildChecklistReminderRuleCacheKey(candidate);
    const rules =
      caches.reminderRules.get(reminderRuleCacheKey) ??
      (await listRows<ChecklistReminderRuleRecord>(
        client,
        `
          SELECT
            id::text,
            tenant_id::text,
            template_id::text,
            template_version_id::text,
            department_type::text,
            scope_type::text,
            reminder_type::text,
            offset_minutes,
            delivery_channel::text,
            escalation_role,
            active_status,
            created_at::text,
            updated_at::text
          FROM checklist_reminder_rules
          WHERE tenant_id = $1
            AND active_status = true
            AND (template_id IS NULL OR template_id = $2)
            AND (template_version_id IS NULL OR template_version_id = $3)
            AND (department_type IS NULL OR department_type = $4::job_department_type)
            AND (scope_type IS NULL OR scope_type = $5::checklist_scope_type)
        `,
        [tenantId, candidate.template_id, candidate.template_version_id, candidate.department_type ?? null, candidate.scope_type]
      ));
    if (!caches.reminderRules.has(reminderRuleCacheKey)) {
      caches.reminderRules.set(reminderRuleCacheKey, rules);
    }
    const dueAt = normalizeTimestamp(candidate.due_at);
    const dueMs = dueAt ? new Date(dueAt).getTime() : null;
    const now = Date.now();
    const overdue = Boolean(dueMs != null && dueMs <= now && !isChecklistTerminalStatus(candidate.status));
    let instanceStatus = candidate.status;
    if (overdue && candidate.status !== "overdue") {
      await client.query(
        `
          UPDATE checklist_instances
          SET status = 'overdue'::checklist_instance_status_type,
              updated_at = now()
          WHERE tenant_id = $1
            AND id = $2
            AND status <> 'approved'::checklist_instance_status_type
            AND status <> 'waived'::checklist_instance_status_type
        `,
        [tenantId, candidate.id]
      );
      instanceStatus = "overdue";
    }
    for (const rule of rules) {
      let shouldTrigger = false;
      if (rule.reminder_type === "before_due" && dueMs != null) {
        shouldTrigger = now >= dueMs - rule.offset_minutes * 60_000 && now < dueMs;
      } else if (rule.reminder_type === "at_due" && dueMs != null) {
        shouldTrigger = now >= dueMs && now < dueMs + Math.max(rule.offset_minutes, 60) * 60_000;
      } else if (rule.reminder_type === "overdue" && dueMs != null) {
        shouldTrigger = overdue && now >= dueMs + rule.offset_minutes * 60_000;
      } else if (rule.reminder_type === "escalation" && dueMs != null) {
        shouldTrigger = overdue && now >= dueMs + rule.offset_minutes * 60_000;
      }
      if (!shouldTrigger) {
        continue;
      }
      if (dueMs != null && reminderAlreadyTriggered(candidate, rule.reminder_type, reminderTriggerFloorMs(rule.reminder_type, dueMs, rule.offset_minutes))) {
        continue;
      }
      if (rule.reminder_type === "overdue") {
        await resolveChecklistWatchFlag(client, tenantId, candidate.id, "before_due", auth?.id ?? null);
        await resolveChecklistWatchFlag(client, tenantId, candidate.id, "at_due", auth?.id ?? null);
      }
      if (rule.reminder_type === "escalation") {
        await resolveChecklistWatchFlag(client, tenantId, candidate.id, "before_due", auth?.id ?? null);
        await resolveChecklistWatchFlag(client, tenantId, candidate.id, "at_due", auth?.id ?? null);
        await resolveChecklistWatchFlag(client, tenantId, candidate.id, "overdue", auth?.id ?? null);
      }
      const watchFlagId = await createChecklistWatchFlag(
        client,
        auth,
        context,
        { ...candidate, status: instanceStatus },
        candidate.template_code,
        candidate.template_name,
        rule.reminder_type,
        rule.escalation_role
      );
      if (watchFlagId) {
        watchFlagCount += 1;
      }
      const notificationQueued = await enqueueChecklistReminderNotifications(
        client,
        auth,
        context,
        { ...candidate, status: instanceStatus },
        candidate.template_code,
        candidate.template_name,
        rule.reminder_type,
        rule.delivery_channel,
        rule.escalation_role,
        caches
      );
      await client.query(
        `
          UPDATE checklist_instances
          SET last_reminded_at = now(),
              escalated_at = CASE WHEN $3 = 'escalation'::checklist_reminder_type THEN now() ELSE escalated_at END,
              updated_at = now()
          WHERE tenant_id = $1
            AND id = $2
        `,
        [tenantId, candidate.id, rule.reminder_type]
      );
      await createAuditLog(client, {
        tenantId,
        actorUserId: auth?.id ?? null,
        action: `checklist.reminder_${rule.reminder_type}`,
        entityType: "checklist_instance",
        entityId: candidate.id,
        metadata: {
          checklist_template_code: candidate.template_code,
          delivery_channel: rule.delivery_channel,
          escalation_role: rule.escalation_role,
          scope_type: context.scope_type,
          scope_id: context.scope_id
        },
        sourceSurface: "workflow_checklist_engine"
      });
      alertCount += notificationQueued ? 1 : 0;
    }
  }
  return {
    scanned_instance_count: candidates.length,
    alert_count: alertCount,
    watch_flag_count: watchFlagCount
  };
}
