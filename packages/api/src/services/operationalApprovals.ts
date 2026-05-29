import type { PoolClient } from "pg";
import { hasAuthorityTier } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";
import type { AuthUser, AuthorityTier, JobFunctionProfile } from "../types/auth.js";
import { createAuditLog } from "./audit.js";
import { writeAuditEvent } from "./diagnostics/auditEventService.js";
import { applyProactiveCommunicationRule } from "./proactiveCommunicationRules.js";
import { hasLeadershipApprovalAuthority, hasManagerApprovalAuthority } from "./approvalRights.js";
import {
  canAssignStaff,
  canChangeStatuses,
  canEditRecords,
  canViewRecords,
  type OperationalPermissionContext
} from "./policy/operationalAuthorization.js";
import type {
  CreateOperationalApprovalRequestInput,
  OperationalApprovalCandidateApprover,
  OperationalApprovalDecisionPayload,
  OperationalApprovalDetail,
  OperationalApprovalEventRecord,
  OperationalApprovalExecuteResult,
  OperationalApprovalRequestSummary,
  OperationalApprovalRequestType,
  OperationalApprovalRoleGroup,
  OperationalApprovalSourceEntityType,
  OperationalApprovalSourceSummary,
  OperationalApprovalStatus,
  OperationalApprovalStepRecord,
  OperationalApprovalWorkspace
} from "../types/operationalApprovals.js";
import type { UrgentWatchCandidate } from "../types/urgentWatch.js";

type ApprovalRequestRow = {
  id: string;
  request_type: OperationalApprovalRequestType;
  status: OperationalApprovalStatus;
  source_module: string;
  source_entity_type: string;
  source_entity_id: string;
  source_entity_label: string | null;
  requester_department: string | null;
  blocking: boolean;
  requested_action_code: string;
  request_title: string;
  request_summary: string | null;
  reason: string;
  severity: string;
  requested_by_user_id: string;
  requested_by_name: string | null;
  approval_chain: OperationalApprovalRoleGroup[];
  current_state: Record<string, unknown>;
  requested_state: Record<string, unknown>;
  metadata: Record<string, unknown>;
  clarification_note: string | null;
  decision_note: string | null;
  sla_due_at: string | null;
  overdue_at: string | null;
  escalated_at: string | null;
  escalation_level: number;
  decided_at: string | null;
  executed_at: string | null;
  created_at: string;
  updated_at: string;
  current_approver_user_id: string | null;
  current_approver_name: string | null;
  current_approver_role_group: OperationalApprovalRoleGroup | null;
};

type ApprovalStepRow = {
  id: string;
  step_order: number;
  approver_role_group: OperationalApprovalRoleGroup;
  approver_department: string | null;
  approver_user_id: string | null;
  approver_name: string | null;
  status: string;
  acted_by_user_id: string | null;
  acted_by_name: string | null;
  delegated_from_user_id: string | null;
  delegated_from_name: string | null;
  note: string | null;
  due_at: string | null;
  acted_at: string | null;
  created_at: string;
  updated_at: string;
};

type ApprovalEventRow = {
  id: string;
  approval_step_id: string | null;
  event_type: string;
  summary: string;
  note: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type ApproverUserRow = {
  id: string;
  full_name: string;
  department: string;
  authority_tier: AuthorityTier | null;
  job_function_profiles: JobFunctionProfile[];
};

type ApprovalScope = "all" | "department" | "own";

type ApprovalTemplate = {
  roleGroups: OperationalApprovalRoleGroup[];
  blocking: boolean;
  severity: string;
  slaHours: number;
};

type EnsureApprovalInput = {
  requestType: OperationalApprovalRequestType;
  sourceModule: string;
  sourceEntityType: string;
  sourceEntityId: string;
  sourceEntityLabel?: string | null;
  requesterDepartment?: string | null;
  requestedActionCode: string;
  requestTitle: string;
  requestSummary?: string | null;
  reason: string;
  blocking?: boolean;
  severity?: string;
  dedupeKey?: string | null;
  currentState?: Record<string, unknown>;
  requestedState?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

type ApprovalSourceContext = {
  sourceEntityType: OperationalApprovalSourceEntityType;
  sourceEntityId: string;
  sourceEntityLabel: string;
  requesterDepartment: string | null;
  permissionContext: OperationalPermissionContext;
};

export function getOperationalApprovalScope(auth: AuthUser): ApprovalScope | null {
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    return "all";
  }
  if (
    hasManagerApprovalAuthority(auth) ||
    auth.department === "production" ||
    auth.permissions.includes("schedule.manage") ||
    auth.permissions.includes("schedule.publish") ||
    auth.permissions.includes("trade.approve") ||
    auth.permissions.includes("pto.approve")
  ) {
    return "department";
  }
  return auth.status === "active" ? "own" : null;
}

export function canViewOperationalApprovals(auth: AuthUser) {
  return getOperationalApprovalScope(auth) !== null;
}

export async function listOperationalApprovalWorkspace(client: PoolClient, auth: AuthUser): Promise<OperationalApprovalWorkspace> {
  assertCanViewOperationalApprovals(auth);

  const rows = await listVisibleApprovalRows(client, auth, 250);
  const summaries = rows.map((row) => mapApprovalSummary(row, auth));
  return {
    generated_at: new Date().toISOString(),
    summary: {
      awaiting_my_decision: summaries.filter((item) => item.can_decide && item.status === "pending").length,
      submitted_by_me: summaries.filter((item) => item.requested_by_user_id === auth.id).length,
      overdue: summaries.filter((item) => item.overdue).length,
      escalated: summaries.filter((item) => item.escalated).length,
      pending_blocking: summaries.filter((item) => item.blocking && item.status === "pending").length,
      needs_clarification: summaries.filter((item) => item.status === "needs_clarification").length
    },
    awaiting_my_decision: summaries.filter((item) => item.can_decide && item.status === "pending").slice(0, 50),
    submitted_by_me: summaries.filter((item) => item.requested_by_user_id === auth.id).slice(0, 50),
    overdue: summaries.filter((item) => item.overdue).slice(0, 50),
    escalated: summaries.filter((item) => item.escalated).slice(0, 50)
  };
}

export async function getOperationalApprovalDetail(client: PoolClient, auth: AuthUser, requestId: string): Promise<OperationalApprovalDetail> {
  assertCanViewOperationalApprovals(auth);
  const requestRow = await loadApprovalRow(client, auth.tenantId, requestId);
  if (!requestRow) {
    throw new ApiError(404, "Approval request not found");
  }
  assertApprovalVisibleToUser(requestRow, auth);

  const [steps, events, candidateApprovers] = await Promise.all([
    loadApprovalSteps(client, auth.tenantId, requestId),
    loadApprovalEvents(client, auth.tenantId, requestId),
    requestRow.current_approver_role_group
      ? listCandidateApproversForRoleGroup(client, auth.tenantId, requestRow.current_approver_role_group, requestRow.requester_department, requestRow.requested_by_user_id)
      : Promise.resolve([])
  ]);

  return {
    request: mapApprovalSummary(requestRow, auth),
    steps: steps.map(mapApprovalStep),
    events: events.map(mapApprovalEvent),
    candidate_approvers: candidateApprovers,
    current_state: requestRow.current_state,
    requested_state: requestRow.requested_state,
    metadata: requestRow.metadata
  };
}

export async function applyOperationalApprovalDecision(
  client: PoolClient,
  auth: AuthUser,
  requestId: string,
  input: OperationalApprovalDecisionPayload
): Promise<OperationalApprovalDetail> {
  assertCanViewOperationalApprovals(auth);
  await refreshOperationalApprovalEscalations(client, auth.tenantId);

  const requestRow = await loadApprovalRow(client, auth.tenantId, requestId);
  if (!requestRow) {
    throw new ApiError(404, "Approval request not found");
  }
  assertApprovalVisibleToUser(requestRow, auth);

  const steps = await loadApprovalSteps(client, auth.tenantId, requestId);
  const pendingStep = steps.find((step) => step.status === "pending") ?? null;

  switch (input.action) {
    case "approve":
      if (!pendingStep) {
        throw new ApiError(409, "This approval request does not have an active decision step.");
      }
      assertCanActOnPendingStep(auth, requestRow, pendingStep);
      await approveApprovalStep(client, auth, requestRow, pendingStep, input.note ?? null, steps);
      break;
    case "reject":
      if (!pendingStep) {
        throw new ApiError(409, "This approval request does not have an active decision step.");
      }
      assertCanActOnPendingStep(auth, requestRow, pendingStep);
      await rejectApprovalRequest(client, auth, requestRow, pendingStep, input.note ?? null);
      break;
    case "send_back":
      if (!pendingStep) {
        throw new ApiError(409, "This approval request does not have an active decision step.");
      }
      assertCanActOnPendingStep(auth, requestRow, pendingStep);
      const clarificationNote = normalizeNullableText(input.note);
      if (!clarificationNote) {
        throw new ApiError(400, "Send-back requires a clarification note.");
      }
      await sendApprovalBack(client, auth, requestRow, pendingStep, clarificationNote);
      break;
    case "delegate":
      if (!pendingStep) {
        throw new ApiError(409, "This approval request does not have an active decision step.");
      }
      assertCanActOnPendingStep(auth, requestRow, pendingStep);
      if (!input.delegate_to_user_id) {
        throw new ApiError(400, "Select a delegate before reassigning this approval.");
      }
      await delegateApprovalStep(client, auth, requestRow, pendingStep, input.delegate_to_user_id, input.note ?? null);
      break;
    case "cancel":
      if (requestRow.requested_by_user_id !== auth.id && !hasLeadershipApprovalAuthority(auth)) {
        throw new ApiError(403, "Only the requester or leadership can cancel this approval request.");
      }
      await cancelApprovalRequest(client, auth, requestRow, normalizeNullableText(input.note));
      break;
    case "resubmit":
      if (requestRow.status !== "needs_clarification") {
        throw new ApiError(409, "Only send-back approvals can be resubmitted.");
      }
      if (requestRow.requested_by_user_id !== auth.id && !hasLeadershipApprovalAuthority(auth)) {
        throw new ApiError(403, "Only the requester or leadership can resubmit this approval request.");
      }
      await resubmitApprovalRequest(client, auth, requestRow, normalizeNullableText(input.note), steps);
      break;
      default:
        throw new ApiError(400, "Unsupported approval action.");
    }

  await writeAuditEvent(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    eventCategory: "operational_approval",
    eventType: "operational_approval.decision_applied",
    resourceType: "operational_approval_request",
    resourceId: requestId,
    result: input.action,
    context: {
      action: input.action,
      note_present: Boolean(normalizeNullableText(input.note)),
      delegate_to_user_id: input.delegate_to_user_id ?? null
    }
  });

  return getOperationalApprovalDetail(client, auth, requestId);
}

