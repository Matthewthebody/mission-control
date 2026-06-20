import type { PoolClient, QueryResultRow } from "pg";
import type { ChecklistTransitionValidation } from "../../types/checklists.js";
import {
  canCreateOrEditShootDepartment,
  canManageSchoolsHub,
  getSchoolsHubAccessScope,
  hasAuthorityTier
} from "../../authz/authority.js";
import type {
  JobApprovalStatus,
  JobCategory,
  JobDeliverableStatus,
  JobDepartmentType,
  JobHandoffStatus,
  JobPriorityLevel,
  JobProductionIssueStatus,
  JobProductionStatus,
  JobQaReviewStatus,
  ProductionBoardWorkflowStatus
} from "../../domain/jobTruth/index.js";
import { ApiError } from "../../errors/apiError.js";
import { canSharedPolicy, sanitizeJobDetailResponse, sanitizeJobListItems, sanitizeProductionQueueItems } from "../policy/index.js";
import type { AuthUser, DepartmentCode } from "../../types/auth.js";
import { emitJobAssignedEvent } from "../operationalEvents.js";
import {
  getDayReadyRequirementsConfiguration,
  getProductionWorkflowConfiguration,
  getPublishRequiredFieldsConfiguration
} from "../adminConfiguration.js";
import type {
  ActivityLogEntryRecord,
  ApprovalRequestRecord,
  DeliverableItemRecord,
  JobDayRecord,
  JobDetailResponse,
  JobDraftInput,
  JobListItem,
  JobPrepReadinessQueueIssue,
  JobPrepReadinessQueueItem,
  JobPrepReadinessQueueResponse,
  JobPrepReadinessPreview,
  JobPrepReadinessWarning,
  JobReadinessItemRecord,
  JobRecord,
  JobSummaryView,
  JobStaffAssignmentRecord,
  JobStatusSnapshot,
  JobValidationResult,
  JobWatchFlagRecord,
  JobShootLinkRecord,
  ProductionHandoffRecord,
  ProductionItemShootLinkRecord,
  ProductionIssueRecord,
  ProductionItemRecord,
  ProductionQueueItem,
  ProductionQueueSummary,
  QaReviewFindingRecord,
  QaReviewRecord,
  SchoolJobProfileRecord,
  SchoolJobProfileView,
  SportsJobProfileRecord,
  SportsJobProfileView
} from "../../types/jobTruth.js";
import { writeJobActivity } from "./activityLogService.js";
import { getActivityTimeline } from "../activityTimeline.js";
import { resolveAlertsForWatchFlag, syncWatchFlagAlertById } from "./alertEventService.js";
import { getDepartmentJobAdapter } from "./departmentJobAdapterRegistry.js";
import { calculateJobStatusSnapshot } from "./jobStatusEngine.js";
import { queueTeamsMeetingJobRecordLifecycleSync } from "../teamsMeetings.js";
import {
  computeProductionBoardDerivedFields,
  deriveProductionFileMatchStatus,
  getProductionQaMinimumSamplePercent,
  isProductionQaGateKey,
  mapWorkflowStatusToLegacyStatus,
  validateProductionGrouping,
  validateProductionSplit
} from "./productionBoardEngine.js";
import { ensureTriggeredChecklistInstances, validateChecklistTargetTransition } from "./checklistService.js";
import {
  buildDepartmentProductionTemplatePlan,
  evaluateProductionCompletionState
} from "./productionBoardTemplates.js";
import { syncJobWatchFlags } from "./watchFlagEngine.js";
import {
  buildJobDayReadyTransitionValidation,
  buildJobWorkflowSummary,
  buildProductionWorkflowTransitionValidation,
  buildPublishWorkflowValidation,
  buildWorkflowValidationError
} from "./workflowStateEngine.js";
import { applyProactiveCommunicationRule, applyProactiveCommunicationRuleOutOfBand } from "../proactiveCommunicationRules.js";
import { ensureSharedWorkflowRunForJob, getSharedWorkflowJobDetail } from "../workflow/sharedWorkflowService.js";

type LoadedJobAggregate = {
  job: JobRecord;
  schoolProfile: SchoolJobProfileRecord | null;
  sportsProfile: SportsJobProfileRecord | null;
  days: JobDayRecord[];
  staffAssignments: JobStaffAssignmentRecord[];
  readinessItems: JobReadinessItemRecord[];
  jobShootLinks: JobShootLinkRecord[];
  productionItems: ProductionItemRecord[];
  productionItemShootLinks: ProductionItemShootLinkRecord[];
  productionHandoffs: ProductionHandoffRecord[];
  approvalRequests: ApprovalRequestRecord[];
  qaReviews: QaReviewRecord[];
  qaFindings: QaReviewFindingRecord[];
  deliverableItems: DeliverableItemRecord[];
  productionIssues: ProductionIssueRecord[];
  watchFlags: JobWatchFlagRecord[];
  activity: ActivityLogEntryRecord[];
  status: JobStatusSnapshot;
};

type LeadAssignmentRecord = {
  job_id: string;
  user_id: string | null;
};

type OpenFlagCountRecord = {
  job_id: string;
  open_watch_flag_count: string;
};

type DayCountRecord = {
  job_id: string;
  day_count: string;
};

type AssignmentCountRecord = {
  job_id: string;
  assigned_staff_count: string;
  checked_in_staff_count: string;
  ready_present_count: string;
};

type ProductionItemShootSummary = {
  shootIds: string[];
  completed: boolean;
};

type ReadinessCountRecord = {
  job_id: string;
  required_count: string;
  completed_required_count: string;
  blocker_count: string;
};

type ProductionBaseRow = ProductionItemRecord & {
  job_number: string | null;
  job_title: string;
  organization_id: string | null;
  primary_location_id: string | null;
  primary_contact_id: string | null;
  job_risk_status: JobRecord["risk_status"];
  job_readiness_status: JobRecord["readiness_status"];
};

type ProductionChecklistAggregateRow = {
  production_item_id: string;
  checklist_total_count: number;
  checklist_overdue_count: number;
  checklist_awaiting_approval_count: number;
  checklist_rejected_count: number;
  checklist_blocked_count: number;
  checklist_missing_proof_count: number;
  blocking_checklist_instance_id: string | null;
  blocking_checklist_title: string | null;
};

type DisplayMaps = {
  organizations: Map<string, { label: string; accountType: string | null }>;
  contacts: Map<string, { label: string; title: string | null }>;
  locations: Map<string, { label: string; address: string | null }>;
  users: Map<string, { label: string; department: string | null }>;
};

type RelatedIds = {
  organizationIds: Set<string>;
  contactIds: Set<string>;
  locationIds: Set<string>;
  userIds: Set<string>;
};

const JOB_NUMBER_PREFIX: Record<JobDepartmentType, string> = {
  schools: "SCH",
  sports: "SPT",
  corporate: "COR",
  headshots: "HDS",
  other: "JOB"
};

const QA_PASS_STATUSES = new Set<JobQaReviewStatus>(["passed", "passed_with_notes", "complete"]);
const QA_FAIL_STATUSES = new Set<JobQaReviewStatus>(["failed", "rework_in_progress", "recheck_required"]);

function getChecklistTemplateCodesForProductionCreation() {
  return ["production_intake_file_receipt"];
}

function getChecklistTemplateCodesForProductionWorkflowStatus(status: ProductionBoardWorkflowStatus | null | undefined) {
  switch (status) {
    case "IN_PRODUCTION":
      return ["artist_self_qa"];
    case "READY_FOR_QA":
    case "IN_PEER_REVIEW":
    case "REWORK_REQUIRED":
      return ["peer_review_sign_off"];
    case "UPLOADED":
    case "READY_FOR_RELEASE":
      return ["captura_upload_qa"];
    case "RELEASED":
    case "SENT_TO_VENDOR":
    case "DELIVERED_CLOSED":
      return ["final_release_checklist"];
    default:
      return [];
  }
}

function shouldInstantiateUploadChecklist(
  nextUploadStatus: string | null | undefined,
  nextWorkflowStatus: ProductionBoardWorkflowStatus | null | undefined
) {
  return nextUploadStatus === "VERIFIED" || nextWorkflowStatus === "UPLOADED" || nextWorkflowStatus === "READY_FOR_RELEASE";
}

function shouldInstantiateReleaseChecklist(
  nextReleaseStatus: string | null | undefined,
  nextWorkflowStatus: ProductionBoardWorkflowStatus | null | undefined
) {
  return (
    nextReleaseStatus === "READY_FOR_RELEASE" ||
    nextReleaseStatus === "RELEASED" ||
    nextWorkflowStatus === "READY_FOR_RELEASE" ||
    nextWorkflowStatus === "RELEASED"
  );
}

type ProductionQaDecisionPayload = {
  files_complete_storage?: boolean | null;
  color_density_consistency?: boolean | null;
  sorting_and_roster_accuracy?: boolean | null;
  template_price_release_accuracy?: boolean | null;
  next_stage_decision?: string | null;
};

function normalizeQaQuestionAnswers(value: Record<string, unknown> | null | undefined): ProductionQaDecisionPayload {
  return {
    files_complete_storage: typeof value?.files_complete_storage === "boolean" ? value.files_complete_storage : null,
    color_density_consistency: typeof value?.color_density_consistency === "boolean" ? value.color_density_consistency : null,
    sorting_and_roster_accuracy: typeof value?.sorting_and_roster_accuracy === "boolean" ? value.sorting_and_roster_accuracy : null,
    template_price_release_accuracy: typeof value?.template_price_release_accuracy === "boolean" ? value.template_price_release_accuracy : null,
    next_stage_decision: typeof value?.next_stage_decision === "string" ? value.next_stage_decision.trim().toLowerCase() : null
  };
}

function isLargeProductionJob(aggregate: LoadedJobAggregate, item: ProductionItemRecord) {
  const sizeSignals = [
    aggregate.job.actual_subject_count,
    aggregate.job.estimated_subject_count,
    item.file_count_expected,
    item.file_count_received
  ].filter((value): value is number => typeof value === "number");
  const strongestSignal = sizeSignals.length ? Math.max(...sizeSignals) : 0;
  return strongestSignal >= 100;
}

function getLatestQaReviewForStage(reviews: QaReviewRecord[], stage: string, productionItemId: string) {
  return (
    reviews
      .filter((review) => review.production_item_id === productionItemId && review.review_stage === stage)
      .sort((left, right) => new Date(normalizeTimestamp(right.updated_at) ?? 0).getTime() - new Date(normalizeTimestamp(left.updated_at) ?? 0).getTime())[0] ??
    null
  );
}

function canOverrideQaSelfReview(auth: AuthUser, aggregate: LoadedJobAggregate, item: ProductionItemRecord | null) {
  return (
    canSharedPolicy(auth, "qa.self_review_override", buildProductionPolicyContext(aggregate, item)) ||
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])
  );
}

function requiresQaDecisionValidation(status: JobQaReviewStatus | null | undefined, reworkRequired: boolean | null | undefined) {
  return Boolean((status && (QA_PASS_STATUSES.has(status) || QA_FAIL_STATUSES.has(status))) || reworkRequired);
}

