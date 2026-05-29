import { ApiError } from "../../errors/apiError.js";
import type {
  DayReadyRequirementsConfig,
  ProductionFinalReleaseStatusesConfig,
  ProductionReleaseBlockersConfig
} from "../../types/adminConfiguration.js";
import type { ChecklistTransitionValidation } from "../../types/checklists.js";
import type {
  ApprovalRequestRecord,
  JobDayRecord,
  JobReadinessItemRecord,
  JobRecord,
  JobStaffAssignmentRecord,
  JobStatusSnapshot,
  JobValidationIssue,
  JobValidationResult,
  JobWatchFlagRecord,
  JobWorkflowSummary,
  ProductionIssueRecord,
  ProductionItemRecord,
  WorkflowCheckpointSummary,
  WorkflowIssue,
  WorkflowTransitionValidation
} from "../../types/jobTruth.js";

type JobWorkflowSummaryContext = {
  job: JobRecord;
  days: JobDayRecord[];
  staffAssignments: JobStaffAssignmentRecord[];
  readinessItems: JobReadinessItemRecord[];
  productionItems: ProductionItemRecord[];
  approvalRequests: ApprovalRequestRecord[];
  productionIssues: ProductionIssueRecord[];
  watchFlags: JobWatchFlagRecord[];
  status: JobStatusSnapshot;
  publishValidation: JobValidationResult;
};

type JobDayReadyTransitionContext = {
  jobId: string;
  day: JobDayRecord;
  staffAssignments: JobStaffAssignmentRecord[];
  readinessItems: JobReadinessItemRecord[];
  managerOverride: boolean;
  rules?: DayReadyRequirementsConfig | null;
  input: {
    on_site_confirmed?: boolean | null;
    setup_complete?: boolean | null;
    all_required_staff_present?: boolean | null;
    blockers_resolved?: boolean | null;
    equipment_ready?: boolean | null;
    client_contact_checked_in?: boolean | null;
  };
};

type ProductionWorkflowTransitionContext = {
  jobId: string;
  item: ProductionItemRecord | null;
  approvalRequests: ApprovalRequestRecord[];
  productionIssues: ProductionIssueRecord[];
  rules?: ProductionReleaseBlockersConfig | null;
  finalReleaseStatuses?: ProductionFinalReleaseStatusesConfig | null;
  input: {
    workflow_status?: ProductionItemRecord["workflow_status"] | null;
    upload_status?: ProductionItemRecord["upload_status"] | null;
    release_status?: ProductionItemRecord["release_status"] | null;
    peer_review_complete?: boolean | null;
    final_release_review_complete?: boolean | null;
    approval_required?: boolean | null;
    proof_required?: boolean | null;
    gallery_or_output_reference?: string | null;
    vendor_reference?: string | null;
    release_target?: string | null;
    assigned_to_user_id?: string | null;
  };
  checklistValidation?: ChecklistTransitionValidation | null;
};

export const OPERATIONAL_WORKFLOW_STATE_MODELS = {
  job: ["draft", "pending_confirmation", "confirmed", "ready_to_staff", "staffed", "ready_to_execute", "in_progress", "execution_complete", "postponed", "weather_hold", "cancelled", "archived"],
  staffing_readiness: ["unassigned", "partially_staffed", "staffed", "checked_in", "ready_confirmed", "gap_flagged"],
  production_item: ["DRAFT", "WAITING_ON_INTAKE", "WAITING_ON_FILES", "INTAKE_REVIEW", "READY_FOR_PRODUCTION", "IN_PRODUCTION", "READY_FOR_QA", "IN_PEER_REVIEW", "REWORK_REQUIRED", "READY_FOR_UPLOAD", "UPLOADING", "UPLOADED", "READY_FOR_RELEASE", "RELEASED", "SENT_TO_VENDOR", "DELIVERED_CLOSED", "ON_HOLD", "BLOCKED", "CANCELLED"],
  approval_request: ["not_required", "not_started", "requested", "viewed", "approved", "rejected", "revisions_requested", "overdue", "cancelled"],
  evaluation: ["draft", "submitted", "reviewed", "closed"]
} as const;

const RELEASE_WORKFLOW_STATUSES = new Set<ProductionItemRecord["workflow_status"]>([
  "READY_FOR_RELEASE",
  "RELEASED",
  "SENT_TO_VENDOR",
  "DELIVERED_CLOSED"
]);

