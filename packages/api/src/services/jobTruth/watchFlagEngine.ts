import type { PoolClient } from "pg";
import type {
  ActivityLogEntryRecord,
  ApprovalRequestRecord,
  DeliverableItemRecord,
  JobDayRecord,
  JobReadinessItemRecord,
  JobRecord,
  JobStaffAssignmentRecord,
  JobStatusSnapshot,
  JobWatchFlagRecord,
  ProductionIssueRecord,
  ProductionItemRecord,
  QaReviewFindingRecord,
  QaReviewRecord
} from "../../types/jobTruth.js";
import { writeJobActivity } from "./activityLogService.js";
import { resolveAlertsForWatchFlag, syncWatchFlagAlert } from "./alertEventService.js";
import {
  computeProductionBoardDerivedFields,
  deriveProductionFileMatchStatus,
  getStageStallThresholdHours,
  isReleaseReadyWorkflow,
  requiresPeerReviewer,
  requiresReleaseReviewer
} from "./productionBoardEngine.js";

type SyncInput = {
  tenantId: string;
  actorUserId?: string | null;
  job: JobRecord;
  days: JobDayRecord[];
  readinessItems: JobReadinessItemRecord[];
  staffAssignments: JobStaffAssignmentRecord[];
  productionItems: ProductionItemRecord[];
  approvalRequests: ApprovalRequestRecord[];
  qaReviews: QaReviewRecord[];
  qaFindings: QaReviewFindingRecord[];
  deliverableItems: DeliverableItemRecord[];
  productionIssues: ProductionIssueRecord[];
  existingFlags: JobWatchFlagRecord[];
  activity: ActivityLogEntryRecord[];
  status: JobStatusSnapshot;
};

type EngineFlag = {
  autoKey: string;
  severity: JobWatchFlagRecord["severity"];
  flagType: string;
  title: string;
  description: string;
  ownerUserId?: string | null;
  productionItemId?: string | null;
  sourceEntityType: string;
  sourceEntityId: string;
  dueAt?: string | null;
};

type ProductionFlagContext = {
  item: ProductionItemRecord;
  qaReviews: QaReviewRecord[];
  qaFindings: QaReviewFindingRecord[];
  blockers: ProductionIssueRecord[];
  derived: ReturnType<typeof computeProductionBoardDerivedFields>;
  stageAnchorAt: string | null;
};

const MS_PER_HOUR = 60 * 60 * 1000;