export async function createOperationalApprovalRequest(
  client: PoolClient,
  auth: AuthUser,
  input: CreateOperationalApprovalRequestInput
): Promise<OperationalApprovalRequestSummary> {
  const sourceContext = await loadApprovalSourceContext(client, auth.tenantId, input.source_entity_type, input.source_entity_id);
  assertCanViewApprovalSource(auth, sourceContext);
  assertCanCreateApprovalForSource(auth, sourceContext, input.request_type);

  return ensureOperationalApprovalRequest(client, auth, {
    requestType: input.request_type,
    sourceModule: input.source_module.trim(),
    sourceEntityType: input.source_entity_type,
    sourceEntityId: input.source_entity_id,
    sourceEntityLabel: sourceContext.sourceEntityLabel,
    requesterDepartment: sourceContext.requesterDepartment ?? auth.department,
    requestedActionCode: input.requested_action_code.trim(),
    requestTitle: input.request_title.trim(),
    requestSummary: normalizeNullableText(input.request_summary),
    reason: input.reason.trim(),
    blocking: input.blocking ?? undefined,
    severity: normalizeNullableText(input.severity) ?? undefined,
    dedupeKey: normalizeNullableText(input.dedupe_key),
    currentState: input.current_state ?? {},
    requestedState: input.requested_state ?? {},
    metadata: {
      ...(input.metadata ?? {}),
      source_access: {
        entity_type: sourceContext.sourceEntityType,
        entity_id: sourceContext.sourceEntityId
      }
    }
  });
}

export async function ensureOperationalApprovalRequest(
  client: PoolClient,
  auth: AuthUser,
  input: EnsureApprovalInput
): Promise<OperationalApprovalRequestSummary> {
  const dedupeKey = normalizeNullableText(input.dedupeKey);
  if (dedupeKey) {
    const existing = await findApprovalByDedupeKey(client, auth.tenantId, dedupeKey);
    if (existing) {
      return mapApprovalSummary(existing, auth);
    }
  }

  const template = resolveApprovalTemplate({
    requestType: input.requestType,
    sourceModule: input.sourceModule,
    severity: input.severity ?? null,
    blocking: input.blocking ?? true
  });
  const roleGroups = template.roleGroups;
  const createdAt = new Date();
  const dueAt = new Date(createdAt.getTime() + template.slaHours * 60 * 60 * 1000);
  const resolvedSteps = await resolveApprovalSteps(
    client,
    auth.tenantId,
    roleGroups,
    input.requesterDepartment ?? auth.department,
    auth.id
  );

  const requestInsert = await client.query<{ id: string }>(
    `
      INSERT INTO operational_approval_request (
        tenant_id,
        request_type,
        status,
        source_module,
        source_entity_type,
        source_entity_id,
        source_entity_label,
        requester_department,
        blocking,
        requested_action_code,
        request_title,
        request_summary,
        reason,
        severity,
        dedupe_key,
        requested_by_user_id,
        approval_chain,
        current_state,
        requested_state,
        metadata,
        sla_due_at
      )
      VALUES ($1,$2,'pending',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::text[],$17::jsonb,$18::jsonb,$19::jsonb,$20)
      RETURNING id
    `,
    [
      auth.tenantId,
      input.requestType,
      input.sourceModule,
      input.sourceEntityType,
      input.sourceEntityId,
      input.sourceEntityLabel ?? null,
      input.requesterDepartment ?? auth.department,
      input.blocking ?? template.blocking,
      input.requestedActionCode,
      input.requestTitle.trim(),
      normalizeNullableText(input.requestSummary),
      input.reason.trim(),
      input.severity ?? template.severity,
      dedupeKey,
      auth.id,
      roleGroups,
      JSON.stringify(input.currentState ?? {}),
      JSON.stringify(input.requestedState ?? {}),
      JSON.stringify(input.metadata ?? {}),
      dueAt.toISOString()
    ]
  );
  const requestId = requestInsert.rows[0].id;

  for (const [index, step] of resolvedSteps.entries()) {
    await client.query(
      `
        INSERT INTO operational_approval_step (
          tenant_id,
          approval_request_id,
          step_order,
          approver_role_group,
          approver_department,
          approver_user_id,
          status,
          due_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `,
      [
        auth.tenantId,
        requestId,
        index + 1,
        step.roleGroup,
        step.department,
        step.approverUserId,
        index === 0 ? "pending" : "queued",
        dueAt.toISOString()
      ]
    );
  }

  await recordApprovalEvent(client, {
    tenantId: auth.tenantId,
    requestId,
    eventType: "approval.requested",
    summary: `${formatRequestTypeLabel(input.requestType)} submitted`,
    note: normalizeNullableText(input.requestSummary) ?? input.reason.trim(),
    actorUserId: auth.id,
    metadata: {
      source_module: input.sourceModule,
      source_entity_type: input.sourceEntityType,
      source_entity_id: input.sourceEntityId,
      blocking: input.blocking ?? template.blocking,
      severity: input.severity ?? template.severity,
      approval_chain: roleGroups
    }
  });

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "operational_approval.requested",
    entityType: "operational_approval_request",
    entityId: requestId,
    metadata: {
      request_type: input.requestType,
      source_module: input.sourceModule,
      source_entity_type: input.sourceEntityType,
      source_entity_id: input.sourceEntityId,
      requested_action_code: input.requestedActionCode,
      blocking: input.blocking ?? template.blocking,
      severity: input.severity ?? template.severity,
      approval_chain: roleGroups
    },
    reasonComment: input.reason.trim()
  });

  if (input.sourceEntityType === "job" || input.sourceEntityType === "production_item") {
    await applyProactiveCommunicationRule(client, auth, {
      triggerType: "approval_needed",
      sourceModule: input.sourceModule,
      sourceObjectType: "operational_approval_request",
      sourceObjectId: requestId,
      sourceObjectLabel: input.requestTitle.trim(),
      communicationObjectType: input.sourceEntityType,
      communicationObjectId: input.sourceEntityId,
      title: `Approval requested: ${input.requestTitle.trim()}`,
      summary: normalizeNullableText(input.requestSummary) ?? input.reason.trim(),
      recipientUserIds: resolvedSteps
        .slice(0, 1)
        .map((step) => step.approverUserId)
        .filter((value): value is string => Boolean(value)),
      appDeepLink: `#approvals?tab=operational&request=${encodeURIComponent(requestId)}`,
      severity: normalizeNotificationSeverity(input.severity ?? template.severity),
      metadata: {
        due_at: dueAt.toISOString(),
        request_type: input.requestType,
        blocking: input.blocking ?? template.blocking
      }
    });
  }

  const requestRow = await loadApprovalRow(client, auth.tenantId, requestId);
  if (!requestRow) {
    throw new ApiError(500, "Approval request could not be loaded after creation.");
  }

  await writeAuditEvent(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    eventCategory: "operational_approval",
    eventType: "operational_approval.request_created",
    resourceType: "operational_approval_request",
    resourceId: requestId,
    result: "created",
    context: {
      request_type: input.requestType,
      source_module: input.sourceModule,
      source_entity_type: input.sourceEntityType,
      source_entity_id: input.sourceEntityId,
      blocking: input.blocking ?? template.blocking,
      severity: input.severity ?? template.severity
    }
  });
  return mapApprovalSummary(requestRow, auth);
}