const UPLOAD_WORKFLOW_STATUSES = new Set<ProductionItemRecord["workflow_status"]>([
  "READY_FOR_UPLOAD",
  "UPLOADING",
  "UPLOADED",
  ...RELEASE_WORKFLOW_STATUSES
]);

const RELEASE_STATUSES = new Set<NonNullable<ProductionItemRecord["release_status"]>>([
  "READY_FOR_RELEASE",
  "RELEASED",
  "SENT_TO_VENDOR",
  "DELIVERED",
  "CLOSED"
]);

const UPLOAD_STATUSES = new Set<NonNullable<ProductionItemRecord["upload_status"]>>([
  "READY",
  "UPLOADING",
  "UPLOADED",
  "VERIFIED"
]);

const EXECUTION_COMPLETE_JOB_STATUSES = new Set<JobRecord["job_status"]>(["execution_complete", "in_progress"]);
const EXECUTION_COMPLETE_DAY_STATUSES = new Set<JobDayRecord["day_status"]>(["complete", "in_progress"]);

const DEFAULT_DAY_READY_RULES: DayReadyRequirementsConfig = {
  require_lead_assigned: true,
  missing_lead_level: "hard_block",
  require_on_site_confirmed: true,
  require_setup_complete: true,
  require_all_required_staff_present: true,
  require_blockers_resolved: true,
  require_equipment_ready: false,
  require_client_contact_checked_in: false,
  manager_override_downgrades: true
};

const DEFAULT_PRODUCTION_RELEASE_BLOCKERS: ProductionReleaseBlockersConfig = {
  require_peer_review_for_upload: true,
  require_final_review_for_release: true,
  require_approval_when_required: true,
  require_proof_reference_when_required: true,
  require_no_blocking_issues_for_final_release: true
};