function normalizeTimestamp(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function hoursSince(value: string | Date | null | undefined, now = new Date()) {
  const normalized = normalizeTimestamp(value);
  if (!normalized) {
    return null;
  }
  return Math.floor((now.getTime() - new Date(normalized).getTime()) / MS_PER_HOUR);
}

function withinHours(value: string | Date | null | undefined, hours: number, now = new Date()) {
  const normalized = normalizeTimestamp(value);
  if (!normalized) {
    return false;
  }
  const diff = new Date(normalized).getTime() - now.getTime();
  return diff <= hours * MS_PER_HOUR;
}

function isClosedWorkflow(workflowStatus: ProductionItemRecord["workflow_status"]) {
  return ["DELIVERED_CLOSED", "CANCELLED"].includes(workflowStatus);
}

function resolveProductionOwner(job: JobRecord, item: ProductionItemRecord) {
  return item.assigned_to_user_id ?? item.escalation_owner_user_id ?? item.department_owner_user_id ?? job.account_owner_user_id ?? null;
}

function buildProductionFlag(
  input: SyncInput,
  item: ProductionItemRecord,
  autoKeySuffix: string,
  severity: JobWatchFlagRecord["severity"],
  flagType: string,
  title: string,
  description: string,
  dueAt: string | null = null,
  ownerUserId: string | null = null
): EngineFlag {
  return {
    autoKey: `production:${item.id}:${autoKeySuffix}`,
    severity,
    flagType,
    title,
    description,
    ownerUserId,
    productionItemId: item.id,
    sourceEntityType: "production_item",
    sourceEntityId: item.id,
    dueAt
  };
}

function buildProductionFlagContexts(input: SyncInput) {
  const now = new Date();
  return input.productionItems.map<ProductionFlagContext>((item) => {
    const qaReviews = input.qaReviews.filter((review) => review.production_item_id === item.id);
    const qaReviewIds = new Set(qaReviews.map((review) => review.id));
    const qaFindings = input.qaFindings.filter((finding) => qaReviewIds.has(finding.qa_review_record_id));
    const blockers = input.productionIssues.filter(
      (issue) => issue.production_item_id === item.id && issue.is_blocking && issue.status !== "resolved" && issue.status !== "dismissed"
    );
    const derived = computeProductionBoardDerivedFields({
      item: { ...item, file_match_status: deriveProductionFileMatchStatus(item) },
      qaReviews,
      qaFindings,
      blockers,
      shootCompleted: item.workflow_status !== "DRAFT",
      now
    });
    return {
      item,
      qaReviews,
      qaFindings,
      blockers,
      derived,
      stageAnchorAt: resolveProductionStageAnchor(item, input.activity)
    };
  });
}

function resolveProductionStageAnchor(item: ProductionItemRecord, activity: ActivityLogEntryRecord[]) {
  const stageEvents = activity
    .filter((entry) => entry.production_item_id === item.id && entry.event_type === "production_workflow_status_changed")
    .sort((left, right) => new Date(normalizeTimestamp(right.created_at) ?? 0).getTime() - new Date(normalizeTimestamp(left.created_at) ?? 0).getTime());
  const matchingStageEvent =
    stageEvents.find((entry) => {
      const workflowStatus = entry.new_values_json?.workflow_status;
      const previousWorkflowStatus = entry.old_values_json?.workflow_status;
      return typeof workflowStatus === "string" && workflowStatus === item.workflow_status && workflowStatus !== previousWorkflowStatus;
    }) ??
    stageEvents.find((entry) => {
      const workflowStatus = entry.new_values_json?.workflow_status;
      return typeof workflowStatus === "string" && workflowStatus === item.workflow_status;
    });
  return normalizeTimestamp(matchingStageEvent?.created_at ?? item.updated_at);
}

function upcomingThreshold(job: JobRecord) {
  const scheduledStart = normalizeTimestamp(job.scheduled_start_at);
  if (!scheduledStart) {
    return false;
  }
  return new Date(scheduledStart).getTime() - Date.now() <= 72 * 60 * 60 * 1000;
}

function buildEngineFlags(input: SyncInput): EngineFlag[] {
  const flags: EngineFlag[] = [];
  const now = new Date();
  const leadAssigned = input.staffAssignments.some((assignment) => assignment.is_lead && assignment.assignment_status !== "cancelled");
  const blockerCount = input.readinessItems.filter((item) => item.is_blocker && !item.is_complete).length;
  const productionBlocked = input.productionItems.find((item) => item.status === "blocked");
  const overdueApproval = input.approvalRequests.find((request) => request.status === "overdue");
  const openIssue = input.productionIssues.find((issue) => issue.status === "open" && (issue.severity === "high" || issue.severity === "critical"));
  const deliveryRisk = input.deliverableItems.find((item) => item.status === "issue_flagged");
  const missingReceipt = input.productionItems.find(
    (item) => item.file_count_expected != null && (item.file_count_received ?? 0) < item.file_count_expected && item.delivery_deadline_at
  );
  const needsReadyConfirmation = input.days.some((day) => day.date === new Date().toISOString().slice(0, 10) && !day.ready_confirmed_at);

  if (upcomingThreshold(input.job) && blockerCount > 0) {
    flags.push({
      autoKey: "blockers_within_72h",
      severity: "high",
      flagType: "readiness_blocker",
      title: "Critical readiness blockers within 72 hours",
      description: `${blockerCount} blocking readiness item(s) remain incomplete for an upcoming job.`,
      sourceEntityType: "job",
      sourceEntityId: input.job.id,
      dueAt: normalizeTimestamp(input.job.scheduled_start_at)
    });
  }

  if (!leadAssigned) {
    flags.push({
      autoKey: "missing_lead_assignment",
      severity: upcomingThreshold(input.job) ? "high" : "medium",
      flagType: "staffing_gap",
      title: "Lead photographer not assigned",
      description: "This job does not yet have a lead assignment.",
      sourceEntityType: "job",
      sourceEntityId: input.job.id,
      dueAt: normalizeTimestamp(input.job.scheduled_start_at)
    });
  }

  if (!input.job.primary_location_id && !input.job.location_override_note) {
    flags.push({
      autoKey: "missing_primary_location",
      severity: "medium",
      flagType: "missing_linked_record",
      title: "Primary location unresolved",
      description: "Publish-time location requirements are still unresolved.",
      sourceEntityType: "job",
      sourceEntityId: input.job.id
    });
  }

  if (!input.job.primary_contact_id && !input.job.contact_override_note) {
    flags.push({
      autoKey: "missing_primary_contact",
      severity: "medium",
      flagType: "missing_linked_record",
      title: "Primary contact unresolved",
      description: "Publish-time contact requirements are still unresolved.",
      sourceEntityType: "job",
      sourceEntityId: input.job.id
    });
  }

  if (productionBlocked) {
    flags.push({
      autoKey: "production_blocked",
      severity: "high",
      flagType: "production_blocked",
      title: "Production item blocked",
      description: productionBlocked.blocked_reason || "A linked production item is blocked.",
      sourceEntityType: "job",
      sourceEntityId: input.job.id
    });
  }

  if (overdueApproval) {
    flags.push({
      autoKey: "approval_overdue",
      severity: "high",
      flagType: "approval_delay",
      title: "Approval request overdue",
      description: overdueApproval.summary || "A required approval is overdue.",
      sourceEntityType: "approval_request",
      sourceEntityId: overdueApproval.id,
      dueAt: normalizeTimestamp(overdueApproval.due_at)
    });
  }

  if (openIssue) {
    flags.push({
      autoKey: "production_issue_open",
      severity: openIssue.severity,
      flagType: "production_issue",
      title: openIssue.title,
      description: openIssue.description,
      ownerUserId: openIssue.owner_user_id ?? null,
      productionItemId: openIssue.production_item_id,
      sourceEntityType: "production_issue",
      sourceEntityId: openIssue.id,
      dueAt: normalizeTimestamp(openIssue.due_at)
    });
  }

  if (deliveryRisk) {
    flags.push({
      autoKey: "delivery_issue_flagged",
      severity: "high",
      flagType: "delivery_issue",
      title: "Delivery issue flagged",
      description: deliveryRisk.title,
      sourceEntityType: "deliverable",
      sourceEntityId: deliveryRisk.id,
      dueAt: normalizeTimestamp(deliveryRisk.delivered_at)
    });
  }

  if (missingReceipt) {
    flags.push({
      autoKey: "missing_file_receipt",
      severity: "medium",
      flagType: "missing_files",
      title: "Expected files still missing",
      description: `${missingReceipt.title} is still missing expected files.`,
      ownerUserId: missingReceipt.assigned_to_user_id ?? null,
      productionItemId: missingReceipt.id,
      sourceEntityType: "production_item",
      sourceEntityId: missingReceipt.id,
      dueAt: normalizeTimestamp(missingReceipt.delivery_deadline_at)
    });
  }

  if (needsReadyConfirmation) {
    flags.push({
      autoKey: "day_of_ready_confirmation_missing",
      severity: "medium",
      flagType: "ready_confirmation_missing",
      title: "Day-of ready confirmation missing",
      description: "A job day is active today and still missing lead-ready confirmation.",
      sourceEntityType: "job",
      sourceEntityId: input.job.id
    });
  }

  for (const context of buildProductionFlagContexts(input)) {
    const { item, derived, blockers } = context;
    const primaryOwner = resolveProductionOwner(input.job, item);
    const dueAt = normalizeTimestamp(item.due_at);
    const releaseDueAt = normalizeTimestamp(item.release_due_at);
    const holdReviewAt = normalizeTimestamp(item.hold_review_at);
    const overdueSeverity = derived.daysPastDue != null && derived.daysPastDue >= 2 ? "critical" : "high";
    const dueSoon = Boolean(
      dueAt &&
        !isClosedWorkflow(derived.workflowStatus) &&
        !isReleaseReadyWorkflow(derived.workflowStatus) &&
        withinHours(dueAt, 24, now)
    );
    const stageThresholdHours = getStageStallThresholdHours(derived.workflowStatus);
    const stageHoursOpen = hoursSince(context.stageAnchorAt, now);
    const stalled = stageThresholdHours != null && stageHoursOpen != null && stageHoursOpen >= stageThresholdHours;
    const blockingNonFileIssue = blockers.find((issue) => issue.source_key !== "file_count_mismatch");
    const hasMissingFiles = ["MISSING", "PARTIAL", "MISMATCH"].includes(derived.fileMatchStatus);

    if (derived.overdueFlag) {
      flags.push(
        buildProductionFlag(
          input,
          item,
          "overdue",
          overdueSeverity,
          "production_overdue",
          `${item.title} is overdue`,
          "This production item is past due and still not closed.",
          dueAt,
          primaryOwner
        )
      );
    } else if (dueSoon) {
      flags.push(
        buildProductionFlag(
          input,
          item,
          "due-soon",
          "high",
          "production_due_soon",
          `${item.title} is due within 24 hours`,
          "This production item is due within 24 hours and is not yet ready for release.",
          dueAt,
          primaryOwner
        )
      );
    }

    if (
      (derived.workflowStatus === "BLOCKED" || item.status === "blocked") &&
      (blockingNonFileIssue || item.blocked_reason || context.qaFindings.some((finding) => finding.is_blocking && !finding.resolved_at))
    ) {
      flags.push(
        buildProductionFlag(
          input,
          item,
          "blocked",
          blockers.some((issue) => issue.severity === "critical") || Boolean(item.blocked_reason) ? "critical" : "high",
          "production_blocked",
          `${item.title} is blocked`,
          item.blocked_reason || blockingNonFileIssue?.description || "Production is blocked by a downstream issue.",
          releaseDueAt ?? dueAt,
          primaryOwner
        )
      );
    }

    if (hasMissingFiles) {
      flags.push(
        buildProductionFlag(
          input,
          item,
          "missing-files",
          item.file_count_received === 0 ? "critical" : "high",
          "missing_files",
          `${item.title} is missing files`,
          item.file_count_expected == null
            ? "Required file counts are incomplete."
            : `Expected ${item.file_count_expected} file(s) but received ${item.file_count_received ?? 0}.`,
          dueAt ?? releaseDueAt,
          primaryOwner
        )
      );
    }

    if (!item.assigned_to_user_id) {
      flags.push(
        buildProductionFlag(
          input,
          item,
          "missing-owner",
          derived.overdueFlag || dueSoon ? "high" : "medium",
          "missing_owner",
          `${item.title} has no production owner`,
          "Assign a production owner so work and alerts route correctly.",
          dueAt,
          item.escalation_owner_user_id ?? item.department_owner_user_id ?? input.job.account_owner_user_id ?? null
        )
      );
    }

    if (requiresPeerReviewer(item) && !item.assigned_peer_reviewer_user_id) {
      flags.push(
        buildProductionFlag(
          input,
          item,
          "missing-peer-reviewer",
          derived.overdueFlag || dueSoon ? "high" : "medium",
          "missing_peer_reviewer",
          `${item.title} is missing a peer reviewer`,
          "A peer reviewer is required before QA and upload can complete cleanly.",
          dueAt,
          primaryOwner
        )
      );
    }

    if (requiresReleaseReviewer(item) && !item.assigned_release_reviewer_user_id) {
      flags.push(
        buildProductionFlag(
          input,
          item,
          "missing-release-reviewer",
          releaseDueAt && withinHours(releaseDueAt, 24, now) ? "high" : "medium",
          "missing_release_reviewer",
          `${item.title} is missing a release reviewer`,
          "Assign a release reviewer before upload verification or release signoff slips.",
          releaseDueAt ?? dueAt,
          primaryOwner
        )
      );
    }

    if (["UPLOADED", "VERIFIED"].includes(item.upload_status) && !item.final_release_review_complete) {
      flags.push(
        buildProductionFlag(
          input,
          item,
          "release-review-pending",
          releaseDueAt && withinHours(releaseDueAt, 24, now) ? "high" : "medium",
          "release_review_pending",
          `${item.title} is waiting on final release review`,
          "Upload has been verified, but final release review is still pending.",
          releaseDueAt ?? dueAt,
          item.assigned_release_reviewer_user_id ?? primaryOwner
        )
      );
    }

    if (item.upload_status === "FAILED") {
      flags.push(
        buildProductionFlag(
          input,
          item,
          "upload-failure",
          "high",
          "upload_failure",
          `${item.title} upload failed`,
          "The latest upload attempt failed and needs intervention before release.",
          releaseDueAt ?? dueAt,
          item.assigned_release_reviewer_user_id ?? primaryOwner
        )
      );
    }

    if (stalled) {
      flags.push(
        buildProductionFlag(
          input,
          item,
          "stalled-stage",
          dueSoon || derived.overdueFlag ? "high" : "medium",
          "stalled_stage",
          `${item.title} is stalled in ${derived.workflowStatus}`,
          `This item has been in ${derived.workflowStatus} for at least ${stageThresholdHours} hour(s) without progressing.`,
          dueAt ?? releaseDueAt,
          primaryOwner
        )
      );
    }

    if (derived.workflowStatus === "ON_HOLD" && holdReviewAt && new Date(holdReviewAt).getTime() <= now.getTime()) {
      flags.push(
        buildProductionFlag(
          input,
          item,
          "hold-review-due",
          "high",
          "hold_review_due",
          `${item.title} needs hold review`,
          "The target review date for this hold has passed and needs management follow-up.",
          holdReviewAt,
          item.hold_owner_user_id ?? item.escalation_owner_user_id ?? primaryOwner
        )
      );
    }

    if (item.rework_count >= 2 || item.qa_fail_count >= 2) {
      flags.push(
        buildProductionFlag(
          input,
          item,
          "rework-escalation",
          "high",
          "qa_rework_escalation",
          `${item.title} has repeated QA failures`,
          `This item has entered rework ${Math.max(item.rework_count, item.qa_fail_count)} times and now needs management attention.`,
          dueAt,
          item.escalation_owner_user_id ?? item.department_owner_user_id ?? input.job.account_owner_user_id ?? primaryOwner
        )
      );
    }
  }

  return flags;
}

export async function syncJobWatchFlags(client: PoolClient, input: SyncInput) {
  const desiredFlags = buildEngineFlags(input);
  const existingAutoFlags = input.existingFlags.filter((flag) => flag.auto_key);
  const desiredKeys = new Set(desiredFlags.map((flag) => flag.autoKey));

  for (const existing of existingAutoFlags) {
    if (!existing.auto_key || desiredKeys.has(existing.auto_key)) {
      continue;
    }
    await client.query(
      `
        UPDATE job_watch_flags
        SET status = 'resolved'::job_watch_flag_status_type,
            resolved_at = now(),
            resolved_by_user_id = $3,
            updated_at = now()
        WHERE id = $1
          AND tenant_id = $2
      `,
      [existing.id, input.tenantId, input.actorUserId ?? null]
    );
    await resolveAlertsForWatchFlag(client, input.tenantId, existing.id);
  }

  for (const desired of desiredFlags) {
    const existing = existingAutoFlags.find((flag) => flag.auto_key === desired.autoKey);
    if (existing) {
      await client.query(
        `
          UPDATE job_watch_flags
          SET production_item_id = $3::uuid,
              source_entity_type = $4,
              source_entity_id = $5::uuid,
              severity = $6::job_watch_flag_severity_type,
              flag_type = $7,
              title = $8,
              description = $9,
              owner_user_id = $10::uuid,
              due_at = $11,
              status = CASE WHEN status = 'resolved'::job_watch_flag_status_type THEN 'open'::job_watch_flag_status_type ELSE status END,
              updated_at = now()
          WHERE id = $1
            AND tenant_id = $2
        `,
        [
          existing.id,
          input.tenantId,
          desired.productionItemId ?? null,
          desired.sourceEntityType,
          desired.sourceEntityId,
          desired.severity,
          desired.flagType,
          desired.title,
          desired.description,
          desired.ownerUserId ?? null,
          desired.dueAt ?? null
        ]
      );
      await syncWatchFlagAlert(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId ?? null,
        trigger: existing.status === "resolved" ? "reopened" : "updated",
        job: {
          id: input.job.id,
          department_type: input.job.department_type,
          job_number: input.job.job_number,
          title: input.job.title,
          event_name: input.job.event_name,
          account_owner_user_id: input.job.account_owner_user_id,
          organization_name: null
        },
        watchFlag: {
          ...existing,
          production_item_id: desired.productionItemId ?? null,
          source_entity_type: desired.sourceEntityType,
          source_entity_id: desired.sourceEntityId,
          severity: desired.severity,
          flag_type: desired.flagType,
          title: desired.title,
          description: desired.description,
          owner_user_id: desired.ownerUserId ?? null,
          due_at: desired.dueAt ?? null,
          status: existing.status === "resolved" ? "open" : existing.status,
          updated_at: new Date().toISOString()
        }
      });
      continue;
    }

    const inserted = await client.query(
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
          auto_key,
          created_by_user_id
        )
        VALUES ($1,$2,$3,$4,$5::uuid,$6::job_watch_flag_severity_type,$7,$8,$9,'open'::job_watch_flag_status_type,$10,$11,$12,$13)
        RETURNING *
      `,
      [
        input.tenantId,
        input.job.id,
        desired.productionItemId ?? null,
        desired.sourceEntityType,
        desired.sourceEntityId,
        desired.severity,
        desired.flagType,
        desired.title,
        desired.description,
        desired.ownerUserId ?? null,
        desired.dueAt ?? null,
        desired.autoKey,
        input.actorUserId ?? null
      ]
    );

    await writeJobActivity(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      jobId: input.job.id,
      watchFlagId: inserted.rows[0].id,
      eventType: "watch_flag_created",
      summary: desired.title,
      metadata: { auto_key: desired.autoKey, flag_type: desired.flagType }
    });
    await syncWatchFlagAlert(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      trigger: "created",
      job: {
        id: input.job.id,
        department_type: input.job.department_type,
        job_number: input.job.job_number,
        title: input.job.title,
        event_name: input.job.event_name,
        account_owner_user_id: input.job.account_owner_user_id,
        organization_name: null
      },
      watchFlag: inserted.rows[0]
    });
  }
}
