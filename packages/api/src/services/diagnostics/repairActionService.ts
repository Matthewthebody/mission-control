import type { PoolClient } from "pg";
import { ApiError } from "../../errors/apiError.js";
import { getDepartmentJobAdapter } from "../jobTruth/departmentJobAdapterRegistry.js";
import { writeJobActivity } from "../jobTruth/activityLogService.js";
import { buildDepartmentProductionTemplatePlan } from "../jobTruth/productionBoardTemplates.js";
import { getJobDetail } from "../jobTruth/jobService.js";
import { calculateJobStatusSnapshot } from "../jobTruth/jobStatusEngine.js";
import { syncJobWatchFlags } from "../jobTruth/watchFlagEngine.js";
import type { AuthUser } from "../../types/auth.js";
import type { RepairActionListItem, RepairPreviewResponse } from "../../types/diagnostics.js";
import type { JobDraftInput, JobStatusSnapshot } from "../../types/jobTruth.js";
import { runDiagnosticRules } from "./diagnosticsRuleService.js";
import { writeAuditEvent } from "./auditEventService.js";

type RepairActionKey =
  | "job.regenerate_default_production_item"
  | "job.recompute_derived_status"
  | "diagnostics.rescan_record";

type RepairActionRequest = {
  actionKey: RepairActionKey;
  resourceType: string;
  resourceId: string | null;
  reason?: string | null;
  input?: Record<string, unknown> | null;
};

type RepairPreviewData = {
  beforeSnapshot: Record<string, unknown> | null;
  projectedAfterSnapshot: Record<string, unknown> | null;
  previewSummary: RepairPreviewResponse["preview_summary"];
  noOp: boolean;
};

function isRepairActionKey(value: string): value is RepairActionKey {
  return [
    "job.regenerate_default_production_item",
    "job.recompute_derived_status",
    "diagnostics.rescan_record"
  ].includes(value);
}

async function loadRepairAction(client: PoolClient, tenantId: string, actionId: string): Promise<RepairActionListItem> {
  const { rows } = await client.query<RepairActionListItem>(
    `
      SELECT
        action.id::text,
        action.tenant_id::text,
        action.action_key,
        action.resource_type,
        action.resource_id,
        action.requested_by_user_id::text,
        action.approved_by_user_id::text,
        action.executed_by_user_id::text,
        action.status,
        action.dry_run,
        action.input_json,
        action.before_snapshot_json,
        action.after_snapshot_json,
        action.result_summary_json,
        action.created_at,
        action.executed_at,
        action.rolled_back_at,
        requester.full_name AS requested_by_name,
        approver.full_name AS approved_by_name,
        executor.full_name AS executed_by_name
      FROM repair_actions action
      LEFT JOIN app_user requester ON requester.id = action.requested_by_user_id AND requester.tenant_id = action.tenant_id
      LEFT JOIN app_user approver ON approver.id = action.approved_by_user_id AND approver.tenant_id = action.tenant_id
      LEFT JOIN app_user executor ON executor.id = action.executed_by_user_id AND executor.tenant_id = action.tenant_id
      WHERE action.tenant_id = $1
        AND action.id = $2::uuid
      LIMIT 1
    `,
    [tenantId, actionId]
  );

  if (!rows[0]) {
    throw new ApiError(404, "Repair action not found");
  }

  return rows[0];
}