const DEFAULT_FINAL_RELEASE_STATUSES: ProductionFinalReleaseStatusesConfig = {
  statuses: ["RELEASED", "SENT_TO_VENDOR", "DELIVERED", "CLOSED"]
};

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function humanizeToken(value: string) {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function countIssues(issues: WorkflowIssue[]) {
  return {
    blocker_count: issues.filter((issue) => issue.level === "hard_block").length,
    warning_count: issues.filter((issue) => issue.level === "warning").length
  };
}

function deriveCheckpointState(issues: WorkflowIssue[]): WorkflowCheckpointSummary["state"] {
  if (issues.some((issue) => issue.level === "hard_block")) {
    return "blocked";
  }
  if (issues.length) {
    return "warning";
  }
  return "clear";
}

function buildCheckpoint(
  key: string,
  label: string,
  issues: WorkflowIssue[],
  clearSummary: string,
  warningSummary: string,
  blockedSummary: string,
  nextAction: string | null = null
): WorkflowCheckpointSummary {
  const { blocker_count, warning_count } = countIssues(issues);
  return {
    key,
    label,
    state: deriveCheckpointState(issues),
    blocker_count,
    warning_count,
    summary: blocker_count > 0 ? blockedSummary : warning_count > 0 ? warningSummary : clearSummary,
    next_action: nextAction ?? issues.find((issue) => issue.action_label)?.action_label ?? null,
    issues
  };
}

function issueFromValidation(jobId: string, issue: JobValidationIssue): WorkflowIssue {
  return {
    code: issue.code || "validation",
    level: "hard_block",
    subject_type: "job",
    subject_id: jobId,
    field: issue.field ?? null,
    message: issue.message,
    action_label: mapFieldToActionLabel(issue.field),
    metadata: issue.field ? { field: issue.field } : null
  };
}

function mapFieldToActionLabel(field: string | null | undefined) {
  switch (field) {
    case "organization_id":
      return "Link the organization";
    case "primary_location_id":
      return "Set the location";
    case "primary_contact_id":
      return "Set the primary contact";
    case "timezone":
      return "Set the timezone";
    case "days":
      return "Add an execution day";
    case "title":
      return "Add a job title";
    default:
      return "Resolve the required job data";
  }
}

function buildIssue(
  code: string,
  level: WorkflowIssue["level"],
  subjectType: WorkflowIssue["subject_type"],
  subjectId: string | null,
  message: string,
  options: {
    field?: string | null;
    actionLabel?: string | null;
    metadata?: Record<string, unknown> | null;
  } = {}
): WorkflowIssue {
  return {
    code,
    level,
    subject_type: subjectType,
    subject_id: subjectId,
    field: options.field ?? null,
    message,
    action_label: options.actionLabel ?? null,
    metadata: options.metadata ?? null
  };
}

function mapChecklistIssues(
  subjectId: string | null,
  validation: ChecklistTransitionValidation | null | undefined
): WorkflowIssue[] {
  if (!validation || validation.allowed) {
    return [];
  }
  return validation.issues.map((issue) =>
    buildIssue(
      "checklist_transition_blocked",
      issue.blocking_level === "hard_block" ? "hard_block" : "warning",
      "production_item",
      subjectId,
      issue.message,
      {
        actionLabel: issue.missing_approval ? "Finish checklist approval" : "Complete required checklist work",
        metadata: {
          template_code: issue.template_code,
          template_name: issue.template_name,
          instance_id: issue.instance_id,
          missing_item_labels: issue.missing_item_labels,
          missing_proof_item_labels: issue.missing_proof_item_labels,
          missing_approval: issue.missing_approval
        }
      }
    )
  );
}

function hasApprovedApproval(approvalRequests: ApprovalRequestRecord[], productionItemId: string | null) {
  if (!productionItemId) {
    return false;
  }
  return approvalRequests.some((request) => request.production_item_id === productionItemId && request.status === "approved");
}

function isApprovalPending(status: ApprovalRequestRecord["status"]) {
  return ["requested", "viewed"].includes(status);
}

function isApprovalBlocking(status: ApprovalRequestRecord["status"]) {
  return ["overdue", "rejected", "revisions_requested"].includes(status);
}

function buildReadinessCheckpointIssues(context: JobWorkflowSummaryContext) {
  const issues: WorkflowIssue[] = [];
  const incompleteRequired = context.readinessItems.filter((item) => item.is_required && !item.is_complete);
  const daysWithoutLead = context.days.filter((day) => {
    if (day.lead_user_id) {
      return false;
    }
    return !context.staffAssignments.some(
      (assignment) =>
        assignment.is_lead &&
        assignment.assignment_status !== "cancelled" &&
        (assignment.job_day_id === day.id || assignment.job_day_id == null)
    );
  });

  for (const item of incompleteRequired) {
    issues.push(
      buildIssue(
        item.is_blocker ? "readiness_blocker_incomplete" : "readiness_required_incomplete",
        "hard_block",
        item.job_day_id ? "job_day" : "job",
        item.job_day_id ?? context.job.id,
        `${item.label} is still incomplete.`,
        {
          field: item.section_key,
          actionLabel: "Complete readiness work",
          metadata: {
            readiness_item_id: item.id,
            job_day_id: item.job_day_id,
            due_at: item.due_at,
            is_blocker: item.is_blocker
          }
        }
      )
    );
  }

  for (const day of daysWithoutLead) {
    issues.push(
      buildIssue("day_lead_missing", "warning", "job_day", day.id, `${day.day_label ?? day.date} does not have a lead assigned yet.`, {
        field: "lead_user_id",
        actionLabel: "Assign a lead",
        metadata: { day_id: day.id }
      })
    );
  }

  if (context.status.staffing_status === "unassigned" || context.status.staffing_status === "gap_flagged") {
    issues.push(
      buildIssue("staffing_gap_open", "warning", "job", context.job.id, "Staffing still has open gaps that could impact readiness.", {
        actionLabel: "Resolve staffing gaps",
        metadata: { staffing_status: context.status.staffing_status }
      })
    );
  }

  return issues;
}

function buildProductionCheckpointIssues(context: JobWorkflowSummaryContext) {
  if (!context.job.production_required) {
    return [];
  }
  const issues: WorkflowIssue[] = [];
  if (!context.productionItems.length) {
    issues.push(
      buildIssue("production_item_missing", "hard_block", "job", context.job.id, "This job requires downstream production work, but no production item exists yet.", {
        actionLabel: "Create the production item"
      })
    );
    return issues;
  }

  for (const item of context.productionItems) {
    if (item.workflow_status === "BLOCKED" || item.blocked_reason || item.blocker_count > 0) {
      issues.push(
        buildIssue("production_item_blocked", "hard_block", "production_item", item.id, `${item.title} is blocked and cannot move forward cleanly.`, {
          actionLabel: "Resolve the production blocker",
          metadata: { workflow_status: item.workflow_status, blocked_reason: item.blocked_reason }
        })
      );
    }

    if (item.approval_required && !hasApprovedApproval(context.approvalRequests, item.id)) {
      issues.push(
        buildIssue("production_approval_pending", "warning", "production_item", item.id, `${item.title} still needs approval sign-off before final release.`, {
          actionLabel: "Track approval status"
        })
      );
    }
  }

  const blockingIssues = context.productionIssues.filter((issue) => issue.is_blocking && !["resolved", "dismissed"].includes(issue.status));
  if (blockingIssues.length) {
    issues.push(
      buildIssue("production_issue_open", "hard_block", "job", context.job.id, `${blockingIssues.length} blocking production issue${blockingIssues.length === 1 ? "" : "s"} remain open.`, {
        actionLabel: "Resolve production issues",
        metadata: { blocking_issue_ids: blockingIssues.map((issue) => issue.id) }
      })
    );
  }

  return issues;
}

function buildApprovalCheckpointIssues(context: JobWorkflowSummaryContext) {
  const issues: WorkflowIssue[] = [];
  const approvalRequiredWithoutRequest = context.productionItems.filter(
    (item) => item.approval_required && !context.approvalRequests.some((request) => request.production_item_id === item.id)
  );

  for (const item of approvalRequiredWithoutRequest) {
    issues.push(
      buildIssue("approval_request_missing", "warning", "production_item", item.id, `${item.title} is approval-gated but no approval request is open yet.`, {
        actionLabel: "Create an approval request"
      })
    );
  }

  for (const request of context.approvalRequests) {
    if (isApprovalBlocking(request.status)) {
      issues.push(
        buildIssue("approval_blocking", "hard_block", "approval_request", request.id, `Approval ${humanizeToken(request.status)}: ${request.summary ?? "Follow-up is required before finalizing this work."}`, {
          actionLabel: request.status === "rejected" || request.status === "revisions_requested" ? "Address the requested changes" : "Resolve the approval blocker",
          metadata: { production_item_id: request.production_item_id, status: request.status, due_at: request.due_at }
        })
      );
    } else if (isApprovalPending(request.status)) {
      issues.push(
        buildIssue("approval_pending", "warning", "approval_request", request.id, `Approval is ${humanizeToken(request.status)} for ${request.summary ?? "a linked production item"}.`, {
          actionLabel: "Follow up on approval",
          metadata: { production_item_id: request.production_item_id, status: request.status, due_at: request.due_at }
        })
      );
    }
  }

  return issues;
}

function buildEvaluationCheckpointIssues(context: JobWorkflowSummaryContext) {
  const executionHasStarted =
    EXECUTION_COMPLETE_JOB_STATUSES.has(context.job.job_status) || context.days.some((day) => EXECUTION_COMPLETE_DAY_STATUSES.has(day.day_status));

  if (!executionHasStarted) {
    return [];
  }

  const hasEvaluationSummary = context.productionItems.some((item) => normalizeNullableText(item.post_shoot_eval_summary));
  if (hasEvaluationSummary) {
    return [];
  }

  return [
    buildIssue(
      "post_shoot_evaluation_missing",
      "warning",
      "evaluation",
      null,
      "Execution has started, but no post-shoot evaluation summary is attached to this job yet.",
      {
        actionLabel: "Capture post-shoot evaluation"
      }
    )
  ];
}

export function buildJobWorkflowSummary(context: JobWorkflowSummaryContext): JobWorkflowSummary {
  const publishIssues = context.publishValidation.errors.map((issue) => issueFromValidation(context.job.id, issue));
  const readinessIssues = buildReadinessCheckpointIssues(context);
  const productionIssues = buildProductionCheckpointIssues(context);
  const approvalIssues = buildApprovalCheckpointIssues(context);
  const evaluationIssues = buildEvaluationCheckpointIssues(context);

  return {
    publish: buildCheckpoint(
      "publish",
      "Publish Readiness",
      publishIssues,
      "Required publish data is complete.",
      "Publish is available, but there are warnings worth reviewing.",
      "Required job data is still missing.",
      "Resolve the publish blockers"
    ),
    readiness: buildCheckpoint(
      "readiness",
      "Staffing and Readiness",
      readinessIssues,
      "Readiness and staffing checks are in good shape.",
      "Execution can proceed, but readiness still has warnings.",
      "Readiness blockers still need attention."
    ),
    production: buildCheckpoint(
      "production",
      "Production Workflow",
      productionIssues,
      context.job.production_required ? "Production work is clear to continue." : "No downstream production workflow is required.",
      "Production can continue, but there are open warnings.",
      "Production has active blockers."
    ),
    approvals: buildCheckpoint(
      "approvals",
      "Approvals",
      approvalIssues,
      "No approval gates are currently blocking this job.",
      "There are approvals still in flight.",
      "Approvals are actively blocking downstream work."
    ),
    evaluations: buildCheckpoint(
      "evaluations",
      "Post-Shoot Evaluation",
      evaluationIssues,
      "Evaluation follow-through is satisfied or not needed yet.",
      "Capture the post-shoot evaluation when execution wraps.",
      "Evaluation follow-through still needs attention."
    )
  };
}

export function buildPublishWorkflowValidation(jobId: string, currentState: string | null, validation: JobValidationResult): WorkflowTransitionValidation {
  const issues = validation.errors.map((issue) => issueFromValidation(jobId, issue));
  const { blocker_count, warning_count } = countIssues(issues);
  return {
    subject_type: "job",
    subject_id: jobId,
    transition_key: "job.publish",
    current_state: currentState,
    target_state: "published",
    allowed: blocker_count === 0,
    hard_blocked: blocker_count > 0,
    blocker_count,
    warning_count,
    issues,
    checklist_validation: null
  };
}

export function buildJobDayReadyTransitionValidation(context: JobDayReadyTransitionContext): WorkflowTransitionValidation {
  const issues: WorkflowIssue[] = [];
  const rules = context.rules ?? DEFAULT_DAY_READY_RULES;
  const scopedReadinessItems = context.readinessItems.filter(
    (item) => item.job_day_id == null || item.job_day_id === context.day.id
  );
  const incompleteRequired = scopedReadinessItems.filter((item) => item.is_required && !item.is_complete);
  const matchingLead = context.staffAssignments.find(
    (assignment) =>
      assignment.is_lead &&
      assignment.assignment_status !== "cancelled" &&
      (assignment.job_day_id === context.day.id || assignment.job_day_id == null)
  );

  if (!matchingLead && rules.require_lead_assigned) {
    issues.push(
      buildIssue("lead_assignment_missing", rules.missing_lead_level, "job_day", context.day.id, "A lead must be assigned before this day can be marked ready.", {
        actionLabel: "Assign a lead",
        field: "lead_user_id"
      })
    );
  }

  for (const item of incompleteRequired) {
    issues.push(
      buildIssue(
        item.is_blocker ? "readiness_blocker_incomplete" : "readiness_required_incomplete",
        "hard_block",
        item.job_day_id ? "job_day" : "job",
        item.job_day_id ?? context.jobId,
        `${item.label} must be completed before this day can be marked ready.`,
        {
          actionLabel: "Complete readiness work",
          metadata: { readiness_item_id: item.id, is_blocker: item.is_blocker }
        }
      )
    );
  }

  const booleanChecks: Array<{
    key: keyof JobDayReadyTransitionContext["input"];
    label: string;
    enabled: boolean;
  }> = [
    { key: "on_site_confirmed", label: "On-site arrival is not confirmed yet.", enabled: rules.require_on_site_confirmed },
    { key: "setup_complete", label: "Setup is not complete yet.", enabled: rules.require_setup_complete },
    { key: "all_required_staff_present", label: "Required staff are not all present yet.", enabled: rules.require_all_required_staff_present },
    { key: "blockers_resolved", label: "There are still unresolved blockers on this day.", enabled: rules.require_blockers_resolved }
  ];

  for (const check of booleanChecks) {
    if (check.enabled && context.input[check.key] === false) {
      issues.push(
        buildIssue(
          `ready_confirmation_${check.key}`,
          context.managerOverride && rules.manager_override_downgrades ? "warning" : "hard_block",
          "job_day",
          context.day.id,
          context.managerOverride && rules.manager_override_downgrades
            ? `${check.label} A manager override will record the warning without moving the day to ready.`
            : `${check.label} Manager override is required to continue.`,
          {
            field: "ready_confirmation",
            actionLabel:
              context.managerOverride && rules.manager_override_downgrades
                ? "Document the override"
                : "Resolve the blocker or use manager override",
            metadata: { check: check.key, manager_override: context.managerOverride }
          }
        )
      );
    }
  }

  if (rules.require_equipment_ready && context.input.equipment_ready === false) {
    issues.push(
      buildIssue("equipment_not_ready", "hard_block", "job_day", context.day.id, "Equipment is marked as not ready.", {
        actionLabel: "Verify equipment readiness"
      })
    );
  } else if (context.input.equipment_ready === false) {
    issues.push(
      buildIssue("equipment_not_ready", "warning", "job_day", context.day.id, "Equipment is marked as not ready.", {
        actionLabel: "Verify equipment readiness"
      })
    );
  }
  if (rules.require_client_contact_checked_in && context.input.client_contact_checked_in === false) {
    issues.push(
      buildIssue("client_contact_not_checked_in", "hard_block", "job_day", context.day.id, "Client contact is not checked in yet.", {
        actionLabel: "Confirm client contact"
      })
    );
  } else if (context.input.client_contact_checked_in === false) {
    issues.push(
      buildIssue("client_contact_not_checked_in", "warning", "job_day", context.day.id, "Client contact is not checked in yet.", {
        actionLabel: "Confirm client contact"
      })
    );
  }

  const { blocker_count, warning_count } = countIssues(issues);
  return {
    subject_type: "job_day",
    subject_id: context.day.id,
    transition_key: "job_day.mark_ready",
    current_state: context.day.day_status,
    target_state: "ready",
    allowed: blocker_count === 0,
    hard_blocked: blocker_count > 0,
    blocker_count,
    warning_count,
    issues,
    checklist_validation: null
  };
}

export function buildProductionWorkflowTransitionValidation(context: ProductionWorkflowTransitionContext): WorkflowTransitionValidation {
  const issues: WorkflowIssue[] = [];
  const rules = context.rules ?? DEFAULT_PRODUCTION_RELEASE_BLOCKERS;
  const finalReleaseStatuses = new Set<NonNullable<ProductionItemRecord["release_status"]>>(
    (context.finalReleaseStatuses ?? DEFAULT_FINAL_RELEASE_STATUSES).statuses
  );
  const currentItem = context.item;
  const currentState = currentItem?.workflow_status ?? null;
  const targetWorkflowStatus = context.input.workflow_status ?? currentItem?.workflow_status ?? "DRAFT";
  const targetUploadStatus = context.input.upload_status ?? currentItem?.upload_status ?? "NOT_STARTED";
  const targetReleaseStatus = context.input.release_status ?? currentItem?.release_status ?? "NOT_STARTED";
  const approvalRequired = Boolean(context.input.approval_required ?? currentItem?.approval_required ?? false);
  const proofRequired = Boolean(context.input.proof_required ?? currentItem?.proof_required ?? false);
  const peerReviewSatisfied = Boolean(context.input.peer_review_complete ?? currentItem?.peer_review_complete ?? false);
  const finalReviewSatisfied = Boolean(
    context.input.final_release_review_complete ?? currentItem?.final_release_review_complete ?? false
  );
  const hasProofArtifact = Boolean(
    normalizeNullableText(context.input.gallery_or_output_reference) ??
      normalizeNullableText(currentItem?.gallery_or_output_reference) ??
      normalizeNullableText(context.input.vendor_reference) ??
      normalizeNullableText(currentItem?.vendor_reference) ??
      normalizeNullableText(context.input.release_target) ??
      normalizeNullableText(currentItem?.release_target)
  );
  const ownerUserId = context.input.assigned_to_user_id ?? currentItem?.assigned_to_user_id ?? null;
  const movingIntoUpload = UPLOAD_WORKFLOW_STATUSES.has(targetWorkflowStatus) || UPLOAD_STATUSES.has(targetUploadStatus);
  const movingIntoRelease = RELEASE_WORKFLOW_STATUSES.has(targetWorkflowStatus) || RELEASE_STATUSES.has(targetReleaseStatus);
  const finalizing =
    ["RELEASED", "SENT_TO_VENDOR", "DELIVERED_CLOSED"].includes(targetWorkflowStatus) ||
    finalReleaseStatuses.has(targetReleaseStatus);

  if (!currentItem) {
    if (targetWorkflowStatus !== "DRAFT" || targetUploadStatus !== "NOT_STARTED" || targetReleaseStatus !== "NOT_STARTED") {
      issues.push(
        buildIssue(
          "production_create_requires_draft",
          "hard_block",
          "production_item",
          null,
          "Create the production item as a draft first so checklist, QA, and approval gates can attach cleanly.",
          {
            actionLabel: "Create as draft"
          }
        )
      );
    }
  }

  issues.push(...mapChecklistIssues(currentItem?.id ?? null, context.checklistValidation));

  if (rules.require_peer_review_for_upload && movingIntoUpload && !peerReviewSatisfied) {
    issues.push(
      buildIssue("peer_review_required", "hard_block", "production_item", currentItem?.id ?? null, "Peer review must pass before this production item can move into upload or release.", {
        actionLabel: "Complete peer review"
      })
    );
  }

  if (rules.require_final_review_for_release && movingIntoRelease && !finalReviewSatisfied) {
    issues.push(
      buildIssue(
        "final_release_review_required",
        "hard_block",
        "production_item",
        currentItem?.id ?? null,
        "Final release review must pass before this production item can move into release.",
        {
          actionLabel: "Complete final release review"
        }
      )
    );
  }

  if (
    rules.require_approval_when_required &&
    approvalRequired &&
    movingIntoRelease &&
    !hasApprovedApproval(context.approvalRequests, currentItem?.id ?? null)
  ) {
    issues.push(
      buildIssue("approval_required_before_release", "hard_block", "production_item", currentItem?.id ?? null, "This production item requires approval before it can be released.", {
        actionLabel: "Record approval"
      })
    );
  }

  if (rules.require_proof_reference_when_required && proofRequired && finalizing && !hasProofArtifact) {
    issues.push(
      buildIssue("proof_required_before_close", "hard_block", "production_item", currentItem?.id ?? null, "Required proof or output reference is missing for this production item.", {
        actionLabel: "Attach proof or output reference"
      })
    );
  }

  const openBlockingIssues = context.productionIssues.filter(
    (issue) =>
      issue.production_item_id === currentItem?.id &&
      issue.is_blocking &&
      !["resolved", "dismissed"].includes(issue.status)
  );
  if (rules.require_no_blocking_issues_for_final_release && openBlockingIssues.length && (movingIntoRelease || finalizing)) {
    issues.push(
      buildIssue(
        "blocking_production_issue_open",
        "hard_block",
        "production_item",
        currentItem?.id ?? null,
        `${openBlockingIssues.length} blocking production issue${openBlockingIssues.length === 1 ? "" : "s"} must be resolved before final release.`,
        {
          actionLabel: "Resolve blocking issues",
          metadata: { production_issue_ids: openBlockingIssues.map((issue) => issue.id) }
        }
      )
    );
  }

  if (targetWorkflowStatus !== "DRAFT" && !ownerUserId) {
    issues.push(
      buildIssue("production_owner_missing", "warning", "production_item", currentItem?.id ?? null, "This production item does not have an assigned owner yet.", {
        actionLabel: "Assign an owner"
      })
    );
  }

  const { blocker_count, warning_count } = countIssues(issues);
  return {
    subject_type: "production_item",
    subject_id: currentItem?.id ?? null,
    transition_key: "production_item.update_workflow",
    current_state: currentState,
    target_state: targetWorkflowStatus,
    allowed: blocker_count === 0 && (context.checklistValidation?.allowed ?? true),
    hard_blocked: blocker_count > 0 || Boolean(context.checklistValidation?.hard_blocked),
    blocker_count,
    warning_count,
    issues,
    checklist_validation: context.checklistValidation ?? null
  };
}

export function buildWorkflowValidationError(
  validation: WorkflowTransitionValidation,
  options: {
    status?: number;
    message?: string;
    details?: Record<string, unknown>;
  } = {}
) {
  return new ApiError(
    options.status ?? (validation.hard_blocked ? 409 : 428),
    options.message ?? "This workflow transition is blocked.",
    {
      ...options.details,
      workflow_validation: validation,
      ...(validation.checklist_validation ? { checklist_block_validation: validation.checklist_validation } : {})
    }
  );
}