function humanizeQaStage(value: string | null | undefined) {
  const normalized = normalizeNullableText(value);
  if (!normalized) {
    return "QA review";
  }
  return normalized
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function mapDepartmentToLegacy(department: JobDepartmentType): DepartmentCode {
  if (department === "schools" || department === "sports") {
    return department;
  }
  return "operations";
}

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeTimestamp(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function timestampDatePart(value: string | Date | null | undefined) {
  const normalized = normalizeTimestamp(value);
  return normalized ? normalized.slice(0, 10) : null;
}

function timestampTimePart(value: string | Date | null | undefined) {
  const normalized = normalizeTimestamp(value);
  if (!normalized) {
    return null;
  }
  return normalized.length >= 19 ? normalized.slice(11, 19) : null;
}

function summarizeDayTimestamp(date: string | Date | null | undefined, time: string | null | undefined, fallbackTime: string) {
  const dayDate = timestampDatePart(date);
  if (!dayDate) {
    return null;
  }
  return `${dayDate}T${time ?? fallbackTime}`;
}

function countFromRecord(map: Map<string, number>, key: string) {
  return map.get(key) ?? 0;
}

function groupRowsByStringKey<T>(rows: T[], getKey: (row: T) => string | null | undefined) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = getKey(row);
    if (!key) {
      continue;
    }
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function buildProductionItemShootMap(
  links: ProductionItemShootLinkRecord[],
  completionMap: Map<string, boolean>
) {
  const itemMap = new Map<string, ProductionItemShootSummary>();
  for (const link of links) {
    const current = itemMap.get(link.production_item_id) ?? { shootIds: [], completed: false };
    current.shootIds.push(link.shoot_id);
    current.completed = current.completed || completionMap.get(link.shoot_id) === true;
    itemMap.set(link.production_item_id, current);
  }
  return itemMap;
}

function buildProductionItemDetailView(
  item: ProductionItemRecord,
  issueRows: ProductionIssueRecord[],
  qaReviewRows: QaReviewRecord[],
  qaFindingRows: QaReviewFindingRecord[],
  linkedShootSummary: ProductionItemShootSummary | undefined,
  now = new Date()
) {
  const blockerRows = issueRows.filter((issue) => issue.is_blocking && issue.status !== "resolved" && issue.status !== "dismissed");
  const derived = computeProductionBoardDerivedFields({
    item: { ...item, file_match_status: deriveProductionFileMatchStatus(item) },
    qaReviews: qaReviewRows,
    qaFindings: qaFindingRows,
    blockers: blockerRows,
    shootCompleted: linkedShootSummary?.completed ?? false,
    now
  });

  return {
    linked_shoot_ids: linkedShootSummary?.shootIds ?? [],
    days_since_shoot: derived.daysSinceShoot,
    days_open: derived.daysOpen,
    days_to_due: derived.daysToDue,
    days_past_due: derived.daysPastDue,
    stage_age: derived.stageAge,
    turnaround_days: derived.turnaroundDays,
    on_time_flag: derived.onTimeFlag,
    open_blocker_count: derived.openBlockerCount,
    overdue_flag: derived.overdueFlag,
    release_lag_days: derived.releaseLagDays
  };
}

async function loadShootCompletionMap(client: PoolClient, tenantId: string, shootIds: string[]) {
  if (!shootIds.length) {
    return new Map<string, boolean>();
  }
  const rows = await listRows<{ shoot_id: string; status: string | null; record_state: string | null }>(
    client,
    `
      SELECT
        id::text AS shoot_id,
        status::text AS status,
        record_state::text AS record_state
      FROM shoot
      WHERE tenant_id = $1
        AND id = ANY($2::uuid[])
    `,
    [tenantId, shootIds]
  );
  return new Map(
    rows.map((row) => [
      row.shoot_id,
      ["SHOOT_COMPLETE", "POST_PRODUCTION", "COMPLETE"].includes(row.status ?? "") && row.record_state !== "cancelled"
    ])
  );
}

function createRelatedIds(): RelatedIds {
  return {
    organizationIds: new Set<string>(),
    contactIds: new Set<string>(),
    locationIds: new Set<string>(),
    userIds: new Set<string>()
  };
}

function addId(target: Set<string>, value: string | null | undefined) {
  if (value) {
    target.add(value);
  }
}

function hasAssignmentForUser(aggregate: LoadedJobAggregate, userId: string, dayId?: string | null) {
  return aggregate.staffAssignments.some(
    (assignment) =>
      assignment.user_id === userId &&
      assignment.assignment_status !== "cancelled" &&
      (!dayId || assignment.job_day_id === dayId || assignment.job_day_id == null)
  );
}

function collectJobCommunicationRecipientUserIds(
  aggregate: LoadedJobAggregate,
  options: {
    excludeUserId?: string | null;
    includeOwners?: boolean;
    additionalUserIds?: Array<string | null | undefined>;
  } = {}
) {
  const values = new Set<string>();
  for (const assignment of aggregate.staffAssignments) {
    if (assignment.assignment_status === "cancelled" || assignment.assignment_status === "absent" || assignment.assignment_status === "checked_out") {
      continue;
    }
    if (assignment.user_id) {
      values.add(assignment.user_id);
    }
  }
  if (options.includeOwners) {
    addId(values, aggregate.job.account_owner_user_id);
    addId(values, aggregate.job.created_by_user_id);
  }
  for (const value of options.additionalUserIds ?? []) {
    addId(values, value);
  }
  if (options.excludeUserId) {
    values.delete(options.excludeUserId);
  }
  return [...values];
}

async function findStaffingConflictForUser(
  client: PoolClient,
  tenantId: string,
  input: {
    jobId: string;
    userId: string;
    scheduledStartAt: string | null;
    scheduledEndAt: string | null;
  }
) {
  if (!input.scheduledStartAt || !input.scheduledEndAt) {
    return null;
  }

  const { rows } = await client.query<{
    conflict_job_id: string;
    conflict_job_number: string | null;
    conflict_title: string;
    scheduled_start_at: string | null;
    scheduled_end_at: string | null;
  }>(
    `
      SELECT
        job.id::text AS conflict_job_id,
        job.job_number,
        job.title AS conflict_title,
        job.scheduled_start_at::text,
        job.scheduled_end_at::text
      FROM job_staff_assignments assignment
      JOIN jobs job
        ON job.tenant_id = assignment.tenant_id
       AND job.id = assignment.job_id
      WHERE assignment.tenant_id = $1
        AND assignment.user_id = $2
        AND assignment.job_id <> $3
        AND assignment.assignment_status IN (
          'assigned'::job_assignment_status_type,
          'confirmed'::job_assignment_status_type,
          'checked_in'::job_assignment_status_type
        )
        AND job.job_status NOT IN (
          'cancelled'::job_status_type,
          'archived'::job_status_type,
          'postponed'::job_status_type
        )
        AND job.scheduled_start_at IS NOT NULL
        AND job.scheduled_end_at IS NOT NULL
        AND tstzrange(job.scheduled_start_at, job.scheduled_end_at, '[)') && tstzrange($4::timestamptz, $5::timestamptz, '[)')
      ORDER BY job.scheduled_start_at ASC
      LIMIT 1
    `,
    [tenantId, input.userId, input.jobId, input.scheduledStartAt, input.scheduledEndAt]
  );

  return rows[0] ?? null;
}

function buildSchoolProfileView(profile: SchoolJobProfileRecord | null, maps: DisplayMaps): SchoolJobProfileView | null {
  if (!profile) {
    return null;
  }
  return {
    ...profile,
    district_name: profile.district_id ? maps.organizations.get(profile.district_id)?.label ?? null : null
  };
}

function buildSportsProfileView(profile: SportsJobProfileRecord | null, maps: DisplayMaps): SportsJobProfileView | null {
  if (!profile) {
    return null;
  }
  return {
    ...profile,
    approval_contact_name: profile.approval_contact_id ? maps.contacts.get(profile.approval_contact_id)?.label ?? null : null,
    billing_contact_name: profile.billing_contact_id ? maps.contacts.get(profile.billing_contact_id)?.label ?? null : null
  };
}

function deriveApprovalStatus(requests: ApprovalRequestRecord[], approvalRequired: boolean): JobApprovalStatus {
  if (!approvalRequired) {
    return "not_required";
  }
  if (requests.some((request) => request.status === "overdue")) {
    return "overdue";
  }
  if (requests.some((request) => request.status === "revisions_requested")) {
    return "revisions_requested";
  }
  if (requests.some((request) => request.status === "rejected")) {
    return "rejected";
  }
  if (requests.some((request) => request.status === "approved")) {
    return "approved";
  }
  if (requests.some((request) => request.status === "viewed")) {
    return "viewed";
  }
  if (requests.some((request) => request.status === "requested")) {
    return "requested";
  }
  return "not_started";
}

function deriveQaSummaryStatus(reviews: QaReviewRecord[], item: ProductionItemRecord): JobQaReviewStatus {
  if (!item.qa_required) {
    return "not_required";
  }
  if (reviews.some((review) => review.status === "recheck_required")) {
    return "recheck_required";
  }
  if (reviews.some((review) => review.status === "rework_in_progress")) {
    return "rework_in_progress";
  }
  if (reviews.some((review) => review.status === "failed")) {
    return "failed";
  }
  if (reviews.some((review) => review.status === "passed_with_notes")) {
    return "passed_with_notes";
  }
  if (reviews.some((review) => review.status === "passed")) {
    return "passed";
  }
  if (reviews.some((review) => review.status === "in_review")) {
    return "in_review";
  }
  if (reviews.some((review) => review.status === "queued")) {
    return "queued";
  }
  return "queued";
}

function deriveDeliverableStatus(deliverables: DeliverableItemRecord[]): JobDeliverableStatus {
  if (deliverables.some((item) => item.status === "issue_flagged")) {
    return "issue_flagged";
  }
  if (deliverables.some((item) => item.status === "confirmed")) {
    return "confirmed";
  }
  if (deliverables.some((item) => item.status === "delivered")) {
    return "delivered";
  }
  if (deliverables.some((item) => item.status === "in_transit")) {
    return "in_transit";
  }
  if (deliverables.some((item) => item.status === "sent")) {
    return "sent";
  }
  if (deliverables.some((item) => item.status === "preparing")) {
    return "preparing";
  }
  return "not_started";
}

function deriveFileReceiptState(item: ProductionItemRecord): ProductionQueueItem["file_receipt_state"] {
  if (item.file_count_expected == null) {
    return "not_applicable";
  }
  if ((item.file_count_received ?? 0) === 0) {
    return "missing_receipt";
  }
  if ((item.file_count_received ?? 0) < item.file_count_expected) {
    return "partial_receipt";
  }
  if ((item.file_count_received ?? 0) === item.file_count_expected) {
    return "exact_match";
  }
  return "extra_files";
}

function deriveProofStatus(proofRequired: boolean, statuses: JobProductionStatus[]) {
  if (!proofRequired) {
    return "not_required";
  }
  if (statuses.includes("revisions_requested")) {
    return "revisions_requested";
  }
  if (statuses.includes("awaiting_approval") || statuses.includes("proof_sent")) {
    return "sent";
  }
  if (statuses.includes("proof_build")) {
    return "building";
  }
  if (
    statuses.some((status) =>
      ["approved_for_production", "ordered_or_printed", "packaged", "delivered", "complete"].includes(status)
    )
  ) {
    return "approved";
  }
  return "not_started";
}

async function loadDisplayMaps(client: PoolClient, tenantId: string, ids: RelatedIds): Promise<DisplayMaps> {
  const organizations = ids.organizationIds.size
    ? await listRows<{ id: string; display_name: string; account_type: string | null }>(
        client,
        `
          SELECT id::text AS id, display_name, account_type::text AS account_type
          FROM organization
          WHERE tenant_id = $1
            AND id = ANY($2::uuid[])
        `,
        [tenantId, [...ids.organizationIds]]
      )
    : [];
  const contacts = ids.contactIds.size
    ? await listRows<{ id: string; full_name: string; title: string | null }>(
        client,
        `
          SELECT id::text AS id, full_name, title
          FROM organization_contact
          WHERE tenant_id = $1
            AND id = ANY($2::uuid[])
        `,
        [tenantId, [...ids.contactIds]]
      )
    : [];
  const locations = ids.locationIds.size
    ? await listRows<{ id: string; label: string; address: string | null }>(
        client,
        `
          SELECT
            id::text AS id,
            COALESCE(NULLIF(maps_label, ''), name) AS label,
            NULLIF(
              trim(
                BOTH ', ' FROM concat_ws(', ', address_line_1, city, state, zip)
              ),
              ''
            ) AS address
          FROM shoot_location
          WHERE tenant_id = $1
            AND id = ANY($2::uuid[])
        `,
        [tenantId, [...ids.locationIds]]
      )
    : [];
  const users = ids.userIds.size
    ? await listRows<{ id: string; full_name: string; department: string | null }>(
        client,
        `
          SELECT id::text AS id, full_name, department::text AS department
          FROM app_user
          WHERE tenant_id = $1
            AND id = ANY($2::uuid[])
        `,
        [tenantId, [...ids.userIds]]
      )
    : [];

  return {
    organizations: new Map(organizations.map((row) => [row.id, { label: row.display_name, accountType: row.account_type }])),
    contacts: new Map(contacts.map((row) => [row.id, { label: row.full_name, title: row.title }])),
    locations: new Map(locations.map((row) => [row.id, { label: row.label, address: row.address }])),
    users: new Map(users.map((row) => [row.id, { label: row.full_name, department: row.department }]))
  };
}

function collectAggregateRelatedIds(
  aggregate: LoadedJobAggregate,
  schoolProfile: SchoolJobProfileRecord | null,
  sportsProfile: SportsJobProfileRecord | null
) {
  const ids = createRelatedIds();
  addId(ids.organizationIds, aggregate.job.organization_id);
  addId(ids.locationIds, aggregate.job.primary_location_id);
  addId(ids.contactIds, aggregate.job.primary_contact_id);
  addId(ids.userIds, aggregate.job.account_owner_user_id);
  addId(ids.organizationIds, schoolProfile?.district_id ?? null);
  addId(ids.contactIds, sportsProfile?.approval_contact_id ?? null);
  addId(ids.contactIds, sportsProfile?.billing_contact_id ?? null);

  for (const day of aggregate.days) {
    addId(ids.locationIds, day.location_id);
    addId(ids.contactIds, day.onsite_contact_id);
    addId(ids.userIds, day.lead_user_id);
  }
  for (const assignment of aggregate.staffAssignments) {
    addId(ids.userIds, assignment.user_id);
  }
  for (const item of aggregate.readinessItems) {
    addId(ids.userIds, item.completed_by_user_id);
  }
  for (const item of aggregate.productionItems) {
    addId(ids.organizationIds, item.organization_id);
    addId(ids.locationIds, item.location_id);
    addId(ids.contactIds, item.primary_contact_id);
    addId(ids.userIds, item.account_owner_user_id);
    addId(ids.userIds, item.assigned_to_user_id);
    addId(ids.userIds, item.department_owner_user_id);
    addId(ids.userIds, item.assigned_peer_reviewer_user_id);
    addId(ids.userIds, item.assigned_release_reviewer_user_id);
    addId(ids.userIds, item.escalation_owner_user_id);
    addId(ids.userIds, item.hold_owner_user_id);
  }
  for (const handoff of aggregate.productionHandoffs) {
    addId(ids.userIds, handoff.from_user_id);
    addId(ids.userIds, handoff.to_user_id);
  }
  for (const request of aggregate.approvalRequests) {
    addId(ids.contactIds, request.approver_contact_id);
    addId(ids.userIds, request.approver_user_id);
  }
  for (const review of aggregate.qaReviews) {
    addId(ids.userIds, review.reviewer_user_id);
    addId(ids.userIds, review.requested_by_user_id);
    addId(ids.userIds, review.sent_back_to_user_id);
  }
  for (const finding of aggregate.qaFindings) {
    addId(ids.userIds, finding.resolved_by_user_id);
  }
  for (const deliverable of aggregate.deliverableItems) {
    addId(ids.contactIds, deliverable.recipient_contact_id);
    addId(ids.organizationIds, deliverable.recipient_organization_id);
  }
  for (const issue of aggregate.productionIssues) {
    addId(ids.userIds, issue.owner_user_id);
    addId(ids.userIds, issue.resolved_by_user_id);
  }
  for (const flag of aggregate.watchFlags) {
    addId(ids.userIds, flag.owner_user_id);
    addId(ids.userIds, flag.resolved_by_user_id);
  }
  for (const entry of aggregate.activity) {
    addId(ids.userIds, entry.actor_user_id);
  }
  return ids;
}

function buildJobSummaryView(
  aggregate: LoadedJobAggregate,
  maps: DisplayMaps,
  schoolProfile: SchoolJobProfileView | null,
  sportsProfile: SportsJobProfileView | null
): JobSummaryView {
  const primaryDay = aggregate.days[0] ?? null;
  const leadAssignment = aggregate.staffAssignments.find((assignment) => assignment.is_lead) ?? null;
  const latestActivity = aggregate.activity[0]?.created_at ?? null;
  const proofStatus = deriveProofStatus(
    sportsProfile?.proof_required ?? false,
    aggregate.productionItems.map((item) => item.status)
  );

  return {
    organization_name: aggregate.job.organization_id ? maps.organizations.get(aggregate.job.organization_id)?.label ?? null : null,
    organization_account_type: aggregate.job.organization_id ? maps.organizations.get(aggregate.job.organization_id)?.accountType ?? null : null,
    primary_location_name: aggregate.job.primary_location_id ? maps.locations.get(aggregate.job.primary_location_id)?.label ?? null : null,
    primary_location_address: aggregate.job.primary_location_id ? maps.locations.get(aggregate.job.primary_location_id)?.address ?? null : null,
    primary_contact_name: aggregate.job.primary_contact_id ? maps.contacts.get(aggregate.job.primary_contact_id)?.label ?? null : null,
    primary_contact_title: aggregate.job.primary_contact_id ? maps.contacts.get(aggregate.job.primary_contact_id)?.title ?? null : null,
    account_owner_name: aggregate.job.account_owner_user_id ? maps.users.get(aggregate.job.account_owner_user_id)?.label ?? null : null,
    lead_owner_user_id: leadAssignment?.user_id ?? primaryDay?.lead_user_id ?? null,
    lead_owner_name:
      (leadAssignment?.user_id ? maps.users.get(leadAssignment.user_id)?.label : null) ??
      (primaryDay?.lead_user_id ? maps.users.get(primaryDay.lead_user_id)?.label : null) ??
      null,
    primary_day_date: primaryDay?.date ?? timestampDatePart(aggregate.job.scheduled_start_at),
    primary_day_start_time: primaryDay?.start_time ?? timestampTimePart(aggregate.job.scheduled_start_at),
    primary_day_end_time: primaryDay?.end_time ?? timestampTimePart(aggregate.job.scheduled_end_at),
    primary_day_label: primaryDay?.day_label ?? null,
    latest_activity_at: latestActivity,
    department_summary: getDepartmentJobAdapter(aggregate.job.department_type).buildDepartmentSummary(aggregate.job, schoolProfile, sportsProfile),
    proof_status: aggregate.job.department_type === "sports" ? proofStatus : null
  };
}

type JobPrepContactRow = {
  id: string;
  display_name: string;
  title: string | null;
  email: string | null;
  mobile_phone: string | null;
  active_status: "active" | "inactive";
  allow_email: boolean;
  allow_sms: boolean;
  do_not_contact: boolean;
  sms_consent_status: "unknown" | "opted_in" | "opted_out" | "not_eligible";
  client_roles: unknown;
};

type JobPrepLocationRow = {
  id: string;
  location_name: string;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  address_display: string | null;
  navigation_url: string | null;
  navigation_notes: string | null;
  parking_instructions: string | null;
  entrance_instructions: string | null;
  unloading_instructions: string | null;
  setup_area: string | null;
  backup_indoor_location: string | null;
  accessibility_notes: string | null;
  power_availability_notes: string | null;
  wifi_cell_notes: string | null;
  security_checkin_requirements: string | null;
  weather_contingency_notes: string | null;
  client_facing_notes: string | null;
  employee_facing_notes: string | null;
  internal_only_notes: string | null;
};

type JobPrepAttachmentRow = {
  id: string;
  title: string;
  description: string | null;
  attachment_type: string;
  audience: "client_facing" | "employee_facing" | "internal_only";
  file_url: string | null;
  storage_key: string | null;
};

const JOB_PREP_RECIPIENT_ROLES = new Set([
  "primary_contact",
  "primary_decision_maker",
  "picture_day_contact",
  "picture_day_prep_recipient",
  "day_before_reminder_recipient",
  "head_secretary",
  "secretary_admin_assistant"
]);

function parseJobPrepRoles(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .replace(/^\{|\}$/g, "")
      .split(",")
      .map((role) => role.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
  }
  return [];
}

function contactHasPrepRole(contact: { client_roles: string[] }) {
  return contact.client_roles.some((role) => JOB_PREP_RECIPIENT_ROLES.has(role));
}

function buildJobPrepEmailExclusion(contact: JobPrepContactRow & { client_roles: string[] }) {
  if (contact.active_status !== "active") {
    return "Contact is inactive.";
  }
  if (contact.do_not_contact) {
    return "Do not contact is enabled.";
  }
  if (!contactHasPrepRole(contact)) {
    return "Contact is not marked for prep communication.";
  }
  if (!contact.allow_email) {
    return "Email is not allowed for this contact.";
  }
  if (!contact.email) {
    return "Missing email address.";
  }
  return null;
}

function buildJobPrepSmsExclusion(contact: JobPrepContactRow & { client_roles: string[] }) {
  if (contact.active_status !== "active") {
    return "Contact is inactive.";
  }
  if (contact.do_not_contact) {
    return "Do not contact is enabled.";
  }
  if (!contactHasPrepRole(contact)) {
    return "Contact is not marked for prep communication.";
  }
  if (!contact.allow_sms) {
    return "SMS is not allowed for this contact.";
  }
  if (!contact.mobile_phone) {
    return "Missing mobile phone.";
  }
  if (contact.sms_consent_status !== "opted_in") {
    return `SMS consent is ${contact.sms_consent_status.replace(/_/g, " ")}.`;
  }
  return null;
}

function buildJobPrepGoogleMapsUrl(location: Pick<JobPrepLocationRow, "location_name" | "address_display" | "address_line_1" | "city" | "state" | "zip">) {
  const address = location.address_display || [location.address_line_1, [location.city, location.state].filter(Boolean).join(", "), location.zip].filter(Boolean).join(" ");
  const query = [location.location_name, address].filter(Boolean).join(" ");
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}

const PREP_LOCATION_DETAIL_WARNING_CODES = new Set(["location_missing_parking", "location_missing_entrance", "location_missing_setup"]);

function derivePrepReadinessQueueIssues(preview: JobPrepReadinessPreview): JobPrepReadinessQueueIssue[] {
  const warningCodes = new Set(preview.warnings.map((warning) => warning.code));
  const issues = new Set<JobPrepReadinessQueueIssue>();
  if (warningCodes.has("missing_primary_location")) {
    issues.add("missing_location");
  }
  if (warningCodes.has("no_prep_email_recipients")) {
    issues.add("missing_prep_recipient");
  }
  if (warningCodes.has("no_prep_sms_recipients")) {
    issues.add("missing_sms_eligibility");
  }
  if ([...warningCodes].some((code) => PREP_LOCATION_DETAIL_WARNING_CODES.has(code))) {
    issues.add("missing_location_details");
  }
  if (
    !preview.message_previews.client_prep_email.can_preview ||
    !preview.message_previews.client_prep_sms.can_preview ||
    !preview.message_previews.employee_briefing.can_preview
  ) {
    issues.add("message_preview_blocked");
  }
  return [...issues];
}

function buildPrepReadinessQueueItem(aggregate: LoadedJobAggregate, summary: JobSummaryView, preview: JobPrepReadinessPreview): JobPrepReadinessQueueItem {
  const issues = derivePrepReadinessQueueIssues(preview);
  const locationHasDetailGaps = issues.includes("missing_location_details");
  const messagePreviewBlockers = [
    preview.message_previews.client_prep_email,
    preview.message_previews.client_prep_sms,
    preview.message_previews.employee_briefing
  ].filter((messagePreview) => !messagePreview.can_preview);

  return {
    job_id: aggregate.job.id,
    job_number: aggregate.job.job_number,
    organization_id: aggregate.job.organization_id,
    organization_name: summary.organization_name,
    job_name: aggregate.job.title,
    job_date: summary.primary_day_date ?? timestampDatePart(aggregate.job.scheduled_start_at),
    department_type: aggregate.job.department_type,
    job_category: aggregate.job.job_category,
    readiness_status: preview.status,
    warnings: preview.warnings,
    issue_codes: issues,
    primary_location_status: preview.client_prep.primary_location ? (locationHasDetailGaps ? "needs_details" : "ready") : "missing",
    prep_email_recipient_status: preview.client_prep.eligible_email_recipients.length ? "ready" : "missing",
    sms_readiness_status: preview.client_prep.eligible_sms_recipients.length ? "ready" : preview.client_prep.excluded_contacts.length ? "not_ready" : "missing",
    message_preview_status: messagePreviewBlockers.some((messagePreview) => messagePreview.channel !== "sms") ? "blocked" : messagePreviewBlockers.length ? "needs_review" : "ready",
    job_command_center_href: `#jobs/${aggregate.job.id}`,
    client_command_center_href: aggregate.job.organization_id ? `#client-command-center/accounts/${aggregate.job.organization_id}` : null
  };
}

function summarizePrepReadinessQueue(items: JobPrepReadinessQueueItem[]): JobPrepReadinessQueueResponse["summary"] {
  return {
    total_count: items.length,
    ready_count: items.filter((item) => item.readiness_status === "ready").length,
    needs_review_count: items.filter((item) => item.readiness_status === "needs_attention").length,
    blocked_count: items.filter((item) => item.readiness_status === "blocked").length,
    missing_location_count: items.filter((item) => item.issue_codes.includes("missing_location")).length,
    missing_prep_recipient_count: items.filter((item) => item.issue_codes.includes("missing_prep_recipient")).length,
    missing_sms_eligibility_count: items.filter((item) => item.issue_codes.includes("missing_sms_eligibility")).length
  };
}

function pushPrepWarning(warnings: JobPrepReadinessWarning[], code: string, severity: JobPrepReadinessWarning["severity"], label: string, detail: string | null = null) {
  warnings.push({ code, severity, label, detail });
}

function makePrepWarning(code: string, severity: JobPrepReadinessWarning["severity"], label: string, detail: string | null = null): JobPrepReadinessWarning {
  return { code, severity, label, detail };
}

function compactPrepLine(label: string, value: string | null | undefined) {
  return value ? `${label}: ${value}` : null;
}

function firstPrepRecipientName(recipients: Array<{ display_name: string }>) {
  const firstName = recipients[0]?.display_name.split(/\s+/)[0]?.trim();
  return firstName || "there";
}

function buildJobPrepMessagePreviews(input: {
  accountName: string | null;
  jobName: string;
  jobDate: string | null;
  clientLocation: JobPrepReadinessPreview["client_prep"]["primary_location"];
  employeeLocation: JobPrepReadinessPreview["employee_briefing"]["primary_location"];
  eligibleEmail: JobPrepReadinessPreview["client_prep"]["eligible_email_recipients"];
  eligibleSms: JobPrepReadinessPreview["client_prep"]["eligible_sms_recipients"];
}): JobPrepReadinessPreview["message_previews"] {
  const accountName = input.accountName ?? "Account not connected yet";
  const jobDate = input.jobDate ?? "Job date not connected yet";
  const emailWarnings: JobPrepReadinessWarning[] = [];
  const smsWarnings: JobPrepReadinessWarning[] = [];
  const briefingWarnings: JobPrepReadinessWarning[] = [];

  if (!input.eligibleEmail.length) {
    emailWarnings.push(makePrepWarning("email_preview_no_recipient", "blocker", "No prep email recipients", "Add an active prep contact with email allowed."));
  }
  if (!input.eligibleSms.length) {
    smsWarnings.push(makePrepWarning("sms_preview_no_recipient", "blocker", "No SMS-eligible recipients", "SMS preview requires opted-in SMS recipients."));
  }
  if (!input.clientLocation) {
    emailWarnings.push(makePrepWarning("email_preview_no_location", "blocker", "No primary location", "Client prep email needs a primary location."));
    smsWarnings.push(makePrepWarning("sms_preview_no_location", "blocker", "No primary location", "Client prep SMS needs a primary location."));
  } else {
    if (!input.clientLocation.address_display) {
      emailWarnings.push(makePrepWarning("email_preview_missing_address", "warning", "Location missing address"));
    }
    if (!input.clientLocation.google_maps_url) {
      emailWarnings.push(makePrepWarning("email_preview_missing_map", "warning", "No Google Maps link"));
      smsWarnings.push(makePrepWarning("sms_preview_missing_map", "warning", "No Google Maps link"));
    }
  }
  if (!input.employeeLocation) {
    briefingWarnings.push(makePrepWarning("briefing_preview_no_location", "blocker", "No primary location", "Employee briefing needs a primary location."));
  }

  const clientLocation = input.clientLocation;
  const employeeLocation = input.employeeLocation;
  const clientAttachmentLines = clientLocation?.reference_attachments.length
    ? [`Client-safe attachments: ${clientLocation.reference_attachments.map((attachment) => attachment.title).join(", ")}`]
    : [];
  const emailBodyLines = [
    `Hello ${firstPrepRecipientName(input.eligibleEmail)},`,
    `Here are the prep details for ${input.jobName}.`,
    compactPrepLine("Account", accountName),
    compactPrepLine("Job date", jobDate),
    compactPrepLine("Location", clientLocation?.location_name),
    compactPrepLine("Address", clientLocation?.address_display),
    compactPrepLine("Google Maps", clientLocation?.google_maps_url),
    compactPrepLine("Prep note", clientLocation?.client_facing_notes),
    ...clientAttachmentLines,
    "Thanks,",
    "Kemmetmueller Photography"
  ].filter((line): line is string => Boolean(line));
  const smsBodyLines = input.eligibleSms.length
    ? [
        `${accountName}: ${input.jobName} on ${jobDate}.`,
        clientLocation?.location_name ? `Location: ${clientLocation.location_name}.` : null,
        clientLocation?.google_maps_url ? `Map: ${clientLocation.google_maps_url}` : null,
        clientLocation?.client_facing_notes ? `Note: ${clientLocation.client_facing_notes}` : null
      ].filter((line): line is string => Boolean(line))
    : ["SMS preview unavailable until at least one prep contact is SMS eligible."];
  const employeeBodyLines = [
    `Job: ${input.jobName}`,
    compactPrepLine("Account", accountName),
    compactPrepLine("Job date", jobDate),
    compactPrepLine("Primary location", employeeLocation?.location_name),
    compactPrepLine("Address", employeeLocation?.address_display),
    compactPrepLine("Google Maps", employeeLocation?.google_maps_url),
    compactPrepLine("Navigation", employeeLocation?.navigation_notes),
    compactPrepLine("Parking", employeeLocation?.parking_instructions),
    compactPrepLine("Entrance / check-in", employeeLocation?.entrance_instructions),
    compactPrepLine("Unloading", employeeLocation?.unloading_instructions),
    compactPrepLine("Setup area", employeeLocation?.setup_area),
    compactPrepLine("Backup indoor location", employeeLocation?.backup_indoor_location),
    compactPrepLine("Power", employeeLocation?.power_availability_notes),
    compactPrepLine("Wi-Fi / cell", employeeLocation?.wifi_cell_notes),
    compactPrepLine("Weather contingency", employeeLocation?.weather_contingency_notes),
    compactPrepLine("Employee-facing notes", employeeLocation?.employee_facing_notes),
    compactPrepLine("Internal-only notes", employeeLocation?.internal_only_notes),
    employeeLocation?.reference_attachments.length ? `Reference attachments: ${employeeLocation.reference_attachments.map((attachment) => `${attachment.title} (${attachment.audience.replace(/_/g, " ")})`).join(", ")}` : null
  ].filter((line): line is string => Boolean(line));

  return {
    client_prep_email: {
      preview_only: true,
      template_key: "client_prep_email_v1",
      label: "Client Prep Email",
      channel: "email",
      can_preview: emailWarnings.every((warning) => warning.severity !== "blocker"),
      recipients: input.eligibleEmail,
      subject: `Prep details for ${input.jobName}`,
      body_lines: emailBodyLines,
      warnings: emailWarnings,
      reference_attachments: clientLocation?.reference_attachments ?? []
    },
    client_prep_sms: {
      preview_only: true,
      template_key: "client_prep_sms_v1",
      label: "Client Prep SMS",
      channel: "sms",
      can_preview: smsWarnings.every((warning) => warning.severity !== "blocker"),
      recipients: input.eligibleSms,
      subject: null,
      body_lines: smsBodyLines,
      warnings: smsWarnings,
      reference_attachments: []
    },
    employee_briefing: {
      preview_only: true,
      template_key: "employee_briefing_v1",
      label: "Employee Briefing",
      channel: "internal_briefing",
      can_preview: briefingWarnings.every((warning) => warning.severity !== "blocker"),
      recipients: [],
      subject: `Employee briefing: ${input.jobName}`,
      body_lines: employeeBodyLines,
      warnings: briefingWarnings,
      reference_attachments: employeeLocation?.reference_attachments ?? []
    }
  };
}

async function buildJobPrepReadinessPreview(
  client: PoolClient,
  tenantId: string,
  aggregate: LoadedJobAggregate,
  summary: JobSummaryView
): Promise<JobPrepReadinessPreview> {
  const warnings: JobPrepReadinessWarning[] = [];
  const organizationId = aggregate.job.organization_id;
  const contactRows = organizationId
    ? await listRows<JobPrepContactRow>(
        client,
        `
          SELECT
            contact.id::text,
            COALESCE(contact.display_name, contact.full_name) AS display_name,
            contact.title,
            contact.email,
            contact.mobile_phone,
            contact.active_status::text AS active_status,
            contact.allow_email,
            contact.allow_sms,
            contact.do_not_contact,
            contact.sms_consent_status::text AS sms_consent_status,
            relationship.client_roles
          FROM organization_contact_relationship relationship
          JOIN organization_contact contact
            ON contact.tenant_id = relationship.tenant_id
           AND contact.id = relationship.contact_id
          WHERE relationship.tenant_id = $1
            AND relationship.organization_id = $2
            AND relationship.is_current = true
          ORDER BY relationship.is_primary DESC, contact.active_status, lower(contact.full_name)
        `,
        [tenantId, organizationId]
      )
    : [];

  const contacts = contactRows.map((contact) => ({
    ...contact,
    client_roles: parseJobPrepRoles(contact.client_roles)
  }));
  const contactPreview = contacts.map((normalized) => {
    return {
      id: normalized.id,
      display_name: normalized.display_name,
      title: normalized.title,
      email: normalized.email,
      mobile_phone: normalized.mobile_phone,
      client_roles: normalized.client_roles,
      prep_email_exclusion_reason: buildJobPrepEmailExclusion(normalized),
      prep_sms_exclusion_reason: buildJobPrepSmsExclusion(normalized)
    };
  });
  const eligibleEmail = contactPreview
    .filter((contact) => !contact.prep_email_exclusion_reason)
    .map((contact) => ({
      id: contact.id,
      display_name: contact.display_name,
      title: contact.title,
      email: contact.email,
      mobile_phone: contact.mobile_phone,
      client_roles: contact.client_roles
    }));
  const eligibleSms = contactPreview
    .filter((contact) => !contact.prep_sms_exclusion_reason)
    .map((contact) => ({
      id: contact.id,
      display_name: contact.display_name,
      title: contact.title,
      email: contact.email,
      mobile_phone: contact.mobile_phone,
      client_roles: contact.client_roles
    }));
  const excludedContacts = contactPreview.filter((contact) => contact.prep_email_exclusion_reason || contact.prep_sms_exclusion_reason);

  if (!eligibleEmail.length) {
    pushPrepWarning(warnings, "no_prep_email_recipients", "blocker", "No prep email recipients", "Add an active prep contact with email allowed.");
  }
  if (!eligibleSms.length) {
    pushPrepWarning(warnings, "no_prep_sms_recipients", "warning", "No SMS-eligible prep recipients", "SMS requires mobile phone, SMS allowed, and opted-in consent.");
  }
  if (!contacts.some((contact) => contact.client_roles.includes("emergency_day_of_contact"))) {
    pushPrepWarning(warnings, "no_day_of_contact", "warning", "No day-of contact", "Mark an active contact as the emergency/day-of contact before relying on prep communication.");
  }

  const primaryLocationId = aggregate.job.primary_location_id ?? aggregate.days.find((day) => day.location_id)?.location_id ?? null;
  let clientLocation: JobPrepReadinessPreview["client_prep"]["primary_location"] = null;
  let employeeLocation: JobPrepReadinessPreview["employee_briefing"]["primary_location"] = null;

  if (!primaryLocationId) {
    pushPrepWarning(warnings, "missing_primary_location", "blocker", "No primary location", "Add a primary job location before previewing prep messages.");
  } else {
    const location = await client.query<JobPrepLocationRow>(
      `
        SELECT
          id::text,
          name AS location_name,
          address_line_1,
          address_line_2,
          city,
          state,
          zip,
          COALESCE(
            NULLIF(address, ''),
            NULLIF(
              trim(
                concat_ws(
                  ', ',
                  NULLIF(address_line_1, ''),
                  NULLIF(address_line_2, ''),
                  NULLIF(
                    trim(
                      concat_ws(
                        ' ',
                        NULLIF(concat_ws(', ', NULLIF(city, ''), NULLIF(state, '')), ''),
                        NULLIF(zip, '')
                      )
                    ),
                    ''
                  )
                )
              ),
              ''
            )
          ) AS address_display,
          navigation_url,
          navigation_notes,
          parking_instructions,
          entrance_instructions,
          unloading_instructions,
          setup_area,
          backup_indoor_location,
          accessibility_notes,
          power_availability_notes,
          wifi_cell_notes,
          security_checkin_requirements,
          weather_contingency_notes,
          client_facing_notes,
          employee_facing_notes,
          internal_only_notes
        FROM shoot_location
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1
      `,
      [tenantId, primaryLocationId]
    );
    const locationRow = location.rows[0] ?? null;
    if (!locationRow) {
      pushPrepWarning(warnings, "missing_primary_location", "blocker", "Primary location unavailable", "The job references a location that could not be loaded.");
    } else {
      const attachmentRows = await listRows<JobPrepAttachmentRow>(
        client,
        `
          SELECT
            id::text,
            title,
            description,
            attachment_type::text AS attachment_type,
            audience::text AS audience,
            file_url,
            storage_key
          FROM location_reference_attachment
          WHERE tenant_id = $1
            AND location_id = $2
            AND active_status = 'active'::directory_active_status
          ORDER BY audience::text, attachment_type::text, lower(title)
        `,
        [tenantId, primaryLocationId]
      );
      const googleMapsUrl = locationRow.navigation_url ?? buildJobPrepGoogleMapsUrl(locationRow);
      if (!locationRow.address_display) {
        pushPrepWarning(warnings, "location_missing_address", "warning", "Location missing address", "Add a street address so generated directions are reliable.");
      }
      if (!googleMapsUrl) {
        pushPrepWarning(warnings, "location_missing_map_link", "warning", "No Google Maps link", "Add a manual Maps URL or enough address detail to generate one.");
      }
      if (!locationRow.parking_instructions) {
        pushPrepWarning(warnings, "location_missing_parking", "warning", "Missing parking instructions");
      }
      if (!locationRow.entrance_instructions) {
        pushPrepWarning(warnings, "location_missing_entrance", "warning", "Missing entrance/check-in instructions");
      }
      if (!locationRow.setup_area) {
        pushPrepWarning(warnings, "location_missing_setup", "warning", "Missing setup area");
      }

      const commonLocation = {
        id: locationRow.id,
        location_name: locationRow.location_name,
        address_display: locationRow.address_display,
        google_maps_url: googleMapsUrl,
        client_facing_notes: locationRow.client_facing_notes
      };
      clientLocation = {
        ...commonLocation,
        reference_attachments: attachmentRows.filter((attachment) => attachment.audience === "client_facing")
      };
      employeeLocation = {
        ...commonLocation,
        navigation_notes: locationRow.navigation_notes,
        parking_instructions: locationRow.parking_instructions,
        entrance_instructions: locationRow.entrance_instructions,
        unloading_instructions: locationRow.unloading_instructions,
        setup_area: locationRow.setup_area,
        backup_indoor_location: locationRow.backup_indoor_location,
        accessibility_notes: locationRow.accessibility_notes,
        power_availability_notes: locationRow.power_availability_notes,
        wifi_cell_notes: locationRow.wifi_cell_notes,
        security_checkin_requirements: locationRow.security_checkin_requirements,
        weather_contingency_notes: locationRow.weather_contingency_notes,
        employee_facing_notes: locationRow.employee_facing_notes,
        internal_only_notes: locationRow.internal_only_notes,
        reference_attachments: attachmentRows
      };
    }
  }

  const status = warnings.some((warning) => warning.severity === "blocker") ? "blocked" : warnings.length ? "needs_attention" : "ready";
  const accountName = summary.organization_name;
  const jobName = aggregate.job.title;
  const jobDate = summary.primary_day_date ?? timestampDatePart(aggregate.job.scheduled_start_at);
  const messagePreviews = buildJobPrepMessagePreviews({
    accountName,
    jobName,
    jobDate,
    clientLocation,
    employeeLocation,
    eligibleEmail,
    eligibleSms
  });
  return {
    preview_only: true,
    generated_at: new Date().toISOString(),
    status,
    client_prep: {
      account_name: accountName,
      job_name: jobName,
      job_date: jobDate,
      primary_location: clientLocation,
      eligible_email_recipients: eligibleEmail,
      eligible_sms_recipients: eligibleSms,
      excluded_contacts: excludedContacts
    },
    employee_briefing: {
      primary_location: employeeLocation
    },
    message_previews: messagePreviews,
    warnings
  };
}

function summarizeProductionQueue(
  items: ProductionQueueItem[],
  now = new Date()
): ProductionQueueSummary {
  const todayKey = now.toISOString().slice(0, 10);
  return {
    total_count: items.length,
    blocked_count: items.filter((item) => item.status === "blocked" || item.blocking_issue_count > 0 || Boolean(item.blocked_reason)).length,
    overdue_count: items.filter((item) => {
      const due = normalizeTimestamp(item.due_at);
      return due ? new Date(due).getTime() < now.getTime() : false;
    }).length,
    awaiting_approval_count: items.filter((item) => ["requested", "viewed", "overdue", "revisions_requested"].includes(item.approval_status)).length,
    qa_pending_count: items.filter((item) => !["not_required", "passed", "passed_with_notes", "complete"].includes(item.qa_summary_status)).length,
    due_today_count: items.filter((item) => normalizeTimestamp(item.due_at)?.slice(0, 10) === todayKey).length
  };
}

function normalizeMatchToken(value: string | null | undefined) {
  const normalized = normalizeNullableText(value);
  return normalized ? normalized.toLowerCase() : null;
}

function matchesProductionQueueSearch(item: ProductionQueueItem, search: string | null | undefined) {
  const normalizedSearch = normalizeMatchToken(search);
  if (!normalizedSearch) {
    return true;
  }
  return [
    item.title,
    item.job_title,
    item.job_number,
    item.organization_name,
    item.production_type,
    item.assigned_to_name,
    item.primary_contact_name,
    item.release_target,
    item.client_visible_label,
    item.vendor_name,
    item.vendor_reference,
    item.blocked_reason
  ]
    .map((value) => normalizeMatchToken(value))
    .filter((value): value is string => Boolean(value))
    .some((value) => value.includes(normalizedSearch));
}

function matchesProductionQueueChecklistState(
  item: ProductionQueueItem,
  checklistState: "overdue" | "awaiting_approval" | "rejected" | "blocked" | null | undefined
) {
  switch (checklistState) {
    case "overdue":
      return item.checklist_overdue_count > 0;
    case "awaiting_approval":
      return item.checklist_awaiting_approval_count > 0;
    case "rejected":
      return item.checklist_rejected_count > 0;
    case "blocked":
      return item.checklist_blocked_count > 0;
    default:
      return true;
  }
}

function canManageProductionItem(auth: AuthUser, aggregate: LoadedJobAggregate, itemId?: string | null) {
  const item = itemId ? aggregate.productionItems.find((row) => row.id === itemId) ?? null : null;
  const context = buildProductionPolicyContext(aggregate, item);
  if (canSharedPolicy(auth, "production.update", context)) {
    return true;
  }
  if (hasManageAccess(auth, aggregate.job.department_type)) {
    return true;
  }
  if (!item) {
    return false;
  }
  return (
    item.assigned_to_user_id === auth.id ||
    item.assigned_peer_reviewer_user_id === auth.id ||
    item.assigned_release_reviewer_user_id === auth.id
  );
}

function canManageProductionAction(
  auth: AuthUser,
  aggregate: LoadedJobAggregate,
  permissionKey:
    | "production.group"
    | "production.split"
    | "production.merge"
    | "production.reopen"
    | "production.cancel"
    | "production.override_dates"
    | "production.release_approve",
  item?: ProductionItemRecord | null
) {
  const context = buildProductionPolicyContext(aggregate, item);
  if (canSharedPolicy(auth, permissionKey, context)) {
    return true;
  }
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"])) {
    return true;
  }
  if (
    ["production.group", "production.split", "production.release_approve", "production.reopen"].includes(permissionKey) &&
    hasManageAccess(auth, aggregate.job.department_type)
  ) {
    return true;
  }
  return false;
}

function requireWriteAccess(auth: AuthUser, department: JobDepartmentType) {
  if (
    canSharedPolicy(auth, "job.create", { departmentType: department }) ||
    canSharedPolicy(auth, "job.update", { departmentType: department })
  ) {
    return;
  }
  const legacyDepartment = mapDepartmentToLegacy(department);
  if (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    (department === "schools" && canManageSchoolsHub(auth)) ||
    (department === "sports" && canManageSportsDepartment(auth)) ||
    canCreateOrEditShootDepartment(auth, legacyDepartment)
  ) {
    return;
  }
  throw new ApiError(403, "Forbidden");
}

export function requireManageAccess(auth: AuthUser, department: JobDepartmentType) {
  if (
    canSharedPolicy(auth, "job.update", { departmentType: department }) ||
    canSharedPolicy(auth, "job.publish", { departmentType: department }) ||
    canSharedPolicy(auth, "job.assign_staff", { departmentType: department }) ||
    canSharedPolicy(auth, "job.manage_readiness", { departmentType: department }) ||
    canSharedPolicy(auth, "production.update", { departmentType: department }) ||
    canSharedPolicy(auth, "watchflag.resolve", { departmentType: department })
  ) {
    return;
  }
  if (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    (department === "schools" && canManageSchoolsHub(auth)) ||
    (department === "sports" && canManageSportsDepartment(auth))
  ) {
    return;
  }
  throw new ApiError(403, "Forbidden");
}

function hasManageAccess(auth: AuthUser, department: JobDepartmentType) {
  try {
    requireManageAccess(auth, department);
    return true;
  } catch {
    return false;
  }
}

function canManageSportsDepartment(auth: Pick<AuthUser, "authorityTier" | "department" | "jobFunctionProfiles" | "permissions">) {
  return (
    hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin"]) ||
    (auth.department === "sports" && hasAuthorityTier(auth, "supervisor")) ||
    auth.jobFunctionProfiles.some((profile) => ["sports_client_success", "director_of_sports_photography"].includes(profile)) ||
    auth.permissions.includes("sports_hub.manage")
  );
}

function getSportsReadScope(auth: Pick<AuthUser, "authorityTier" | "department" | "jobFunctionProfiles" | "permissions" | "roles">) {
  if (canManageSportsDepartment(auth)) {
    return "all" as const;
  }
  if (hasAuthorityTier(auth, "read_only_viewer")) {
    return "all" as const;
  }
  if (
    auth.jobFunctionProfiles.some((profile) =>
      [
        "sports_client_success",
        "customer_service_rep",
        "graphic_artist",
        "director_of_digital_production",
        "director_of_school_photography"
      ].includes(profile)
    )
  ) {
    return "all" as const;
  }
  if (auth.permissions.includes("sports_hub.view")) {
    return "all" as const;
  }
  const ownOnly =
    !hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"]) &&
    !auth.jobFunctionProfiles.some((profile) => ["schools_client_success", "sports_client_success", "customer_service_rep"].includes(profile)) &&
    (auth.jobFunctionProfiles.some((profile) =>
      ["associate_photographer", "seasonal_photographer", "part_time_photographer", "senior_photographer", "graphic_artist"].includes(profile)
    ) || auth.roles.includes("office_employee"));
  return ownOnly ? ("own" as const) : null;
}

function getPolicyReadScope(auth: AuthUser, department: JobDepartmentType) {
  const grants = auth.policyGrants.filter(
    (grant) =>
      grant.permissionKey === "job.read" &&
      grant.effect === "allow" &&
      (grant.scopeType === "global" || (grant.scopeType === "department" && grant.scopeValue === department) || grant.scopeType !== "department")
  );
  if (!grants.length) {
    return null;
  }
  if (grants.some((grant) => grant.scopeType === "global" || (grant.scopeType === "department" && grant.scopeValue === department))) {
    return "all" as const;
  }
  return "own" as const;
}

export function hasReadScope(auth: AuthUser, department: JobDepartmentType) {
  const policyScope = getPolicyReadScope(auth, department);
  if (policyScope) {
    return policyScope;
  }
  if (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "read_only_viewer"])) {
    return "all" as const;
  }
  if (department === "schools") {
    return getSchoolsHubAccessScope(auth);
  }
  if (department === "sports") {
    return getSportsReadScope(auth);
  }
  return null;
}

function validateSharedPublish(
  job: JobRecord,
  days: JobDayRecord[],
  config: {
    required_fields: string[];
    allow_location_override_note: boolean;
    allow_contact_override_note: boolean;
  }
): JobValidationResult {
  const errors = [];
  const requiredFields = new Set(config.required_fields);
  if (requiredFields.has("department_type") && !job.department_type) {
    errors.push({ field: "department_type", code: "required", message: "Department is required." });
  }
  if (requiredFields.has("organization_id") && !job.organization_id) {
    errors.push({ field: "organization_id", code: "required", message: "Organization is required." });
  }
  if (requiredFields.has("title") && !normalizeNullableText(job.title) && !normalizeNullableText(job.event_name)) {
    errors.push({ field: "title", code: "required", message: "A title or event name is required." });
  }
  if (requiredFields.has("days") && days.length === 0 && !job.scheduled_start_at) {
    errors.push({ field: "days", code: "required", message: "At least one execution day is required." });
  }
  if (
    requiredFields.has("primary_location_id") &&
    !job.primary_location_id &&
    !(config.allow_location_override_note && normalizeNullableText(job.location_override_note))
  ) {
    errors.push({ field: "primary_location_id", code: "required", message: "Location is required unless explicitly overridden." });
  }
  if (
    requiredFields.has("primary_contact_id") &&
    !job.primary_contact_id &&
    !(config.allow_contact_override_note && normalizeNullableText(job.contact_override_note))
  ) {
    errors.push({ field: "primary_contact_id", code: "required", message: "Primary contact is required unless explicitly overridden." });
  }
  if (requiredFields.has("timezone") && !normalizeNullableText(job.timezone)) {
    errors.push({ field: "timezone", code: "required", message: "Timezone is required." });
  }
  return { valid: errors.length === 0, errors };
}

async function getRow<T extends QueryResultRow>(client: PoolClient, sql: string, params: unknown[]) {
  const result = await client.query<T>(sql, params);
  return result.rows[0] ?? null;
}

async function listRows<T extends QueryResultRow>(client: PoolClient, sql: string, params: unknown[]) {
  const result = await client.query<T>(sql, params);
  return result.rows;
}