export async function consumeApprovedOperationalApproval(
  client: PoolClient,
  auth: AuthUser,
  dedupeKey: string | null | undefined
): Promise<OperationalApprovalExecuteResult | OperationalApprovalRequestSummary> {
  const normalizedKey = normalizeNullableText(dedupeKey);
  if (!normalizedKey) {
    return { approval_required: false };
  }

  const { rows } = await client.query<{ id: string; requested_by_user_id: string }>(
    `
      SELECT id, requested_by_user_id
      FROM operational_approval_request
      WHERE tenant_id = $1
        AND dedupe_key = $2
        AND status = 'approved'
        AND executed_at IS NULL
      ORDER BY decided_at DESC NULLS LAST, created_at DESC
      LIMIT 1
    `,
    [auth.tenantId, normalizedKey]
  );
  const row = rows[0];
  if (!row) {
    return { approval_required: false };
  }
  if (row.requested_by_user_id !== auth.id && !hasLeadershipApprovalAuthority(auth)) {
    return getApprovalSummaryById(client, auth, row.id);
  }
  return {
    approval_required: false,
    consumed_approval_request_id: row.id
  };
}

export async function markOperationalApprovalExecuted(
  client: PoolClient,
  auth: AuthUser,
  approvalRequestId: string | null | undefined,
  note?: string | null
) {
  const normalizedId = normalizeNullableText(approvalRequestId);
  if (!normalizedId) {
    return;
  }
  await client.query(
    `
      UPDATE operational_approval_request
      SET executed_at = COALESCE(executed_at, now()),
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
        AND status = 'approved'
    `,
    [auth.tenantId, normalizedId]
  );
  await recordApprovalEvent(client, {
    tenantId: auth.tenantId,
    requestId: normalizedId,
    eventType: "approval.executed",
    summary: "Approved action executed",
    note: normalizeNullableText(note),
    actorUserId: auth.id,
    metadata: {}
  });
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "operational_approval.executed",
    entityType: "operational_approval_request",
    entityId: normalizedId,
    metadata: {}
  });
}

export async function listOperationalApprovalSourceSummary(
  client: PoolClient,
  auth: AuthUser,
  input: {
    sourceModule: string;
    sourceEntityType: string;
    sourceEntityId: string;
  }
): Promise<OperationalApprovalSourceSummary> {
  assertCanViewOperationalApprovals(auth);
  const sourceContext = await loadOptionalApprovalSourceContext(client, auth.tenantId, input.sourceEntityType, input.sourceEntityId);
  if (sourceContext) {
    assertCanViewApprovalSource(auth, sourceContext);
  }
  const rows = await listSourceApprovalRows(client, auth, input);
  const items = rows.filter((row) => canUserSeeApprovalRow(row, auth)).map((row) => mapApprovalSummary(row, auth));
  return {
    source_module: input.sourceModule,
    source_entity_type: input.sourceEntityType,
    source_entity_id: input.sourceEntityId,
    open_count: items.length,
    blocking_open_count: items.filter((item) => item.blocking && item.status !== "approved").length,
    overdue_count: items.filter((item) => item.overdue).length,
    escalated_count: items.filter((item) => item.escalated).length,
    items
  };
}

export async function listOperationalApprovalWatchCandidates(
  client: PoolClient,
  tenantId: string
): Promise<UrgentWatchCandidate[]> {
  const rows = await listTenantApprovalRows(client, tenantId, 250);
  const now = Date.now();

  return rows
    .filter((row) => row.status === "pending" || row.status === "needs_clarification")
    .filter((row) => {
      const escalation = deriveApprovalEscalationState(row);
      return row.blocking || escalation.overdue || escalation.escalated;
    })
    .map((row) => {
      const escalation = deriveApprovalEscalationState(row);
      const dueAt = normalizeNullableText(row.sla_due_at);
      const dueMs = dueAt ? new Date(dueAt).getTime() : null;
      const overdue = escalation.overdue;
      const dueWithin24Hours = dueMs !== null && dueMs <= now + 24 * 60 * 60 * 1000;
      const severity = overdue || dueWithin24Hours ? "red" : "yellow";
      const escalationLevel = escalation.escalationLevel;

      return {
        source_module: "approvals",
        source_entity_type: "operational_approval_request",
        source_entity_id: row.id,
        source_entity_label: row.request_title,
        scope_department: row.requester_department ?? null,
        watch_type: "approval_blocker",
        severity,
        title: row.request_title,
        summary:
          row.request_summary ??
          row.reason ??
          `${formatRequestTypeLabel(row.request_type)} is still waiting on approval action.`,
        owner_user_id: row.current_approver_user_id,
        owner_label: row.current_approver_name ?? humanizeLabel(row.current_approver_role_group ?? "approver"),
        due_at: dueAt,
        next_action_label: "Open approval",
        action_hash: `#people-ops/approvals?approval=${row.id}&tab=operational`,
        operational_impact_score: (row.blocking ? 100 : 70) + Math.min(escalationLevel * 10, 30),
        source_snapshot: {
          blocking: row.blocking,
          status: row.status,
          request_type: row.request_type,
          requester_department: row.requester_department,
          requested_action_code: row.requested_action_code,
          current_approver_user_id: row.current_approver_user_id,
          current_approver_name: row.current_approver_name,
          escalation_level: escalationLevel,
          overdue_at: row.overdue_at,
          escalated_at: row.escalated_at
        }
      } satisfies UrgentWatchCandidate;
    });
}

async function getApprovalSummaryById(client: PoolClient, auth: AuthUser, requestId: string) {
  const row = await loadApprovalRow(client, auth.tenantId, requestId);
  if (!row) {
    throw new ApiError(404, "Approval request not found");
  }
  return mapApprovalSummary(row, auth);
}