async function insertRepairAction(
  client: PoolClient,
  auth: AuthUser,
  input: {
    actionKey: RepairActionKey;
    resourceType: string;
    resourceId: string | null;
    dryRun: boolean;
    status: RepairActionListItem["status"];
    requestInput?: Record<string, unknown> | null;
    beforeSnapshot?: Record<string, unknown> | null;
    afterSnapshot?: Record<string, unknown> | null;
    resultSummary?: Record<string, unknown> | null;
  }
) {
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO repair_actions (
        tenant_id,
        action_key,
        resource_type,
        resource_id,
        requested_by_user_id,
        approved_by_user_id,
        executed_by_user_id,
        status,
        dry_run,
        input_json,
        before_snapshot_json,
        after_snapshot_json,
        result_summary_json,
        executed_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::repair_action_status_type,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14)
      RETURNING id::text
    `,
    [
      auth.tenantId,
      input.actionKey,
      input.resourceType,
      input.resourceId,
      auth.id,
      input.dryRun ? null : auth.id,
      input.dryRun ? null : auth.id,
      input.status,
      input.dryRun,
      input.requestInput == null ? null : JSON.stringify(input.requestInput),
      input.beforeSnapshot == null ? null : JSON.stringify(input.beforeSnapshot),
      input.afterSnapshot == null ? null : JSON.stringify(input.afterSnapshot),
      input.resultSummary == null ? null : JSON.stringify(input.resultSummary),
      input.dryRun ? null : new Date().toISOString()
    ]
  );

  return loadRepairAction(client, auth.tenantId, rows[0].id);
}

async function completeRepairAction(
  client: PoolClient,
  auth: AuthUser,
  actionId: string,
  input: {
    status: RepairActionListItem["status"];
    afterSnapshot?: Record<string, unknown> | null;
    resultSummary?: Record<string, unknown> | null;
  }
) {
  await client.query(
    `
      UPDATE repair_actions
      SET
        approved_by_user_id = COALESCE(approved_by_user_id, $3::uuid),
        executed_by_user_id = COALESCE(executed_by_user_id, $3::uuid),
        status = $4::repair_action_status_type,
        after_snapshot_json = $5::jsonb,
        result_summary_json = $6::jsonb,
        executed_at = COALESCE(executed_at, now())
      WHERE tenant_id = $1
        AND id = $2::uuid
    `,
    [
      auth.tenantId,
      actionId,
      auth.id,
      input.status,
      input.afterSnapshot == null ? null : JSON.stringify(input.afterSnapshot),
      input.resultSummary == null ? null : JSON.stringify(input.resultSummary)
    ]
  );

  return loadRepairAction(client, auth.tenantId, actionId);
}

function toAdapterInput(detail: Awaited<ReturnType<typeof getJobDetail>>): JobDraftInput {
  return {
    department_type: detail.job.department_type,
    job_category: detail.job.job_category,
    title: detail.job.title,
    event_name: detail.job.event_name,
    production_required: detail.job.production_required,
    school_profile: detail.school_profile ?? undefined,
    sports_profile: detail.sports_profile ?? undefined
  };
}

async function previewRegenerateProduction(
  client: PoolClient,
  auth: AuthUser,
  resourceId: string | null
): Promise<RepairPreviewData> {
  if (!resourceId) {
    throw new ApiError(400, "A job resource id is required.");
  }

  const detail = await getJobDetail(client, auth, resourceId);
  const adapter = getDepartmentJobAdapter(detail.job.department_type);
  const defaultConfig = adapter.getDefaultProductionConfig(toAdapterInput(detail));
  const existingCount = detail.production_items.length;
  const shouldCreate = detail.job.production_required && existingCount === 0;

  return {
    beforeSnapshot: {
      job_id: detail.job.id,
      production_required: detail.job.production_required,
      existing_production_item_count: existingCount
    },
    projectedAfterSnapshot: shouldCreate
      ? {
          production_item_count: existingCount + 1,
          created_title: defaultConfig.title,
          created_type: defaultConfig.production_type
        }
      : {
          production_item_count: existingCount
        },
    previewSummary: {
      risk_level: "low",
      reversible: false,
      changes: shouldCreate
        ? [`Create shared production item "${defaultConfig.title}" (${defaultConfig.production_type}).`]
        : detail.job.production_required
          ? ["No repair needed because this job already has shared production items."]
          : ["No repair needed because this job is not marked as requiring downstream production."]
    },
    noOp: !shouldCreate
  };
}

function summarizeStatusDelta(detail: Awaited<ReturnType<typeof getJobDetail>>, snapshot: JobStatusSnapshot) {
  const changes: string[] = [];
  if (detail.job.job_status !== snapshot.job_status) {
    changes.push(`Job status ${detail.job.job_status} -> ${snapshot.job_status}`);
  }
  if (detail.job.production_status !== snapshot.production_status) {
    changes.push(`Production status ${detail.job.production_status} -> ${snapshot.production_status}`);
  }
  if (detail.job.staffing_status !== snapshot.staffing_status) {
    changes.push(`Staffing status ${detail.job.staffing_status} -> ${snapshot.staffing_status}`);
  }
  if (detail.job.readiness_status !== snapshot.readiness_status) {
    changes.push(`Readiness status ${detail.job.readiness_status} -> ${snapshot.readiness_status}`);
  }
  if (detail.job.risk_status !== snapshot.risk_status) {
    changes.push(`Risk status ${detail.job.risk_status} -> ${snapshot.risk_status}`);
  }
  return changes;
}

async function previewRecomputeDerivedStatus(
  client: PoolClient,
  auth: AuthUser,
  resourceId: string | null
): Promise<RepairPreviewData> {
  if (!resourceId) {
    throw new ApiError(400, "A job resource id is required.");
  }

  const detail = await getJobDetail(client, auth, resourceId);
  const snapshot = calculateJobStatusSnapshot({
    job: detail.job,
    days: detail.days,
    readinessItems: detail.readiness_items,
    staffAssignments: detail.staff_assignments,
    productionItems: detail.production_items,
    approvalRequests: detail.approval_requests,
    qaReviews: detail.qa_reviews,
    qaFindings: detail.qa_findings,
    deliverableItems: detail.deliverable_items,
    productionIssues: detail.production_issues,
    watchFlags: detail.watch_flags,
    activity: []
  });
  const changes = summarizeStatusDelta(detail, snapshot);

  return {
    beforeSnapshot: {
      job_status: detail.job.job_status,
      production_status: detail.job.production_status,
      staffing_status: detail.job.staffing_status,
      readiness_status: detail.job.readiness_status,
      risk_status: detail.job.risk_status
    },
    projectedAfterSnapshot: {
      job_status: snapshot.job_status,
      production_status: snapshot.production_status,
      staffing_status: snapshot.staffing_status,
      readiness_status: snapshot.readiness_status,
      risk_status: snapshot.risk_status,
      blocker_count: snapshot.blocker_count,
      open_watch_flag_count: snapshot.open_watch_flag_count
    },
    previewSummary: {
      risk_level: "low",
      reversible: false,
      changes: changes.length > 0 ? changes : ["No derived job status drift was detected."]
    },
    noOp: changes.length === 0
  };
}

async function previewDiagnosticsRescan(
  client: PoolClient,
  auth: AuthUser,
  input: RepairActionRequest
): Promise<RepairPreviewData> {
  if (!input.resourceId) {
    throw new ApiError(400, "A resource id is required to rescan diagnostics.");
  }

  const existing = await client.query<{ open_count: string }>(
    `
      SELECT count(*)::text AS open_count
      FROM diagnostic_findings
      WHERE tenant_id = $1
        AND (
          (resource_type = $2 AND resource_id = $3)
          OR (related_resource_type = $2 AND related_resource_id = $3)
        )
        AND status IN ('open', 'acknowledged', 'in_review')
    `,
    [auth.tenantId, input.resourceType, input.resourceId]
  );

  return {
    beforeSnapshot: {
      existing_open_finding_count: Number(existing.rows[0]?.open_count ?? "0")
    },
    projectedAfterSnapshot: {
      scan_scope: `${input.resourceType}:${input.resourceId}`
    },
    previewSummary: {
      risk_level: "low",
      reversible: true,
      changes: ["Run shared diagnostics rules against this record and refresh any matching findings."]
    },
    noOp: false
  };
}

async function buildRepairPreviewData(
  client: PoolClient,
  auth: AuthUser,
  input: RepairActionRequest
): Promise<RepairPreviewData> {
  switch (input.actionKey) {
    case "job.regenerate_default_production_item":
      if (input.resourceType !== "job") {
        throw new ApiError(400, "This repair action only supports job resources.");
      }
      return previewRegenerateProduction(client, auth, input.resourceId);
    case "job.recompute_derived_status":
      if (input.resourceType !== "job") {
        throw new ApiError(400, "This repair action only supports job resources.");
      }
      return previewRecomputeDerivedStatus(client, auth, input.resourceId);
    case "diagnostics.rescan_record":
      return previewDiagnosticsRescan(client, auth, input);
    default:
      throw new ApiError(400, "Unsupported repair action.");
  }
}

async function updateJobStatusFields(
  client: PoolClient,
  auth: AuthUser,
  jobId: string,
  snapshot: JobStatusSnapshot
) {
  await client.query(
    `
      UPDATE jobs
      SET
        job_status = $3::job_status_type,
        production_status = $4::job_production_status_type,
        staffing_status = $5::job_staffing_status_type,
        readiness_status = $6::job_readiness_status_type,
        risk_status = $7::job_risk_status_type,
        updated_by_user_id = $8::uuid,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2::uuid
    `,
    [
      auth.tenantId,
      jobId,
      snapshot.job_status,
      snapshot.production_status,
      snapshot.staffing_status,
      snapshot.readiness_status,
      snapshot.risk_status,
      auth.id
    ]
  );
}

async function recomputeJobDerivedState(client: PoolClient, auth: AuthUser, jobId: string) {
  const before = await getJobDetail(client, auth, jobId);
  const firstSnapshot = calculateJobStatusSnapshot({
    job: before.job,
    days: before.days,
    readinessItems: before.readiness_items,
    staffAssignments: before.staff_assignments,
    productionItems: before.production_items,
    approvalRequests: before.approval_requests,
    qaReviews: before.qa_reviews,
    qaFindings: before.qa_findings,
    deliverableItems: before.deliverable_items,
    productionIssues: before.production_issues,
    watchFlags: before.watch_flags,
    activity: []
  });

  await updateJobStatusFields(client, auth, jobId, firstSnapshot);
  await syncJobWatchFlags(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    job: before.job,
    days: before.days,
    readinessItems: before.readiness_items,
    staffAssignments: before.staff_assignments,
    productionItems: before.production_items,
    approvalRequests: before.approval_requests,
    qaReviews: before.qa_reviews,
    qaFindings: before.qa_findings,
    deliverableItems: before.deliverable_items,
    productionIssues: before.production_issues,
    existingFlags: before.watch_flags,
    status: firstSnapshot,
    activity: []
  });

  const after = await getJobDetail(client, auth, jobId);
  const finalSnapshot = calculateJobStatusSnapshot({
    job: after.job,
    days: after.days,
    readinessItems: after.readiness_items,
    staffAssignments: after.staff_assignments,
    productionItems: after.production_items,
    approvalRequests: after.approval_requests,
    qaReviews: after.qa_reviews,
    qaFindings: after.qa_findings,
    deliverableItems: after.deliverable_items,
    productionIssues: after.production_issues,
    watchFlags: after.watch_flags,
    activity: []
  });
  await updateJobStatusFields(client, auth, jobId, finalSnapshot);

  return {
    before,
    after: await getJobDetail(client, auth, jobId),
    finalSnapshot
  };
}

async function executeRegenerateProduction(
  client: PoolClient,
  auth: AuthUser,
  resourceId: string | null
) {
  if (!resourceId) {
    throw new ApiError(400, "A job resource id is required.");
  }

  const detail = await getJobDetail(client, auth, resourceId);
  const adapter = getDepartmentJobAdapter(detail.job.department_type);
  const defaultConfig = adapter.getDefaultProductionConfig(toAdapterInput(detail));
  const plan = buildDepartmentProductionTemplatePlan({
    departmentType: detail.job.department_type,
    jobCategory: detail.job.job_category,
    title: defaultConfig.title,
    productionType: defaultConfig.production_type,
    proofRequired: defaultConfig.proof_required,
    schoolProfile: detail.school_profile,
    sportsProfile: detail.sports_profile
  });
  if (!detail.job.production_required || detail.production_items.length > 0) {
    return {
      noOp: true,
      afterSnapshot: {
        production_item_count: detail.production_items.length
      },
      resultSummary: {
        message: detail.job.production_required
          ? "No production item created because one already exists."
          : "No production item created because the job does not require downstream production."
      }
    };
  }

  const inserted = await client.query<{ id: string; title: string; production_type: string }>(
    `
      INSERT INTO production_items (
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
        organization_id,
        location_id,
        primary_contact_id,
        account_owner_user_id,
        department_type,
        approval_required,
        proof_required,
        qa_required,
        due_at,
        delivery_deadline_at,
        release_due_at,
        shoot_date_start,
        shoot_date_end,
        legacy_source_reference,
        file_match_status,
        qa_status
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,
        'repair',
        'queued'::job_production_status_type,
        'DRAFT'::production_board_workflow_status_type,
        'ON_TRACK'::production_board_health_state_type,
        'CLEAN'::production_board_sync_state_type,
        $9,$10,$11,$12,$13,$14,false,$15,false,$16,$17,$18,$19,$20,$21,
        'UNKNOWN'::production_board_file_match_status_type,
        'not_started'
      )
      RETURNING id::text, title, production_type
    `,
    [
      auth.tenantId,
      detail.job.id,
      `${detail.job.department_type}:${detail.job.id}:repair`,
      plan.title,
      detail.job.job_category,
      plan.productionType,
      plan.templateKey,
      plan.completionRuleKey,
      detail.job.priority_level,
      detail.job.organization_id,
      detail.job.primary_location_id,
      detail.job.primary_contact_id,
      detail.job.account_owner_user_id,
      detail.job.department_type,
      plan.proofRequired,
      detail.job.production_deadline_at,
      detail.job.client_deadline_at,
      detail.job.client_deadline_at,
      detail.job.scheduled_start_at ? new Date(detail.job.scheduled_start_at).toISOString().slice(0, 10) : null,
      detail.job.scheduled_end_at
        ? new Date(detail.job.scheduled_end_at).toISOString().slice(0, 10)
        : detail.job.scheduled_start_at
          ? new Date(detail.job.scheduled_start_at).toISOString().slice(0, 10)
          : null,
      detail.job.legacy_shoot_id
    ]
  );

  const linkedShootIds = detail.job_shoot_links.length
    ? detail.job_shoot_links.map((link) => link.shoot_id)
    : detail.job.legacy_shoot_id
      ? [detail.job.legacy_shoot_id]
      : [];
  for (const shootId of [...new Set(linkedShootIds)]) {
    await client.query(
      `
        INSERT INTO production_item_shoot_links (tenant_id, production_item_id, shoot_id)
        VALUES ($1,$2::uuid,$3::uuid)
        ON CONFLICT (tenant_id, production_item_id, shoot_id) DO NOTHING
      `,
      [auth.tenantId, inserted.rows[0].id, shootId]
    );
  }

  for (const seed of plan.deliverableSeeds) {
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
        VALUES ($1,$2::uuid,$3,$4,$5,$6,null,$7,$8::job_deliverable_status_type,$9,$10)
      `,
      [
        auth.tenantId,
        inserted.rows[0].id,
        seed.deliverable_type,
        seed.deliverable_group_key ?? null,
        seed.completion_marker_key ?? null,
        seed.title,
        seed.delivery_method,
        seed.status ?? "not_started",
        seed.vendor_name ?? null,
        seed.legacy_source_reference ?? null
      ]
    );
  }

  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    departmentType: detail.job.department_type,
    jobId: detail.job.id,
    productionItemId: inserted.rows[0].id,
    eventType: "repair_generated_production_item",
    summary: `Repair generated production item ${inserted.rows[0].title}`,
    metadata: {
      repair_action: "job.regenerate_default_production_item",
      production_type: inserted.rows[0].production_type,
      production_template_key: plan.templateKey,
      completion_rule_key: plan.completionRuleKey,
      linked_shoot_count: linkedShootIds.length,
      deliverable_seed_count: plan.deliverableSeeds.length
    },
    sourceSurface: "admin_system_repairs"
  });

  const refreshed = await recomputeJobDerivedState(client, auth, detail.job.id);
  return {
    noOp: false,
    afterSnapshot: {
      production_item_id: inserted.rows[0].id,
      production_item_count: refreshed.after.production_items.length
    },
    resultSummary: {
      message: "Default production item created and shared job state recomputed."
    }
  };
}