export async function getJobRecord(client: PoolClient, tenantId: string, jobId: string) {
  return getRow<JobRecord>(
    client,
    `
      SELECT *
      FROM jobs
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [tenantId, jobId]
  );
}

async function loadJobAggregate(client: PoolClient, tenantId: string, jobId: string): Promise<LoadedJobAggregate | null> {
  const job = await getJobRecord(client, tenantId, jobId);
  if (!job) {
    return null;
  }

  const schoolProfile = await getRow<SchoolJobProfileRecord>(
    client,
    `SELECT * FROM school_job_profiles WHERE tenant_id = $1 AND job_id = $2 LIMIT 1`,
    [tenantId, jobId]
  );
  const sportsProfile = await getRow<SportsJobProfileRecord>(
    client,
    `SELECT * FROM sports_job_profiles WHERE tenant_id = $1 AND job_id = $2 LIMIT 1`,
    [tenantId, jobId]
  );
  const days = await listRows<JobDayRecord>(
    client,
    `SELECT * FROM job_days WHERE tenant_id = $1 AND job_id = $2 ORDER BY date ASC, created_at ASC`,
    [tenantId, jobId]
  );
  const staffAssignments = await listRows<JobStaffAssignmentRecord>(
    client,
    `SELECT * FROM job_staff_assignments WHERE tenant_id = $1 AND job_id = $2 ORDER BY is_lead DESC, created_at ASC`,
    [tenantId, jobId]
  );
  const readinessItems = await listRows<JobReadinessItemRecord>(
    client,
    `SELECT * FROM job_readiness_items WHERE tenant_id = $1 AND job_id = $2 ORDER BY section_key ASC, sort_order ASC, created_at ASC`,
    [tenantId, jobId]
  );
  const jobShootLinks = await listRows<JobShootLinkRecord>(
    client,
    `SELECT * FROM job_shoot_links WHERE tenant_id = $1 AND job_id = $2 ORDER BY created_at ASC`,
    [tenantId, jobId]
  );
  const productionItems = await listRows<ProductionItemRecord>(
    client,
    `SELECT * FROM production_items WHERE tenant_id = $1 AND job_id = $2 AND merged_into_production_item_id IS NULL ORDER BY created_at ASC`,
    [tenantId, jobId]
  );
  const productionItemShootLinks = await listRows<ProductionItemShootLinkRecord>(
    client,
    `
      SELECT link.*
      FROM production_item_shoot_links link
      JOIN production_items item
        ON item.id = link.production_item_id
       AND item.tenant_id = link.tenant_id
      WHERE link.tenant_id = $1
        AND item.job_id = $2
        AND item.merged_into_production_item_id IS NULL
      ORDER BY link.created_at ASC
    `,
    [tenantId, jobId]
  );
  const productionHandoffs = await listRows<ProductionHandoffRecord>(
    client,
    `
      SELECT handoff.*
      FROM production_handoffs handoff
      JOIN production_items item
        ON item.id = handoff.production_item_id
       AND item.tenant_id = handoff.tenant_id
      WHERE handoff.tenant_id = $1
        AND item.job_id = $2
      ORDER BY handoff.created_at DESC
    `,
    [tenantId, jobId]
  );
  const approvalRequests = await listRows<ApprovalRequestRecord>(
    client,
    `SELECT * FROM approval_requests WHERE tenant_id = $1 AND job_id = $2 ORDER BY created_at DESC`,
    [tenantId, jobId]
  );
  const qaReviews = await listRows<QaReviewRecord>(
    client,
    `SELECT * FROM qa_review_records WHERE tenant_id = $1 AND job_id = $2 ORDER BY created_at DESC`,
    [tenantId, jobId]
  );
  const qaFindings = await listRows<QaReviewFindingRecord>(
    client,
    `
      SELECT finding.*
      FROM qa_review_findings finding
      JOIN qa_review_records review
        ON review.id = finding.qa_review_record_id
       AND review.tenant_id = finding.tenant_id
      WHERE finding.tenant_id = $1
        AND review.job_id = $2
      ORDER BY finding.created_at DESC
    `,
    [tenantId, jobId]
  );
  const deliverableItems = await listRows<DeliverableItemRecord>(
    client,
    `
      SELECT deliverable.*
      FROM deliverable_items deliverable
      JOIN production_items item
        ON item.id = deliverable.production_item_id
       AND item.tenant_id = deliverable.tenant_id
      WHERE deliverable.tenant_id = $1
        AND item.job_id = $2
      ORDER BY deliverable.created_at DESC
    `,
    [tenantId, jobId]
  );
  const productionIssues = await listRows<ProductionIssueRecord>(
    client,
    `SELECT * FROM production_issue_records WHERE tenant_id = $1 AND job_id = $2 ORDER BY created_at DESC`,
    [tenantId, jobId]
  );
  const watchFlags = await listRows<JobWatchFlagRecord>(
    client,
    `SELECT * FROM job_watch_flags WHERE tenant_id = $1 AND job_id = $2 ORDER BY created_at DESC`,
    [tenantId, jobId]
  );
  const activity = await listRows<ActivityLogEntryRecord>(
    client,
    `SELECT * FROM activity_log_entries WHERE tenant_id = $1 AND job_id = $2 ORDER BY created_at DESC`,
    [tenantId, jobId]
  );

  const status = calculateJobStatusSnapshot({
    job,
    days,
    readinessItems,
    staffAssignments,
    productionItems,
    approvalRequests,
    qaReviews,
    qaFindings,
    deliverableItems,
    productionIssues,
    watchFlags,
    activity
  });

  return {
    job,
    schoolProfile,
    sportsProfile,
    days,
    staffAssignments,
    readinessItems,
    jobShootLinks,
    productionItems,
    productionItemShootLinks,
    productionHandoffs,
    approvalRequests,
    qaReviews,
    qaFindings,
    deliverableItems,
    productionIssues,
    watchFlags,
    activity,
    status
  };
}

async function buildJobDetailResponse(
  client: PoolClient,
  auth: AuthUser,
  tenantId: string,
  aggregate: LoadedJobAggregate
): Promise<JobDetailResponse> {
  const publishValidation = await validateDepartmentPublish(client, aggregate);
  const ids = collectAggregateRelatedIds(aggregate, aggregate.schoolProfile, aggregate.sportsProfile);
  const maps = await loadDisplayMaps(client, tenantId, ids);
  const schoolProfile = buildSchoolProfileView(aggregate.schoolProfile, maps);
  const sportsProfile = buildSportsProfileView(aggregate.sportsProfile, maps);
  const summary = buildJobSummaryView(aggregate, maps, schoolProfile, sportsProfile);
  const prepReadiness = await buildJobPrepReadinessPreview(client, tenantId, aggregate, summary);
  const linkedShootIds = [...new Set([...aggregate.jobShootLinks.map((link) => link.shoot_id), ...aggregate.productionItemShootLinks.map((link) => link.shoot_id)])];
  const shootCompletionMap = await loadShootCompletionMap(client, tenantId, linkedShootIds);
  const itemShootMap = buildProductionItemShootMap(aggregate.productionItemShootLinks, shootCompletionMap);
  const activityTimeline = await getActivityTimeline(client, auth, {
    objectType: "job",
    objectId: aggregate.job.id,
    limit: 80
  });
  const sharedWorkflow = await getSharedWorkflowJobDetail(client, tenantId, aggregate.job.id);
  const events = aggregate.days.map((day) => ({
    ...day,
    location_name: day.location_id ? maps.locations.get(day.location_id)?.label ?? null : null,
    onsite_contact_name: day.onsite_contact_id ? maps.contacts.get(day.onsite_contact_id)?.label ?? null : null,
    lead_user_name: day.lead_user_id ? maps.users.get(day.lead_user_id)?.label ?? null : null
  }));
  const jobExceptions = aggregate.watchFlags.map((flag) => ({
    ...flag,
    owner_name: flag.owner_user_id ? maps.users.get(flag.owner_user_id)?.label ?? null : null,
    resolved_by_name: flag.resolved_by_user_id ? maps.users.get(flag.resolved_by_user_id)?.label ?? null : null
  }));

  return sanitizeJobDetailResponse(client, auth, {
    job: aggregate.job,
    summary,
    school_profile: schoolProfile,
    sports_profile: sportsProfile,
    job_shoot_links: aggregate.jobShootLinks,
    events,
    days: events,
    staff_assignments: aggregate.staffAssignments.map((assignment) => ({
      ...assignment,
      user_name: maps.users.get(assignment.user_id)?.label ?? null
    })),
    readiness_items: aggregate.readinessItems.map((item) => ({
      ...item,
      completed_by_name: item.completed_by_user_id ? maps.users.get(item.completed_by_user_id)?.label ?? null : null
    })),
    production_items: aggregate.productionItems.map((item) => ({
      ...item,
      assigned_to_name: item.assigned_to_user_id ? maps.users.get(item.assigned_to_user_id)?.label ?? null : null,
      account_owner_name: item.account_owner_user_id ? maps.users.get(item.account_owner_user_id)?.label ?? null : null,
      primary_contact_name: item.primary_contact_id ? maps.contacts.get(item.primary_contact_id)?.label ?? null : null,
      location_name: item.location_id ? maps.locations.get(item.location_id)?.label ?? null : null,
      assigned_peer_reviewer_name: item.assigned_peer_reviewer_user_id ? maps.users.get(item.assigned_peer_reviewer_user_id)?.label ?? null : null,
      assigned_release_reviewer_name: item.assigned_release_reviewer_user_id ? maps.users.get(item.assigned_release_reviewer_user_id)?.label ?? null : null,
      escalation_owner_name: item.escalation_owner_user_id ? maps.users.get(item.escalation_owner_user_id)?.label ?? null : null,
      hold_owner_name: item.hold_owner_user_id ? maps.users.get(item.hold_owner_user_id)?.label ?? null : null,
      ...buildProductionItemDetailView(
        item,
        aggregate.productionIssues.filter((issue) => issue.production_item_id === item.id),
        aggregate.qaReviews.filter((review) => review.production_item_id === item.id),
        aggregate.qaFindings.filter((finding) =>
          aggregate.qaReviews.some((review) => review.id === finding.qa_review_record_id && review.production_item_id === item.id)
        ),
        itemShootMap.get(item.id)
      )
    })),
    production_item_shoot_links: aggregate.productionItemShootLinks,
    production_handoffs: aggregate.productionHandoffs.map((handoff) => ({
      ...handoff,
      from_user_name: handoff.from_user_id ? maps.users.get(handoff.from_user_id)?.label ?? null : null,
      to_user_name: handoff.to_user_id ? maps.users.get(handoff.to_user_id)?.label ?? null : null
    })),
    approval_requests: aggregate.approvalRequests.map((request) => ({
      ...request,
      approver_contact_name: request.approver_contact_id ? maps.contacts.get(request.approver_contact_id)?.label ?? null : null,
      approver_user_name: request.approver_user_id ? maps.users.get(request.approver_user_id)?.label ?? null : null
    })),
    qa_reviews: aggregate.qaReviews.map((review) => ({
      ...review,
      reviewer_name: maps.users.get(review.reviewer_user_id)?.label ?? null,
      requested_by_name: review.requested_by_user_id ? maps.users.get(review.requested_by_user_id)?.label ?? null : null,
      sent_back_to_name: review.sent_back_to_user_id ? maps.users.get(review.sent_back_to_user_id)?.label ?? null : null,
      original_owner_name: review.original_owner_user_id ? maps.users.get(review.original_owner_user_id)?.label ?? null : null,
      accountable_owner_name: review.accountable_owner_user_id ? maps.users.get(review.accountable_owner_user_id)?.label ?? null : null,
      accountable_reviewer_name: review.accountable_reviewer_user_id ? maps.users.get(review.accountable_reviewer_user_id)?.label ?? null : null
    })),
    qa_findings: aggregate.qaFindings.map((finding) => ({
      ...finding,
      resolved_by_name: finding.resolved_by_user_id ? maps.users.get(finding.resolved_by_user_id)?.label ?? null : null
    })),
    deliverable_items: aggregate.deliverableItems.map((deliverable) => ({
      ...deliverable,
      recipient_contact_name: deliverable.recipient_contact_id
        ? maps.contacts.get(deliverable.recipient_contact_id)?.label ?? null
        : null,
      recipient_organization_name: deliverable.recipient_organization_id
        ? maps.organizations.get(deliverable.recipient_organization_id)?.label ?? null
        : null
    })),
    production_issues: aggregate.productionIssues.map((issue) => ({
      ...issue,
      owner_name: issue.owner_user_id ? maps.users.get(issue.owner_user_id)?.label ?? null : null,
      resolved_by_name: issue.resolved_by_user_id ? maps.users.get(issue.resolved_by_user_id)?.label ?? null : null
    })),
    production_blockers: aggregate.productionIssues
      .filter((issue) => issue.is_blocking)
      .map((issue) => ({
        ...issue,
        owner_name: issue.owner_user_id ? maps.users.get(issue.owner_user_id)?.label ?? null : null,
        resolved_by_name: issue.resolved_by_user_id ? maps.users.get(issue.resolved_by_user_id)?.label ?? null : null
      })),
    job_exceptions: jobExceptions,
    watch_flags: jobExceptions,
    activity: activityTimeline.items,
    status: aggregate.status,
    workflow: buildJobWorkflowSummary({
      job: aggregate.job,
      days: aggregate.days,
      staffAssignments: aggregate.staffAssignments,
      readinessItems: aggregate.readinessItems,
      productionItems: aggregate.productionItems,
      approvalRequests: aggregate.approvalRequests,
      productionIssues: aggregate.productionIssues,
      watchFlags: aggregate.watchFlags,
      status: aggregate.status,
      publishValidation
    }),
    shared_workflow: sharedWorkflow,
    prep_readiness: prepReadiness,
    policy: {
      permissions: auth.permissions,
      fields: {},
      sections: {},
      actions: {},
      reasons: {}
    }
  });
}

async function assertJobReadAccess(auth: AuthUser, aggregate: LoadedJobAggregate) {
  const policyContext = {
    departmentType: aggregate.job.department_type,
    organizationId: aggregate.job.organization_id,
    locationId: aggregate.job.primary_location_id,
    ownerUserIds: [aggregate.job.account_owner_user_id, aggregate.job.created_by_user_id],
    assignedUserIds: [
      ...aggregate.staffAssignments.map((assignment) => assignment.user_id),
      ...aggregate.productionItems.map((item) => item.assigned_to_user_id),
      ...aggregate.watchFlags.map((flag) => flag.owner_user_id)
    ]
  };
  if (canSharedPolicy(auth, "job.read", policyContext)) {
    return;
  }
  const scope = hasReadScope(auth, aggregate.job.department_type);
  if (scope === "all") {
    return;
  }
  const isOwn = aggregate.job.account_owner_user_id === auth.id ||
    aggregate.job.created_by_user_id === auth.id ||
    aggregate.staffAssignments.some((assignment) => assignment.user_id === auth.id);
  if (scope === "own" && isOwn) {
    return;
  }
  throw new ApiError(403, "Forbidden");
}

async function upsertJobCore(
  client: PoolClient,
  tenantId: string,
  actorUserId: string,
  input: JobDraftInput,
  existingJobId?: string | null
) {
  const scheduledStartAt = input.scheduled_start_at ?? null;
  const rawScheduledEndAt = input.scheduled_end_at ?? null;
  // The jobs table requires scheduled_end_at to be strictly after scheduled_start_at.
  // Intake composes an end timestamp from the start date when no explicit end is given,
  // which yields end === start (a zero-length window). Store that degenerate end as null
  // instead of letting it violate the constraint as an unhandled 500. A real end > start
  // is preserved; a genuinely invalid payload still fails validation upstream.
  const scheduledEndAt =
    rawScheduledEndAt && scheduledStartAt && new Date(rawScheduledEndAt).getTime() <= new Date(scheduledStartAt).getTime()
      ? null
      : rawScheduledEndAt;
  const { rows } = await client.query<JobRecord>(
    `
      INSERT INTO jobs (
        id,
        tenant_id,
        department_type,
        job_category,
        organization_id,
        primary_location_id,
        primary_contact_id,
        account_owner_user_id,
        title,
        event_name,
        description_internal,
        priority_level,
        delivery_type,
        gallery_type,
        scheduled_start_at,
        scheduled_end_at,
        timezone,
        estimated_subject_count,
        estimated_staff_count,
        client_deadline_at,
        production_deadline_at,
        production_required,
        location_override_note,
        contact_override_note,
        created_by_user_id,
        updated_by_user_id
      )
      VALUES (
        COALESCE($1::uuid, gen_random_uuid()),
        $2,
        $3::job_department_type,
        $4::job_category_type,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12::job_priority_level,
        $13,
        $14,
        $15,
        $16,
        $17,
        $18,
        $19,
        $20,
        $21,
        $22,
        $23,
        $24,
        $25,
        $25
      )
      ON CONFLICT (id)
      DO UPDATE SET
        department_type = EXCLUDED.department_type,
        job_category = EXCLUDED.job_category,
        organization_id = EXCLUDED.organization_id,
        primary_location_id = EXCLUDED.primary_location_id,
        primary_contact_id = EXCLUDED.primary_contact_id,
        account_owner_user_id = EXCLUDED.account_owner_user_id,
        title = EXCLUDED.title,
        event_name = EXCLUDED.event_name,
        description_internal = EXCLUDED.description_internal,
        priority_level = EXCLUDED.priority_level,
        delivery_type = EXCLUDED.delivery_type,
        gallery_type = EXCLUDED.gallery_type,
        scheduled_start_at = EXCLUDED.scheduled_start_at,
        scheduled_end_at = EXCLUDED.scheduled_end_at,
        timezone = EXCLUDED.timezone,
        estimated_subject_count = EXCLUDED.estimated_subject_count,
        estimated_staff_count = EXCLUDED.estimated_staff_count,
        client_deadline_at = EXCLUDED.client_deadline_at,
        production_deadline_at = EXCLUDED.production_deadline_at,
        production_required = EXCLUDED.production_required,
        location_override_note = EXCLUDED.location_override_note,
        contact_override_note = EXCLUDED.contact_override_note,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
      RETURNING *
    `,
    [
      existingJobId ?? null,
      tenantId,
      input.department_type,
      input.job_category ?? "other",
      input.organization_id ?? null,
      input.primary_location_id ?? null,
      input.primary_contact_id ?? null,
      input.account_owner_user_id ?? null,
      normalizeNullableText(input.title) ?? normalizeNullableText(input.event_name) ?? "Untitled job",
      normalizeNullableText(input.event_name),
      normalizeNullableText(input.description_internal),
      (input as { priority_level?: JobPriorityLevel | null }).priority_level ?? "normal",
      normalizeNullableText(input.delivery_type),
      normalizeNullableText(input.gallery_type),
      scheduledStartAt,
      scheduledEndAt,
      normalizeNullableText(input.timezone) ?? "America/Chicago",
      input.estimated_subject_count ?? null,
      input.estimated_staff_count ?? null,
      input.client_deadline_at ?? null,
      input.production_deadline_at ?? null,
      input.production_required ?? true,
      normalizeNullableText(input.location_override_note),
      normalizeNullableText(input.contact_override_note),
      actorUserId
    ]
  );

  return rows[0];
}

async function replaceJobDays(client: PoolClient, tenantId: string, jobId: string, days: JobDraftInput["days"]) {
  if (!days) {
    return;
  }
  await client.query(`DELETE FROM job_days WHERE tenant_id = $1 AND job_id = $2 AND legacy_shoot_day_id IS NULL`, [tenantId, jobId]);
  for (const [index, day] of days.entries()) {
    if (!day.date) {
      continue;
    }
    await client.query(
      `
        INSERT INTO job_days (
          tenant_id,
          job_id,
          day_label,
          date,
          start_time,
          end_time,
          timezone,
          location_id,
          onsite_contact_id,
          lead_user_id,
          day_status,
          weather_sensitive,
          indoor_outdoor,
          access_notes,
          parking_notes,
          setup_notes,
          travel_notes
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::job_day_status_type,$12,$13,$14,$15,$16,$17)
      `,
      [
        tenantId,
        jobId,
        normalizeNullableText(day.day_label) ?? (index === 0 ? "Primary day" : `Day ${index + 1}`),
        day.date,
        day.start_time ?? null,
        day.end_time ?? null,
        normalizeNullableText(day.timezone) ?? "America/Chicago",
        day.location_id ?? null,
        day.onsite_contact_id ?? null,
        day.lead_user_id ?? null,
        day.day_status ?? "scheduled",
        day.weather_sensitive ?? false,
        normalizeNullableText(day.indoor_outdoor),
        normalizeNullableText(day.access_notes),
        normalizeNullableText(day.parking_notes),
        normalizeNullableText(day.setup_notes),
        normalizeNullableText(day.travel_notes)
      ]
    );
  }
}

async function seedReadinessItems(client: PoolClient, tenantId: string, actorUserId: string | null, aggregate: LoadedJobAggregate) {
  if (aggregate.readinessItems.length > 0) {
    return;
  }
  const adapter = getDepartmentJobAdapter(aggregate.job.department_type);
  const templates = adapter.readinessTemplates({
    ...aggregate.job,
    school_profile: aggregate.schoolProfile,
    sports_profile: aggregate.sportsProfile
  } as unknown as JobDraftInput);

  for (const template of templates) {
    const inserted = await client.query<JobReadinessItemRecord>(
      `
        INSERT INTO job_readiness_items (
          tenant_id,
          job_id,
          section_key,
          label,
          description,
          is_required,
          is_blocker,
          is_complete,
          sort_order,
          source_template_key
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8,$9)
        RETURNING *
      `,
      [
        tenantId,
        aggregate.job.id,
        template.section_key,
        template.label,
        template.description ?? null,
        template.is_required,
        template.is_blocker,
        template.sort_order,
        template.source_template_key
      ]
    );
    await writeJobActivity(client, {
      tenantId,
      actorUserId,
      jobId: aggregate.job.id,
      eventType: "readiness_item_seeded",
      summary: template.label,
      metadata: { readiness_item_id: inserted.rows[0].id, section_key: template.section_key }
    });
  }
}

async function ensureDefaultDay(client: PoolClient, tenantId: string, job: JobRecord) {
  const dayCount = await getRow<{ count: string }>(
    client,
    `SELECT count(*)::text AS count FROM job_days WHERE tenant_id = $1 AND job_id = $2`,
    [tenantId, job.id]
  );
  if ((dayCount?.count ?? "0") !== "0") {
    return;
  }
  if (!job.scheduled_start_at) {
    throw new ApiError(400, "Validation failed", {
      field_errors: { days: ["A published job needs at least one execution day."] },
      form_errors: []
    });
  }
  const startDate = timestampDatePart(job.scheduled_start_at);
  const startTime = timestampTimePart(job.scheduled_start_at);
  const endDate = timestampDatePart(job.scheduled_end_at);
  const rawEndTime = timestampTimePart(job.scheduled_end_at);
  const endTime =
    rawEndTime && startTime && startDate && endDate === startDate && rawEndTime > startTime ? rawEndTime : null;
  await client.query(
    `
      INSERT INTO job_days (
        tenant_id,
        job_id,
        day_label,
        date,
        start_time,
        end_time,
        timezone,
        location_id,
        day_status
      )
      VALUES ($1,$2,'Primary day',$3,$4,$5,$6,$7,'scheduled'::job_day_status_type)
    `,
    [
      tenantId,
      job.id,
      startDate,
      startTime,
      endTime,
      job.timezone,
      job.primary_location_id
    ]
  );
}

async function ensureDefaultProductionItem(client: PoolClient, auth: AuthUser, aggregate: LoadedJobAggregate) {
  if (!aggregate.job.production_required || aggregate.productionItems.length > 0) {
    return;
  }
  const adapter = getDepartmentJobAdapter(aggregate.job.department_type);
  const adapterConfig = adapter.getDefaultProductionConfig({
    ...aggregate.job,
    school_profile: aggregate.schoolProfile,
    sports_profile: aggregate.sportsProfile
  } as unknown as JobDraftInput);
  const plan = buildProductionTemplatePlanForAggregate(aggregate, {
    title: adapterConfig.title,
    production_type: adapterConfig.production_type,
    proof_required: adapterConfig.proof_required
  });

  const inserted = await client.query<ProductionItemRecord>(
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
        $1,$2,$3,$4,$5,$6,$7,$8,$9,
        'queued'::job_production_status_type,
        'DRAFT'::production_board_workflow_status_type,
        'ON_TRACK'::production_board_health_state_type,
        'CLEAN'::production_board_sync_state_type,
        $10,$11,$12,$13,$14,$15,false,$16,$17,$18,$19,$20,$21,$22,$23,'UNKNOWN'::production_board_file_match_status_type,'not_started'
      )
      RETURNING *
    `,
    [
      auth.tenantId,
      aggregate.job.id,
      `${aggregate.job.department_type}:${aggregate.job.id}`,
      plan.title,
      aggregate.job.job_category,
      plan.productionType,
      plan.templateKey,
      plan.completionRuleKey,
      "job_publish",
      aggregate.job.priority_level,
      aggregate.job.organization_id,
      aggregate.job.primary_location_id,
      aggregate.job.primary_contact_id,
      aggregate.job.account_owner_user_id,
      aggregate.job.department_type,
      plan.proofRequired,
      false,
      aggregate.job.production_deadline_at,
      aggregate.job.client_deadline_at,
      aggregate.job.client_deadline_at,
      timestampDatePart(aggregate.job.scheduled_start_at),
      timestampDatePart(aggregate.job.scheduled_end_at) ?? timestampDatePart(aggregate.job.scheduled_start_at),
      aggregate.job.legacy_shoot_id
    ]
  );

  const linkedShootIds = aggregate.jobShootLinks.length
    ? aggregate.jobShootLinks.map((link) => link.shoot_id)
    : aggregate.job.legacy_shoot_id
      ? [aggregate.job.legacy_shoot_id]
      : [];
  await linkShootIdsToProductionItem(client, auth.tenantId, inserted.rows[0].id, linkedShootIds);

  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId: aggregate.job.id,
    productionItemId: inserted.rows[0].id,
    eventType: "production_item_created",
    summary: plan.title,
    metadata: {
      production_type: plan.productionType,
      proof_required: plan.proofRequired,
      production_template_key: plan.templateKey,
      completion_rule_key: plan.completionRuleKey
    }
  });
  await ensureProductionTemplateDeliverables(
    client,
    auth.tenantId,
    auth.id,
    aggregate.job.id,
    inserted.rows[0],
    plan,
    aggregate.deliverableItems
  );
  await ensureTriggeredChecklistInstances(client, auth, {
    scope_type: "production_item",
    scope_id: inserted.rows[0].id,
    trigger_types: ["production_status_transition"],
    template_codes: getChecklistTemplateCodesForProductionCreation(),
    created_from_trigger_key: "job_publish",
    source_metadata_json: {
      job_id: aggregate.job.id,
      production_item_id: inserted.rows[0].id
    }
  });
}

async function applyStatusSnapshot(client: PoolClient, tenantId: string, actorUserId: string | null, aggregate: LoadedJobAggregate) {
  const earliestDay = aggregate.days[0];
  const latestDay = aggregate.days[aggregate.days.length - 1];
  const snapshot = calculateJobStatusSnapshot({
    job: aggregate.job,
    days: aggregate.days,
    readinessItems: aggregate.readinessItems,
    staffAssignments: aggregate.staffAssignments,
    productionItems: aggregate.productionItems,
    approvalRequests: aggregate.approvalRequests,
    qaReviews: aggregate.qaReviews,
    qaFindings: aggregate.qaFindings,
    deliverableItems: aggregate.deliverableItems,
    productionIssues: aggregate.productionIssues,
    watchFlags: aggregate.watchFlags,
    activity: aggregate.activity
  });

  const { rows } = await client.query<JobRecord>(
    `
      UPDATE jobs
      SET job_status = $3::job_status_type,
          production_status = $4::job_production_status_type,
          staffing_status = $5::job_staffing_status_type,
          readiness_status = $6::job_readiness_status_type,
          risk_status = $7::job_risk_status_type,
          scheduled_start_at = COALESCE($8, scheduled_start_at),
          scheduled_end_at = COALESCE($9, scheduled_end_at),
          updated_by_user_id = $10,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING *
    `,
    [
      tenantId,
      aggregate.job.id,
      snapshot.job_status,
      snapshot.production_status,
      snapshot.staffing_status,
      snapshot.readiness_status,
      snapshot.risk_status,
      earliestDay ? summarizeDayTimestamp(earliestDay.date, earliestDay.start_time, "00:00:00") : normalizeTimestamp(aggregate.job.scheduled_start_at),
      latestDay?.end_time ? summarizeDayTimestamp(latestDay.date, latestDay.end_time, "23:59:59") : normalizeTimestamp(aggregate.job.scheduled_end_at),
      actorUserId ?? aggregate.job.updated_by_user_id
    ]
  );

  const updatedJob = rows[0];
  await syncJobWatchFlags(client, {
    tenantId,
    actorUserId,
    job: updatedJob,
    days: aggregate.days,
    readinessItems: aggregate.readinessItems,
    staffAssignments: aggregate.staffAssignments,
    productionItems: aggregate.productionItems,
    approvalRequests: aggregate.approvalRequests,
    qaReviews: aggregate.qaReviews,
      qaFindings: aggregate.qaFindings,
      deliverableItems: aggregate.deliverableItems,
      productionIssues: aggregate.productionIssues,
      existingFlags: aggregate.watchFlags,
      activity: aggregate.activity,
      status: snapshot
    });

  return snapshot;
}

function buildProductionPolicyContext(aggregate: LoadedJobAggregate, item?: ProductionItemRecord | null) {
  return {
    departmentType: aggregate.job.department_type,
    organizationId: aggregate.job.organization_id,
    locationId: aggregate.job.primary_location_id,
    ownerUserIds: [
      aggregate.job.account_owner_user_id,
      aggregate.job.created_by_user_id,
      item?.assigned_to_user_id,
      item?.department_owner_user_id,
      item?.escalation_owner_user_id,
      item?.hold_owner_user_id
    ],
    assignedUserIds: [
      ...aggregate.staffAssignments.map((assignment) => assignment.user_id),
      item?.assigned_to_user_id,
      item?.assigned_peer_reviewer_user_id,
      item?.assigned_release_reviewer_user_id
    ]
  };
}

function buildProductionTemplatePlanForAggregate(
  aggregate: LoadedJobAggregate,
  item?: Partial<ProductionItemRecord> | null
) {
  return buildDepartmentProductionTemplatePlan({
    departmentType: aggregate.job.department_type,
    jobCategory: aggregate.job.job_category,
    title: normalizeNullableText(item?.title) ?? aggregate.job.title,
    productionType: normalizeNullableText(item?.production_type) ?? null,
    proofRequired: item?.proof_required ?? aggregate.sportsProfile?.proof_required ?? false,
    vendorName: normalizeNullableText(item?.vendor_name) ?? null,
    releaseTarget: normalizeNullableText(item?.release_target) ?? null,
    schoolProfile: aggregate.schoolProfile,
    sportsProfile: aggregate.sportsProfile
  });
}