async function loadApprovalRow(client: PoolClient, tenantId: string, requestId: string) {
  const { rows } = await client.query<ApprovalRequestRow>(
    `
      SELECT
        req.id,
        req.request_type::text AS request_type,
        req.status::text AS status,
        req.source_module,
        req.source_entity_type,
        req.source_entity_id,
        req.source_entity_label,
        req.requester_department,
        req.blocking,
        req.requested_action_code,
        req.request_title,
        req.request_summary,
        req.reason,
        req.severity,
        req.requested_by_user_id,
        requester.full_name AS requested_by_name,
        req.approval_chain::text[] AS approval_chain,
        req.current_state,
        req.requested_state,
        req.metadata,
        req.clarification_note,
        req.decision_note,
        req.sla_due_at::text,
        req.overdue_at::text,
        req.escalated_at::text,
        req.escalation_level,
        req.decided_at::text,
        req.executed_at::text,
        req.created_at::text,
        req.updated_at::text,
        pending.approver_user_id AS current_approver_user_id,
        approver.full_name AS current_approver_name,
        pending.approver_role_group::text AS current_approver_role_group
      FROM operational_approval_request req
      LEFT JOIN app_user requester ON requester.id = req.requested_by_user_id
      LEFT JOIN LATERAL (
        SELECT step.approver_user_id, step.approver_role_group
        FROM operational_approval_step step
        WHERE step.tenant_id = req.tenant_id
          AND step.approval_request_id = req.id
          AND step.status = 'pending'
        ORDER BY step.step_order ASC
        LIMIT 1
      ) pending ON true
      LEFT JOIN app_user approver ON approver.id = pending.approver_user_id
      WHERE req.tenant_id = $1
        AND req.id = $2
      LIMIT 1
    `,
    [tenantId, requestId]
  );
  return rows[0] ?? null;
}

async function loadApprovalSteps(client: PoolClient, tenantId: string, requestId: string) {
  const { rows } = await client.query<ApprovalStepRow>(
    `
      SELECT
        step.id,
        step.step_order,
        step.approver_role_group::text AS approver_role_group,
        step.approver_department,
        step.approver_user_id,
        approver.full_name AS approver_name,
        step.status::text AS status,
        step.acted_by_user_id,
        acted.full_name AS acted_by_name,
        step.delegated_from_user_id,
        delegated.full_name AS delegated_from_name,
        step.note,
        step.due_at::text,
        step.acted_at::text,
        step.created_at::text,
        step.updated_at::text
      FROM operational_approval_step step
      LEFT JOIN app_user approver ON approver.id = step.approver_user_id
      LEFT JOIN app_user acted ON acted.id = step.acted_by_user_id
      LEFT JOIN app_user delegated ON delegated.id = step.delegated_from_user_id
      WHERE step.tenant_id = $1
        AND step.approval_request_id = $2
      ORDER BY step.step_order ASC
    `,
    [tenantId, requestId]
  );
  return rows;
}

async function loadApprovalEvents(client: PoolClient, tenantId: string, requestId: string) {
  const { rows } = await client.query<ApprovalEventRow>(
    `
      SELECT
        event.id,
        event.approval_step_id,
        event.event_type,
        event.summary,
        event.note,
        event.actor_user_id,
        actor.full_name AS actor_name,
        event.metadata,
        event.created_at::text
      FROM operational_approval_event event
      LEFT JOIN app_user actor ON actor.id = event.actor_user_id
      WHERE event.tenant_id = $1
        AND event.approval_request_id = $2
      ORDER BY event.created_at DESC
      LIMIT 100
    `,
    [tenantId, requestId]
  );
  return rows;
}

async function listVisibleApprovalRows(client: PoolClient, auth: AuthUser, limit: number) {
  const scope = getOperationalApprovalScope(auth);
  if (!scope) {
    throw new ApiError(403, "You do not have access to the approvals workspace.");
  }

  let values: unknown[];
  let visibilityClause: string;
  if (scope === "all") {
    values = [auth.tenantId];
    visibilityClause = "true";
  } else if (scope === "own") {
    values = [auth.tenantId, auth.id];
    visibilityClause = "(req.requested_by_user_id = $2 OR pending.approver_user_id = $2)";
  } else {
    values = [auth.tenantId, auth.id, auth.department];
    visibilityClause = "(req.requester_department = $3 OR req.requested_by_user_id = $2 OR pending.approver_user_id = $2)";
  }
  values.push(limit);
  const limitPlaceholder = `$${values.length}`;

  const { rows } = await client.query<ApprovalRequestRow>(
    `
      SELECT
        req.id,
        req.request_type::text AS request_type,
        req.status::text AS status,
        req.source_module,
        req.source_entity_type,
        req.source_entity_id,
        req.source_entity_label,
        req.requester_department,
        req.blocking,
        req.requested_action_code,
        req.request_title,
        req.request_summary,
        req.reason,
        req.severity,
        req.requested_by_user_id,
        requester.full_name AS requested_by_name,
        req.approval_chain::text[] AS approval_chain,
        req.current_state,
        req.requested_state,
        req.metadata,
        req.clarification_note,
        req.decision_note,
        req.sla_due_at::text,
        req.overdue_at::text,
        req.escalated_at::text,
        req.escalation_level,
        req.decided_at::text,
        req.executed_at::text,
        req.created_at::text,
        req.updated_at::text,
        pending.approver_user_id AS current_approver_user_id,
        approver.full_name AS current_approver_name,
        pending.approver_role_group::text AS current_approver_role_group
      FROM operational_approval_request req
      LEFT JOIN app_user requester ON requester.id = req.requested_by_user_id
      LEFT JOIN LATERAL (
        SELECT step.approver_user_id, step.approver_role_group
        FROM operational_approval_step step
        WHERE step.tenant_id = req.tenant_id
          AND step.approval_request_id = req.id
          AND step.status = 'pending'
        ORDER BY step.step_order ASC
        LIMIT 1
      ) pending ON true
      LEFT JOIN app_user approver ON approver.id = pending.approver_user_id
      WHERE req.tenant_id = $1
        AND ${visibilityClause}
      ORDER BY
        CASE WHEN req.status = 'pending' THEN 0 WHEN req.status = 'needs_clarification' THEN 1 ELSE 2 END,
        req.created_at DESC
      LIMIT ${limitPlaceholder}
    `,
    values
  );
  return rows;
}

async function listTenantApprovalRows(client: PoolClient, tenantId: string, limit: number) {
  const { rows } = await client.query<ApprovalRequestRow>(
    `
      SELECT
        req.id,
        req.request_type::text AS request_type,
        req.status::text AS status,
        req.source_module,
        req.source_entity_type,
        req.source_entity_id,
        req.source_entity_label,
        req.requester_department,
        req.blocking,
        req.requested_action_code,
        req.request_title,
        req.request_summary,
        req.reason,
        req.severity,
        req.requested_by_user_id,
        requester.full_name AS requested_by_name,
        req.approval_chain::text[] AS approval_chain,
        req.current_state,
        req.requested_state,
        req.metadata,
        req.clarification_note,
        req.decision_note,
        req.sla_due_at::text,
        req.overdue_at::text,
        req.escalated_at::text,
        req.escalation_level,
        req.decided_at::text,
        req.executed_at::text,
        req.created_at::text,
        req.updated_at::text,
        pending.approver_user_id AS current_approver_user_id,
        approver.full_name AS current_approver_name,
        pending.approver_role_group::text AS current_approver_role_group
      FROM operational_approval_request req
      LEFT JOIN app_user requester ON requester.id = req.requested_by_user_id
      LEFT JOIN LATERAL (
        SELECT step.approver_user_id, step.approver_role_group
        FROM operational_approval_step step
        WHERE step.tenant_id = req.tenant_id
          AND step.approval_request_id = req.id
          AND step.status = 'pending'
        ORDER BY step.step_order ASC
        LIMIT 1
      ) pending ON true
      LEFT JOIN app_user approver ON approver.id = pending.approver_user_id
      WHERE req.tenant_id = $1
      ORDER BY
        CASE WHEN req.status = 'pending' THEN 0 WHEN req.status = 'needs_clarification' THEN 1 ELSE 2 END,
        req.created_at DESC
      LIMIT $2
    `,
    [tenantId, limit]
  );
  return rows;
}