async function executeRecomputeDerivedStatus(
  client: PoolClient,
  auth: AuthUser,
  resourceId: string | null
) {
  if (!resourceId) {
    throw new ApiError(400, "A job resource id is required.");
  }

  const refreshed = await recomputeJobDerivedState(client, auth, resourceId);
  return {
    noOp: false,
    afterSnapshot: {
      job_status: refreshed.after.job.job_status,
      production_status: refreshed.after.job.production_status,
      staffing_status: refreshed.after.job.staffing_status,
      readiness_status: refreshed.after.job.readiness_status,
      risk_status: refreshed.after.job.risk_status
    },
    resultSummary: {
      message: "Derived job statuses and shared watch flags were recomputed."
    }
  };
}

async function executeDiagnosticsRescan(client: PoolClient, auth: AuthUser, input: RepairActionRequest) {
  if (!input.resourceId) {
    throw new ApiError(400, "A resource id is required to rescan diagnostics.");
  }

  const runs = await runDiagnosticRules(client, auth, {
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    ruleKey: typeof input.input?.rule_key === "string" ? input.input.rule_key : null,
    triggerType: "repair"
  });

  return {
    noOp: false,
    afterSnapshot: {
      run_count: runs.length
    },
    resultSummary: {
      runs: runs.map((run) => ({
        rule_key: run.run.rule_key,
        findings_created: run.findings_created,
        findings_updated: run.findings_updated,
        findings_resolved: run.findings_resolved
      }))
    }
  };
}