async function ensureProductionTemplateDeliverables(
  client: PoolClient,
  tenantId: string,
  actorUserId: string | null,
  jobId: string,
  item: ProductionItemRecord,
  plan: ReturnType<typeof buildDepartmentProductionTemplatePlan>,
  existingDeliverables: DeliverableItemRecord[]
) {
  let insertedCount = 0;
  for (const seed of plan.deliverableSeeds) {
    const alreadyExists = existingDeliverables.some(
      (deliverable) =>
        deliverable.production_item_id === item.id &&
        deliverable.deliverable_type === seed.deliverable_type &&
        (deliverable.deliverable_group_key ?? null) === (seed.deliverable_group_key ?? null) &&
        (deliverable.completion_marker_key ?? null) === (seed.completion_marker_key ?? null)
    );
    if (alreadyExists) {
      continue;
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
        item.id,
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
    await writeJobActivity(client, {
      tenantId,
      actorUserId,
      jobId,
      productionItemId: item.id,
      eventType: "deliverable_seeded",
      summary: `${item.title}: seeded ${seed.title}`,
      metadata: {
        deliverable_type: seed.deliverable_type,
        deliverable_group_key: seed.deliverable_group_key,
        completion_marker_key: seed.completion_marker_key
      }
    });
    insertedCount += 1;
  }
  return insertedCount;
}

async function upsertAutomaticFileMismatchBlocker(
  client: PoolClient,
  tenantId: string,
  actorUserId: string | null,
  aggregate: LoadedJobAggregate,
  item: ProductionItemRecord
) {
  if (item.file_count_expected == null || item.file_count_received == null) {
    return;
  }
  const existing = aggregate.productionIssues.find(
    (issue) => issue.production_item_id === item.id && issue.source_key === "file_count_mismatch"
  );
  if (item.file_count_expected === item.file_count_received) {
    if (!existing || ["resolved", "dismissed"].includes(existing.status)) {
      return;
    }
    await client.query(
      `
        UPDATE production_issue_records
        SET status = 'resolved'::job_issue_status_type,
            resolved_at = now(),
            resolved_by_user_id = $4,
            resolution_note = 'File counts match after reconciliation.',
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
          AND production_item_id = $3
      `,
      [tenantId, existing.id, item.id, actorUserId]
    );
    await writeJobActivity(client, {
      tenantId,
      actorUserId,
      jobId: aggregate.job.id,
      productionItemId: item.id,
      eventType: "production_blocker_resolved",
      summary: `${item.title}: file mismatch resolved`,
      metadata: { source_key: "file_count_mismatch" }
    });
    return;
  }

  const severity =
    item.file_count_received === 0 || Math.abs(item.file_count_expected - item.file_count_received) >= Math.max(1, Math.ceil(item.file_count_expected / 2))
      ? "high"
      : "medium";
  const description = `Expected ${item.file_count_expected} file(s) but received ${item.file_count_received}.`;
  if (existing) {
    await client.query(
      `
        UPDATE production_issue_records
        SET severity = $4::job_watch_flag_severity_type,
            title = $5,
            description = $6,
            status = 'open'::job_issue_status_type,
            is_blocking = true,
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
          AND production_item_id = $3
      `,
      [tenantId, existing.id, item.id, severity, "File count mismatch", description]
    );
    return;
  }

  await client.query(
    `
      INSERT INTO production_issue_records (
        tenant_id,
        production_item_id,
        job_id,
        issue_type,
        severity,
        title,
        description,
        status,
        owner_user_id,
        due_at,
        is_blocking,
        source_key,
        created_by_user_id
      )
      VALUES ($1,$2,$3,'missing_files',$4::job_watch_flag_severity_type,$5,$6,'open'::job_issue_status_type,$7,$8,true,'file_count_mismatch',$9)
    `,
    [
      tenantId,
      item.id,
      aggregate.job.id,
      severity,
      "File count mismatch",
      description,
      item.assigned_to_user_id ?? aggregate.job.account_owner_user_id ?? null,
      item.due_at ?? aggregate.job.production_deadline_at ?? null,
      actorUserId
    ]
  );
  await writeJobActivity(client, {
    tenantId,
    actorUserId,
    jobId: aggregate.job.id,
    productionItemId: item.id,
    eventType: "production_blocker_created",
    summary: `${item.title}: file count mismatch`,
    metadata: {
      source_key: "file_count_mismatch",
      expected_file_count: item.file_count_expected,
      actual_file_count: item.file_count_received
    }
  });
}

async function syncProductionBoardForJob(client: PoolClient, tenantId: string, actorUserId: string | null, jobId: string) {
  const aggregate = await loadJobAggregate(client, tenantId, jobId);
  if (!aggregate || aggregate.productionItems.length === 0) {
    return aggregate;
  }

  const shootCompletionMap = await loadShootCompletionMap(
    client,
    tenantId,
    [...new Set(aggregate.productionItemShootLinks.map((link) => link.shoot_id))]
  );
  const itemShootMap = buildProductionItemShootMap(aggregate.productionItemShootLinks, shootCompletionMap);

  for (const item of aggregate.productionItems) {
    await upsertAutomaticFileMismatchBlocker(client, tenantId, actorUserId, aggregate, item);
  }

  const refreshed = await loadJobAggregate(client, tenantId, jobId);
  if (!refreshed) {
    return null;
  }

  let deliverableSeedsInserted = 0;
  for (const item of refreshed.productionItems) {
    const plan = buildProductionTemplatePlanForAggregate(refreshed, item);
    const rowDeliverables = refreshed.deliverableItems.filter((deliverable) => deliverable.production_item_id === item.id);
    deliverableSeedsInserted += await ensureProductionTemplateDeliverables(
      client,
      tenantId,
      actorUserId,
      jobId,
      item,
      plan,
      rowDeliverables
    );
  }

  const syncedAggregate = deliverableSeedsInserted > 0 ? await loadJobAggregate(client, tenantId, jobId) : refreshed;
  if (!syncedAggregate) {
    return null;
  }

  for (const item of syncedAggregate.productionItems) {
    const plan = buildProductionTemplatePlanForAggregate(syncedAggregate, item);
    const rowReviews = syncedAggregate.qaReviews.filter((review) => review.production_item_id === item.id);
    const rowReviewIds = new Set(rowReviews.map((review) => review.id));
    const rowFindings = syncedAggregate.qaFindings.filter((finding) => rowReviewIds.has(finding.qa_review_record_id));
    const rowBlockers = syncedAggregate.productionIssues.filter(
      (issue) => issue.production_item_id === item.id && issue.is_blocking && issue.status !== "resolved" && issue.status !== "dismissed"
    );
    const rowDeliverables = syncedAggregate.deliverableItems.filter((deliverable) => deliverable.production_item_id === item.id);
    const derived = computeProductionBoardDerivedFields({
      item: { ...item, file_match_status: deriveProductionFileMatchStatus(item) },
      qaReviews: rowReviews,
      qaFindings: rowFindings,
      blockers: rowBlockers,
      shootCompleted: itemShootMap.get(item.id)?.completed ?? false
    });
    const completion = evaluateProductionCompletionState({
      item,
      deliverables: rowDeliverables,
      plan
    });
    const nextWorkflowStatus = completion.workflowStatus ?? derived.workflowStatus;
    const nextLegacyStatus =
      nextWorkflowStatus === derived.workflowStatus
        ? derived.legacyStatus
        : mapWorkflowStatusToLegacyStatus(nextWorkflowStatus, item.upload_status, item.blocked_reason);
    const nextReleaseStatus = completion.releaseStatus;
    const nextSyncState =
      rowBlockers.length > 0 ? "PARTIAL_ERROR" : item.handoff_complete ? "SYNCED" : item.workflow_status === "DRAFT" ? "CLEAN" : "PENDING_SYNC";

    const completedAt =
      item.completed_at ??
      completion.completedAt ??
      (["READY_FOR_RELEASE", "RELEASED", "SENT_TO_VENDOR", "DELIVERED_CLOSED"].includes(nextWorkflowStatus) ? new Date().toISOString() : null);
    const closedAt =
      item.closed_at ??
      completion.closedAt ??
      (["DELIVERED_CLOSED", "CANCELLED"].includes(nextWorkflowStatus) ? new Date().toISOString() : null);

    await client.query(
      `
        UPDATE production_items
        SET status = $3::job_production_status_type,
            workflow_status = $4::production_board_workflow_status_type,
            health_state = $5::production_board_health_state_type,
            sync_state = $6::production_board_sync_state_type,
            readiness_score = $7,
            blocker_count = $8,
            file_match_status = $9::production_board_file_match_status_type,
            risk_flag = $10,
            completed_at = COALESCE($11, completed_at),
            closed_at = COALESCE($12, closed_at),
            release_status = COALESCE($13::production_board_release_status_type, release_status),
            production_template_key = $14,
            completion_rule_key = $15
        WHERE tenant_id = $1
          AND id = $2
          AND (
            status <> $3::job_production_status_type
            OR workflow_status <> $4::production_board_workflow_status_type
            OR health_state <> $5::production_board_health_state_type
            OR sync_state <> $6::production_board_sync_state_type
            OR readiness_score <> $7
            OR blocker_count <> $8
            OR file_match_status <> $9::production_board_file_match_status_type
            OR risk_flag <> $10
            OR COALESCE(release_status::text, '') <> COALESCE($13::text, COALESCE(release_status::text, ''))
            OR COALESCE(production_template_key, '') <> COALESCE($14, '')
            OR COALESCE(completion_rule_key, '') <> COALESCE($15, '')
          )
      `,
      [
        tenantId,
        item.id,
        nextLegacyStatus,
        nextWorkflowStatus,
        derived.healthState,
        nextSyncState,
        derived.readinessScore,
        derived.openBlockerCount,
        derived.fileMatchStatus,
        derived.healthState !== "ON_TRACK",
        completedAt,
        closedAt,
        nextReleaseStatus,
        plan.templateKey,
        plan.completionRuleKey
      ]
    );

    if (
      item.workflow_status !== nextWorkflowStatus ||
      item.health_state !== derived.healthState ||
      item.status !== nextLegacyStatus
    ) {
      await writeJobActivity(client, {
        tenantId,
        actorUserId,
        jobId,
        productionItemId: item.id,
        eventType: "production_workflow_status_changed",
        summary: `${item.title}: ${item.workflow_status} -> ${nextWorkflowStatus}`,
        oldValues: {
          workflow_status: item.workflow_status,
          health_state: item.health_state,
          status: item.status
        },
        newValues: {
          workflow_status: nextWorkflowStatus,
          health_state: derived.healthState,
          status: nextLegacyStatus
        }
      });
    }
  }

  return loadJobAggregate(client, tenantId, jobId);
}

export async function sweepProductionBoardAutomation(
  client: PoolClient,
  tenantId: string,
  actorUserId: string | null,
  options: { departmentType?: JobDepartmentType | null; jobId?: string | null; limit?: number } = {}
) {
  const params: unknown[] = [tenantId];
  let sql = `
    SELECT
      item.job_id::text AS job_id,
      min(COALESCE(item.due_at, item.release_due_at, item.hold_review_at, item.updated_at)) AS next_attention_at
    FROM production_items item
    WHERE item.tenant_id = $1
      AND item.merged_into_production_item_id IS NULL
      AND (
        item.closed_at IS NULL
        OR item.workflow_status = 'ON_HOLD'::production_board_workflow_status_type
        OR item.due_at IS NOT NULL
        OR item.release_due_at IS NOT NULL
      )
  `;

  if (options.departmentType) {
    params.push(options.departmentType);
    sql += ` AND item.department_type = $${params.length}::job_department_type`;
  }

  if (options.jobId) {
    params.push(options.jobId);
    sql += ` AND item.job_id = $${params.length}::uuid`;
  }

  sql += ` GROUP BY item.job_id ORDER BY next_attention_at ASC NULLS LAST, item.job_id ASC`;
  params.push(options.limit ?? 400);
  sql += ` LIMIT $${params.length}`;

  const { rows } = await client.query<{ job_id: string }>(sql, params);
  for (const row of rows) {
    const aggregate = await syncProductionBoardForJob(client, tenantId, actorUserId, row.job_id);
    if (!aggregate) {
      continue;
    }
    await applyStatusSnapshot(client, tenantId, actorUserId, aggregate);
  }

  return {
    scanned_job_count: rows.length
  };
}

async function validateDepartmentPublish(client: PoolClient, aggregate: LoadedJobAggregate) {
  const adapter = getDepartmentJobAdapter(aggregate.job.department_type);
  const publishConfiguration = await getPublishRequiredFieldsConfiguration(client, aggregate.job.tenant_id, aggregate.job);
  const departmentIssues = adapter.validateForPublish({
    ...aggregate.job,
    school_profile: aggregate.schoolProfile,
    sports_profile: aggregate.sportsProfile,
    days: aggregate.days
  } as unknown as JobDraftInput);
  const shared = validateSharedPublish(aggregate.job, aggregate.days, publishConfiguration);
  const errors = [...shared.errors, ...departmentIssues];
  return {
    valid: errors.length === 0,
    errors
  };
}

export async function listJobs(
  client: PoolClient,
  auth: AuthUser,
  filters: {
    department_type?: JobDepartmentType | null;
    search?: string | null;
    day_date?: string | null;
    production_status?: string | null;
    readiness_status?: string | null;
  } = {}
) {
  const department = filters.department_type ?? null;
  if (department) {
    const scope = hasReadScope(auth, department);
    if (!scope) {
      throw new ApiError(403, "Forbidden");
    }
  }
  const params: unknown[] = [auth.tenantId];
  let sql = `
    SELECT j.*
    FROM jobs j
    WHERE j.tenant_id = $1
  `;
  if (department) {
    params.push(department);
    sql += ` AND j.department_type = $${params.length}::job_department_type`;
  }
  const search = normalizeNullableText(filters.search);
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    sql += ` AND (lower(j.title) LIKE $${params.length} OR lower(coalesce(j.event_name, '')) LIKE $${params.length} OR lower(coalesce(j.job_number, '')) LIKE $${params.length})`;
  }
  // Optional server-side status filters. These let a deep-linked filtered view
  // (e.g. #jobs?productionStatus=blocked) return the FULL matching set instead of
  // only the matches that fall inside the 200-row display window, so a Company
  // Command count and its drilldown agree. Compared as text so an unrecognized
  // value simply matches nothing rather than erroring on the enum cast.
  const productionStatusFilter = normalizeNullableText(filters.production_status);
  if (productionStatusFilter) {
    params.push(productionStatusFilter);
    sql += ` AND j.production_status::text = $${params.length}`;
  }
  const readinessStatusFilter = normalizeNullableText(filters.readiness_status);
  if (readinessStatusFilter) {
    params.push(readinessStatusFilter);
    sql += ` AND j.readiness_status::text = $${params.length}`;
  }
  if (filters.day_date) {
    params.push(filters.day_date);
    const dayDateIndex = params.length;
    sql += `
      AND (
        EXISTS (
          SELECT 1
          FROM job_days jd
          WHERE jd.tenant_id = j.tenant_id
            AND jd.job_id = j.id
            AND jd.date = $${dayDateIndex}::date
        )
        OR (
          NOT EXISTS (
            SELECT 1
            FROM job_days missing_day_check
            WHERE missing_day_check.tenant_id = j.tenant_id
              AND missing_day_check.job_id = j.id
          )
          AND j.scheduled_start_at IS NOT NULL
          AND j.scheduled_start_at::date = $${dayDateIndex}::date
        )
      )
    `;
  }
  sql += ` ORDER BY j.scheduled_start_at NULLS LAST, j.created_at DESC LIMIT 200`;
  const rows = await listRows<JobRecord>(client, sql, params);
  const visibleRows = rows.filter((row) => hasReadScope(auth, row.department_type));
  if (!visibleRows.length) {
    return [];
  }

  const jobIds = visibleRows.map((row) => row.id);
  const [schoolProfiles, sportsProfiles, primaryDays, leadAssignments, openFlagCounts, dayCounts, assignmentCounts, readinessCounts] = await Promise.all([
    listRows<SchoolJobProfileRecord>(
      client,
      `SELECT * FROM school_job_profiles WHERE tenant_id = $1 AND job_id = ANY($2::uuid[])`,
      [auth.tenantId, jobIds]
    ),
    listRows<SportsJobProfileRecord>(
      client,
      `SELECT * FROM sports_job_profiles WHERE tenant_id = $1 AND job_id = ANY($2::uuid[])`,
      [auth.tenantId, jobIds]
    ),
    listRows<JobDayRecord>(
      client,
      `
        SELECT DISTINCT ON (job_id) *
        FROM job_days
        WHERE tenant_id = $1
          AND job_id = ANY($2::uuid[])
        ORDER BY job_id, date ASC, created_at ASC
      `,
      [auth.tenantId, jobIds]
    ),
    listRows<LeadAssignmentRecord>(
      client,
      `
        SELECT DISTINCT ON (job_id)
          job_id::text AS job_id,
          user_id::text AS user_id
        FROM job_staff_assignments
        WHERE tenant_id = $1
          AND job_id = ANY($2::uuid[])
          AND is_lead = true
        ORDER BY job_id, created_at ASC
      `,
      [auth.tenantId, jobIds]
    ),
    listRows<OpenFlagCountRecord>(
      client,
      `
        SELECT
          job_id::text AS job_id,
          count(*)::text AS open_watch_flag_count
        FROM job_watch_flags
        WHERE tenant_id = $1
          AND job_id = ANY($2::uuid[])
          AND status IN ('open'::job_watch_flag_status_type, 'acknowledged'::job_watch_flag_status_type)
        GROUP BY job_id
      `,
      [auth.tenantId, jobIds]
    ),
    listRows<DayCountRecord>(
      client,
      `
        SELECT job_id::text AS job_id, count(*)::text AS day_count
        FROM job_days
        WHERE tenant_id = $1
          AND job_id = ANY($2::uuid[])
        GROUP BY job_id
      `,
      [auth.tenantId, jobIds]
    ),
    listRows<AssignmentCountRecord>(
      client,
      `
        SELECT
          job_id::text AS job_id,
          count(*) FILTER (WHERE assignment_status <> 'cancelled'::job_assignment_status_type)::text AS assigned_staff_count,
          count(*) FILTER (
            WHERE check_in_at IS NOT NULL
              AND check_out_at IS NULL
              AND assignment_status <> 'cancelled'::job_assignment_status_type
          )::text AS checked_in_staff_count,
          count(*) FILTER (WHERE is_ready_present = true)::text AS ready_present_count
        FROM job_staff_assignments
        WHERE tenant_id = $1
          AND job_id = ANY($2::uuid[])
        GROUP BY job_id
      `,
      [auth.tenantId, jobIds]
    ),
    listRows<ReadinessCountRecord>(
      client,
      `
        SELECT
          job_id::text AS job_id,
          count(*) FILTER (WHERE is_required = true)::text AS required_count,
          count(*) FILTER (WHERE is_required = true AND is_complete = true)::text AS completed_required_count,
          count(*) FILTER (WHERE is_blocker = true AND is_complete = false)::text AS blocker_count
        FROM job_readiness_items
        WHERE tenant_id = $1
          AND job_id = ANY($2::uuid[])
        GROUP BY job_id
      `,
      [auth.tenantId, jobIds]
    )
  ]);

  const ids = createRelatedIds();
  for (const row of visibleRows) {
    addId(ids.organizationIds, row.organization_id);
    addId(ids.locationIds, row.primary_location_id);
    addId(ids.contactIds, row.primary_contact_id);
    addId(ids.userIds, row.account_owner_user_id);
  }
  for (const profile of schoolProfiles) {
    addId(ids.organizationIds, profile.district_id);
  }
  for (const profile of sportsProfiles) {
    addId(ids.contactIds, profile.approval_contact_id);
    addId(ids.contactIds, profile.billing_contact_id);
  }
  for (const day of primaryDays) {
    addId(ids.locationIds, day.location_id);
    addId(ids.userIds, day.lead_user_id);
  }
  for (const lead of leadAssignments) {
    addId(ids.userIds, lead.user_id);
  }

  const maps = await loadDisplayMaps(client, auth.tenantId, ids);
  const schoolProfileByJob = new Map(schoolProfiles.map((profile) => [profile.job_id, buildSchoolProfileView(profile, maps)]));
  const sportsProfileByJob = new Map(sportsProfiles.map((profile) => [profile.job_id, buildSportsProfileView(profile, maps)]));
  const primaryDayByJob = new Map(primaryDays.map((row) => [row.job_id, row]));
  const leadByJob = new Map(leadAssignments.map((row) => [row.job_id, row]));
  const openFlagsByJob = new Map(openFlagCounts.map((row) => [row.job_id, Number(row.open_watch_flag_count)]));
  const dayCountsByJob = new Map(dayCounts.map((row) => [row.job_id, Number(row.day_count)]));
  const assignedCountsByJob = new Map(assignmentCounts.map((row) => [row.job_id, Number(row.assigned_staff_count)]));
  const checkedInCountsByJob = new Map(assignmentCounts.map((row) => [row.job_id, Number(row.checked_in_staff_count)]));
  const readyPresentCountsByJob = new Map(assignmentCounts.map((row) => [row.job_id, Number(row.ready_present_count)]));
  const blockerCountsByJob = new Map(readinessCounts.map((row) => [row.job_id, Number(row.blocker_count)]));
  const readinessPercentByJob = new Map(
    readinessCounts.map((row) => {
      const requiredCount = Number(row.required_count);
      const completedRequiredCount = Number(row.completed_required_count);
      return [row.job_id, requiredCount > 0 ? Math.round((completedRequiredCount / requiredCount) * 100) : 100] as const;
    })
  );

  const items = visibleRows.map<JobListItem>((row) => {
    const schoolProfile = schoolProfileByJob.get(row.id) ?? null;
    const sportsProfile = sportsProfileByJob.get(row.id) ?? null;
    const primaryDay = primaryDayByJob.get(row.id) ?? null;
    const leadAssignment = leadByJob.get(row.id) ?? null;

    return {
      ...row,
      organization_name: row.organization_id ? maps.organizations.get(row.organization_id)?.label ?? null : null,
      primary_location_name: row.primary_location_id ? maps.locations.get(row.primary_location_id)?.label ?? null : null,
      primary_location_address: row.primary_location_id ? maps.locations.get(row.primary_location_id)?.address ?? null : null,
      primary_contact_name: row.primary_contact_id ? maps.contacts.get(row.primary_contact_id)?.label ?? null : null,
      account_owner_name: row.account_owner_user_id ? maps.users.get(row.account_owner_user_id)?.label ?? null : null,
      lead_owner_user_id: leadAssignment?.user_id ?? primaryDay?.lead_user_id ?? null,
      lead_owner_name:
        (leadAssignment?.user_id ? maps.users.get(leadAssignment.user_id)?.label : null) ??
        (primaryDay?.lead_user_id ? maps.users.get(primaryDay.lead_user_id)?.label : null) ??
        null,
      primary_day_date: primaryDay?.date ?? timestampDatePart(row.scheduled_start_at),
      primary_day_start_time: primaryDay?.start_time ?? timestampTimePart(row.scheduled_start_at),
      primary_day_end_time: primaryDay?.end_time ?? timestampTimePart(row.scheduled_end_at),
      primary_day_label: primaryDay?.day_label ?? null,
      school_profile: schoolProfile,
      sports_profile: sportsProfile,
      department_summary: getDepartmentJobAdapter(row.department_type).buildDepartmentSummary(row, schoolProfile, sportsProfile),
      proof_status: row.department_type === "sports" ? deriveProofStatus(sportsProfile?.proof_required ?? false, [row.production_status]) : null,
      open_watch_flag_count: openFlagsByJob.get(row.id) ?? 0,
      readiness_percent: countFromRecord(readinessPercentByJob, row.id),
      blocker_count: countFromRecord(blockerCountsByJob, row.id),
      day_count: countFromRecord(dayCountsByJob, row.id),
      assigned_staff_count: countFromRecord(assignedCountsByJob, row.id),
      checked_in_staff_count: countFromRecord(checkedInCountsByJob, row.id),
      ready_present_count: countFromRecord(readyPresentCountsByJob, row.id)
    };
  });
  return sanitizeJobListItems(client, auth, items);
}

export type JobStatusCounts = {
  total_active: number;
  behind: number;
  at_risk: number;
  blocked_production: number;
  high_risk: number;
  staffing_gap: number;
};

const EMPTY_JOB_STATUS_COUNTS: JobStatusCounts = {
  total_active: 0,
  behind: 0,
  at_risk: 0,
  blocked_production: 0,
  high_risk: 0,
  staffing_gap: 0
};

// Accurate, uncapped job-level status counts for the canonical jobs world. Unlike
// listJobs (LIMIT 200, tuned for display), this aggregates over every active job
// the caller can read, so Company Command headline counts stay honest at any
// scale. Each count maps to a single Jobs-index filter (e.g. behind ->
// readinessStatus=off_track, blocked_production -> productionStatus=blocked) so a
// card's number stays coherent with what its #jobs?<filter> drilldown shows.
export async function getJobStatusCounts(
  client: PoolClient,
  auth: AuthUser,
  filters: { department_type?: JobDepartmentType | null } = {}
): Promise<JobStatusCounts> {
  const requestedDepartment = filters.department_type ?? null;
  const departments = (
    requestedDepartment
      ? [requestedDepartment]
      : (["schools", "sports", "corporate", "headshots", "other"] as JobDepartmentType[])
  ).filter((department) => hasReadScope(auth, department) != null);
  if (!departments.length) {
    if (requestedDepartment) {
      throw new ApiError(403, "Forbidden");
    }
    return { ...EMPTY_JOB_STATUS_COUNTS };
  }
  const rows = await listRows<JobStatusCounts>(
    client,
    `
      SELECT
        count(*)::int AS total_active,
        count(*) FILTER (WHERE readiness_status = 'off_track')::int AS behind,
        count(*) FILTER (WHERE readiness_status = 'at_risk')::int AS at_risk,
        count(*) FILTER (WHERE production_status = 'blocked')::int AS blocked_production,
        count(*) FILTER (WHERE risk_status IN ('high', 'critical'))::int AS high_risk,
        count(*) FILTER (WHERE staffing_status = 'gap_flagged')::int AS staffing_gap
      FROM jobs
      WHERE tenant_id = $1
        AND archived_at IS NULL
        AND department_type = ANY($2::job_department_type[])
    `,
    [auth.tenantId, departments]
  );
  return rows[0] ?? { ...EMPTY_JOB_STATUS_COUNTS };
}

export async function listPrepReadinessQueue(
  client: PoolClient,
  auth: AuthUser,
  filters: {
    status?: JobPrepReadinessPreview["status"] | "all" | null;
    issue?: JobPrepReadinessQueueIssue | "all" | null;
    department_type?: JobDepartmentType | "all" | null;
    limit?: number | null;
  } = {}
): Promise<JobPrepReadinessQueueResponse> {
  const requestedDepartment = filters.department_type && filters.department_type !== "all" ? filters.department_type : null;
  const departmentScopes = requestedDepartment
    ? [{ department: requestedDepartment, scope: hasReadScope(auth, requestedDepartment) }]
    : (["schools", "sports", "corporate", "headshots", "other"] as JobDepartmentType[]).map((department) => ({
        department,
        scope: hasReadScope(auth, department)
      }));
  const allowedDepartments = departmentScopes
    .filter((entry): entry is { department: JobDepartmentType; scope: "all" | "own" } => entry.scope != null)
    .map((entry) => entry.department);

  if (requestedDepartment && allowedDepartments.length === 0) {
    throw new ApiError(403, "Forbidden");
  }
  if (!allowedDepartments.length) {
    return {
      generated_at: new Date().toISOString(),
      preview_only: true,
      summary: summarizePrepReadinessQueue([]),
      items: []
    };
  }

  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 250);
  const { rows } = await client.query<{ id: string }>(
    `
      SELECT j.id::text AS id
      FROM jobs j
      WHERE j.tenant_id = $1
        AND j.department_type = ANY($2::job_department_type[])
        AND j.job_status NOT IN ('cancelled'::job_status_type, 'archived'::job_status_type, 'execution_complete'::job_status_type)
        AND COALESCE(
          (
            SELECT min(day.date)::timestamp
            FROM job_days day
            WHERE day.tenant_id = j.tenant_id
              AND day.job_id = j.id
          ),
          j.scheduled_start_at,
          j.created_at
        ) >= date_trunc('day', now())
      ORDER BY
        COALESCE(
          (
            SELECT min(day.date)::timestamp
            FROM job_days day
            WHERE day.tenant_id = j.tenant_id
              AND day.job_id = j.id
          ),
          j.scheduled_start_at,
          j.created_at
        ) ASC,
        j.created_at DESC
      LIMIT $3
    `,
    [auth.tenantId, allowedDepartments, limit]
  );

  const items: JobPrepReadinessQueueItem[] = [];
  for (const row of rows) {
    const aggregate = await loadJobAggregate(client, auth.tenantId, row.id);
    if (!aggregate) {
      continue;
    }
    try {
      await assertJobReadAccess(auth, aggregate);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        continue;
      }
      throw error;
    }
    const ids = collectAggregateRelatedIds(aggregate, aggregate.schoolProfile, aggregate.sportsProfile);
    const maps = await loadDisplayMaps(client, auth.tenantId, ids);
    const schoolProfile = buildSchoolProfileView(aggregate.schoolProfile, maps);
    const sportsProfile = buildSportsProfileView(aggregate.sportsProfile, maps);
    const summary = buildJobSummaryView(aggregate, maps, schoolProfile, sportsProfile);
    const prepReadiness = await buildJobPrepReadinessPreview(client, auth.tenantId, aggregate, summary);
    items.push(buildPrepReadinessQueueItem(aggregate, summary, prepReadiness));
  }

  const requestedStatus = filters.status && filters.status !== "all" ? filters.status : null;
  const requestedIssue = filters.issue && filters.issue !== "all" ? filters.issue : null;
  const filteredItems = items
    .filter((item) => !requestedStatus || item.readiness_status === requestedStatus)
    .filter((item) => !requestedIssue || item.issue_codes.includes(requestedIssue))
    .sort((left, right) => {
      const severityRank = { blocked: 0, needs_attention: 1, ready: 2 };
      const leftSeverity = severityRank[left.readiness_status];
      const rightSeverity = severityRank[right.readiness_status];
      if (leftSeverity !== rightSeverity) {
        return leftSeverity - rightSeverity;
      }
      const leftDate = left.job_date ? new Date(left.job_date).getTime() : Number.MAX_SAFE_INTEGER;
      const rightDate = right.job_date ? new Date(right.job_date).getTime() : Number.MAX_SAFE_INTEGER;
      if (leftDate !== rightDate) {
        return leftDate - rightDate;
      }
      return left.job_name.localeCompare(right.job_name);
    });

  return {
    generated_at: new Date().toISOString(),
    preview_only: true,
    summary: summarizePrepReadinessQueue(filteredItems),
    items: filteredItems
  };
}