async function listSourceApprovalRows(
  client: PoolClient,
  auth: AuthUser,
  input: { sourceModule: string; sourceEntityType: string; sourceEntityId: string }
) {
  const { rows } = await client.query<ApprovalRequestRow>(
    `
      SELECT
        req.id,
        req.request_type::text AS request_type,
        req.status::text AS status,
        req.source_module,
        req.source_entity_type,
        req.source_entity_id,
        req.source_entity_label,
        req.requester_department,
        req.blocking,
        req.requested_action_code,
        req.request_title,
        req.request_summary,
        req.reason,
        req.severity,
        req.requested_by_user_id,
        requester.full_name AS requested_by_name,
        req.approval_chain::text[] AS approval_chain,
        req.current_state,
        req.requested_state,
        req.metadata,
        req.clarification_note,
        req.decision_note,
        req.sla_due_at::text,
        req.overdue_at::text,
        req.escalated_at::text,
        req.escalation_level,
        req.decided_at::text,
        req.executed_at::text,
        req.created_at::text,
        req.updated_at::text,
        pending.approver_user_id AS current_approver_user_id,
        approver.full_name AS current_approver_name,
        pending.approver_role_group::text AS current_approver_role_group
      FROM operational_approval_request req
      LEFT JOIN app_user requester ON requester.id = req.requested_by_user_id
      LEFT JOIN LATERAL (
        SELECT step.approver_user_id, step.approver_role_group
        FROM operational_approval_step step
        WHERE step.tenant_id = req.tenant_id
          AND step.approval_request_id = req.id
          AND step.status = 'pending'
        ORDER BY step.step_order ASC
        LIMIT 1
      ) pending ON true
      LEFT JOIN app_user approver ON approver.id = pending.approver_user_id
      WHERE req.tenant_id = $1
        AND req.source_module = $2
        AND req.source_entity_type = $3
        AND req.source_entity_id = $4
        AND req.status IN ('pending', 'needs_clarification', 'approved')
      ORDER BY req.created_at DESC
      LIMIT 25
    `,
    [auth.tenantId, input.sourceModule, input.sourceEntityType, input.sourceEntityId]
  );
  return rows;
}

async function loadOptionalApprovalSourceContext(
  client: PoolClient,
  tenantId: string,
  sourceEntityType: string,
  sourceEntityId: string
): Promise<ApprovalSourceContext | null> {
  if (sourceEntityType === "job") {
    const jobResult = await client.query<{
      id: string;
      job_number: string | null;
      title: string;
      department_type: string | null;
      organization_id: string | null;
      primary_location_id: string | null;
      account_owner_user_id: string | null;
      created_by_user_id: string | null;
    }>(
      `
        SELECT
          job.id::text,
          job.job_number,
          job.title,
          job.department_type::text AS department_type,
          job.organization_id::text AS organization_id,
          job.primary_location_id::text AS primary_location_id,
          job.account_owner_user_id::text AS account_owner_user_id,
          job.created_by_user_id::text AS created_by_user_id
        FROM jobs job
        WHERE job.tenant_id = $1
          AND job.id = $2
        LIMIT 1
      `,
      [tenantId, sourceEntityId]
    );
    const job = jobResult.rows[0];
    if (!job) {
      return null;
    }
    const assignmentUsers = await client.query<{ user_id: string }>(
      `
        SELECT DISTINCT user_id::text AS user_id
        FROM job_staff_assignments
        WHERE tenant_id = $1
          AND job_id = $2
      `,
      [tenantId, sourceEntityId]
    );
    return {
      sourceEntityType: "job",
      sourceEntityId,
      sourceEntityLabel: buildApprovalSourceLabel([job.job_number, job.title]),
      requesterDepartment: job.department_type,
      permissionContext: {
        departmentType: job.department_type,
        organizationId: job.organization_id,
        locationId: job.primary_location_id,
        ownerUserIds: [job.account_owner_user_id, job.created_by_user_id].filter((value): value is string => Boolean(value)),
        assignedUserIds: assignmentUsers.rows.map((row) => row.user_id)
      }
    };
  }

  if (sourceEntityType === "production_item") {
    const itemResult = await client.query<{
      id: string;
      title: string;
      assigned_to_user_id: string | null;
      job_number: string | null;
      job_title: string;
      department_type: string | null;
      organization_id: string | null;
      primary_location_id: string | null;
      account_owner_user_id: string | null;
      created_by_user_id: string | null;
    }>(
      `
        SELECT
          item.id::text,
          item.title,
          item.assigned_to_user_id::text AS assigned_to_user_id,
          job.job_number,
          job.title AS job_title,
          job.department_type::text AS department_type,
          job.organization_id::text AS organization_id,
          job.primary_location_id::text AS primary_location_id,
          job.account_owner_user_id::text AS account_owner_user_id,
          job.created_by_user_id::text AS created_by_user_id
        FROM production_items item
        JOIN jobs job
          ON job.tenant_id = item.tenant_id
         AND job.id = item.job_id
        WHERE item.tenant_id = $1
          AND item.id = $2
        LIMIT 1
      `,
      [tenantId, sourceEntityId]
    );
    const item = itemResult.rows[0];
    if (!item) {
      return null;
    }
    return {
      sourceEntityType: "production_item",
      sourceEntityId,
      sourceEntityLabel: buildApprovalSourceLabel([item.job_number, item.title || item.job_title]),
      requesterDepartment: item.department_type,
      permissionContext: {
        departmentType: item.department_type,
        organizationId: item.organization_id,
        locationId: item.primary_location_id,
        ownerUserIds: [item.account_owner_user_id, item.created_by_user_id].filter((value): value is string => Boolean(value)),
        assignedUserIds: [item.assigned_to_user_id].filter((value): value is string => Boolean(value))
      }
    };
  }

  return null;
}

async function loadApprovalSourceContext(
  client: PoolClient,
  tenantId: string,
  sourceEntityType: OperationalApprovalSourceEntityType,
  sourceEntityId: string
) {
  const sourceContext = await loadOptionalApprovalSourceContext(client, tenantId, sourceEntityType, sourceEntityId);
  if (!sourceContext) {
    throw new ApiError(404, "Approval source record not found");
  }
  return sourceContext;
}

function buildApprovalSourceLabel(parts: Array<string | null | undefined>) {
  const values = parts.map((part) => normalizeNullableText(part)).filter((value): value is string => Boolean(value));
  return values.join(" | ") || "Operational Record";
}

function isApprovalRequestTypeSupportedForSource(sourceEntityType: OperationalApprovalSourceEntityType, requestType: OperationalApprovalRequestType) {
  if (sourceEntityType === "job") {
    return [
      "staffing_exception_approval",
      "schedule_change_approval",
      "role_override_approval",
      "overtime_labor_exception_approval",
      "fee_refund_approval",
      "cancellation_approval",
      "policy_exception_approval"
    ].includes(requestType);
  }

  return [
    "rush_order_approval",
    "due_date_extension_approval",
    "deadline_override_approval",
    "peer_review_exception_approval",
    "qc_exception_approval",
    "release_override_approval",
    "rework_waiver_approval",
    "policy_exception_approval"
  ].includes(requestType);
}

function assertCanViewApprovalSource(auth: AuthUser, sourceContext: ApprovalSourceContext) {
  const entityType = sourceContext.sourceEntityType === "job" ? "job" : "production";
  if (canViewRecords(auth, entityType, sourceContext.permissionContext)) {
    return;
  }
  throw new ApiError(403, "You do not have access to that approval source.");
}