export async function previewRepairAction(
  client: PoolClient,
  auth: AuthUser,
  input: RepairActionRequest
): Promise<RepairPreviewResponse> {
  if (!isRepairActionKey(input.actionKey)) {
    throw new ApiError(400, "Unsupported repair action.");
  }

  const preview = await buildRepairPreviewData(client, auth, input);
  const repairAction = await insertRepairAction(client, auth, {
    actionKey: input.actionKey,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    dryRun: true,
    status: "dry_run_complete",
    requestInput: {
      reason: input.reason ?? null,
      ...(input.input ?? {})
    },
    beforeSnapshot: preview.beforeSnapshot,
    afterSnapshot: preview.projectedAfterSnapshot,
    resultSummary: preview.previewSummary
  });

  await writeAuditEvent(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    eventCategory: "diagnostics",
    eventType: "repair_preview_created",
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    oldValues: preview.beforeSnapshot,
    newValues: preview.projectedAfterSnapshot,
    context: {
      repair_action_id: repairAction.id,
      repair_action_key: input.actionKey,
      preview: true
    },
    result: "allowed"
  });

  return {
    repair_action: repairAction,
    preview_summary: preview.previewSummary
  };
}

export async function executeRepairAction(
  client: PoolClient,
  auth: AuthUser,
  input: RepairActionRequest
) {
  if (!isRepairActionKey(input.actionKey)) {
    throw new ApiError(400, "Unsupported repair action.");
  }

  const preview = await buildRepairPreviewData(client, auth, input);
  const repairAction = await insertRepairAction(client, auth, {
    actionKey: input.actionKey,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    dryRun: false,
    status: "executing",
    requestInput: {
      reason: input.reason ?? null,
      ...(input.input ?? {})
    },
    beforeSnapshot: preview.beforeSnapshot
  });

  const execution =
    input.actionKey === "job.regenerate_default_production_item"
      ? await executeRegenerateProduction(client, auth, input.resourceId)
      : input.actionKey === "job.recompute_derived_status"
        ? await executeRecomputeDerivedStatus(client, auth, input.resourceId)
        : await executeDiagnosticsRescan(client, auth, input);

  const completed = await completeRepairAction(client, auth, repairAction.id, {
    status: "completed",
    afterSnapshot: execution.afterSnapshot,
    resultSummary: execution.resultSummary
  });

  await writeAuditEvent(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    eventCategory: "diagnostics",
    eventType: "repair_action_completed",
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    oldValues: preview.beforeSnapshot,
    newValues: execution.afterSnapshot,
    context: {
      repair_action_id: completed.id,
      repair_action_key: input.actionKey,
      no_op: execution.noOp,
      reason: input.reason ?? null
    },
    result: execution.noOp ? "no_op" : "completed"
  });

  return completed;
}