export async function listProductionQueue(
  client: PoolClient,
  auth: AuthUser,
  filters: {
    department_type?: JobDepartmentType | null;
    status?: JobProductionStatus | null;
    workflow_status?: ProductionBoardWorkflowStatus | null;
    health_state?: import("../../domain/jobTruth/index.js").ProductionBoardHealthState | null;
    approval_status?: JobApprovalStatus | null;
    qa_status?: JobQaReviewStatus | null;
    assigned_to_user_id?: string | null;
    blocked?: "yes" | "no" | null;
    priority?: JobPriorityLevel | null;
    due_bucket?: "today" | "overdue" | "next-7" | null;
    search?: string | null;
    deliverable_type?: string | null;
    organization_id?: string | null;
    release_status?: import("../../domain/jobTruth/index.js").ProductionBoardReleaseStatus | null;
    checklist_state?: "overdue" | "awaiting_approval" | "rejected" | "blocked" | null;
    run_automation?: boolean;
  } = {}
) {
  if (filters.run_automation !== false) {
    await sweepProductionBoardAutomation(client, auth.tenantId, auth.id, {
      departmentType: filters.department_type ?? null
    });
  }
  const requestedDepartment = filters.department_type ?? null;
  const departmentScopes = requestedDepartment
    ? [{ department: requestedDepartment, scope: hasReadScope(auth, requestedDepartment) }]
    : (["schools", "sports", "corporate", "headshots", "other"] as JobDepartmentType[]).map((department) => ({
        department,
        scope: hasReadScope(auth, department)
      }));

  const allowedDepartments = departmentScopes
    .filter((entry): entry is { department: JobDepartmentType; scope: "all" | "own" } => entry.scope != null)
    .map((entry) => entry.department);

  if (requestedDepartment && allowedDepartments.length === 0) {
    throw new ApiError(403, "Forbidden");
  }

  if (!allowedDepartments.length) {
    return { items: [], summary: summarizeProductionQueue([]) };
  }

  const ownOnlyDepartments = new Set(
    departmentScopes
      .filter((entry): entry is { department: JobDepartmentType; scope: "own" } => entry.scope === "own")
      .map((entry) => entry.department)
  );

  const params: unknown[] = [auth.tenantId, allowedDepartments];
  let sql = `
    SELECT
      item.*,
      job.job_number,
      job.title AS job_title,
      job.organization_id,
      job.primary_location_id,
      job.primary_contact_id,
      job.risk_status AS job_risk_status,
      job.readiness_status AS job_readiness_status
    FROM production_items item
    JOIN jobs job
      ON job.id = item.job_id
     AND job.tenant_id = item.tenant_id
    WHERE item.tenant_id = $1
      AND item.department_type = ANY($2::job_department_type[])
      AND item.merged_into_production_item_id IS NULL
  `;

  if (filters.status) {
    params.push(filters.status);
    sql += ` AND item.status = $${params.length}::job_production_status_type`;
  }
  if (filters.workflow_status) {
    params.push(filters.workflow_status);
    sql += ` AND item.workflow_status = $${params.length}::production_board_workflow_status_type`;
  }
  if (filters.health_state) {
    params.push(filters.health_state);
    sql += ` AND item.health_state = $${params.length}::production_board_health_state_type`;
  }
  if (filters.assigned_to_user_id) {
    params.push(filters.assigned_to_user_id);
    sql += ` AND item.assigned_to_user_id = $${params.length}::uuid`;
  }
  if (filters.priority) {
    params.push(filters.priority);
    sql += ` AND item.priority = $${params.length}::job_priority_level`;
  }
  if (filters.organization_id) {
    params.push(filters.organization_id);
    sql += ` AND item.organization_id = $${params.length}::uuid`;
  }
  if (filters.release_status) {
    params.push(filters.release_status);
    sql += ` AND UPPER(item.release_status::text) = UPPER($${params.length}::text)`;
  }
  if (filters.deliverable_type) {
    params.push(`%${normalizeNullableText(filters.deliverable_type) ?? ""}%`);
    sql += ` AND item.production_type ILIKE $${params.length}`;
  }
  if (filters.blocked === "yes") {
    sql += ` AND (item.status = 'blocked'::job_production_status_type OR item.blocked_reason IS NOT NULL)`;
  } else if (filters.blocked === "no") {
    sql += ` AND item.status <> 'blocked'::job_production_status_type AND item.blocked_reason IS NULL`;
  }
  if (filters.due_bucket === "today") {
    sql += ` AND item.due_at::date = current_date`;
  } else if (filters.due_bucket === "overdue") {
    sql += ` AND item.due_at IS NOT NULL AND item.due_at < now()`;
  } else if (filters.due_bucket === "next-7") {
    sql += ` AND item.due_at IS NOT NULL AND item.due_at >= now() AND item.due_at < now() + interval '7 days'`;
  }
  if (ownOnlyDepartments.size) {
    params.push([...ownOnlyDepartments]);
    const ownDepartmentsIndex = params.length;
    params.push(auth.id);
    const ownUserIndex = params.length;
    sql += `
      AND (
        item.department_type <> ALL($${ownDepartmentsIndex}::job_department_type[])
        OR item.assigned_to_user_id = $${ownUserIndex}::uuid
        OR job.account_owner_user_id = $${ownUserIndex}::uuid
        OR job.created_by_user_id = $${ownUserIndex}::uuid
        OR EXISTS (
          SELECT 1
          FROM job_staff_assignments assignment
          WHERE assignment.tenant_id = item.tenant_id
            AND assignment.job_id = item.job_id
            AND assignment.user_id = $${ownUserIndex}::uuid
        )
      )
    `;
  }
  sql += ` ORDER BY item.due_at NULLS LAST, item.updated_at DESC`;

  const rows = await listRows<ProductionBaseRow>(client, sql, params);
  if (!rows.length) {
    return { items: [], summary: summarizeProductionQueue([]) };
  }

  const itemIds = rows.map((row) => row.id);
  const approvalRequests = await listRows<ApprovalRequestRecord>(
    client,
    `SELECT * FROM approval_requests WHERE tenant_id = $1 AND production_item_id = ANY($2::uuid[]) ORDER BY created_at DESC`,
    [auth.tenantId, itemIds]
  );
  const qaReviews = await listRows<QaReviewRecord>(
    client,
    `SELECT * FROM qa_review_records WHERE tenant_id = $1 AND production_item_id = ANY($2::uuid[]) ORDER BY created_at DESC`,
    [auth.tenantId, itemIds]
  );
  const qaFindings = await listRows<QaReviewFindingRecord>(
    client,
    `
      SELECT finding.*
      FROM qa_review_findings finding
      JOIN qa_review_records review
        ON review.id = finding.qa_review_record_id
       AND review.tenant_id = finding.tenant_id
      WHERE finding.tenant_id = $1
        AND review.production_item_id = ANY($2::uuid[])
      ORDER BY finding.created_at DESC
    `,
    [auth.tenantId, itemIds]
  );
  const deliverables = await listRows<DeliverableItemRecord>(
    client,
    `SELECT * FROM deliverable_items WHERE tenant_id = $1 AND production_item_id = ANY($2::uuid[]) ORDER BY created_at DESC`,
    [auth.tenantId, itemIds]
  );
  const productionIssues = await listRows<ProductionIssueRecord>(
    client,
    `SELECT * FROM production_issue_records WHERE tenant_id = $1 AND production_item_id = ANY($2::uuid[]) ORDER BY created_at DESC`,
    [auth.tenantId, itemIds]
  );
  const productionItemShootLinks = await listRows<ProductionItemShootLinkRecord>(
    client,
    `SELECT * FROM production_item_shoot_links WHERE tenant_id = $1 AND production_item_id = ANY($2::uuid[]) ORDER BY created_at ASC`,
    [auth.tenantId, itemIds]
  );
  const checklistAggregates = await listRows<ProductionChecklistAggregateRow>(
    client,
    `
      SELECT
        instance.production_item_id::text AS production_item_id,
        COUNT(*)::int AS checklist_total_count,
        COUNT(*) FILTER (WHERE instance.status = 'overdue'::checklist_instance_status_type)::int AS checklist_overdue_count,
        COUNT(*) FILTER (
          WHERE instance.approval_required = true
            AND instance.status = 'submitted'::checklist_instance_status_type
        )::int AS checklist_awaiting_approval_count,
        COUNT(*) FILTER (WHERE instance.status = 'rejected'::checklist_instance_status_type)::int AS checklist_rejected_count,
        COUNT(*) FILTER (
          WHERE instance.blocking_level <> 'none'::checklist_blocking_level_type
            AND instance.status <> ALL(ARRAY['approved'::checklist_instance_status_type, 'waived'::checklist_instance_status_type])
        )::int AS checklist_blocked_count,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM checklist_items item
            LEFT JOIN checklist_responses response
              ON response.tenant_id = instance.tenant_id
             AND response.checklist_instance_id = instance.id
             AND response.checklist_item_id = item.id
            LEFT JOIN checklist_attachments attachment
              ON attachment.tenant_id = instance.tenant_id
             AND attachment.checklist_instance_id = instance.id
             AND attachment.checklist_response_id = response.id
            WHERE item.tenant_id = instance.tenant_id
              AND item.template_version_id = instance.template_version_id
              AND item.proof_required = true
              AND (response.id IS NULL OR attachment.id IS NULL)
          )
        )::int AS checklist_missing_proof_count,
        (
          ARRAY_AGG(instance.id::text ORDER BY
            CASE
              WHEN instance.status = 'overdue'::checklist_instance_status_type THEN 0
              WHEN instance.status = 'rejected'::checklist_instance_status_type THEN 1
              WHEN instance.blocking_level = 'hard_block'::checklist_blocking_level_type THEN 2
              WHEN instance.blocking_level = 'soft_block'::checklist_blocking_level_type THEN 3
              ELSE 4
            END,
            instance.due_at ASC NULLS LAST,
            instance.updated_at DESC
          ) FILTER (
            WHERE instance.blocking_level <> 'none'::checklist_blocking_level_type
              AND instance.status <> ALL(ARRAY['approved'::checklist_instance_status_type, 'waived'::checklist_instance_status_type])
          )
        )[1] AS blocking_checklist_instance_id,
        (
          ARRAY_AGG(instance.title ORDER BY
            CASE
              WHEN instance.status = 'overdue'::checklist_instance_status_type THEN 0
              WHEN instance.status = 'rejected'::checklist_instance_status_type THEN 1
              WHEN instance.blocking_level = 'hard_block'::checklist_blocking_level_type THEN 2
              WHEN instance.blocking_level = 'soft_block'::checklist_blocking_level_type THEN 3
              ELSE 4
            END,
            instance.due_at ASC NULLS LAST,
            instance.updated_at DESC
          ) FILTER (
            WHERE instance.blocking_level <> 'none'::checklist_blocking_level_type
              AND instance.status <> ALL(ARRAY['approved'::checklist_instance_status_type, 'waived'::checklist_instance_status_type])
          )
        )[1] AS blocking_checklist_title
      FROM checklist_instances instance
      WHERE instance.tenant_id = $1
        AND instance.production_item_id = ANY($2::uuid[])
        AND instance.status <> ALL(ARRAY['approved'::checklist_instance_status_type, 'waived'::checklist_instance_status_type])
      GROUP BY instance.production_item_id
    `,
    [auth.tenantId, itemIds]
  );
  const shootCompletionMap = await loadShootCompletionMap(
    client,
    auth.tenantId,
    [...new Set(productionItemShootLinks.map((link) => link.shoot_id))]
  );
  const itemShootMap = buildProductionItemShootMap(productionItemShootLinks, shootCompletionMap);
  const checklistAggregateMap = new Map(checklistAggregates.map((aggregate) => [aggregate.production_item_id, aggregate]));
  const approvalRequestsByItemId = groupRowsByStringKey(approvalRequests, (request) => request.production_item_id);
  const qaReviewsByItemId = groupRowsByStringKey(qaReviews, (review) => review.production_item_id);
  const qaFindingsByReviewId = groupRowsByStringKey(qaFindings, (finding) => finding.qa_review_record_id);
  const deliverablesByItemId = groupRowsByStringKey(deliverables, (deliverable) => deliverable.production_item_id);
  const productionIssuesByItemId = groupRowsByStringKey(productionIssues, (issue) => issue.production_item_id);

  const ids = createRelatedIds();
  for (const row of rows) {
    addId(ids.organizationIds, row.organization_id);
    addId(ids.locationIds, row.primary_location_id);
    addId(ids.contactIds, row.primary_contact_id);
    addId(ids.userIds, row.assigned_to_user_id);
  }
  for (const request of approvalRequests) {
    addId(ids.contactIds, request.approver_contact_id);
    addId(ids.userIds, request.approver_user_id);
  }
  for (const deliverable of deliverables) {
    addId(ids.contactIds, deliverable.recipient_contact_id);
    addId(ids.organizationIds, deliverable.recipient_organization_id);
  }
  for (const issue of productionIssues) {
    addId(ids.userIds, issue.owner_user_id);
  }
  const maps = await loadDisplayMaps(client, auth.tenantId, ids);

  const items = rows
    .map<ProductionQueueItem>((row) => {
      const rowApprovals = approvalRequestsByItemId.get(row.id) ?? [];
      const rowReviews = qaReviewsByItemId.get(row.id) ?? [];
      const rowFindings = rowReviews.flatMap((review) => qaFindingsByReviewId.get(review.id) ?? []);
      const rowDeliverables = deliverablesByItemId.get(row.id) ?? [];
      const rowIssues = (productionIssuesByItemId.get(row.id) ?? []).filter(
        (issue) => issue.status !== "dismissed" && issue.status !== "resolved"
      );
      const rowBlockers = rowIssues.filter((issue) => issue.is_blocking);
      const boardView = buildProductionItemDetailView(row, rowIssues, rowReviews, rowFindings, itemShootMap.get(row.id));
      const checklistAggregate = checklistAggregateMap.get(row.id);
      return {
        ...row,
        organization_name: row.organization_id ? maps.organizations.get(row.organization_id)?.label ?? null : null,
        primary_location_name: row.primary_location_id ? maps.locations.get(row.primary_location_id)?.label ?? null : null,
        primary_contact_name: row.primary_contact_id ? maps.contacts.get(row.primary_contact_id)?.label ?? null : null,
        assigned_to_name: row.assigned_to_user_id ? maps.users.get(row.assigned_to_user_id)?.label ?? null : null,
        approval_status: deriveApprovalStatus(rowApprovals, row.approval_required),
        qa_summary_status: deriveQaSummaryStatus(rowReviews, row),
        deliverable_status: deriveDeliverableStatus(rowDeliverables),
        file_receipt_state: deriveFileReceiptState(row),
        overdue_approval_count: rowApprovals.filter((request) => request.status === "overdue").length,
        open_issue_count: rowIssues.length,
        blocking_issue_count: rowIssues.filter((issue) => issue.severity === "high" || issue.severity === "critical").length,
        job_risk_status: row.job_risk_status,
        job_readiness_status: row.job_readiness_status,
        linked_shoot_ids: boardView.linked_shoot_ids,
        days_since_shoot: boardView.days_since_shoot,
        days_open: boardView.days_open,
        days_to_due: boardView.days_to_due,
        days_past_due: boardView.days_past_due,
        stage_age: boardView.stage_age,
        turnaround_days: boardView.turnaround_days,
        on_time_flag: boardView.on_time_flag,
        open_blocker_count: rowBlockers.length,
        overdue_flag: boardView.overdue_flag,
        release_lag_days: boardView.release_lag_days,
        checklist_total_count: checklistAggregate?.checklist_total_count ?? 0,
        checklist_overdue_count: checklistAggregate?.checklist_overdue_count ?? 0,
        checklist_awaiting_approval_count: checklistAggregate?.checklist_awaiting_approval_count ?? 0,
        checklist_rejected_count: checklistAggregate?.checklist_rejected_count ?? 0,
        checklist_blocked_count: checklistAggregate?.checklist_blocked_count ?? 0,
        checklist_missing_proof_count: checklistAggregate?.checklist_missing_proof_count ?? 0,
        blocking_checklist_instance_id: checklistAggregate?.blocking_checklist_instance_id ?? null,
        blocking_checklist_title: checklistAggregate?.blocking_checklist_title ?? null
      };
    })
    .filter((item) => !filters.approval_status || item.approval_status === filters.approval_status)
    .filter((item) => !filters.qa_status || item.qa_summary_status === filters.qa_status)
    .filter((item) => matchesProductionQueueChecklistState(item, filters.checklist_state))
    .filter((item) => matchesProductionQueueSearch(item, filters.search));

  const sanitizedItems = await sanitizeProductionQueueItems(client, auth, items);
  return {
    items: sanitizedItems,
    summary: summarizeProductionQueue(sanitizedItems)
  };
}

export async function getJobDetail(client: PoolClient, auth: AuthUser, jobId: string): Promise<JobDetailResponse> {
  const aggregate = await loadJobAggregate(client, auth.tenantId, jobId);
  if (!aggregate) {
    throw new ApiError(404, "Job not found");
  }
  await assertJobReadAccess(auth, aggregate);
  return buildJobDetailResponse(client, auth, auth.tenantId, aggregate);
}

export async function createDraftJob(client: PoolClient, auth: AuthUser, input: JobDraftInput) {
  requireWriteAccess(auth, input.department_type);
  const job = await upsertJobCore(client, auth.tenantId, auth.id, input);
  const adapter = getDepartmentJobAdapter(input.department_type);
  await adapter.upsertProfile(client, auth.tenantId, job.id, input);
  await replaceJobDays(client, auth.tenantId, job.id, input.days ?? null);
  await ensureSharedWorkflowRunForJob(client, auth, job, input);
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId: job.id,
    eventType: "job_created",
    summary: `Created ${input.department_type} draft job`,
    metadata: { department_type: input.department_type, job_category: input.job_category ?? "other" }
  });
  return getJobDetail(client, auth, job.id);
}

export async function updateDraftJob(client: PoolClient, auth: AuthUser, jobId: string, input: JobDraftInput) {
  const existing = await loadJobAggregate(client, auth.tenantId, jobId);
  if (!existing) {
    throw new ApiError(404, "Job not found");
  }
  await assertJobReadAccess(auth, existing);
  requireWriteAccess(auth, existing.job.department_type);
  if (existing.job.published_at) {
    throw new ApiError(400, "Published jobs must use protected updates.");
  }
  const updated = await upsertJobCore(client, auth.tenantId, auth.id, { ...input, department_type: existing.job.department_type }, existing.job.id);
  const adapter = getDepartmentJobAdapter(existing.job.department_type);
  await adapter.upsertProfile(client, auth.tenantId, updated.id, input);
  await replaceJobDays(client, auth.tenantId, updated.id, input.days ?? null);
  await ensureSharedWorkflowRunForJob(client, auth, updated, input);
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId: updated.id,
    eventType: "job_updated",
    summary: "Updated draft job",
    metadata: { published: false }
  });
  await queueTeamsMeetingJobRecordLifecycleSync(client, auth, updated.id, "update");
  return getJobDetail(client, auth, updated.id);
}

async function nextJobNumber(client: PoolClient, department: JobDepartmentType, scheduledStartAt: string | Date | null) {
  const { rows } = await client.query<{ sequence: string }>(`SELECT nextval('job_truth_number_seq')::text AS sequence`);
  const year = scheduledStartAt ? new Date(scheduledStartAt).getUTCFullYear() : new Date().getUTCFullYear();
  return `${JOB_NUMBER_PREFIX[department]}-${year}-${rows[0].sequence.padStart(5, "0")}`;
}

export async function publishJob(client: PoolClient, auth: AuthUser, jobId: string) {
  const aggregate = await loadJobAggregate(client, auth.tenantId, jobId);
  if (!aggregate) {
    throw new ApiError(404, "Job not found");
  }
  requireManageAccess(auth, aggregate.job.department_type);
  await assertJobReadAccess(auth, aggregate);

  await ensureDefaultDay(client, auth.tenantId, aggregate.job);
  const refreshedWithDay = await loadJobAggregate(client, auth.tenantId, jobId);
  if (!refreshedWithDay) {
    throw new ApiError(404, "Job not found");
  }
  const validation = await validateDepartmentPublish(client, refreshedWithDay);
  if (!validation.valid) {
    const missingFieldsSummary = validation.errors.slice(0, 3).map((issue) => issue.field.replace(/_/g, " "));
    await applyProactiveCommunicationRuleOutOfBand(auth, {
      triggerType: "required_info_missing",
      sourceModule: "jobs",
      sourceObjectType: "job",
      sourceObjectId: refreshedWithDay.job.id,
      sourceObjectLabel: refreshedWithDay.job.job_number ?? refreshedWithDay.job.title,
      communicationObjectType: "job",
      communicationObjectId: refreshedWithDay.job.id,
      title: `Required info missing for ${refreshedWithDay.job.job_number ?? refreshedWithDay.job.title}`,
      summary:
        missingFieldsSummary.length > 0
          ? `Publishing is blocked until ${missingFieldsSummary.join(", ")} ${missingFieldsSummary.length === 1 ? "is" : "are"} completed.`
          : "Publishing is blocked until the required job details are completed.",
      recipientUserIds: collectJobCommunicationRecipientUserIds(refreshedWithDay, {
        excludeUserId: auth.id,
        includeOwners: true
      }),
      appDeepLink: `#jobs/${encodeURIComponent(refreshedWithDay.job.id)}`,
      metadata: {
        missing_fields: validation.errors.map((issue) => issue.field)
      }
    });
    throw buildWorkflowValidationError(
      buildPublishWorkflowValidation(refreshedWithDay.job.id, refreshedWithDay.job.job_status, validation),
      {
        status: 400,
        message: "Validation failed",
        details: {
          field_errors: validation.errors.reduce<Record<string, string[]>>((acc, issue) => {
            acc[issue.field] = [...(acc[issue.field] ?? []), issue.message];
            return acc;
          }, {}),
          form_errors: []
        }
      }
    );
  }

  const jobNumber = refreshedWithDay.job.job_number ?? (await nextJobNumber(client, refreshedWithDay.job.department_type, refreshedWithDay.job.scheduled_start_at));
  const { rows } = await client.query<JobRecord>(
    `
      UPDATE jobs
      SET job_number = $3,
          published_at = COALESCE(published_at, now()),
          updated_by_user_id = $4,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING *
    `,
    [auth.tenantId, jobId, jobNumber, auth.id]
  );
  const publishedJob = rows[0];

  const publishedAggregate = await loadJobAggregate(client, auth.tenantId, publishedJob.id);
  if (!publishedAggregate) {
    throw new ApiError(404, "Job not found");
  }
  await seedReadinessItems(client, auth.tenantId, auth.id, publishedAggregate);
  const withReadiness = await loadJobAggregate(client, auth.tenantId, publishedJob.id);
  if (!withReadiness) {
    throw new ApiError(404, "Job not found");
  }
  await ensureDefaultProductionItem(client, auth, withReadiness);
  const finalAggregate = await loadJobAggregate(client, auth.tenantId, publishedJob.id);
  if (!finalAggregate) {
    throw new ApiError(404, "Job not found");
  }
  await ensureTriggeredChecklistInstances(client, auth, {
    scope_type: "job",
    scope_id: finalAggregate.job.id,
    trigger_types: ["job_publish"],
    created_from_trigger_key: "job_publish",
    source_metadata_json: {
      job_id: finalAggregate.job.id
    }
  });
  const status = await applyStatusSnapshot(client, auth.tenantId, auth.id, finalAggregate);
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId: finalAggregate.job.id,
    eventType: "job_published",
    summary: `Published job ${jobNumber}`,
    metadata: { job_number: jobNumber, readiness_percent: status.readiness_percent }
  });
  await queueTeamsMeetingJobRecordLifecycleSync(client, auth, finalAggregate.job.id, "update");
  return getJobDetail(client, auth, finalAggregate.job.id);
}

async function loadAndGuard(client: PoolClient, auth: AuthUser, jobId: string) {
  const aggregate = await loadJobAggregate(client, auth.tenantId, jobId);
  if (!aggregate) {
    throw new ApiError(404, "Job not found");
  }
  await assertJobReadAccess(auth, aggregate);
  return aggregate;
}

async function refreshJobAfterOperationalMutation(client: PoolClient, auth: AuthUser, jobId: string) {
  await syncProductionBoardForJob(client, auth.tenantId, auth.id, jobId);
  const detail = await getJobDetail(client, auth, jobId);
  await applyStatusSnapshot(client, auth.tenantId, auth.id, {
    job: detail.job,
    schoolProfile: detail.school_profile,
    sportsProfile: detail.sports_profile,
    days: detail.days,
    staffAssignments: detail.staff_assignments,
    readinessItems: detail.readiness_items,
    jobShootLinks: detail.job_shoot_links,
    productionItems: detail.production_items,
    productionItemShootLinks: detail.production_item_shoot_links,
    productionHandoffs: detail.production_handoffs,
    approvalRequests: detail.approval_requests,
    qaReviews: detail.qa_reviews,
    qaFindings: detail.qa_findings,
    deliverableItems: detail.deliverable_items,
    productionIssues: detail.production_issues,
    watchFlags: detail.watch_flags,
    activity: [],
    status: detail.status
  });
  return getJobDetail(client, auth, jobId);
}

export async function addJobDay(client: PoolClient, auth: AuthUser, jobId: string, input: Partial<JobDayRecord>) {
  const aggregate = await loadAndGuard(client, auth, jobId);
  requireManageAccess(auth, aggregate.job.department_type);
  if (!input.date) {
    throw new ApiError(400, "Validation failed", { field_errors: { date: ["Date is required."] }, form_errors: [] });
  }
  await client.query(
    `
      INSERT INTO job_days (
        tenant_id,
        job_id,
        day_label,
        date,
        start_time,
        end_time,
        timezone,
        location_id,
        onsite_contact_id,
        lead_user_id,
        day_status,
        weather_sensitive,
        indoor_outdoor,
        access_notes,
        parking_notes,
        setup_notes,
        travel_notes
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::job_day_status_type,$12,$13,$14,$15,$16,$17)
    `,
    [
      auth.tenantId,
      jobId,
      normalizeNullableText(input.day_label),
      input.date,
      input.start_time ?? null,
      input.end_time ?? null,
      normalizeNullableText(input.timezone) ?? aggregate.job.timezone,
      input.location_id ?? aggregate.job.primary_location_id,
      input.onsite_contact_id ?? null,
      input.lead_user_id ?? null,
      input.day_status ?? "scheduled",
      input.weather_sensitive ?? false,
      normalizeNullableText(input.indoor_outdoor),
      normalizeNullableText(input.access_notes),
      normalizeNullableText(input.parking_notes),
      normalizeNullableText(input.setup_notes),
      normalizeNullableText(input.travel_notes)
    ]
  );
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId,
    eventType: "day_added",
    summary: `Added job day for ${input.date}`,
    metadata: { date: input.date }
  });
  return refreshJobAfterOperationalMutation(client, auth, jobId);
}

export async function assignJobStaff(client: PoolClient, auth: AuthUser, jobId: string, input: Partial<JobStaffAssignmentRecord>) {
  const aggregate = await loadAndGuard(client, auth, jobId);
  requireManageAccess(auth, aggregate.job.department_type);
  if (!input.user_id) {
    throw new ApiError(400, "Validation failed", { field_errors: { user_id: ["Assignee is required."] }, form_errors: [] });
  }
  const assignmentInsert = await client.query<{ id: string }>(
    `
      INSERT INTO job_staff_assignments (
        tenant_id,
        job_id,
        job_day_id,
        user_id,
        assignment_role,
        assignment_status,
        is_lead,
        notes
      )
      VALUES ($1,$2,$3,$4,$5,$6::job_assignment_status_type,$7,$8)
      RETURNING id::text
    `,
    [
      auth.tenantId,
      jobId,
      input.job_day_id ?? null,
      input.user_id,
      input.assignment_role ?? "photographer",
      input.assignment_status ?? "assigned",
      input.is_lead ?? false,
      normalizeNullableText(input.notes)
    ]
  );
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId,
    eventType: "assignment_created",
    summary: `Assigned ${input.assignment_role ?? "photographer"} staff`,
    metadata: {
      assignment_id: assignmentInsert.rows[0]?.id ?? null,
      user_id: input.user_id,
      job_day_id: input.job_day_id ?? null,
      is_lead: input.is_lead ?? false
    }
  });

  if (input.user_id !== auth.id) {
    await emitJobAssignedEvent(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      jobId,
      jobTitle: aggregate.job.title,
      jobNumber: aggregate.job.job_number ?? null,
      assignmentRole: input.assignment_role ?? "photographer",
      recipientUserId: input.user_id,
      jobDayId: input.job_day_id ?? null
    });
  }

  await applyProactiveCommunicationRule(client, auth, {
    triggerType: "assignment_changed",
    sourceModule: "jobs",
    sourceObjectType: "job_staff_assignment",
    sourceObjectId: assignmentInsert.rows[0]?.id ?? `${jobId}:${input.user_id}`,
    sourceObjectLabel: aggregate.job.job_number ?? aggregate.job.title,
    communicationObjectType: "job",
    communicationObjectId: jobId,
    title: `Assignment updated for ${aggregate.job.job_number ?? aggregate.job.title}`,
    summary: `You were assigned as ${input.assignment_role ?? "photographer"} on ${aggregate.job.job_number ?? aggregate.job.title}.`,
    messageText: `Assignment update: ${input.assignment_role ?? "photographer"} coverage was added for ${aggregate.job.job_number ?? aggregate.job.title}.`,
    recipientUserIds: [input.user_id],
    appDeepLink: `#jobs/${encodeURIComponent(jobId)}`,
    metadata: {
      assignment_id: assignmentInsert.rows[0]?.id ?? null,
      assignment_role: input.assignment_role ?? "photographer",
      is_lead: input.is_lead ?? false
    }
  });

  const staffingConflict = await findStaffingConflictForUser(client, auth.tenantId, {
    jobId,
    userId: input.user_id,
    scheduledStartAt: normalizeTimestamp(aggregate.job.scheduled_start_at),
    scheduledEndAt: normalizeTimestamp(aggregate.job.scheduled_end_at)
  });
  if (staffingConflict) {
    await applyProactiveCommunicationRule(client, auth, {
      triggerType: "conflict_detected",
      sourceModule: "jobs",
      sourceObjectType: "job_staff_assignment",
      sourceObjectId: assignmentInsert.rows[0]?.id ?? `${jobId}:${input.user_id}:conflict`,
      sourceObjectLabel: aggregate.job.job_number ?? aggregate.job.title,
      communicationObjectType: "job",
      communicationObjectId: jobId,
      title: `Staffing conflict detected for ${aggregate.job.job_number ?? aggregate.job.title}`,
      summary: `${aggregate.job.job_number ?? aggregate.job.title} overlaps with ${staffingConflict.conflict_job_number ?? staffingConflict.conflict_title} for the assigned staff member.`,
      messageText: `Staffing conflict detected: this assignment overlaps with ${staffingConflict.conflict_job_number ?? staffingConflict.conflict_title}.`,
      recipientUserIds: collectJobCommunicationRecipientUserIds(aggregate, {
        excludeUserId: auth.id,
        includeOwners: true,
        additionalUserIds: [input.user_id]
      }),
      appDeepLink: `#jobs/${encodeURIComponent(jobId)}`,
      metadata: {
        assignment_id: assignmentInsert.rows[0]?.id ?? null,
        conflicting_job_id: staffingConflict.conflict_job_id,
        conflicting_job_number: staffingConflict.conflict_job_number
      }
    });
  }
  await queueTeamsMeetingJobRecordLifecycleSync(client, auth, jobId, "update");
  return refreshJobAfterOperationalMutation(client, auth, jobId);
}

export async function checkInJobStaff(client: PoolClient, auth: AuthUser, jobId: string, assignmentId: string) {
  const aggregate = await loadAndGuard(client, auth, jobId);
  const assignment = aggregate.staffAssignments.find((row) => row.id === assignmentId);
  if (!assignment) {
    throw new ApiError(404, "Assignment not found");
  }
  if (assignment.user_id !== auth.id) {
    requireManageAccess(auth, aggregate.job.department_type);
  }
  await client.query(
    `
      UPDATE job_staff_assignments
      SET assignment_status = 'checked_in'::job_assignment_status_type,
          check_in_at = now(),
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, assignmentId]
  );
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId,
    eventType: "staff_checked_in",
    summary: "Staff checked in",
    metadata: { assignment_id: assignmentId }
  });
  return refreshJobAfterOperationalMutation(client, auth, jobId);
}

export async function updateJobStaffAssignment(
  client: PoolClient,
  auth: AuthUser,
  jobId: string,
  assignmentId: string,
  input: Partial<JobStaffAssignmentRecord> & {
    assignment_role?: string | null;
    notes?: string | null;
    request_backup?: boolean | null;
  }
) {
  const aggregate = await loadAndGuard(client, auth, jobId);
  const assignment = aggregate.staffAssignments.find((row) => row.id === assignmentId);
  if (!assignment) {
    throw new ApiError(404, "Assignment not found");
  }
  const isSelfUpdate = assignment.user_id === auth.id;
  const onlySelfServiceUpdate =
    isSelfUpdate &&
    (input.assignment_status === "checked_out" || input.assignment_status == null) &&
    input.assignment_role == null &&
    input.job_day_id == null &&
    input.is_lead == null &&
    input.is_ready_present == null;

  if (!onlySelfServiceUpdate) {
    requireManageAccess(auth, aggregate.job.department_type);
  }

  const normalizedNotes = normalizeNullableText(input.notes);
  await client.query(
    `
      UPDATE job_staff_assignments
      SET assignment_role = COALESCE($3, assignment_role),
          assignment_status = COALESCE($4::job_assignment_status_type, assignment_status),
          is_lead = COALESCE($5, is_lead),
          job_day_id = COALESCE($6, job_day_id),
          is_ready_present = COALESCE($7, is_ready_present),
          notes = COALESCE($8, notes),
          check_out_at = CASE
            WHEN $4 = 'checked_out'::job_assignment_status_type THEN now()
            ELSE check_out_at
          END,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      auth.tenantId,
      assignmentId,
      normalizeNullableText(input.assignment_role),
      input.assignment_status ?? null,
      input.is_lead ?? null,
      input.job_day_id ?? null,
      input.is_ready_present ?? null,
      normalizedNotes
    ]
  );

  if (input.request_backup) {
    await client.query(
      `
        INSERT INTO job_watch_flags (
          tenant_id,
          job_id,
          job_day_id,
          severity,
          flag_type,
          title,
          description,
          status,
          owner_user_id,
          due_at
        )
        VALUES ($1,$2,$3,'medium'::job_watch_flag_severity_type,'staffing_gap',$4,$5,'open'::job_watch_flag_status_type,null,$6)
      `,
      [
        auth.tenantId,
        jobId,
        assignment.job_day_id ?? input.job_day_id ?? null,
        "Backup requested for staffing assignment",
        normalizedNotes ?? "Backup coverage requested from the shared staffing planner.",
        normalizeTimestamp(aggregate.job.scheduled_start_at)
      ]
    );
  }

  const meaningfulAssignmentChange =
    normalizeNullableText(input.assignment_role) !== null ||
    input.assignment_status != null ||
    input.job_day_id != null ||
    input.is_lead != null ||
    input.request_backup === true;

  if (meaningfulAssignmentChange) {
    await applyProactiveCommunicationRule(client, auth, {
      triggerType: "assignment_changed",
      sourceModule: "jobs",
      sourceObjectType: "job_staff_assignment",
      sourceObjectId: assignmentId,
      sourceObjectLabel: aggregate.job.job_number ?? aggregate.job.title,
      communicationObjectType: "job",
      communicationObjectId: jobId,
      title: `Assignment updated for ${aggregate.job.job_number ?? aggregate.job.title}`,
      summary: `Your assignment on ${aggregate.job.job_number ?? aggregate.job.title} was updated.`,
      messageText:
        input.request_backup === true
          ? `Assignment update: backup coverage was requested for ${aggregate.job.job_number ?? aggregate.job.title}.`
          : `Assignment update: your staffing details changed on ${aggregate.job.job_number ?? aggregate.job.title}.`,
      recipientUserIds: [assignment.user_id],
      appDeepLink: `#jobs/${encodeURIComponent(jobId)}`,
      metadata: {
        assignment_id: assignmentId,
        assignment_status: input.assignment_status ?? assignment.assignment_status,
        assignment_role: normalizeNullableText(input.assignment_role) ?? assignment.assignment_role,
        is_lead: input.is_lead ?? assignment.is_lead,
        request_backup: input.request_backup ?? false
      }
    });
  }

  const nextAssignmentStatus = input.assignment_status ?? assignment.assignment_status;
  if (nextAssignmentStatus !== "cancelled" && nextAssignmentStatus !== "absent" && nextAssignmentStatus !== "checked_out") {
    const staffingConflict = await findStaffingConflictForUser(client, auth.tenantId, {
      jobId,
      userId: assignment.user_id,
      scheduledStartAt: normalizeTimestamp(aggregate.job.scheduled_start_at),
      scheduledEndAt: normalizeTimestamp(aggregate.job.scheduled_end_at)
    });
    if (staffingConflict) {
      await applyProactiveCommunicationRule(client, auth, {
        triggerType: "conflict_detected",
        sourceModule: "jobs",
        sourceObjectType: "job_staff_assignment",
        sourceObjectId: assignmentId,
        sourceObjectLabel: aggregate.job.job_number ?? aggregate.job.title,
        communicationObjectType: "job",
        communicationObjectId: jobId,
        title: `Staffing conflict detected for ${aggregate.job.job_number ?? aggregate.job.title}`,
        summary: `${aggregate.job.job_number ?? aggregate.job.title} overlaps with ${staffingConflict.conflict_job_number ?? staffingConflict.conflict_title} for the assigned staff member.`,
        messageText: `Staffing conflict detected: this assignment overlaps with ${staffingConflict.conflict_job_number ?? staffingConflict.conflict_title}.`,
        recipientUserIds: collectJobCommunicationRecipientUserIds(aggregate, {
          excludeUserId: auth.id,
          includeOwners: true,
          additionalUserIds: [assignment.user_id]
        }),
        appDeepLink: `#jobs/${encodeURIComponent(jobId)}`,
        metadata: {
          assignment_id: assignmentId,
          conflicting_job_id: staffingConflict.conflict_job_id,
          conflicting_job_number: staffingConflict.conflict_job_number
        }
      });
    }
  }

  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId,
    jobDayId: assignment.job_day_id ?? input.job_day_id ?? null,
    eventType:
      input.assignment_status === "checked_out"
        ? "staff_checked_out"
        : input.assignment_status === "absent"
          ? "staff_marked_absent"
          : input.request_backup
            ? "staff_backup_requested"
            : "assignment_updated",
    summary:
      input.assignment_status === "checked_out"
        ? "Staff checked out"
        : input.assignment_status === "absent"
          ? "Staff marked absent"
          : input.request_backup
            ? "Backup coverage requested"
            : "Updated staff assignment",
    metadata: {
      assignment_id: assignmentId,
      assignment_status: input.assignment_status ?? null,
      assignment_role: normalizeNullableText(input.assignment_role),
      is_lead: input.is_lead ?? null,
      request_backup: input.request_backup ?? false,
      note: normalizedNotes
    }
  });

  if (meaningfulAssignmentChange || input.assignment_status != null) {
    await queueTeamsMeetingJobRecordLifecycleSync(client, auth, jobId, "update");
  }

  return refreshJobAfterOperationalMutation(client, auth, jobId);
}

export async function markLeadReady(
  client: PoolClient,
  auth: AuthUser,
  jobId: string,
  dayId: string,
  input: {
    on_site_confirmed?: boolean | null;
    setup_complete?: boolean | null;
    all_required_staff_present?: boolean | null;
    blockers_resolved?: boolean | null;
    equipment_ready?: boolean | null;
    client_contact_checked_in?: boolean | null;
    note?: string | null;
  }
) {
  const aggregate = await loadAndGuard(client, auth, jobId);
  const day = aggregate.days.find((row) => row.id === dayId);
  if (!day) {
    throw new ApiError(404, "Job day not found");
  }
  const matchingLead = aggregate.staffAssignments.find((assignment) => assignment.is_lead && (assignment.job_day_id === dayId || assignment.job_day_id == null));
  const managerOverride = hasManageAccess(auth, aggregate.job.department_type);
  if (matchingLead?.user_id !== auth.id && !managerOverride) {
    requireManageAccess(auth, aggregate.job.department_type);
  }
  const dayReadyRequirements = await getDayReadyRequirementsConfiguration(client, auth.tenantId, aggregate.job);
  const onSiteConfirmed = input.on_site_confirmed ?? true;
  const setupComplete = input.setup_complete ?? true;
  const allRequiredStaffPresent = input.all_required_staff_present ?? true;
  const blockersResolved = input.blockers_resolved ?? true;
  const workflowValidation = buildJobDayReadyTransitionValidation({
    jobId,
    day,
    staffAssignments: aggregate.staffAssignments,
    readinessItems: aggregate.readinessItems,
    managerOverride,
    rules: dayReadyRequirements,
    input
  });
  const canAdvanceDay = onSiteConfirmed && setupComplete && allRequiredStaffPresent && blockersResolved;

  if (!workflowValidation.allowed) {
    throw buildWorkflowValidationError(workflowValidation, {
      message: "This job day cannot be marked ready yet."
    });
  }
  await client.query(
    `
      UPDATE job_days
      SET ready_confirmed_at = now(),
          ready_confirmed_by_user_id = $3,
          day_status = CASE WHEN $4 THEN 'ready'::job_day_status_type ELSE day_status END,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, dayId, auth.id, canAdvanceDay]
  );
  if (matchingLead) {
    await client.query(
      `
        UPDATE job_staff_assignments
        SET is_ready_present = $3,
            assignment_status = CASE WHEN assignment_status = 'checked_in'::job_assignment_status_type THEN assignment_status ELSE 'confirmed'::job_assignment_status_type END,
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [auth.tenantId, matchingLead.id, canAdvanceDay]
    );
  }
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId,
    jobDayId: dayId,
    eventType: "lead_ready_confirmed",
    summary: "Lead ready confirmation recorded",
    metadata: {
      note: normalizeNullableText(input.note),
      on_site_confirmed: onSiteConfirmed,
      setup_complete: setupComplete,
      all_required_staff_present: allRequiredStaffPresent,
      blockers_resolved: blockersResolved,
      equipment_ready: input.equipment_ready ?? null,
      client_contact_checked_in: input.client_contact_checked_in ?? null,
      manager_override: !canAdvanceDay && managerOverride
    }
  });
  return refreshJobAfterOperationalMutation(client, auth, jobId);
}