function assertCanCreateApprovalForSource(
  auth: AuthUser,
  sourceContext: ApprovalSourceContext,
  requestType: OperationalApprovalRequestType
) {
  if (!isApprovalRequestTypeSupportedForSource(sourceContext.sourceEntityType, requestType)) {
    throw new ApiError(400, "This approval type is not supported for that record.");
  }

  if (sourceContext.sourceEntityType === "job") {
    if (
      requestType === "staffing_exception_approval" &&
      (canAssignStaff(auth, sourceContext.permissionContext) || canEditRecords(auth, "job", sourceContext.permissionContext))
    ) {
      return;
    }
    if (
      ["schedule_change_approval", "cancellation_approval"].includes(requestType) &&
      (canChangeStatuses(auth, "job", sourceContext.permissionContext) || canEditRecords(auth, "job", sourceContext.permissionContext))
    ) {
      return;
    }
    if (canEditRecords(auth, "job", sourceContext.permissionContext)) {
      return;
    }
  } else {
    if (
      ["release_override_approval", "qc_exception_approval", "rework_waiver_approval"].includes(requestType) &&
      (canChangeStatuses(auth, "production", sourceContext.permissionContext) ||
        canEditRecords(auth, "production", sourceContext.permissionContext))
    ) {
      return;
    }
    if (canEditRecords(auth, "production", sourceContext.permissionContext)) {
      return;
    }
  }

  throw new ApiError(403, "You do not have permission to request this approval.");
}

async function findApprovalByDedupeKey(client: PoolClient, tenantId: string, dedupeKey: string) {
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT id
      FROM operational_approval_request
      WHERE tenant_id = $1
        AND dedupe_key = $2
        AND status IN ('pending', 'needs_clarification', 'approved')
        AND executed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [tenantId, dedupeKey]
  );
  if (!rows[0]) {
    return null;
  }
  return loadApprovalRow(client, tenantId, rows[0].id);
}

async function resolveApprovalSteps(
  client: PoolClient,
  tenantId: string,
  roleGroups: OperationalApprovalRoleGroup[],
  requesterDepartment: string | null | undefined,
  requesterUserId: string
) {
  const steps: Array<{ roleGroup: OperationalApprovalRoleGroup; department: string | null; approverUserId: string | null }> = [];
  for (const roleGroup of roleGroups) {
    const candidates = await listCandidateApproversForRoleGroup(client, tenantId, roleGroup, requesterDepartment ?? null, requesterUserId);
    steps.push({
      roleGroup,
      department: requesterDepartment ?? null,
      approverUserId: candidates[0]?.id ?? null
    });
  }
  return steps;
}

async function listCandidateApproversForRoleGroup(
  client: PoolClient,
  tenantId: string,
  roleGroup: OperationalApprovalRoleGroup,
  requesterDepartment: string | null,
  excludedUserId?: string | null
): Promise<OperationalApprovalCandidateApprover[]> {
  const { rows } = await client.query<ApproverUserRow>(
    `
      SELECT
        au.id,
        au.full_name,
        au.department::text AS department,
        uaa.authority_tier::text AS authority_tier,
        COALESCE(array_agg(DISTINCT ujp.job_function_profile::text) FILTER (WHERE ujp.job_function_profile IS NOT NULL), '{}') AS job_function_profiles
      FROM app_user au
      LEFT JOIN user_authority_assignment uaa
        ON uaa.tenant_id = au.tenant_id
       AND uaa.user_id = au.id
      LEFT JOIN user_job_function_profile ujp
        ON ujp.tenant_id = au.tenant_id
       AND ujp.user_id = au.id
      WHERE au.tenant_id = $1
        AND au.status = 'active'
      GROUP BY au.id, au.full_name, au.department, uaa.authority_tier
      ORDER BY au.full_name ASC
    `,
    [tenantId]
  );

  return rows
    .filter((row) => row.id !== excludedUserId)
    .filter((row) => matchesApproverRoleGroup(row, roleGroup, requesterDepartment))
    .map((row) => ({
      id: row.id,
      label: row.full_name,
      detail: [humanizeLabel(row.department), row.authority_tier ? humanizeLabel(row.authority_tier) : null].filter(Boolean).join(" | ")
    }));
}

function matchesApproverRoleGroup(
  row: Pick<ApproverUserRow, "department" | "authority_tier" | "job_function_profiles">,
  roleGroup: OperationalApprovalRoleGroup,
  requesterDepartment: string | null
) {
  const authorityTier = row.authority_tier;
  const profiles = row.job_function_profiles ?? [];
  switch (roleGroup) {
    case "leadership":
      return authorityTier === "super_admin" || authorityTier === "leadership" || authorityTier === "director_admin";
    case "department_manager":
      return (
        row.department === requesterDepartment &&
        (authorityTier === "supervisor" || authorityTier === "director_admin" || authorityTier === "leadership" || authorityTier === "super_admin")
      );
    case "scheduling_lead":
      return (
        profiles.includes("schools_client_success") ||
        profiles.includes("sports_client_success") ||
        ((row.department === "schools" || row.department === "sports" || row.department === "office" || row.department === "customer_service") &&
          (authorityTier === "supervisor" || authorityTier === "director_admin" || authorityTier === "leadership" || authorityTier === "super_admin"))
      );
    case "production_manager":
      return (
        row.department === "production" &&
        (profiles.includes("director_of_digital_production") ||
          authorityTier === "supervisor" ||
          authorityTier === "director_admin" ||
          authorityTier === "leadership" ||
          authorityTier === "super_admin")
      );
    case "operations_lead":
      return (
        row.department === "operations" ||
        profiles.includes("senior_photographer") ||
        profiles.includes("director_of_photography") ||
        profiles.includes("director_of_school_photography") ||
        profiles.includes("director_of_sports_photography")
      );
    default:
      return false;
  }
}

function resolveApprovalTemplate(input: {
  requestType: OperationalApprovalRequestType;
  sourceModule: string;
  severity: string | null;
  blocking: boolean;
}): ApprovalTemplate {
  switch (input.requestType) {
    case "staffing_exception_approval":
      return { roleGroups: input.severity === "critical" ? ["scheduling_lead", "leadership"] : ["scheduling_lead"], blocking: true, severity: input.severity ?? "high", slaHours: 2 };
    case "schedule_change_approval":
    case "role_override_approval":
    case "overtime_labor_exception_approval":
      return { roleGroups: input.severity === "critical" ? ["department_manager", "leadership"] : ["department_manager"], blocking: input.blocking, severity: input.severity ?? "high", slaHours: 4 };
    case "rush_order_approval":
      return {
        roleGroups: input.sourceModule === "production" || input.severity === "critical" ? ["production_manager", "leadership"] : ["production_manager"],
        blocking: input.blocking,
        severity: input.severity ?? "high",
        slaHours: 2
      };
    case "fee_refund_approval":
      return { roleGroups: ["leadership"], blocking: true, severity: input.severity ?? "high", slaHours: 8 };
    case "due_date_extension_approval":
    case "deadline_override_approval":
      return { roleGroups: ["production_manager"], blocking: input.blocking, severity: input.severity ?? "normal", slaHours: 8 };
    case "peer_review_exception_approval":
    case "qc_exception_approval":
    case "rework_waiver_approval":
      return { roleGroups: ["production_manager", "leadership"], blocking: true, severity: input.severity ?? "high", slaHours: 4 };
    case "release_override_approval":
    case "cancellation_approval":
      return { roleGroups: input.sourceModule === "production" ? ["production_manager", "leadership"] : ["department_manager", "leadership"], blocking: true, severity: input.severity ?? "critical", slaHours: 2 };
    case "policy_exception_approval":
    default:
      return { roleGroups: ["department_manager", "leadership"], blocking: input.blocking, severity: input.severity ?? "high", slaHours: 24 };
  }
}