export async function updateReadinessItem(
  client: PoolClient,
  auth: AuthUser,
  jobId: string,
  itemId: string,
  input: {
    is_complete?: boolean | null;
    note?: string | null;
  }
) {
  const aggregate = await loadAndGuard(client, auth, jobId);
  requireManageAccess(auth, aggregate.job.department_type);
  const complete = input.is_complete ?? true;
  const normalizedNote = normalizeNullableText(input.note);
  await client.query(
    `
        UPDATE job_readiness_items
        SET is_complete = $3,
            completed_at = CASE WHEN $3 THEN now() ELSE null END,
            completed_by_user_id = CASE WHEN $3 THEN $4::uuid ELSE null END,
            notes = COALESCE($5, notes),
            updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, itemId, complete, auth.id, normalizedNote]
  );
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId,
    eventType: complete ? "readiness_completed" : "readiness_reopened",
    summary: complete ? "Completed readiness item" : "Reopened readiness item",
    metadata: { readiness_item_id: itemId, note: normalizedNote, is_complete: complete }
  });
  return refreshJobAfterOperationalMutation(client, auth, jobId);
}

export async function completeReadinessItem(client: PoolClient, auth: AuthUser, jobId: string, itemId: string, note: string | null = null) {
  return updateReadinessItem(client, auth, jobId, itemId, { is_complete: true, note });
}

export async function updateJobDay(
  client: PoolClient,
  auth: AuthUser,
  jobId: string,
  dayId: string,
  input: { day_status: JobDayRecord["day_status"]; note?: string | null }
) {
  const aggregate = await loadAndGuard(client, auth, jobId);
  const day = aggregate.days.find((row) => row.id === dayId);
  if (!day) {
    throw new ApiError(404, "Job day not found");
  }
  requireManageAccess(auth, aggregate.job.department_type);
  const normalizedNote = normalizeNullableText(input.note);
  if ((input.day_status === "postponed" || input.day_status === "cancelled") && !normalizedNote) {
    throw new ApiError(400, "Validation failed", {
      field_errors: { note: ["A reason is required when postponing or cancelling a day."] },
      form_errors: []
    });
  }
  await client.query(
    `
      UPDATE job_days
      SET day_status = $3::job_day_status_type,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, dayId, input.day_status]
  );
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId,
    jobDayId: dayId,
    eventType: "day_status_changed",
    summary: `Updated day status to ${input.day_status}`,
    metadata: { day_status: input.day_status, note: normalizedNote }
  });
  return refreshJobAfterOperationalMutation(client, auth, jobId);
}

export async function addJobDayNote(client: PoolClient, auth: AuthUser, jobId: string, dayId: string, note: string) {
  const aggregate = await loadAndGuard(client, auth, jobId);
  const day = aggregate.days.find((row) => row.id === dayId);
  if (!day) {
    throw new ApiError(404, "Job day not found");
  }
  const normalizedNote = normalizeNullableText(note);
  if (!normalizedNote) {
    throw new ApiError(400, "Validation failed", {
      field_errors: { note: ["A note is required."] },
      form_errors: []
    });
  }
  if (!hasAssignmentForUser(aggregate, auth.id, dayId) && !hasManageAccess(auth, aggregate.job.department_type)) {
    throw new ApiError(403, "Forbidden");
  }
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId,
    jobDayId: dayId,
    eventType: "day_note_added",
    summary: normalizedNote.length > 120 ? `${normalizedNote.slice(0, 117)}...` : normalizedNote,
    metadata: { note: normalizedNote }
  });
  return getJobDetail(client, auth, jobId);
}

function requireProductionItemMutationAccess(auth: AuthUser, aggregate: LoadedJobAggregate, itemId?: string | null) {
  if (canManageProductionItem(auth, aggregate, itemId)) {
    return;
  }
  throw new ApiError(403, "Forbidden");
}

function requireProductionActionAccess(
  auth: AuthUser,
  aggregate: LoadedJobAggregate,
  permissionKey:
    | "production.group"
    | "production.split"
    | "production.merge"
    | "production.reopen"
    | "production.cancel"
    | "production.override_dates"
    | "production.release_approve",
  item?: ProductionItemRecord | null
) {
  if (canManageProductionAction(auth, aggregate, permissionKey, item)) {
    return;
  }
  throw new ApiError(403, "Forbidden");
}

function findProductionItem(aggregate: LoadedJobAggregate, itemId: string) {
  const item = aggregate.productionItems.find((row) => row.id === itemId);
  if (!item) {
    throw new ApiError(404, "Production item not found");
  }
  return item;
}

function getProductionItemLinkedShootIds(aggregate: LoadedJobAggregate, productionItemId: string) {
  const linked = aggregate.productionItemShootLinks
    .filter((link) => link.production_item_id === productionItemId)
    .map((link) => link.shoot_id);
  if (linked.length) {
    return [...new Set(linked)];
  }
  const jobLinked = aggregate.jobShootLinks.map((link) => link.shoot_id);
  if (jobLinked.length) {
    return [...new Set(jobLinked)];
  }
  return aggregate.job.legacy_shoot_id ? [aggregate.job.legacy_shoot_id] : [];
}

async function linkShootIdsToProductionItem(client: PoolClient, tenantId: string, productionItemId: string, shootIds: string[]) {
  const deduped = [...new Set(shootIds.filter(Boolean))];
  if (!deduped.length) {
    return;
  }
  await client.query(
    `
      INSERT INTO production_item_shoot_links (tenant_id, production_item_id, shoot_id)
      SELECT $1, $2, shoot_id
      FROM unnest($3::uuid[]) AS shoot_id
      ON CONFLICT (tenant_id, production_item_id, shoot_id) DO NOTHING
    `,
    [tenantId, productionItemId, deduped]
  );
}

async function reparentProductionArtifacts(client: PoolClient, tenantId: string, fromProductionItemId: string, toProductionItemId: string) {
  await Promise.all([
    client.query(
      `UPDATE production_handoffs SET production_item_id = $3 WHERE tenant_id = $1 AND production_item_id = $2`,
      [tenantId, fromProductionItemId, toProductionItemId]
    ),
    client.query(
      `UPDATE approval_requests SET production_item_id = $3 WHERE tenant_id = $1 AND production_item_id = $2`,
      [tenantId, fromProductionItemId, toProductionItemId]
    ),
    client.query(
      `UPDATE qa_review_records SET production_item_id = $3 WHERE tenant_id = $1 AND production_item_id = $2`,
      [tenantId, fromProductionItemId, toProductionItemId]
    ),
    client.query(
      `UPDATE deliverable_items SET production_item_id = $3 WHERE tenant_id = $1 AND production_item_id = $2`,
      [tenantId, fromProductionItemId, toProductionItemId]
    ),
    client.query(
      `UPDATE production_issue_records SET production_item_id = $3 WHERE tenant_id = $1 AND production_item_id = $2`,
      [tenantId, fromProductionItemId, toProductionItemId]
    ),
    client.query(
      `UPDATE job_watch_flags SET production_item_id = $3 WHERE tenant_id = $1 AND production_item_id = $2`,
      [tenantId, fromProductionItemId, toProductionItemId]
    )
  ]);
}

export async function createOrUpdateProductionItem(
  client: PoolClient,
  auth: AuthUser,
  jobId: string,
  input: Partial<ProductionItemRecord> & {
    id?: string | null;
    allow_checklist_override?: boolean | null;
    checklist_override_reason?: string | null;
  }
) {
  const aggregate = await loadAndGuard(client, auth, jobId);
  const existingItem = input.id ? findProductionItem(aggregate, input.id) : null;
  if (input.id && !existingItem) {
    throw new ApiError(404, "Production item not found");
  }
  const contextItem = existingItem ?? null;

  if (!canManageProductionItem(auth, aggregate, input.id ?? null)) {
    const safeAssignedFields = new Set([
      "handoff_complete",
      "file_count_expected",
      "file_count_received",
      "post_shoot_eval_summary",
      "internal_notes",
      "production_notes"
    ]);
    const touchedKeys = Object.entries(input)
      .filter(([key, value]) => key !== "id" && value !== undefined)
      .map(([key]) => key);
    const canSelfHandoff =
      touchedKeys.every((key) => safeAssignedFields.has(key)) &&
      hasAssignmentForUser(aggregate, auth.id, existingItem?.job_day_id ?? null);
    if (!canSelfHandoff) {
      throw new ApiError(403, "Forbidden");
    }
  }

  const nextTitle = normalizeNullableText(input.title) ?? existingItem?.title ?? null;
  const nextProductionType = normalizeNullableText(input.production_type) ?? existingItem?.production_type ?? null;
  if (!nextTitle || !nextProductionType) {
    throw new ApiError(400, "Validation failed", {
      field_errors: {
        title: ["Production title is required."],
        production_type: ["Production type is required."]
      },
      form_errors: []
    });
  }
  const resolvedPlan = buildProductionTemplatePlanForAggregate(aggregate, {
    ...existingItem,
    title: nextTitle,
    production_type: nextProductionType,
    proof_required: input.proof_required ?? existingItem?.proof_required ?? false,
    vendor_name: normalizeNullableText(input.vendor_name) ?? existingItem?.vendor_name ?? null,
    release_target: normalizeNullableText(input.release_target) ?? existingItem?.release_target ?? null
  } as Partial<ProductionItemRecord>);
  const nextTemplateKey = normalizeNullableText(input.production_template_key) ?? resolvedPlan.templateKey;
  const nextCompletionRuleKey = normalizeNullableText(input.completion_rule_key) ?? resolvedPlan.completionRuleKey;
  const nextCreatedFromSource = normalizeNullableText(input.created_from_source) ?? existingItem?.created_from_source ?? "manual";
  const nextLegacySourceReference =
    normalizeNullableText(input.legacy_source_reference) ?? existingItem?.legacy_source_reference ?? aggregate.job.legacy_shoot_id ?? null;
  const nextImportedStatusSource = normalizeNullableText(input.imported_status_source) ?? existingItem?.imported_status_source ?? null;
  const nextLegacyOwnerHistoryJson = input.legacy_owner_history_json ?? existingItem?.legacy_owner_history_json ?? null;

  const requestedWorkflowStatus = input.workflow_status ?? existingItem?.workflow_status ?? "DRAFT";
  const nextUploadStatus = input.upload_status ?? existingItem?.upload_status ?? null;
  const nextReleaseStatus = input.release_status ?? existingItem?.release_status ?? null;
  if (requestedWorkflowStatus === "ON_HOLD") {
    const holdReason = normalizeNullableText(input.hold_reason) ?? existingItem?.hold_reason ?? null;
    const holdOwnerUserId = input.hold_owner_user_id ?? existingItem?.hold_owner_user_id ?? null;
    const holdReviewAt = input.hold_review_at ?? existingItem?.hold_review_at ?? null;
    if (!holdReason || !holdOwnerUserId || !holdReviewAt) {
      throw new ApiError(400, "Validation failed", {
        field_errors: {
          hold_reason: ["On hold requires a reason."],
          hold_owner_user_id: ["On hold requires an owner."],
          hold_review_at: ["On hold requires a target review date."]
        },
        form_errors: []
      });
    }
  }

  if (existingItem && input.assigned_to_user_id !== undefined && input.assigned_to_user_id !== existingItem.assigned_to_user_id) {
    if (
      !canSharedPolicy(auth, "production.assign_owner", buildProductionPolicyContext(aggregate, contextItem)) &&
      !hasManageAccess(auth, aggregate.job.department_type)
    ) {
      throw new ApiError(403, "Forbidden");
    }
  }

  if (
    existingItem &&
    ((input.due_at !== undefined && normalizeTimestamp(input.due_at) !== normalizeTimestamp(existingItem.due_at)) ||
      (input.release_due_at !== undefined && normalizeTimestamp(input.release_due_at) !== normalizeTimestamp(existingItem.release_due_at)))
  ) {
    requireProductionActionAccess(auth, aggregate, "production.override_dates", contextItem);
  }

  let checklistValidation: ChecklistTransitionValidation | null = null;
  if (existingItem && input.workflow_status && input.workflow_status !== existingItem.workflow_status) {
    if (input.workflow_status === "CANCELLED") {
      requireProductionActionAccess(auth, aggregate, "production.cancel", contextItem);
    }
    if (
      ["DELIVERED_CLOSED", "CANCELLED"].includes(existingItem.workflow_status) &&
      !["DELIVERED_CLOSED", "CANCELLED"].includes(input.workflow_status)
    ) {
      requireProductionActionAccess(auth, aggregate, "production.reopen", contextItem);
    }
    if (["READY_FOR_RELEASE", "RELEASED", "SENT_TO_VENDOR"].includes(input.workflow_status)) {
      requireProductionActionAccess(auth, aggregate, "production.release_approve", contextItem);
    }

    checklistValidation = await validateChecklistTargetTransition(client, auth, {
      resource_type: "production_item",
      from_stage: existingItem.workflow_status,
      to_stage: input.workflow_status,
      department_type: aggregate.job.department_type,
      job_id: jobId,
      production_item_id: existingItem.id,
      allow_soft_override: input.allow_checklist_override ?? false,
      override_reason: normalizeNullableText(input.checklist_override_reason)
    });
  }

  if (
    existingItem &&
    input.release_status &&
    input.release_status !== existingItem.release_status &&
    ["READY_FOR_RELEASE", "RELEASED", "SENT_TO_VENDOR", "DELIVERED", "CLOSED"].includes(input.release_status)
  ) {
    requireProductionActionAccess(auth, aggregate, "production.release_approve", contextItem);
  }

  const workflowTransitionRequested = Boolean(
    input.workflow_status !== undefined || input.upload_status !== undefined || input.release_status !== undefined
  );
  if (workflowTransitionRequested) {
    const productionWorkflowConfiguration = await getProductionWorkflowConfiguration(client, auth.tenantId, {
      department: aggregate.job.department_type,
      item: existingItem
    });
    const workflowValidation = buildProductionWorkflowTransitionValidation({
      jobId,
      item: existingItem,
      approvalRequests: aggregate.approvalRequests,
      productionIssues: aggregate.productionIssues,
      rules: productionWorkflowConfiguration.releaseBlockers,
      finalReleaseStatuses: productionWorkflowConfiguration.finalReleaseStatuses,
      input: {
        workflow_status: input.workflow_status ?? null,
        upload_status: nextUploadStatus,
        release_status: nextReleaseStatus,
        peer_review_complete: input.peer_review_complete ?? null,
        final_release_review_complete: input.final_release_review_complete ?? null,
        approval_required: input.approval_required ?? null,
        proof_required: input.proof_required ?? null,
        gallery_or_output_reference: input.gallery_or_output_reference ?? null,
        vendor_reference: input.vendor_reference ?? null,
        release_target: input.release_target ?? null,
        assigned_to_user_id: input.assigned_to_user_id ?? null
      },
      checklistValidation
    });
    if (!workflowValidation.allowed) {
      throw buildWorkflowValidationError(workflowValidation, {
        message: "This production item cannot move to the requested workflow stage yet."
      });
    }
  }

  const requestedProductionStart =
    input.workflow_status === "IN_PRODUCTION" && !existingItem?.production_start_at ? new Date().toISOString() : input.production_start_at ?? null;
  let createdProductionItemId: string | null = null;

  if (input.id) {
    await client.query(
      `
        UPDATE production_items
        SET title = $3,
            production_type = $4,
            status = COALESCE($5::job_production_status_type, status),
            workflow_status = COALESCE($6::production_board_workflow_status_type, workflow_status),
            health_state = COALESCE($7::production_board_health_state_type, health_state),
            sync_state = COALESCE($8::production_board_sync_state_type, sync_state),
            priority = COALESCE($9::job_priority_level, priority),
            assigned_to_user_id = COALESCE($10, assigned_to_user_id),
            assigned_peer_reviewer_user_id = COALESCE($11, assigned_peer_reviewer_user_id),
            assigned_release_reviewer_user_id = COALESCE($12, assigned_release_reviewer_user_id),
            escalation_owner_user_id = COALESCE($13, escalation_owner_user_id),
            department_owner_user_id = COALESCE($14, department_owner_user_id),
            approval_required = COALESCE($15, approval_required),
            proof_required = COALESCE($16, proof_required),
            qa_required = COALESCE($17, qa_required),
            production_start_at = COALESCE($18, production_start_at),
            due_at = COALESCE($19, due_at),
            release_due_at = COALESCE($20, release_due_at),
            delivery_deadline_at = COALESCE($21, delivery_deadline_at),
            blocked_reason = COALESCE($22, blocked_reason),
            vendor_name = COALESCE($23, vendor_name),
            vendor_reference = COALESCE($24, vendor_reference),
            client_visible_label = COALESCE($25, client_visible_label),
            release_target = COALESCE($26, release_target),
            gallery_or_output_reference = COALESCE($27, gallery_or_output_reference),
            file_count_expected = COALESCE($28, file_count_expected),
            file_count_received = COALESCE($29, file_count_received),
            file_match_status = COALESCE($30::production_board_file_match_status_type, file_match_status),
            handoff_complete = COALESCE($31, handoff_complete),
            roster_received = COALESCE($32, roster_received),
            naming_verified = COALESCE($33, naming_verified),
            folder_structure_verified = COALESCE($34, folder_structure_verified),
            tags_or_flags_verified = COALESCE($35, tags_or_flags_verified),
            creator_review_complete = COALESCE($36, creator_review_complete),
            peer_review_complete = COALESCE($37, peer_review_complete),
            final_release_review_complete = COALESCE($38, final_release_review_complete),
            upload_status = COALESCE($39::production_board_upload_status_type, upload_status),
            release_status = COALESCE($40::production_board_release_status_type, release_status),
            internal_notes = COALESCE($41, internal_notes),
            production_notes = COALESCE($42, production_notes),
            post_shoot_eval_summary = COALESCE($43, post_shoot_eval_summary),
            hold_reason = COALESCE($44, hold_reason),
            hold_owner_user_id = COALESCE($45, hold_owner_user_id),
            hold_review_at = COALESCE($46, hold_review_at),
            qa_status = COALESCE($47, qa_status),
            production_template_key = COALESCE($48, production_template_key),
            completion_rule_key = COALESCE($49, completion_rule_key),
            legacy_source_reference = COALESCE($50, legacy_source_reference),
            imported_status_source = COALESCE($51, imported_status_source),
            legacy_owner_history_json = COALESCE($52::jsonb, legacy_owner_history_json),
            created_from_source = COALESCE($53, created_from_source),
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [
        auth.tenantId,
        input.id,
        nextTitle,
        nextProductionType,
        input.status ?? null,
        input.workflow_status ?? null,
        input.health_state ?? null,
        input.sync_state ?? null,
        input.priority ?? null,
        input.assigned_to_user_id ?? null,
        input.assigned_peer_reviewer_user_id ?? null,
        input.assigned_release_reviewer_user_id ?? null,
        input.escalation_owner_user_id ?? null,
        input.department_owner_user_id ?? null,
        input.approval_required ?? null,
        input.proof_required ?? null,
        input.qa_required ?? null,
        requestedProductionStart,
        input.due_at ?? null,
        input.release_due_at ?? null,
        input.delivery_deadline_at ?? null,
        normalizeNullableText(input.blocked_reason),
        normalizeNullableText(input.vendor_name),
        normalizeNullableText(input.vendor_reference),
        normalizeNullableText(input.client_visible_label),
        normalizeNullableText(input.release_target),
        normalizeNullableText(input.gallery_or_output_reference),
        input.file_count_expected ?? null,
        input.file_count_received ?? null,
        input.file_match_status ?? null,
        input.handoff_complete ?? null,
        input.roster_received ?? null,
        input.naming_verified ?? null,
        input.folder_structure_verified ?? null,
        input.tags_or_flags_verified ?? null,
        input.creator_review_complete ?? null,
        input.peer_review_complete ?? null,
        input.final_release_review_complete ?? null,
        input.upload_status ?? null,
        input.release_status ?? null,
        normalizeNullableText(input.internal_notes),
        normalizeNullableText(input.production_notes),
        normalizeNullableText(input.post_shoot_eval_summary),
        normalizeNullableText(input.hold_reason),
        input.hold_owner_user_id ?? null,
        input.hold_review_at ?? null,
        normalizeNullableText(input.qa_status),
        nextTemplateKey,
        nextCompletionRuleKey,
        nextLegacySourceReference,
        nextImportedStatusSource,
        nextLegacyOwnerHistoryJson ? JSON.stringify(nextLegacyOwnerHistoryJson) : null,
        nextCreatedFromSource
      ]
    );
    await ensureProductionTemplateDeliverables(
      client,
      auth.tenantId,
      auth.id,
      jobId,
      {
        ...existingItem,
        title: nextTitle,
        production_type: nextProductionType,
        production_template_key: nextTemplateKey,
        completion_rule_key: nextCompletionRuleKey,
        proof_required: input.proof_required ?? existingItem?.proof_required ?? false,
        vendor_name: normalizeNullableText(input.vendor_name) ?? existingItem?.vendor_name ?? null,
        release_target: normalizeNullableText(input.release_target) ?? existingItem?.release_target ?? null,
        legacy_source_reference: nextLegacySourceReference,
        imported_status_source: nextImportedStatusSource,
        legacy_owner_history_json: nextLegacyOwnerHistoryJson
      } as ProductionItemRecord,
      resolvedPlan,
      aggregate.deliverableItems.filter((deliverable) => deliverable.production_item_id === input.id)
    );
  } else {
    const inserted = await client.query<ProductionItemRecord>(
      `
        INSERT INTO production_items (
          tenant_id,
          job_id,
          job_day_id,
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
          escalation_owner_user_id,
          department_owner_user_id,
          organization_id,
          location_id,
          primary_contact_id,
          account_owner_user_id,
          department_type,
          approval_required,
          proof_required,
          qa_required,
          production_start_at,
          due_at,
          release_due_at,
          delivery_deadline_at,
          release_target,
          gallery_or_output_reference,
          file_count_expected,
          file_count_received,
          file_match_status,
          handoff_complete,
          roster_received,
          naming_verified,
          folder_structure_verified,
          tags_or_flags_verified,
          blocked_reason,
          vendor_name,
          vendor_reference,
          client_visible_label,
          internal_notes,
          production_notes,
          post_shoot_eval_summary,
          legacy_source_reference,
          imported_status_source,
          legacy_owner_history_json,
          hold_reason,
          hold_owner_user_id,
          hold_review_at,
          qa_status
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11::job_production_status_type,
          $12::production_board_workflow_status_type,
          $13::production_board_health_state_type,
          $14::production_board_sync_state_type,
          $15::job_priority_level,
          $16,$17,$18,$19,$20,$21,$22,$23,$24,
          $25::job_department_type,
          $26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,
          $37::production_board_file_match_status_type,
          $38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56
        )
        RETURNING *
      `,
      [
        auth.tenantId,
        jobId,
        input.job_day_id ?? null,
        normalizeNullableText(input.production_group_key) ?? `${aggregate.job.department_type}:${jobId}`,
        nextTitle,
        aggregate.job.job_category,
        nextProductionType,
        nextTemplateKey,
        nextCompletionRuleKey,
        nextCreatedFromSource,
        input.status ?? "queued",
        input.workflow_status ?? "DRAFT",
        input.health_state ?? "ON_TRACK",
        input.sync_state ?? "CLEAN",
        input.priority ?? aggregate.job.priority_level,
        input.assigned_to_user_id ?? null,
        input.assigned_peer_reviewer_user_id ?? null,
        input.assigned_release_reviewer_user_id ?? null,
        input.escalation_owner_user_id ?? null,
        input.department_owner_user_id ?? aggregate.job.account_owner_user_id ?? null,
        aggregate.job.organization_id,
        aggregate.job.primary_location_id,
        aggregate.job.primary_contact_id,
        aggregate.job.account_owner_user_id,
        aggregate.job.department_type,
        input.approval_required ?? Boolean(input.proof_required ?? resolvedPlan.proofRequired),
        input.proof_required ?? resolvedPlan.proofRequired,
        input.qa_required ?? false,
        requestedProductionStart,
        input.due_at ?? null,
        input.release_due_at ?? null,
        input.delivery_deadline_at ?? null,
        normalizeNullableText(input.release_target),
        normalizeNullableText(input.gallery_or_output_reference),
        input.file_count_expected ?? null,
        input.file_count_received ?? null,
        input.file_match_status ?? deriveProductionFileMatchStatus({
          file_count_expected: input.file_count_expected ?? null,
          file_count_received: input.file_count_received ?? null
        }),
        input.handoff_complete ?? false,
        input.roster_received ?? false,
        input.naming_verified ?? false,
        input.folder_structure_verified ?? false,
        input.tags_or_flags_verified ?? false,
        normalizeNullableText(input.blocked_reason),
        normalizeNullableText(input.vendor_name),
        normalizeNullableText(input.vendor_reference),
        normalizeNullableText(input.client_visible_label),
        normalizeNullableText(input.internal_notes),
        normalizeNullableText(input.production_notes),
        normalizeNullableText(input.post_shoot_eval_summary),
        nextLegacySourceReference,
        nextImportedStatusSource,
        nextLegacyOwnerHistoryJson ? JSON.stringify(nextLegacyOwnerHistoryJson) : null,
        normalizeNullableText(input.hold_reason),
        input.hold_owner_user_id ?? null,
        input.hold_review_at ?? null,
        normalizeNullableText(input.qa_status) ?? "not_started"
      ]
    );
    const insertedItem = inserted.rows[0] ?? null;
    createdProductionItemId = insertedItem?.id ?? null;
    if (insertedItem) {
      const linkedShootIds = aggregate.jobShootLinks.length
        ? aggregate.jobShootLinks.map((link) => link.shoot_id)
        : aggregate.job.legacy_shoot_id
          ? [aggregate.job.legacy_shoot_id]
          : [];
      await linkShootIdsToProductionItem(client, auth.tenantId, insertedItem.id, linkedShootIds);
      await ensureProductionTemplateDeliverables(
        client,
        auth.tenantId,
        auth.id,
        jobId,
        insertedItem,
        resolvedPlan,
        aggregate.deliverableItems.filter((deliverable) => deliverable.production_item_id === insertedItem.id)
      );
    }
  }
  const activityProductionItemId = input.id ?? createdProductionItemId;
  if (activityProductionItemId) {
    const triggerTemplateCodes = new Set<string>();
    if (!existingItem) {
      for (const code of getChecklistTemplateCodesForProductionCreation()) {
        triggerTemplateCodes.add(code);
      }
    }
    if (existingItem && input.workflow_status && input.workflow_status !== existingItem.workflow_status) {
      for (const code of getChecklistTemplateCodesForProductionWorkflowStatus(requestedWorkflowStatus)) {
        triggerTemplateCodes.add(code);
      }
    }
    const uploadTriggerRequested =
      !existingItem
        ? shouldInstantiateUploadChecklist(nextUploadStatus, requestedWorkflowStatus)
        : (input.upload_status !== undefined && input.upload_status !== existingItem.upload_status && shouldInstantiateUploadChecklist(nextUploadStatus, requestedWorkflowStatus)) ||
          (input.workflow_status !== undefined &&
            input.workflow_status !== existingItem.workflow_status &&
            shouldInstantiateUploadChecklist(nextUploadStatus, requestedWorkflowStatus));
    if (uploadTriggerRequested) {
      triggerTemplateCodes.add("captura_upload_qa");
    }
    const releaseTriggerRequested =
      !existingItem
        ? shouldInstantiateReleaseChecklist(nextReleaseStatus, requestedWorkflowStatus)
        : (input.release_status !== undefined &&
            input.release_status !== existingItem.release_status &&
            shouldInstantiateReleaseChecklist(nextReleaseStatus, requestedWorkflowStatus)) ||
          (input.workflow_status !== undefined &&
            input.workflow_status !== existingItem.workflow_status &&
            shouldInstantiateReleaseChecklist(nextReleaseStatus, requestedWorkflowStatus));
    if (releaseTriggerRequested) {
      triggerTemplateCodes.add("final_release_checklist");
    }
    if (triggerTemplateCodes.size) {
      await ensureTriggeredChecklistInstances(client, auth, {
        scope_type: "production_item",
        scope_id: activityProductionItemId,
        trigger_types: ["production_status_transition", "upload_verified", "release_review"],
        template_codes: [...triggerTemplateCodes],
        created_from_trigger_key: `production:${existingItem?.workflow_status ?? "created"}:${requestedWorkflowStatus}`,
        source_metadata_json: {
          job_id: jobId,
          production_item_id: activityProductionItemId,
          upload_status: nextUploadStatus,
          release_status: nextReleaseStatus
        }
      });
    }
  }
  if (existingItem) {
    if (input.assigned_to_user_id !== undefined && input.assigned_to_user_id !== existingItem.assigned_to_user_id) {
      await writeJobActivity(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        jobId,
        productionItemId: activityProductionItemId,
        eventType: "production_assignment_changed",
        summary: `${nextTitle}: production owner reassigned`,
        oldValues: { assigned_to_user_id: existingItem.assigned_to_user_id },
        newValues: { assigned_to_user_id: input.assigned_to_user_id ?? null }
      });
    }
    if (
      (input.due_at !== undefined && normalizeTimestamp(input.due_at) !== normalizeTimestamp(existingItem.due_at)) ||
      (input.release_due_at !== undefined && normalizeTimestamp(input.release_due_at) !== normalizeTimestamp(existingItem.release_due_at))
    ) {
      await writeJobActivity(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        jobId,
        productionItemId: activityProductionItemId,
        eventType: "production_due_date_overridden",
        summary: `${nextTitle}: production dates overridden`,
        oldValues: { due_at: existingItem.due_at, release_due_at: existingItem.release_due_at },
        newValues: { due_at: input.due_at ?? existingItem.due_at, release_due_at: input.release_due_at ?? existingItem.release_due_at }
      });
    }
    if (input.workflow_status && input.workflow_status !== existingItem.workflow_status) {
      let eventType = "production_workflow_status_changed";
      if (input.workflow_status === "ON_HOLD") {
        eventType = "production_hold_applied";
      } else if (existingItem.workflow_status === "ON_HOLD") {
        eventType = "production_hold_released";
      } else if (input.workflow_status === "CANCELLED") {
        eventType = "production_cancelled";
      } else if (
        ["DELIVERED_CLOSED", "CANCELLED"].includes(existingItem.workflow_status) &&
        !["DELIVERED_CLOSED", "CANCELLED"].includes(input.workflow_status)
      ) {
        eventType = "production_reopened";
      }
      await writeJobActivity(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        jobId,
        productionItemId: activityProductionItemId,
        eventType,
        summary: `${nextTitle}: ${existingItem.workflow_status} -> ${input.workflow_status}`,
        oldValues: { workflow_status: existingItem.workflow_status },
        newValues: { workflow_status: input.workflow_status }
      });
    }
    if (input.blocked_reason !== undefined && normalizeNullableText(input.blocked_reason) !== normalizeNullableText(existingItem.blocked_reason)) {
      await writeJobActivity(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        jobId,
        productionItemId: activityProductionItemId,
        eventType: normalizeNullableText(input.blocked_reason) ? "production_blocked" : "production_unblocked",
        summary: `${nextTitle}: ${normalizeNullableText(input.blocked_reason) ? "blocked" : "unblocked"}`,
        oldValues: { blocked_reason: existingItem.blocked_reason },
        newValues: { blocked_reason: normalizeNullableText(input.blocked_reason) }
      });
    }
    if (
      input.release_status &&
      input.release_status !== existingItem.release_status &&
      ["RELEASED", "SENT_TO_VENDOR", "DELIVERED", "CLOSED"].includes(input.release_status)
    ) {
      await writeJobActivity(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        jobId,
        productionItemId: activityProductionItemId,
        eventType: "production_release_updated",
        summary: `${nextTitle}: release status ${input.release_status}`,
        oldValues: { release_status: existingItem.release_status },
        newValues: { release_status: input.release_status }
      });
    }
  }
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId,
    productionItemId: activityProductionItemId,
    eventType: existingItem ? "production_item_updated" : "production_item_created",
    summary: existingItem ? `${nextTitle}: production item updated` : `${nextTitle}: production item created`
  });
  return refreshJobAfterOperationalMutation(client, auth, jobId);
}

export async function groupProductionItems(
  client: PoolClient,
  auth: AuthUser,
  jobId: string,
  input: {
    production_item_ids: string[];
    title?: string | null;
    assigned_to_user_id?: string | null;
    assigned_peer_reviewer_user_id?: string | null;
    assigned_release_reviewer_user_id?: string | null;
    due_at?: string | null;
    release_due_at?: string | null;
    release_target?: string | null;
    note?: string | null;
  }
) {
  const aggregate = await loadAndGuard(client, auth, jobId);
  const items = input.production_item_ids.map((itemId) => findProductionItem(aggregate, itemId));
  for (const item of items) {
    requireProductionActionAccess(auth, aggregate, "production.group", item);
  }

  const validation = validateProductionGrouping(items);
  if (!validation.allowed) {
    throw new ApiError(400, "Validation failed", {
      field_errors: { production_item_ids: validation.reasons },
      form_errors: []
    });
  }

  const [primary, ...secondaryItems] = items;
  const mergedShootIds = [...new Set(items.flatMap((item) => getProductionItemLinkedShootIds(aggregate, item.id)))];
  const mergedExpected = items.reduce<number | null>((sum, item) => {
    if (item.file_count_expected == null) {
      return sum;
    }
    return (sum ?? 0) + item.file_count_expected;
  }, null);
  const mergedActual = items.reduce<number | null>((sum, item) => {
    if (item.file_count_received == null) {
      return sum;
    }
    return (sum ?? 0) + item.file_count_received;
  }, null);

  await client.query(
    `
      UPDATE production_items
      SET title = COALESCE($3, title),
          assigned_to_user_id = COALESCE($4, assigned_to_user_id),
          assigned_peer_reviewer_user_id = COALESCE($5, assigned_peer_reviewer_user_id),
          assigned_release_reviewer_user_id = COALESCE($6, assigned_release_reviewer_user_id),
          due_at = COALESCE($7, due_at),
          release_due_at = COALESCE($8, release_due_at),
          release_target = COALESCE($9, release_target),
          file_count_expected = COALESCE($10, file_count_expected),
          file_count_received = COALESCE($11, file_count_received),
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      auth.tenantId,
      primary.id,
      normalizeNullableText(input.title),
      input.assigned_to_user_id ?? null,
      input.assigned_peer_reviewer_user_id ?? null,
      input.assigned_release_reviewer_user_id ?? null,
      input.due_at ?? null,
      input.release_due_at ?? null,
      normalizeNullableText(input.release_target),
      mergedExpected,
      mergedActual
    ]
  );

  await linkShootIdsToProductionItem(client, auth.tenantId, primary.id, mergedShootIds);

  for (const secondary of secondaryItems) {
    await reparentProductionArtifacts(client, auth.tenantId, secondary.id, primary.id);
    await client.query(
      `
        UPDATE production_items
        SET merged_into_production_item_id = $3,
            workflow_status = 'CANCELLED'::production_board_workflow_status_type,
            status = 'cancelled'::job_production_status_type,
            closed_at = COALESCE(closed_at, now()),
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [auth.tenantId, secondary.id, primary.id]
    );
    await writeJobActivity(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      jobId,
      productionItemId: secondary.id,
      eventType: "production_item_merged",
      summary: `${secondary.title}: merged into ${primary.title}`,
      metadata: { merged_into_production_item_id: primary.id }
    });
  }

  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId,
    productionItemId: primary.id,
    eventType: "production_items_grouped",
    summary: `${primary.title}: grouped ${items.length} production items`,
    metadata: {
      grouped_item_ids: input.production_item_ids,
      linked_shoot_ids: mergedShootIds,
      note: normalizeNullableText(input.note)
    }
  });

  return refreshJobAfterOperationalMutation(client, auth, jobId);
}

export async function splitProductionItem(
  client: PoolClient,
  auth: AuthUser,
  jobId: string,
  productionItemId: string,
  input: {
    branches: Array<{
      title?: string | null;
      production_type?: string | null;
      due_at?: string | null;
      release_due_at?: string | null;
      delivery_deadline_at?: string | null;
      release_target?: string | null;
      assigned_to_user_id?: string | null;
      assigned_peer_reviewer_user_id?: string | null;
      assigned_release_reviewer_user_id?: string | null;
      vendor_name?: string | null;
      client_visible_label?: string | null;
      approval_required?: boolean | null;
      proof_required?: boolean | null;
      qa_required?: boolean | null;
    }>;
    note?: string | null;
  }
) {
  const aggregate = await loadAndGuard(client, auth, jobId);
  const item = findProductionItem(aggregate, productionItemId);
  requireProductionActionAccess(auth, aggregate, "production.split", item);

  const validation = validateProductionSplit(item, input.branches);
  if (!validation.allowed) {
    throw new ApiError(400, "Validation failed", {
      field_errors: { branches: validation.reasons },
      form_errors: []
    });
  }

  const hasDownstreamArtifacts =
    aggregate.productionHandoffs.some((row) => row.production_item_id === productionItemId) ||
    aggregate.approvalRequests.some((row) => row.production_item_id === productionItemId) ||
    aggregate.qaReviews.some((row) => row.production_item_id === productionItemId) ||
    aggregate.deliverableItems.some(
      (row) =>
        row.production_item_id === productionItemId &&
        (
          row.status !== "not_started" ||
          row.parent_deliverable_item_id != null ||
          row.tracking_reference != null ||
          row.delivered_at != null ||
          row.recipient_contact_id != null ||
          row.recipient_organization_id != null ||
          normalizeNullableText(row.notes) != null
        )
    ) ||
    aggregate.productionIssues.some((row) => row.production_item_id === productionItemId);
  if (hasDownstreamArtifacts) {
    throw new ApiError(400, "Validation failed", {
      field_errors: { branches: ["Split is only allowed before downstream approvals, QA, deliverables, handoffs, or issues exist."] },
      form_errors: []
    });
  }

  const [primaryBranch, ...secondaryBranches] = input.branches;
  const linkedShootIds = getProductionItemLinkedShootIds(aggregate, productionItemId);
  await client.query(
    `
      UPDATE production_items
      SET title = COALESCE($3, title),
          production_type = COALESCE($4, production_type),
          due_at = COALESCE($5, due_at),
          release_due_at = COALESCE($6, release_due_at),
          delivery_deadline_at = COALESCE($7, delivery_deadline_at),
          release_target = COALESCE($8, release_target),
          assigned_to_user_id = COALESCE($9, assigned_to_user_id),
          assigned_peer_reviewer_user_id = COALESCE($10, assigned_peer_reviewer_user_id),
          assigned_release_reviewer_user_id = COALESCE($11, assigned_release_reviewer_user_id),
          vendor_name = COALESCE($12, vendor_name),
          client_visible_label = COALESCE($13, client_visible_label),
          approval_required = COALESCE($14, approval_required),
          proof_required = COALESCE($15, proof_required),
          qa_required = COALESCE($16, qa_required),
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      auth.tenantId,
      productionItemId,
      normalizeNullableText(primaryBranch?.title),
      normalizeNullableText(primaryBranch?.production_type),
      primaryBranch?.due_at ?? null,
      primaryBranch?.release_due_at ?? null,
      primaryBranch?.delivery_deadline_at ?? null,
      normalizeNullableText(primaryBranch?.release_target),
      primaryBranch?.assigned_to_user_id ?? null,
      primaryBranch?.assigned_peer_reviewer_user_id ?? null,
      primaryBranch?.assigned_release_reviewer_user_id ?? null,
      normalizeNullableText(primaryBranch?.vendor_name),
      normalizeNullableText(primaryBranch?.client_visible_label),
      primaryBranch?.approval_required ?? null,
      primaryBranch?.proof_required ?? null,
      primaryBranch?.qa_required ?? null
    ]
  );

  const createdBranchIds: string[] = [];
  for (const branch of secondaryBranches) {
    const branchTitle = normalizeNullableText(branch.title) ?? `${item.title} ${createdBranchIds.length + 2}`;
    const branchProductionType = normalizeNullableText(branch.production_type) ?? item.production_type;
    const branchReleaseTarget = normalizeNullableText(branch.release_target) ?? item.release_target;
    const branchVendorName = normalizeNullableText(branch.vendor_name) ?? item.vendor_name;
    const branchPlan = buildProductionTemplatePlanForAggregate(aggregate, {
      ...item,
      title: branchTitle,
      production_type: branchProductionType,
      release_target: branchReleaseTarget,
      vendor_name: branchVendorName,
      proof_required: branch.proof_required ?? item.proof_required
    });
    const created = await client.query<{ id: string; title: string }>(
      `
        INSERT INTO production_items (
          tenant_id,
          job_id,
          job_day_id,
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
          escalation_owner_user_id,
          department_owner_user_id,
          organization_id,
          location_id,
          primary_contact_id,
          account_owner_user_id,
          department_type,
          approval_required,
          proof_required,
          qa_required,
          production_start_at,
          due_at,
          release_due_at,
          delivery_deadline_at,
          release_target,
          gallery_or_output_reference,
          file_count_expected,
          file_count_received,
          file_match_status,
          handoff_complete,
          roster_received,
          naming_verified,
          folder_structure_verified,
          tags_or_flags_verified,
          blocked_reason,
          vendor_name,
          vendor_reference,
          client_visible_label,
          internal_notes,
          production_notes,
          post_shoot_eval_summary,
          legacy_source_reference,
          imported_status_source,
          legacy_owner_history_json,
          hold_reason,
          hold_owner_user_id,
          hold_review_at,
          qa_status
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11::job_production_status_type,
          $12::production_board_workflow_status_type,
          $13::production_board_health_state_type,
          $14::production_board_sync_state_type,
          $15::job_priority_level,
          $16,$17,$18,$19,$20,$21,$22,$23,$24,
          $25::job_department_type,
          $26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,
          $37::production_board_file_match_status_type,
          $38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56
        )
        RETURNING id::text AS id, title
      `,
      [
        auth.tenantId,
        jobId,
        item.job_day_id,
        `${item.production_group_key}:${Date.now()}:${createdBranchIds.length + 1}`,
        branchTitle,
        item.job_type,
        branchProductionType,
        branchPlan.templateKey,
        branchPlan.completionRuleKey,
        "split",
        item.status,
        item.workflow_status,
        item.health_state,
        item.sync_state,
        item.priority,
        branch.assigned_to_user_id ?? item.assigned_to_user_id,
        branch.assigned_peer_reviewer_user_id ?? item.assigned_peer_reviewer_user_id,
        branch.assigned_release_reviewer_user_id ?? item.assigned_release_reviewer_user_id,
        item.escalation_owner_user_id,
        item.department_owner_user_id,
        item.organization_id,
        item.location_id,
        item.primary_contact_id,
        item.account_owner_user_id,
        item.department_type,
        branch.approval_required ?? item.approval_required,
        branch.proof_required ?? item.proof_required,
        branch.qa_required ?? item.qa_required,
        normalizeTimestamp(item.production_start_at),
        branch.due_at ?? normalizeTimestamp(item.due_at),
        branch.release_due_at ?? normalizeTimestamp(item.release_due_at),
        branch.delivery_deadline_at ?? normalizeTimestamp(item.delivery_deadline_at),
        branchReleaseTarget,
        item.gallery_or_output_reference,
        item.file_count_expected,
        item.file_count_received,
        item.file_match_status,
        item.handoff_complete,
        item.roster_received,
        item.naming_verified,
        item.folder_structure_verified,
        item.tags_or_flags_verified,
        item.blocked_reason,
        branchVendorName,
        item.vendor_reference,
        normalizeNullableText(branch.client_visible_label) ?? item.client_visible_label,
        item.internal_notes,
        item.production_notes,
        item.post_shoot_eval_summary,
        item.legacy_source_reference,
        item.imported_status_source,
        item.legacy_owner_history_json,
        item.hold_reason,
        item.hold_owner_user_id,
        normalizeTimestamp(item.hold_review_at),
        item.qa_status
      ]
    );
    const createdId = created.rows[0]?.id;
    if (createdId) {
      createdBranchIds.push(createdId);
      await linkShootIdsToProductionItem(client, auth.tenantId, createdId, linkedShootIds);
      await writeJobActivity(client, {
        tenantId: auth.tenantId,
        actorUserId: auth.id,
        jobId,
        productionItemId: createdId,
        eventType: "production_item_created",
        summary: `${created.rows[0].title}: created from split`,
        metadata: { split_from_production_item_id: productionItemId }
      });
    }
  }

  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId,
    productionItemId,
    eventType: "production_item_split",
    summary: `${item.title}: split into ${input.branches.length} production items`,
    metadata: {
      created_branch_ids: createdBranchIds,
      linked_shoot_ids: linkedShootIds,
      note: normalizeNullableText(input.note)
    }
  });

  return refreshJobAfterOperationalMutation(client, auth, jobId);
}