async function approveApprovalStep(client: PoolClient, auth: AuthUser, requestRow: ApprovalRequestRow, pendingStep: ApprovalStepRow, note: string | null, steps: ApprovalStepRow[]) {
  await client.query(
    `
      UPDATE operational_approval_step
      SET status = 'approved',
          acted_by_user_id = $3,
          note = $4,
          acted_at = now(),
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, pendingStep.id, auth.id, note]
  );
  const nextQueuedStep = steps.find((step) => step.status === "queued" && step.step_order > pendingStep.step_order) ?? null;
  if (nextQueuedStep) {
    await client.query(
      `
        UPDATE operational_approval_step
        SET status = 'pending',
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [auth.tenantId, nextQueuedStep.id]
    );
    await client.query(
      `
        UPDATE operational_approval_request
        SET updated_at = now(),
            decision_note = COALESCE($3, decision_note)
        WHERE tenant_id = $1
          AND id = $2
      `,
      [auth.tenantId, requestRow.id, note]
    );
  } else {
    await client.query(
      `
        UPDATE operational_approval_request
        SET status = 'approved',
            approved_by_user_id = $3,
            decision_note = $4,
            decided_at = now(),
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [auth.tenantId, requestRow.id, auth.id, note]
    );
  }
  await recordApprovalEvent(client, {
    tenantId: auth.tenantId,
    requestId: requestRow.id,
    stepId: pendingStep.id,
    eventType: nextQueuedStep ? "approval.step_approved" : "approval.approved",
    summary: nextQueuedStep ? `Step ${pendingStep.step_order} approved` : `${formatRequestTypeLabel(requestRow.request_type)} approved`,
    note,
    actorUserId: auth.id,
    metadata: { next_step_order: nextQueuedStep?.step_order ?? null }
  });
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: nextQueuedStep ? "operational_approval.step_approved" : "operational_approval.approved",
    entityType: "operational_approval_request",
    entityId: requestRow.id,
    metadata: { request_type: requestRow.request_type, step_order: pendingStep.step_order, next_step_order: nextQueuedStep?.step_order ?? null },
    reasonComment: note
  });
}

async function rejectApprovalRequest(client: PoolClient, auth: AuthUser, requestRow: ApprovalRequestRow, pendingStep: ApprovalStepRow, note: string | null) {
  await client.query(
    `
      UPDATE operational_approval_step
      SET status = 'rejected',
          acted_by_user_id = $3,
          note = $4,
          acted_at = now(),
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, pendingStep.id, auth.id, note]
  );
  await client.query(
    `
      UPDATE operational_approval_request
      SET status = 'rejected',
          rejected_by_user_id = $3,
          decision_note = $4,
          decided_at = now(),
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, requestRow.id, auth.id, note]
  );
  await recordApprovalEvent(client, {
    tenantId: auth.tenantId,
    requestId: requestRow.id,
    stepId: pendingStep.id,
    eventType: "approval.rejected",
    summary: `${formatRequestTypeLabel(requestRow.request_type)} rejected`,
    note,
    actorUserId: auth.id,
    metadata: {}
  });
}

async function sendApprovalBack(client: PoolClient, auth: AuthUser, requestRow: ApprovalRequestRow, pendingStep: ApprovalStepRow, note: string) {
  await client.query(
    `
      UPDATE operational_approval_step
      SET status = 'sent_back',
          acted_by_user_id = $3,
          note = $4,
          acted_at = now(),
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, pendingStep.id, auth.id, note]
  );
  await client.query(
    `
      UPDATE operational_approval_request
      SET status = 'needs_clarification',
          clarification_note = $3,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, requestRow.id, note]
  );
  await recordApprovalEvent(client, {
    tenantId: auth.tenantId,
    requestId: requestRow.id,
    stepId: pendingStep.id,
    eventType: "approval.sent_back",
    summary: "Sent back for clarification",
    note,
    actorUserId: auth.id,
    metadata: {}
  });
}

async function delegateApprovalStep(
  client: PoolClient,
  auth: AuthUser,
  requestRow: ApprovalRequestRow,
  pendingStep: ApprovalStepRow,
  delegateToUserId: string,
  note: string | null
) {
  await client.query(
    `
      UPDATE operational_approval_step
      SET approver_user_id = $3,
          delegated_from_user_id = COALESCE(approver_user_id, $4),
          note = $5,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, pendingStep.id, delegateToUserId, auth.id, note]
  );
  await client.query(
    `
      UPDATE operational_approval_request
      SET updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, requestRow.id]
  );
  await recordApprovalEvent(client, {
    tenantId: auth.tenantId,
    requestId: requestRow.id,
    stepId: pendingStep.id,
    eventType: "approval.delegated",
    summary: "Approval delegated",
    note,
    actorUserId: auth.id,
    metadata: { delegate_to_user_id: delegateToUserId }
  });
}

async function cancelApprovalRequest(client: PoolClient, auth: AuthUser, requestRow: ApprovalRequestRow, note: string | null) {
  await client.query(
    `
      UPDATE operational_approval_request
      SET status = 'canceled',
          canceled_by_user_id = $3,
          decision_note = COALESCE($4, decision_note),
          decided_at = COALESCE(decided_at, now()),
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, requestRow.id, auth.id, note]
  );
  await client.query(
    `
      UPDATE operational_approval_step
      SET status = CASE WHEN status IN ('pending', 'queued') THEN 'canceled'::operational_approval_step_status ELSE status END,
          updated_at = now()
      WHERE tenant_id = $1
        AND approval_request_id = $2
    `,
    [auth.tenantId, requestRow.id]
  );
  await recordApprovalEvent(client, {
    tenantId: auth.tenantId,
    requestId: requestRow.id,
    eventType: "approval.canceled",
    summary: "Approval request canceled",
    note,
    actorUserId: auth.id,
    metadata: {}
  });
}

async function resubmitApprovalRequest(
  client: PoolClient,
  auth: AuthUser,
  requestRow: ApprovalRequestRow,
  note: string | null,
  steps: ApprovalStepRow[]
) {
  const sentBackStep = [...steps].sort((a, b) => b.step_order - a.step_order).find((step) => step.status === "sent_back");
  if (!sentBackStep) {
    throw new ApiError(409, "This approval request is not waiting on clarification.");
  }
  await client.query(
    `
      UPDATE operational_approval_step
      SET status = 'pending',
          note = COALESCE($3, note),
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, sentBackStep.id, note]
  );
  await client.query(
    `
      UPDATE operational_approval_request
      SET status = 'pending',
          clarification_note = COALESCE($3, clarification_note),
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, requestRow.id, note]
  );
  await recordApprovalEvent(client, {
    tenantId: auth.tenantId,
    requestId: requestRow.id,
    stepId: sentBackStep.id,
    eventType: "approval.resubmitted",
    summary: "Approval request resubmitted",
    note,
    actorUserId: auth.id,
    metadata: {}
  });
}