export async function createOrUpdateProductionHandoff(
  client: PoolClient,
  auth: AuthUser,
  jobId: string,
  productionItemId: string,
  input: Partial<ProductionHandoffRecord> & { id?: string | null }
) {
  const aggregate = await loadAndGuard(client, auth, jobId);
  const item = findProductionItem(aggregate, productionItemId);
  requireProductionItemMutationAccess(auth, aggregate, productionItemId);
  if (!input.id && (!normalizeNullableText(input.handoff_type) || !normalizeNullableText(input.from_stage) || !normalizeNullableText(input.to_stage))) {
    throw new ApiError(400, "Validation failed", {
      field_errors: {
        handoff_type: ["Handoff type is required."],
        from_stage: ["From stage is required."],
        to_stage: ["To stage is required."]
      },
      form_errors: []
    });
  }
  if (input.id) {
    const existing = aggregate.productionHandoffs.find((handoff) => handoff.id === input.id && handoff.production_item_id === productionItemId);
    if (!existing) {
      throw new ApiError(404, "Production handoff not found");
    }
    await client.query(
      `
        UPDATE production_handoffs
        SET handoff_type = COALESCE($3, handoff_type),
            from_stage = COALESCE($4, from_stage),
            to_stage = COALESCE($5, to_stage),
            from_user_id = COALESCE($6, from_user_id),
            to_user_id = COALESCE($7, to_user_id),
            status = COALESCE($8::job_handoff_status_type, status),
            note = COALESCE($9, note),
            completed_at = CASE WHEN $8 = 'completed' THEN now() ELSE completed_at END
        WHERE tenant_id = $1
          AND id = $2
      `,
      [
        auth.tenantId,
        input.id,
        normalizeNullableText(input.handoff_type),
        normalizeNullableText(input.from_stage),
        normalizeNullableText(input.to_stage),
        input.from_user_id ?? null,
        input.to_user_id ?? null,
        input.status ?? null,
        normalizeNullableText(input.note)
      ]
    );
  } else {
    await client.query(
      `
        INSERT INTO production_handoffs (
          tenant_id,
          production_item_id,
          handoff_type,
          from_stage,
          to_stage,
          from_user_id,
          to_user_id,
          status,
          note,
          completed_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::job_handoff_status_type,$9,CASE WHEN $8 = 'completed' THEN now() ELSE null END)
      `,
      [
        auth.tenantId,
        productionItemId,
        normalizeNullableText(input.handoff_type),
        normalizeNullableText(input.from_stage),
        normalizeNullableText(input.to_stage),
        input.from_user_id ?? auth.id,
        input.to_user_id ?? null,
        input.status ?? "pending",
        normalizeNullableText(input.note)
      ]
    );
  }
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId,
    productionItemId,
    eventType: input.id ? "production_handoff_updated" : "production_handoff_created",
    summary: `${item.title}: ${normalizeNullableText(input.to_stage) ?? "handoff updated"}`,
    metadata: {
      handoff_type: normalizeNullableText(input.handoff_type),
      from_stage: normalizeNullableText(input.from_stage),
      to_stage: normalizeNullableText(input.to_stage),
      status: input.status ?? null
    }
  });
  return refreshJobAfterOperationalMutation(client, auth, jobId);
}

export async function createOrUpdateApprovalRequest(
  client: PoolClient,
  auth: AuthUser,
  jobId: string,
  productionItemId: string,
  input: Partial<ApprovalRequestRecord> & { id?: string | null; log_follow_up?: boolean | null }
) {
  const aggregate = await loadAndGuard(client, auth, jobId);
  const item = findProductionItem(aggregate, productionItemId);
  requireProductionItemMutationAccess(auth, aggregate, productionItemId);
  if (!input.id && !normalizeNullableText(input.approval_type)) {
    throw new ApiError(400, "Validation failed", {
      field_errors: { approval_type: ["Approval type is required."] },
      form_errors: []
    });
  }
  const nextStatus = input.status ?? (input.id ? undefined : "requested");
  if (input.id) {
    const existing = aggregate.approvalRequests.find((request) => request.id === input.id && request.production_item_id === productionItemId);
    if (!existing) {
      throw new ApiError(404, "Approval request not found");
    }
    await client.query(
      `
        UPDATE approval_requests
        SET job_day_id = COALESCE($3, job_day_id),
            approval_type = COALESCE($4, approval_type),
            approver_contact_id = COALESCE($5, approver_contact_id),
            approver_user_id = COALESCE($6, approver_user_id),
            status = COALESCE($7::job_approval_status_type, status),
            requested_at = CASE WHEN $7 = 'requested' THEN COALESCE(requested_at, now()) ELSE requested_at END,
            viewed_at = CASE WHEN $7 = 'viewed' THEN now() ELSE viewed_at END,
            approved_at = CASE WHEN $7 = 'approved' THEN now() ELSE approved_at END,
            rejected_at = CASE WHEN $7 = 'rejected' THEN now() ELSE rejected_at END,
            revision_requested_at = CASE WHEN $7 = 'revisions_requested' THEN now() ELSE revision_requested_at END,
            revision_count = CASE WHEN $7 = 'revisions_requested' THEN revision_count + 1 ELSE revision_count END,
            due_at = COALESCE($8, due_at),
            last_follow_up_at = CASE WHEN $9 THEN now() ELSE last_follow_up_at END,
            summary = COALESCE($10, summary),
            notes = COALESCE($11, notes),
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [
        auth.tenantId,
        input.id,
        input.job_day_id ?? null,
        normalizeNullableText(input.approval_type),
        input.approver_contact_id ?? null,
        input.approver_user_id ?? null,
        nextStatus ?? null,
        input.due_at ?? null,
        input.log_follow_up ?? false,
        normalizeNullableText(input.summary),
        normalizeNullableText(input.notes)
      ]
    );
  } else {
    await client.query(
      `
        INSERT INTO approval_requests (
          tenant_id,
          production_item_id,
          job_id,
          job_day_id,
          approval_type,
          approver_contact_id,
          approver_user_id,
          status,
          requested_at,
          viewed_at,
          approved_at,
          rejected_at,
          revision_requested_at,
          due_at,
          last_follow_up_at,
          revision_count,
          summary,
          notes
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8::job_approval_status_type,
          CASE WHEN $8 = 'requested' THEN now() ELSE null END,
          CASE WHEN $8 = 'viewed' THEN now() ELSE null END,
          CASE WHEN $8 = 'approved' THEN now() ELSE null END,
          CASE WHEN $8 = 'rejected' THEN now() ELSE null END,
          CASE WHEN $8 = 'revisions_requested' THEN now() ELSE null END,
          $9,
          CASE WHEN $10 THEN now() ELSE null END,
          CASE WHEN $8 = 'revisions_requested' THEN 1 ELSE 0 END,
          $11,
          $12
        )
      `,
      [
        auth.tenantId,
        productionItemId,
        jobId,
        input.job_day_id ?? null,
        normalizeNullableText(input.approval_type),
        input.approver_contact_id ?? null,
        input.approver_user_id ?? null,
        nextStatus ?? "requested",
        input.due_at ?? null,
        input.log_follow_up ?? false,
        normalizeNullableText(input.summary),
        normalizeNullableText(input.notes)
      ]
    );
  }
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId,
    productionItemId,
    eventType: input.id ? "approval_request_updated" : "approval_request_created",
    summary: `${item.title}: approval ${normalizeNullableText(input.approval_type) ?? "updated"}`,
    metadata: {
      approval_type: normalizeNullableText(input.approval_type),
      status: nextStatus ?? null,
      due_at: input.due_at ?? null
    }
  });
  return refreshJobAfterOperationalMutation(client, auth, jobId);
}

export async function createOrUpdateQaReview(
  client: PoolClient,
  auth: AuthUser,
  jobId: string,
  productionItemId: string,
  input: Partial<QaReviewRecord> & { id?: string | null }
) {
  const aggregate = await loadAndGuard(client, auth, jobId);
  const item = findProductionItem(aggregate, productionItemId);
  requireProductionItemMutationAccess(auth, aggregate, productionItemId);

  const existing = input.id ? aggregate.qaReviews.find((review) => review.id === input.id && review.production_item_id === productionItemId) : null;
  if (input.id && !existing) {
    throw new ApiError(404, "QA review not found");
  }

  const nextReviewType = normalizeNullableText(input.review_type) ?? existing?.review_type ?? null;
  const nextReviewStageRaw = normalizeNullableText(input.review_stage) ?? existing?.review_stage ?? null;
  const reviewerUserId = input.reviewer_user_id ?? existing?.reviewer_user_id ?? null;
  const nextStatus = input.status ?? (input.id ? undefined : "queued");
  const persistedStatus = nextStatus ?? existing?.status ?? "queued";
  const nextReviewStage = isProductionQaGateKey(nextReviewStageRaw) ? nextReviewStageRaw : null;
  const nextSampleSizeRaw = input.sample_size_percent ?? existing?.sample_size_percent ?? null;
  const nextSampleSize =
    nextReviewStage === "intake_qc" && nextSampleSizeRaw == null ? 100 : nextSampleSizeRaw;
  const nextChecklistTemplateKey = normalizeNullableText(input.checklist_template_key) ?? existing?.checklist_template_key ?? null;
  const nextNotes = normalizeNullableText(input.notes) ?? existing?.notes ?? null;
  const nextDecisionReason = normalizeNullableText(input.decision_reason) ?? existing?.decision_reason ?? null;
  const nextIssueCategory = normalizeNullableText(input.issue_category) ?? existing?.issue_category ?? null;
  const questionAnswers =
    input.question_answers_json !== undefined
      ? normalizeQaQuestionAnswers((input.question_answers_json as Record<string, unknown> | null | undefined) ?? null)
      : normalizeQaQuestionAnswers((existing?.question_answers_json as Record<string, unknown> | null | undefined) ?? null);
  const reviewDecisionFromAnswers = questionAnswers.next_stage_decision === "approve" ? "approve" : questionAnswers.next_stage_decision;
  const nextDecision = normalizeNullableText(input.decision) ?? reviewDecisionFromAnswers ?? existing?.decision ?? null;
  const nextReworkRequired = input.rework_required ?? existing?.rework_required ?? false;
  const originalOwnerUserId = existing?.original_owner_user_id ?? item.assigned_to_user_id ?? null;
  const sendBackAssignee = input.sent_back_to_user_id ?? existing?.sent_back_to_user_id ?? originalOwnerUserId ?? item.assigned_to_user_id ?? null;
  const overrideSameReviewer = input.override_same_reviewer ?? existing?.override_same_reviewer ?? false;
  const overrideReason = normalizeNullableText(input.override_reason) ?? existing?.override_reason ?? null;

  if (!input.id && (!nextReviewType || !nextReviewStageRaw || !reviewerUserId)) {
    throw new ApiError(400, "Validation failed", {
      field_errors: {
        review_type: ["Review type is required."],
        review_stage: ["Review stage is required."],
        reviewer_user_id: ["Reviewer is required."]
      },
      form_errors: []
    });
  }
  if (nextReviewStageRaw && !nextReviewStage) {
    throw new ApiError(400, "Validation failed", {
      field_errors: {
        review_stage: ["Review stage must be intake_qc, creator_review, peer_review, or final_release_review."]
      },
      form_errors: []
    });
  }
  if (!reviewerUserId) {
    throw new ApiError(400, "Validation failed", {
      field_errors: {
        reviewer_user_id: ["Reviewer is required."]
      },
      form_errors: []
    });
  }

  const failedReview = Boolean((nextStatus != null && QA_FAIL_STATUSES.has(nextStatus)) || nextReworkRequired);
  const passedReview = Boolean(nextStatus != null && QA_PASS_STATUSES.has(nextStatus));
  const activePeerReview = nextStatus === "in_review" && nextReviewStage === "peer_review";
  const samePeerReviewerAsOwner = nextReviewStage === "peer_review" && originalOwnerUserId != null && reviewerUserId === originalOwnerUserId;
  if (samePeerReviewerAsOwner) {
    if (!overrideSameReviewer) {
      throw new ApiError(400, "Validation failed", {
        field_errors: {
          reviewer_user_id: ["Peer reviewer must be different from the original owner unless override is explicitly approved."],
          override_same_reviewer: ["Peer self-review requires an override."]
        },
        form_errors: []
      });
    }
    if (!canOverrideQaSelfReview(auth, aggregate, item)) {
      throw new ApiError(403, "Forbidden");
    }
    if (!overrideReason) {
      throw new ApiError(400, "Validation failed", {
        field_errors: {
          override_reason: ["Peer self-review override requires a reason."]
        },
        form_errors: []
      });
    }
  }

  const latestCreatorReview = getLatestQaReviewForStage(aggregate.qaReviews, "creator_review", productionItemId);
  const latestPeerReview = getLatestQaReviewForStage(aggregate.qaReviews, "peer_review", productionItemId);
  const creatorGateSatisfied =
    item.creator_review_complete || Boolean(latestCreatorReview && QA_PASS_STATUSES.has(latestCreatorReview.status));
  const peerGateSatisfied =
    item.peer_review_complete || Boolean(latestPeerReview && QA_PASS_STATUSES.has(latestPeerReview.status));

  if (nextReviewStage === "peer_review" && requiresQaDecisionValidation(nextStatus, nextReworkRequired) && !creatorGateSatisfied) {
    throw new ApiError(400, "Creator review must pass before peer review can be completed.");
  }
  if (nextReviewStage === "final_release_review" && requiresQaDecisionValidation(nextStatus, nextReworkRequired) && !peerGateSatisfied) {
    throw new ApiError(400, "Peer review must pass before final release review can be completed.");
  }
  if (
    nextReviewStage === "final_release_review" &&
    requiresQaDecisionValidation(nextStatus, nextReworkRequired) &&
    !["UPLOADED", "VERIFIED"].includes(item.upload_status) &&
    !["UPLOADED", "READY_FOR_RELEASE", "RELEASED", "SENT_TO_VENDOR"].includes(item.workflow_status)
  ) {
    throw new ApiError(400, "Upload must be verified before final release review can be completed.");
  }

  if (nextReviewStage && requiresQaDecisionValidation(nextStatus, nextReworkRequired)) {
    const minimumSampleSize = getProductionQaMinimumSamplePercent(nextReviewStage, isLargeProductionJob(aggregate, item));
    if (nextSampleSize == null || nextSampleSize < minimumSampleSize) {
      throw new ApiError(400, "Validation failed", {
        field_errors: {
          sample_size_percent: [`${humanizeQaStage(nextReviewStage)} requires at least a ${minimumSampleSize}% review sample.`]
        },
        form_errors: []
      });
    }

    const missingQuestionKeys = [
      questionAnswers.files_complete_storage == null ? "files_complete_storage" : null,
      questionAnswers.color_density_consistency == null ? "color_density_consistency" : null,
      questionAnswers.sorting_and_roster_accuracy == null ? "sorting_and_roster_accuracy" : null,
      questionAnswers.template_price_release_accuracy == null ? "template_price_release_accuracy" : null,
      questionAnswers.next_stage_decision == null ? "next_stage_decision" : null
    ].filter((value): value is string => value != null);

    if (missingQuestionKeys.length) {
      throw new ApiError(400, "Validation failed", {
        field_errors: {
          question_answers_json: ["All five QA review questions must be answered before submitting this review."]
        },
        form_errors: []
      });
    }

    if (passedReview) {
      if (questionAnswers.next_stage_decision !== "approve") {
        throw new ApiError(400, "Validation failed", {
          field_errors: {
            question_answers_json: ["Approved reviews must confirm approval for the next stage."]
          },
          form_errors: []
        });
      }
      if (
        questionAnswers.files_complete_storage !== true ||
        questionAnswers.color_density_consistency !== true ||
        questionAnswers.sorting_and_roster_accuracy !== true ||
        questionAnswers.template_price_release_accuracy !== true
      ) {
        throw new ApiError(400, "Validation failed", {
          field_errors: {
            question_answers_json: ["All required QA checks must pass before approving the next stage."]
          },
          form_errors: []
        });
      }
    }

    if (failedReview) {
      if (!["send_back", "rework", "rework_required"].includes(questionAnswers.next_stage_decision ?? "")) {
        throw new ApiError(400, "Validation failed", {
          field_errors: {
            question_answers_json: ["Send-back reviews must explicitly mark the item for rework."]
          },
          form_errors: []
        });
      }
      if (!nextDecisionReason) {
        throw new ApiError(400, "Validation failed", {
          field_errors: {
            decision_reason: ["Send-back requires a reason."]
          },
          form_errors: []
        });
      }
      if (!nextIssueCategory) {
        throw new ApiError(400, "Validation failed", {
          field_errors: {
            issue_category: ["Send-back requires an issue category."]
          },
          form_errors: []
        });
      }
    }
  }

  const accountabilityPeerReview =
    nextReviewStage === "final_release_review" && failedReview && latestPeerReview && QA_PASS_STATUSES.has(latestPeerReview.status)
      ? latestPeerReview
      : null;
  const accountabilityStageKey =
    accountabilityPeerReview != null ? "peer_review" : existing?.accountability_stage_key ?? null;
  const accountableOwnerUserId =
    accountabilityPeerReview != null
      ? originalOwnerUserId ?? accountabilityPeerReview.original_owner_user_id ?? item.assigned_to_user_id ?? null
      : existing?.accountable_owner_user_id ?? null;
  const accountableReviewerUserId =
    accountabilityPeerReview != null ? accountabilityPeerReview.reviewer_user_id : existing?.accountable_reviewer_user_id ?? null;

  const reviewId =
    input.id ??
    (
      await client.query<{ id: string }>(
        `
          INSERT INTO qa_review_records (
            tenant_id,
            production_item_id,
            job_id,
            review_type,
            review_stage,
            reviewer_user_id,
            requested_by_user_id,
            status,
            decision,
            reviewed_at,
            sample_size_percent,
            checklist_template_key,
            question_answers_json,
            notes,
            decision_reason,
            issue_category,
            rework_required,
            sent_back_to_user_id,
            override_same_reviewer,
            override_reason,
            original_owner_user_id,
            accountability_stage_key,
            accountable_owner_user_id,
            accountable_reviewer_user_id
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8::job_qa_review_status_type,$9,
            CASE WHEN $8 IN ('passed','passed_with_notes','failed','complete','rework_in_progress','recheck_required') THEN now() ELSE null END,
            $10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
          )
          RETURNING id
        `,
        [
          auth.tenantId,
          productionItemId,
          jobId,
          nextReviewType,
          nextReviewStageRaw,
          reviewerUserId,
          auth.id,
          nextStatus ?? "queued",
          nextDecision,
          nextSampleSize,
          nextChecklistTemplateKey,
          JSON.stringify(questionAnswers),
          nextNotes,
          nextDecisionReason,
          nextIssueCategory,
          nextReworkRequired,
          sendBackAssignee,
          overrideSameReviewer,
          overrideReason,
          originalOwnerUserId,
          accountabilityStageKey,
          accountableOwnerUserId,
          accountableReviewerUserId
        ]
      )
    ).rows[0]?.id ??
    null;

  if (!reviewId) {
    throw new ApiError(500, "QA review could not be saved");
  }

  if (input.id) {
    await client.query(
      `
        UPDATE qa_review_records
        SET review_type = COALESCE($3, review_type),
            review_stage = COALESCE($4, review_stage),
            reviewer_user_id = COALESCE($5, reviewer_user_id),
            status = COALESCE($6::job_qa_review_status_type, status),
            decision = COALESCE($7, decision),
            reviewed_at = CASE
              WHEN $6 IN ('passed','passed_with_notes','failed','complete','rework_in_progress','recheck_required') THEN now()
              ELSE reviewed_at
            END,
            sample_size_percent = COALESCE($8, sample_size_percent),
            checklist_template_key = COALESCE($9, checklist_template_key),
            question_answers_json = COALESCE($10::jsonb, question_answers_json),
            notes = COALESCE($11, notes),
            decision_reason = COALESCE($12, decision_reason),
            issue_category = COALESCE($13, issue_category),
            rework_required = COALESCE($14, rework_required),
            sent_back_to_user_id = COALESCE($15, sent_back_to_user_id),
            override_same_reviewer = COALESCE($16, override_same_reviewer),
            override_reason = COALESCE($17, override_reason),
            original_owner_user_id = COALESCE($18, original_owner_user_id),
            accountability_stage_key = COALESCE($19, accountability_stage_key),
            accountable_owner_user_id = COALESCE($20, accountable_owner_user_id),
            accountable_reviewer_user_id = COALESCE($21, accountable_reviewer_user_id),
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [
        auth.tenantId,
        reviewId,
        nextReviewType,
        nextReviewStageRaw,
        reviewerUserId,
        nextStatus ?? null,
        nextDecision,
        nextSampleSize,
        nextChecklistTemplateKey,
        input.question_answers_json !== undefined ? JSON.stringify(questionAnswers) : null,
        nextNotes,
        nextDecisionReason,
        nextIssueCategory,
        input.rework_required ?? null,
        input.sent_back_to_user_id ?? null,
        input.override_same_reviewer ?? null,
        input.override_reason !== undefined ? overrideReason : null,
        originalOwnerUserId,
        accountabilityStageKey,
        accountableOwnerUserId,
        accountableReviewerUserId
      ]
    );
  }

  const creatorReviewPassed = nextReviewStage === "creator_review" && passedReview;
  const creatorReviewFailed = nextReviewStage === "creator_review" && failedReview;
  const peerReviewPassed = nextReviewStage === "peer_review" && passedReview;
  const peerReviewFailed = nextReviewStage === "peer_review" && failedReview;
  const finalReviewPassed = nextReviewStage === "final_release_review" && passedReview;
  const finalReviewFailed = nextReviewStage === "final_release_review" && failedReview;
  const intakeReviewPassed = nextReviewStage === "intake_qc" && passedReview;
  const intakeReviewFailed = nextReviewStage === "intake_qc" && failedReview;
  const creatorReviewInProgress = nextReviewStage === "creator_review" && nextStatus === "in_review";
  const finalReviewInProgress = nextReviewStage === "final_release_review" && nextStatus === "in_review";

  await client.query(
    `
      UPDATE production_items
      SET qa_required = true,
          qa_status = COALESCE($3, qa_status),
          status = CASE
            WHEN COALESCE($4, false)
              THEN 'revisions_requested'::job_production_status_type
            WHEN COALESCE($5, false)
              THEN 'ingest_complete'::job_production_status_type
            WHEN COALESCE($6, false)
              THEN 'awaiting_internal_review'::job_production_status_type
            WHEN COALESCE($7, false)
              THEN 'approved_for_final'::job_production_status_type
            WHEN COALESCE($8, false)
              THEN 'approved_for_final'::job_production_status_type
            ELSE status
          END,
          workflow_status = CASE
            WHEN COALESCE($4, false)
              THEN 'REWORK_REQUIRED'::production_board_workflow_status_type
            WHEN COALESCE($5, false)
              THEN 'READY_FOR_PRODUCTION'::production_board_workflow_status_type
            WHEN COALESCE($6, false)
              THEN 'READY_FOR_QA'::production_board_workflow_status_type
            WHEN COALESCE($7, false)
              THEN 'READY_FOR_UPLOAD'::production_board_workflow_status_type
            WHEN COALESCE($8, false)
              THEN CASE
                WHEN release_status = 'RELEASED'::production_board_release_status_type
                  THEN 'RELEASED'::production_board_workflow_status_type
                WHEN release_status = 'SENT_TO_VENDOR'::production_board_release_status_type
                  THEN 'SENT_TO_VENDOR'::production_board_workflow_status_type
                ELSE 'READY_FOR_RELEASE'::production_board_workflow_status_type
              END
            WHEN COALESCE($9, false)
              THEN 'IN_PEER_REVIEW'::production_board_workflow_status_type
            WHEN COALESCE($10, false)
              THEN 'IN_PRODUCTION'::production_board_workflow_status_type
            WHEN COALESCE($11, false)
              THEN 'UPLOADED'::production_board_workflow_status_type
            ELSE workflow_status
          END,
          creator_review_complete = CASE
            WHEN COALESCE($12, false) THEN false
            WHEN COALESCE($13, false) THEN true
            ELSE creator_review_complete
          END,
          peer_review_complete = CASE
            WHEN COALESCE($14, false) THEN false
            WHEN COALESCE($15, false) THEN true
            ELSE peer_review_complete
          END,
          final_release_review_complete = CASE
            WHEN COALESCE($16, false) THEN false
            WHEN COALESCE($17, false) THEN true
            ELSE final_release_review_complete
          END,
          first_pass_approved = CASE
            WHEN COALESCE($14, false) THEN false
            WHEN COALESCE($15, false) AND qa_fail_count = 0 THEN true
            ELSE first_pass_approved
          END,
          rework_count = CASE WHEN COALESCE($4, false) THEN rework_count + 1 ELSE rework_count END,
          qa_fail_count = CASE WHEN COALESCE($4, false) THEN qa_fail_count + 1 ELSE qa_fail_count END,
          assigned_to_user_id = CASE WHEN COALESCE($4, false) THEN COALESCE($18, assigned_to_user_id) ELSE assigned_to_user_id END,
          assigned_peer_reviewer_user_id = CASE
            WHEN $19 = 'peer_review' THEN COALESCE($20, assigned_peer_reviewer_user_id)
            ELSE assigned_peer_reviewer_user_id
          END,
          assigned_release_reviewer_user_id = CASE
            WHEN $19 = 'final_release_review' THEN COALESCE($20, assigned_release_reviewer_user_id)
            ELSE assigned_release_reviewer_user_id
          END,
          release_status = CASE
            WHEN COALESCE($17, false) AND release_status = 'PENDING_REVIEW'::production_board_release_status_type
              THEN 'READY_FOR_RELEASE'::production_board_release_status_type
            ELSE release_status
          END,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [
      auth.tenantId,
      productionItemId,
      nextStatus ?? null,
      failedReview,
      intakeReviewPassed,
      creatorReviewPassed,
      peerReviewPassed,
      finalReviewPassed,
      activePeerReview,
      creatorReviewInProgress,
      finalReviewInProgress,
      creatorReviewFailed || intakeReviewFailed,
      creatorReviewPassed,
      peerReviewFailed,
      peerReviewPassed,
      finalReviewFailed,
      finalReviewPassed,
      sendBackAssignee,
      nextReviewStageRaw,
      reviewerUserId
    ]
  );

  if (failedReview) {
    const existingOpenFinding = aggregate.qaFindings.find(
      (finding) =>
        finding.qa_review_record_id === reviewId &&
        !finding.resolved_at &&
        normalizeNullableText(finding.finding_type) === (nextIssueCategory ?? "qa_rework")
    );
    if (!existingOpenFinding) {
      await client.query(
        `
          INSERT INTO qa_review_findings (
            tenant_id,
            qa_review_record_id,
            finding_type,
            severity,
            title,
            description,
            is_blocking
          )
          VALUES ($1,$2,$3,$4::job_watch_flag_severity_type,$5,$6,$7)
        `,
        [
          auth.tenantId,
          reviewId,
          nextIssueCategory ?? "qa_rework",
          nextReviewStage === "final_release_review" ? "high" : "medium",
          `${humanizeQaStage(nextReviewStage)} ${nextIssueCategory ? `| ${humanizeQaStage(nextIssueCategory)}` : "| Rework required"}`,
          nextDecisionReason ?? "Review sent this production item back for rework.",
          true
        ]
      );
    }
  }

  if (passedReview) {
    await client.query(
      `
        UPDATE qa_review_findings
        SET resolved_at = COALESCE(resolved_at, now()),
            resolved_by_user_id = COALESCE(resolved_by_user_id, $3)
        WHERE tenant_id = $1
          AND qa_review_record_id = $2
          AND resolved_at IS NULL
      `,
      [auth.tenantId, reviewId, auth.id]
    );
  }

  if (samePeerReviewerAsOwner && overrideSameReviewer) {
    await writeJobActivity(client, {
      tenantId: auth.tenantId,
      actorUserId: auth.id,
      jobId,
      productionItemId,
      eventType: "qa_self_review_override",
      summary: `${item.title}: peer self-review override approved`,
      metadata: {
        qa_review_id: reviewId,
        review_stage: nextReviewStageRaw,
        reviewer_user_id: reviewerUserId,
        original_owner_user_id: originalOwnerUserId,
        override_reason: overrideReason
      }
    });
  }

  let eventType = input.id ? "qa_review_updated" : "qa_review_requested";
  if (nextStatus === "in_review") {
    eventType = "qa_review_started";
  } else if (failedReview) {
    eventType = "qa_review_sent_back";
  } else if (passedReview) {
    eventType = "qa_review_passed";
  }

  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId,
    productionItemId,
    eventType,
    summary: `${item.title}: ${humanizeQaStage(nextReviewStage)} ${failedReview ? "sent back" : passedReview ? "approved" : "updated"}`,
    metadata: {
      qa_review_id: reviewId,
      review_type: nextReviewType,
      review_stage: nextReviewStageRaw,
      reviewer_user_id: reviewerUserId,
      status: nextStatus ?? existing?.status ?? null,
      decision: nextDecision,
      decision_reason: nextDecisionReason,
      issue_category: nextIssueCategory,
      rework_required: nextReworkRequired,
      override_same_reviewer: overrideSameReviewer,
      override_reason: overrideReason,
      original_owner_user_id: originalOwnerUserId,
      accountable_owner_user_id: accountableOwnerUserId,
      accountable_reviewer_user_id: accountableReviewerUserId,
      accountability_stage_key: accountabilityStageKey
    },
    oldValues: existing
      ? {
          status: existing.status,
          decision: existing.decision,
          decision_reason: existing.decision_reason,
          issue_category: existing.issue_category
        }
      : null,
    newValues: {
      status: nextStatus ?? existing?.status ?? null,
      decision: nextDecision,
      decision_reason: nextDecisionReason,
      issue_category: nextIssueCategory
    }
  });
  return refreshJobAfterOperationalMutation(client, auth, jobId);
}

export async function createOrUpdateQaFinding(
  client: PoolClient,
  auth: AuthUser,
  jobId: string,
  productionItemId: string,
  qaReviewId: string,
  input: Partial<QaReviewFindingRecord> & { id?: string | null; resolve?: boolean | null }
) {
  const aggregate = await loadAndGuard(client, auth, jobId);
  const item = findProductionItem(aggregate, productionItemId);
  requireProductionItemMutationAccess(auth, aggregate, productionItemId);
  const review = aggregate.qaReviews.find((entry) => entry.id === qaReviewId && entry.production_item_id === productionItemId);
  if (!review) {
    throw new ApiError(404, "QA review not found");
  }
  if (!input.id && (!normalizeNullableText(input.title) || !normalizeNullableText(input.finding_type))) {
    throw new ApiError(400, "Validation failed", {
      field_errors: {
        title: ["Finding title is required."],
        finding_type: ["Finding type is required."]
      },
      form_errors: []
    });
  }
  if (input.id) {
    const existing = aggregate.qaFindings.find((finding) => finding.id === input.id && finding.qa_review_record_id === qaReviewId);
    if (!existing) {
      throw new ApiError(404, "QA finding not found");
    }
    await client.query(
      `
        UPDATE qa_review_findings
        SET finding_type = COALESCE($3, finding_type),
            severity = COALESCE($4::job_watch_flag_severity_type, severity),
            title = COALESCE($5, title),
            description = COALESCE($6, description),
            is_blocking = COALESCE($7, is_blocking),
            resolved_at = CASE WHEN $8 THEN now() ELSE resolved_at END,
            resolved_by_user_id = CASE WHEN $8 THEN $9 ELSE resolved_by_user_id END
        WHERE tenant_id = $1
          AND id = $2
      `,
      [
        auth.tenantId,
        input.id,
        normalizeNullableText(input.finding_type),
        input.severity ?? null,
        normalizeNullableText(input.title),
        normalizeNullableText(input.description),
        input.is_blocking ?? null,
        input.resolve ?? false,
        auth.id
      ]
    );
  } else {
    await client.query(
      `
        INSERT INTO qa_review_findings (
          tenant_id,
          qa_review_record_id,
          finding_type,
          severity,
          title,
          description,
          is_blocking
        )
        VALUES ($1,$2,$3,$4::job_watch_flag_severity_type,$5,$6,$7)
      `,
      [
        auth.tenantId,
        qaReviewId,
        normalizeNullableText(input.finding_type),
        input.severity ?? "medium",
        normalizeNullableText(input.title),
        normalizeNullableText(input.description) ?? "",
        input.is_blocking ?? false
      ]
    );
  }
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId,
    productionItemId,
    eventType: input.id ? "qa_finding_updated" : "qa_finding_created",
    summary: `${item.title}: ${normalizeNullableText(input.title) ?? "QA finding updated"}`,
    metadata: {
      qa_review_id: qaReviewId,
      finding_type: normalizeNullableText(input.finding_type),
      severity: input.severity ?? null,
      resolve: input.resolve ?? false
    }
  });
  return refreshJobAfterOperationalMutation(client, auth, jobId);
}

export async function createOrUpdateDeliverableItem(
  client: PoolClient,
  auth: AuthUser,
  jobId: string,
  productionItemId: string,
  input: Partial<DeliverableItemRecord> & { id?: string | null }
) {
  const aggregate = await loadAndGuard(client, auth, jobId);
  const item = findProductionItem(aggregate, productionItemId);
  requireProductionItemMutationAccess(auth, aggregate, productionItemId);
  if (!input.id && (!normalizeNullableText(input.deliverable_type) || !normalizeNullableText(input.title))) {
    throw new ApiError(400, "Validation failed", {
      field_errors: {
        deliverable_type: ["Deliverable type is required."],
        title: ["Deliverable title is required."]
      },
      form_errors: []
    });
  }
  if (input.id) {
    const existing = aggregate.deliverableItems.find((deliverable) => deliverable.id === input.id && deliverable.production_item_id === productionItemId);
    if (!existing) {
      throw new ApiError(404, "Deliverable item not found");
    }
    await client.query(
      `
        UPDATE deliverable_items
        SET parent_deliverable_item_id = COALESCE($3, parent_deliverable_item_id),
            deliverable_type = COALESCE($4, deliverable_type),
            deliverable_group_key = COALESCE($5, deliverable_group_key),
            completion_marker_key = COALESCE($6, completion_marker_key),
            title = COALESCE($7, title),
            quantity = COALESCE($8, quantity),
            delivery_method = COALESCE($9, delivery_method),
            status = COALESCE($10::job_deliverable_status_type, status),
            vendor_name = COALESCE($11, vendor_name),
            tracking_reference = COALESCE($12, tracking_reference),
            delivered_at = CASE WHEN $10 IN ('delivered', 'confirmed') THEN now() ELSE delivered_at END,
            recipient_contact_id = COALESCE($13, recipient_contact_id),
            recipient_organization_id = COALESCE($14, recipient_organization_id),
            notes = COALESCE($15, notes),
            legacy_source_reference = COALESCE($16, legacy_source_reference),
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [
        auth.tenantId,
        input.id,
        input.parent_deliverable_item_id ?? null,
        normalizeNullableText(input.deliverable_type),
        normalizeNullableText(input.deliverable_group_key),
        normalizeNullableText(input.completion_marker_key),
        normalizeNullableText(input.title),
        input.quantity ?? null,
        normalizeNullableText(input.delivery_method),
        input.status ?? null,
        normalizeNullableText(input.vendor_name),
        normalizeNullableText(input.tracking_reference),
        input.recipient_contact_id ?? null,
        input.recipient_organization_id ?? null,
        normalizeNullableText(input.notes),
        normalizeNullableText(input.legacy_source_reference)
      ]
    );
  } else {
    await client.query(
      `
        INSERT INTO deliverable_items (
          tenant_id,
          production_item_id,
          parent_deliverable_item_id,
          deliverable_type,
          deliverable_group_key,
          completion_marker_key,
          title,
          quantity,
          delivery_method,
          status,
          vendor_name,
          tracking_reference,
          delivered_at,
          recipient_contact_id,
          recipient_organization_id,
          notes,
          legacy_source_reference
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9::job_deliverable_status_type,$10,$11,
          CASE WHEN $9 IN ('delivered', 'confirmed') THEN now() ELSE null END,
          $12,$13,$14,$15
        )
      `,
      [
        auth.tenantId,
        productionItemId,
        input.parent_deliverable_item_id ?? null,
        normalizeNullableText(input.deliverable_type),
        normalizeNullableText(input.deliverable_group_key),
        normalizeNullableText(input.completion_marker_key),
        normalizeNullableText(input.title),
        input.quantity ?? null,
        normalizeNullableText(input.delivery_method) ?? "digital",
        input.status ?? "not_started",
        normalizeNullableText(input.vendor_name),
        normalizeNullableText(input.tracking_reference),
        input.recipient_contact_id ?? null,
        input.recipient_organization_id ?? null,
        normalizeNullableText(input.notes),
        normalizeNullableText(input.legacy_source_reference)
      ]
    );
  }
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId,
    productionItemId,
    eventType: input.id ? "deliverable_updated" : "deliverable_created",
    summary: `${item.title}: ${normalizeNullableText(input.title) ?? "deliverable updated"}`,
    metadata: {
      deliverable_type: normalizeNullableText(input.deliverable_type),
      status: input.status ?? null
    }
  });
  return refreshJobAfterOperationalMutation(client, auth, jobId);
}