async function recordApprovalEvent(
  client: PoolClient,
  input: {
    tenantId: string;
    requestId: string;
    stepId?: string | null;
    eventType: string;
    summary: string;
    note?: string | null;
    actorUserId?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await client.query(
    `
      INSERT INTO operational_approval_event (
        tenant_id,
        approval_request_id,
        approval_step_id,
        event_type,
        summary,
        note,
        actor_user_id,
        metadata
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
    `,
    [
      input.tenantId,
      input.requestId,
      input.stepId ?? null,
      input.eventType,
      input.summary,
      input.note ?? null,
      input.actorUserId ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
}

async function refreshOperationalApprovalEscalations(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<{
    id: string;
    request_type: OperationalApprovalRequestType;
    severity: string;
    blocking: boolean;
    sla_due_at: string | null;
    escalation_level: number;
  }>(
    `
      SELECT
        id,
        request_type::text AS request_type,
        severity,
        blocking,
        sla_due_at::text,
        escalation_level
      FROM operational_approval_request
      WHERE tenant_id = $1
        AND status IN ('pending', 'needs_clarification')
        AND sla_due_at IS NOT NULL
    `,
    [tenantId]
  );

  for (const row of rows) {
    const nextEscalationLevel = computeEscalationLevel(row);
    const overdue = row.sla_due_at ? new Date(row.sla_due_at).getTime() < Date.now() : false;
    if (!overdue && row.escalation_level === 0) {
      continue;
    }
    await client.query(
      `
        UPDATE operational_approval_request
        SET
          overdue_at = CASE WHEN $3::boolean THEN COALESCE(overdue_at, now()) ELSE NULL END,
          escalated_at = CASE WHEN $4::int > escalation_level THEN now() ELSE escalated_at END,
          escalation_level = $4,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [tenantId, row.id, overdue, nextEscalationLevel]
    );
    if (nextEscalationLevel > row.escalation_level) {
      await recordApprovalEvent(client, {
        tenantId,
        requestId: row.id,
        eventType: "approval.escalated",
        summary: `Approval escalated to level ${nextEscalationLevel}`,
        metadata: { prior_level: row.escalation_level, next_level: nextEscalationLevel }
      });
    }
  }
}

function computeEscalationLevel(row: { request_type: OperationalApprovalRequestType; severity: string; blocking: boolean; sla_due_at: string | null }) {
  if (!row.sla_due_at) {
    return 0;
  }
  const dueAt = new Date(row.sla_due_at).getTime();
  const deltaHours = (Date.now() - dueAt) / (60 * 60 * 1000);
  if (deltaHours <= 0) {
    return 0;
  }
  let level = row.blocking ? 1 : 0;
  if (["high", "critical"].includes(row.severity) || row.request_type === "release_override_approval" || row.request_type === "cancellation_approval") {
    level = Math.max(level, 2);
  }
  if (deltaHours >= 6) {
    level = Math.max(level, 3);
  }
  return Math.min(level, 3);
}

function assertCanViewOperationalApprovals(auth: AuthUser) {
  if (!canViewOperationalApprovals(auth)) {
    throw new ApiError(403, "You do not have access to operational approvals.");
  }
}

function assertApprovalVisibleToUser(requestRow: ApprovalRequestRow, auth: AuthUser) {
  if (!canUserSeeApprovalRow(requestRow, auth)) {
    throw new ApiError(403, "You do not have access to this approval request.");
  }
}

function canUserSeeApprovalRow(requestRow: ApprovalRequestRow, auth: AuthUser) {
  const scope = getOperationalApprovalScope(auth);
  if (!scope) {
    return false;
  }
  if (scope === "all") {
    return true;
  }
  if (requestRow.requested_by_user_id === auth.id || requestRow.current_approver_user_id === auth.id) {
    return true;
  }
  return scope === "department" && requestRow.requester_department === auth.department;
}

function assertCanActOnPendingStep(auth: AuthUser, _requestRow: ApprovalRequestRow, pendingStep: ApprovalStepRow) {
  if (pendingStep.approver_user_id === auth.id || hasLeadershipApprovalAuthority(auth)) {
    return;
  }
  throw new ApiError(403, "You are not the routed approver for this approval step.");
}

function mapApprovalSummary(row: ApprovalRequestRow, auth: AuthUser): OperationalApprovalRequestSummary {
  const escalation = deriveApprovalEscalationState(row);
  return {
    id: row.id,
    request_type: row.request_type,
    request_type_label: formatRequestTypeLabel(row.request_type),
    status: row.status,
    status_label: formatApprovalStatusLabel(row.status),
    source_module: row.source_module,
    source_entity_type: row.source_entity_type,
    source_entity_id: row.source_entity_id,
    source_entity_label: row.source_entity_label,
    requested_action_code: row.requested_action_code,
    request_title: row.request_title,
    request_summary: row.request_summary,
    reason: row.reason,
    severity: row.severity,
    blocking: row.blocking,
    requester_department: row.requester_department,
    requested_by_user_id: row.requested_by_user_id,
    requested_by_name: row.requested_by_name,
    approval_chain: row.approval_chain,
    current_approver_user_id: row.current_approver_user_id,
    current_approver_name: row.current_approver_name,
    current_approver_role_group: row.current_approver_role_group,
    current_approver_role_group_label: row.current_approver_role_group ? formatRoleGroupLabel(row.current_approver_role_group) : null,
    sla_due_at: row.sla_due_at,
    overdue: escalation.overdue,
    escalated: escalation.escalated,
    escalation_level: escalation.escalationLevel,
    decided_at: row.decided_at,
    executed_at: row.executed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    can_decide: row.status === "pending" && (row.current_approver_user_id === auth.id || hasLeadershipApprovalAuthority(auth)),
    can_cancel: ["pending", "needs_clarification"].includes(row.status) && (row.requested_by_user_id === auth.id || hasLeadershipApprovalAuthority(auth)),
    can_resubmit: row.status === "needs_clarification" && (row.requested_by_user_id === auth.id || hasLeadershipApprovalAuthority(auth)),
    can_delegate: row.status === "pending" && (row.current_approver_user_id === auth.id || hasLeadershipApprovalAuthority(auth))
  };
}

function deriveApprovalEscalationState(
  row: Pick<ApprovalRequestRow, "status" | "request_type" | "severity" | "blocking" | "sla_due_at" | "escalation_level">
) {
  const active = row.status === "pending" || row.status === "needs_clarification";
  if (!active) {
    const escalationLevel = Number(row.escalation_level ?? 0);
    return {
      overdue: false,
      escalated: escalationLevel > 0,
      escalationLevel
    };
  }

  const escalationLevel = computeEscalationLevel(row);
  const overdue = Boolean(row.sla_due_at && new Date(row.sla_due_at).getTime() < Date.now());
  return {
    overdue,
    escalated: escalationLevel > 0,
    escalationLevel
  };
}

function mapApprovalStep(row: ApprovalStepRow): OperationalApprovalStepRecord {
  return {
    id: row.id,
    step_order: row.step_order,
    approver_role_group: row.approver_role_group,
    approver_role_group_label: formatRoleGroupLabel(row.approver_role_group),
    approver_department: row.approver_department,
    approver_user_id: row.approver_user_id,
    approver_name: row.approver_name,
    status: row.status as OperationalApprovalStepRecord["status"],
    status_label: formatApprovalStepStatusLabel(row.status),
    acted_by_user_id: row.acted_by_user_id,
    acted_by_name: row.acted_by_name,
    delegated_from_user_id: row.delegated_from_user_id,
    delegated_from_name: row.delegated_from_name,
    note: row.note,
    due_at: row.due_at,
    acted_at: row.acted_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapApprovalEvent(row: ApprovalEventRow): OperationalApprovalEventRecord {
  return {
    id: row.id,
    approval_step_id: row.approval_step_id,
    event_type: row.event_type,
    event_type_label: humanizeLabel(row.event_type.replace(/^approval\./, "")),
    summary: row.summary,
    note: row.note,
    actor_user_id: row.actor_user_id,
    actor_name: row.actor_name,
    metadata: row.metadata,
    created_at: row.created_at
  };
}

function formatRequestTypeLabel(value: OperationalApprovalRequestType) {
  return humanizeLabel(value.replace(/_approval$/, ""));
}

function formatApprovalStatusLabel(value: OperationalApprovalStatus) {
  switch (value) {
    case "needs_clarification":
      return "Needs Clarification";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "canceled":
      return "Canceled";
    default:
      return "Pending";
  }
}

function formatApprovalStepStatusLabel(value: string) {
  if (value === "sent_back") {
    return "Sent Back";
  }
  return humanizeLabel(value);
}

function formatRoleGroupLabel(value: OperationalApprovalRoleGroup) {
  switch (value) {
    case "department_manager":
      return "Department Manager";
    case "operations_lead":
      return "Operations Lead";
    case "scheduling_lead":
      return "Scheduling Lead";
    case "production_manager":
      return "Production Manager";
    case "leadership":
      return "Leadership";
    default:
      return humanizeLabel(value);
  }
}

function humanizeLabel(value?: string | null) {
  if (!value) {
    return "Unknown";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeNotificationSeverity(value: string | null | undefined) {
  if (value === "low" || value === "medium" || value === "high" || value === "critical") {
    return value;
  }
  return "medium" as const;
}