export async function createOrUpdateProductionIssue(
  client: PoolClient,
  auth: AuthUser,
  jobId: string,
  productionItemId: string,
  input: Partial<ProductionIssueRecord> & { id?: string | null }
) {
  const aggregate = await loadAndGuard(client, auth, jobId);
  const item = findProductionItem(aggregate, productionItemId);
  requireProductionItemMutationAccess(auth, aggregate, productionItemId);
  if (!input.id && (!normalizeNullableText(input.issue_type) || !normalizeNullableText(input.title) || !input.severity)) {
    throw new ApiError(400, "Validation failed", {
      field_errors: {
        issue_type: ["Issue type is required."],
        title: ["Issue title is required."],
        severity: ["Issue severity is required."]
      },
      form_errors: []
    });
  }
  const nextStatus = input.status ?? (input.id ? undefined : "open");
  if (input.id) {
    const existing = aggregate.productionIssues.find((issue) => issue.id === input.id && issue.production_item_id === productionItemId);
    if (!existing) {
      throw new ApiError(404, "Production issue not found");
    }
    await client.query(
      `
        UPDATE production_issue_records
        SET issue_type = COALESCE($3, issue_type),
            severity = COALESCE($4::job_watch_flag_severity_type, severity),
            title = COALESCE($5, title),
            description = COALESCE($6, description),
            status = COALESCE($7::job_issue_status_type, status),
            owner_user_id = COALESCE($8, owner_user_id),
            due_at = COALESCE($9, due_at),
            is_blocking = COALESCE($10, is_blocking),
            source_key = COALESCE($11, source_key),
            resolution_note = COALESCE($12, resolution_note),
            resolved_at = CASE WHEN $7 IN ('resolved', 'dismissed') THEN now() ELSE resolved_at END,
            resolved_by_user_id = CASE WHEN $7 IN ('resolved', 'dismissed') THEN $13 ELSE resolved_by_user_id END,
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [
        auth.tenantId,
        input.id,
        normalizeNullableText(input.issue_type),
        input.severity ?? null,
        normalizeNullableText(input.title),
        normalizeNullableText(input.description) ?? "",
        nextStatus ?? null,
        input.owner_user_id ?? null,
        input.due_at ?? null,
        input.is_blocking ?? null,
        normalizeNullableText(input.source_key),
        normalizeNullableText(input.resolution_note),
        auth.id
      ]
    );
    if (nextStatus === "resolved" || nextStatus === "dismissed") {
      await client.query(
        `
          UPDATE job_watch_flags
          SET status = 'resolved'::job_watch_flag_status_type,
              resolved_at = now(),
              resolved_by_user_id = $4
          WHERE tenant_id = $1
            AND job_id = $2
            AND production_item_id = $3
            AND flag_type = 'production_issue'
            AND status IN ('open', 'acknowledged')
        `,
        [auth.tenantId, jobId, productionItemId, auth.id]
      );
    }
  } else {
    await client.query(
      `
        INSERT INTO production_issue_records (
          tenant_id,
          production_item_id,
          job_id,
          issue_type,
          severity,
          title,
          description,
          status,
          owner_user_id,
          due_at,
          is_blocking,
          source_key,
          created_by_user_id,
          resolution_note
        )
        VALUES ($1,$2,$3,$4,$5::job_watch_flag_severity_type,$6,$7,$8::job_issue_status_type,$9,$10,$11,$12,$13,$14)
      `,
      [
        auth.tenantId,
        productionItemId,
        jobId,
        normalizeNullableText(input.issue_type),
        input.severity,
        normalizeNullableText(input.title),
        normalizeNullableText(input.description) ?? "",
        nextStatus ?? "open",
        input.owner_user_id ?? null,
        input.due_at ?? null,
        input.is_blocking ?? (input.severity === "high" || input.severity === "critical"),
        normalizeNullableText(input.source_key),
        auth.id,
        normalizeNullableText(input.resolution_note)
      ]
    );
    if (input.severity === "high" || input.severity === "critical") {
      await client.query(
        `
          INSERT INTO job_watch_flags (
            tenant_id,
            job_id,
            production_item_id,
            severity,
            flag_type,
            title,
            description,
            status,
            owner_user_id,
            due_at
          )
          VALUES ($1,$2,$3,$4::job_watch_flag_severity_type,'production_issue',$5,$6,'open'::job_watch_flag_status_type,$7,$8)
        `,
        [
          auth.tenantId,
          jobId,
          productionItemId,
          input.severity,
          normalizeNullableText(input.title),
          normalizeNullableText(input.description) ?? "",
          input.owner_user_id ?? null,
          input.due_at ?? null
        ]
      );
    }
  }
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId,
    productionItemId,
    eventType: input.id ? "production_issue_updated" : "production_issue_created",
    summary: `${item.title}: ${normalizeNullableText(input.title) ?? "production issue updated"}`,
    metadata: {
      issue_type: normalizeNullableText(input.issue_type),
      severity: input.severity ?? null,
      status: nextStatus ?? null
    }
  });
  return refreshJobAfterOperationalMutation(client, auth, jobId);
}

export async function createOrResolveWatchFlag(
  client: PoolClient,
  auth: AuthUser,
  jobId: string,
  input: Partial<JobWatchFlagRecord> & { id?: string | null }
) {
  const aggregate = await loadAndGuard(client, auth, jobId);
  const managerAccess = hasManageAccess(auth, aggregate.job.department_type);
  let watchFlagId = input.id ?? null;
  if (input.id) {
    if (!managerAccess) {
      requireManageAccess(auth, aggregate.job.department_type);
    }
  } else if (!managerAccess && !hasAssignmentForUser(aggregate, auth.id, input.job_day_id ?? null)) {
    throw new ApiError(403, "Forbidden");
  }
  if (input.id) {
    await client.query(
      `
        UPDATE job_watch_flags
        SET status = COALESCE($3::job_watch_flag_status_type, status),
            owner_user_id = $4,
            due_at = COALESCE($6, due_at),
            resolved_at = CASE WHEN $3 = 'resolved' THEN now() ELSE resolved_at END,
            resolved_by_user_id = CASE WHEN $3 = 'resolved' THEN $5 ELSE resolved_by_user_id END,
            updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      `,
      [auth.tenantId, input.id, input.status ?? null, input.owner_user_id ?? null, auth.id, input.due_at ?? null]
    );
  } else {
    if (!normalizeNullableText(input.title) || !normalizeNullableText(input.flag_type) || !input.severity) {
      throw new ApiError(400, "Validation failed", {
        field_errors: {
          title: ["Flag title is required."],
          flag_type: ["Flag type is required."],
          severity: ["Severity is required."]
        },
        form_errors: []
      });
    }
    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO job_watch_flags (
          tenant_id,
          job_id,
          job_day_id,
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
          created_by_user_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7::job_watch_flag_severity_type,$8,$9,$10,$11::job_watch_flag_status_type,$12,$13,$14)
        RETURNING id::text AS id
      `,
      [
        auth.tenantId,
        jobId,
        input.job_day_id ?? null,
        input.production_item_id ?? null,
        normalizeNullableText(input.source_entity_type) ??
          (input.production_item_id
            ? "production_item"
            : input.job_day_id
              ? "job_day"
              : input.approval_request_id
                ? "approval_request"
                : input.qa_review_record_id
                  ? "qa_review"
                  : input.deliverable_item_id
                    ? "deliverable"
                    : "job"),
        normalizeNullableText(input.source_entity_id) ??
          input.production_item_id ??
          input.job_day_id ??
          input.approval_request_id ??
          input.qa_review_record_id ??
          input.deliverable_item_id ??
          jobId,
        input.severity,
        normalizeNullableText(input.flag_type),
        normalizeNullableText(input.title),
        normalizeNullableText(input.description) ?? "",
        input.status ?? "open",
        input.owner_user_id ?? null,
        input.due_at ?? null,
        auth.id
      ]
    );
    watchFlagId = inserted.rows[0]?.id ?? null;
  }
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId,
    watchFlagId,
    eventType: input.id ? "watch_flag_updated" : "watch_flag_created",
    summary: normalizeNullableText(input.title) ?? "Watch flag updated"
  });
  if (watchFlagId) {
    if (input.status === "resolved" || input.status === "dismissed") {
      await resolveAlertsForWatchFlag(client, auth.tenantId, watchFlagId);
    } else {
      await syncWatchFlagAlertById(client, auth.tenantId, watchFlagId, auth.id, input.id ? "updated" : "created");
    }
  }

  if ((input.severity === "high" || input.severity === "critical") && input.status !== "resolved" && input.status !== "dismissed") {
    await applyProactiveCommunicationRule(client, auth, {
      triggerType: "urgent_job_update",
      sourceModule: "jobs",
      sourceObjectType: "job_watch_flag",
      sourceObjectId: watchFlagId ?? input.id ?? `${jobId}:watch-flag`,
      sourceObjectLabel: normalizeNullableText(input.title) ?? aggregate.job.job_number ?? aggregate.job.title,
      communicationObjectType: "job",
      communicationObjectId: jobId,
      title: `Urgent update on ${aggregate.job.job_number ?? aggregate.job.title}`,
      summary: normalizeNullableText(input.title) ?? "A high-severity job update needs attention.",
      messageText: `${normalizeNullableText(input.title) ?? "Urgent job update"}: ${normalizeNullableText(input.description) ?? "Open the record for details."}`,
      recipientUserIds: collectJobCommunicationRecipientUserIds(aggregate, {
        excludeUserId: auth.id,
        includeOwners: true,
        additionalUserIds: [input.owner_user_id]
      }),
      appDeepLink: `#jobs/${encodeURIComponent(jobId)}`,
      metadata: {
        watch_flag_id: watchFlagId ?? input.id ?? null,
        severity: input.severity,
        flag_type: normalizeNullableText(input.flag_type)
      }
    });
  }
  return refreshJobAfterOperationalMutation(client, auth, jobId);
}

async function mutateJobLifecycle(
  client: PoolClient,
  auth: AuthUser,
  jobId: string,
  mutation: { jobStatus: JobRecord["job_status"]; cancelled?: boolean; archive?: boolean; cancelReason?: string | null; summary: string }
) {
  const aggregate = await loadAndGuard(client, auth, jobId);
  requireManageAccess(auth, aggregate.job.department_type);
  await client.query(
    `
      UPDATE jobs
      SET job_status = $3::job_status_type,
          cancelled_at = CASE WHEN $4 THEN now() ELSE cancelled_at END,
          cancel_reason = CASE WHEN $4 THEN $5 ELSE cancel_reason END,
          archived_at = CASE WHEN $6 THEN now() ELSE archived_at END,
          updated_by_user_id = $7,
          updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
    `,
    [auth.tenantId, jobId, mutation.jobStatus, mutation.cancelled ?? false, normalizeNullableText(mutation.cancelReason), mutation.archive ?? false, auth.id]
  );
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId,
    eventType: mutation.archive ? "job_archived" : mutation.cancelled ? "job_cancelled" : "job_status_changed",
    summary: mutation.summary,
    metadata: { cancel_reason: normalizeNullableText(mutation.cancelReason), job_status: mutation.jobStatus }
  });
  if (mutation.archive || mutation.cancelled || mutation.jobStatus === "postponed") {
    await queueTeamsMeetingJobRecordLifecycleSync(client, auth, jobId, "cancel");
  }
  return getJobDetail(client, auth, jobId);
}

export async function cancelJob(client: PoolClient, auth: AuthUser, jobId: string, reason: string) {
  return mutateJobLifecycle(client, auth, jobId, {
    jobStatus: "cancelled",
    cancelled: true,
    cancelReason: reason,
    summary: "Cancelled job"
  });
}

export async function postponeJob(client: PoolClient, auth: AuthUser, jobId: string, reason: string) {
  return mutateJobLifecycle(client, auth, jobId, {
    jobStatus: "postponed",
    cancelReason: reason,
    summary: "Postponed job"
  });
}

export async function archiveJob(client: PoolClient, auth: AuthUser, jobId: string) {
  return mutateJobLifecycle(client, auth, jobId, {
    jobStatus: "archived",
    archive: true,
    summary: "Archived job"
  });
}

export async function updatePublishedJob(client: PoolClient, auth: AuthUser, jobId: string, input: JobDraftInput) {
  const aggregate = await loadAndGuard(client, auth, jobId);
  requireManageAccess(auth, aggregate.job.department_type);
  const previousScheduledStartAt = normalizeTimestamp(aggregate.job.scheduled_start_at);
  const previousScheduledEndAt = normalizeTimestamp(aggregate.job.scheduled_end_at);
  const updated = await upsertJobCore(client, auth.tenantId, auth.id, { ...input, department_type: aggregate.job.department_type }, jobId);
  const adapter = getDepartmentJobAdapter(aggregate.job.department_type);
  await adapter.upsertProfile(client, auth.tenantId, updated.id, input);
  if (input.days) {
    await replaceJobDays(client, auth.tenantId, updated.id, input.days);
  }
  await writeJobActivity(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    jobId,
    eventType: "job_updated",
    summary: "Updated published job",
    metadata: { published: true }
  });
  const detail = await getJobDetail(client, auth, jobId);
  await applyStatusSnapshot(client, auth.tenantId, auth.id, {
    job: detail.job,
    schoolProfile: detail.school_profile,
    sportsProfile: detail.sports_profile,
    days: detail.days,
    staffAssignments: detail.staff_assignments,
    readinessItems: detail.readiness_items,
    jobShootLinks: detail.job_shoot_links,
    productionItems: detail.production_items,
    productionItemShootLinks: detail.production_item_shoot_links,
    productionHandoffs: detail.production_handoffs,
    approvalRequests: detail.approval_requests,
    qaReviews: detail.qa_reviews,
    qaFindings: detail.qa_findings,
    deliverableItems: detail.deliverable_items,
    productionIssues: detail.production_issues,
    watchFlags: detail.watch_flags,
    activity: [],
    status: detail.status
  });
  const nextScheduledStartAt = normalizeTimestamp(detail.job.scheduled_start_at);
  const nextScheduledEndAt = normalizeTimestamp(detail.job.scheduled_end_at);
  if (previousScheduledStartAt !== nextScheduledStartAt || previousScheduledEndAt !== nextScheduledEndAt) {
    await applyProactiveCommunicationRule(client, auth, {
      triggerType: "call_time_changed",
      sourceModule: "jobs",
      sourceObjectType: "job",
      sourceObjectId: jobId,
      sourceObjectLabel: detail.job.job_number ?? detail.job.title,
      communicationObjectType: "job",
      communicationObjectId: jobId,
      title: `Call time changed for ${detail.job.job_number ?? detail.job.title}`,
      summary: `${detail.job.job_number ?? detail.job.title} moved from ${previousScheduledStartAt ?? "an unscheduled time"} to ${nextScheduledStartAt ?? "an unscheduled time"}.`,
      messageText: `Call time update: ${detail.job.job_number ?? detail.job.title} now starts at ${nextScheduledStartAt ?? "an updated time"}.`,
      recipientUserIds: collectJobCommunicationRecipientUserIds(
        {
          job: detail.job,
          schoolProfile: detail.school_profile,
          sportsProfile: detail.sports_profile,
          days: detail.days,
          staffAssignments: detail.staff_assignments,
          readinessItems: detail.readiness_items,
          jobShootLinks: detail.job_shoot_links,
          productionItems: detail.production_items,
          productionItemShootLinks: detail.production_item_shoot_links,
          productionHandoffs: detail.production_handoffs,
          approvalRequests: detail.approval_requests,
          qaReviews: detail.qa_reviews,
          qaFindings: detail.qa_findings,
          deliverableItems: detail.deliverable_items,
          productionIssues: detail.production_issues,
          watchFlags: detail.watch_flags,
          activity: [],
          status: detail.status
        },
        {
          excludeUserId: auth.id,
          includeOwners: true
        }
      ),
      appDeepLink: `#jobs/${encodeURIComponent(jobId)}`,
      metadata: {
        previous_scheduled_start_at: previousScheduledStartAt,
        previous_scheduled_end_at: previousScheduledEndAt,
        next_scheduled_start_at: nextScheduledStartAt,
        next_scheduled_end_at: nextScheduledEndAt
      }
    });
  }
  await queueTeamsMeetingJobRecordLifecycleSync(client, auth, jobId, "update");
  return getJobDetail(client, auth, jobId);
}
