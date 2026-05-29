import type { ProductionItemRecord, ProductionIssueRecord, QaReviewFindingRecord, QaReviewRecord } from "../../types/jobTruth.js";
import type {
  JobProductionStatus,
  ProductionBoardFileMatchStatus,
  ProductionBoardHealthState,
  ProductionBoardUploadStatus,
  ProductionBoardWorkflowStatus
} from "../../domain/jobTruth/index.js";

type ProductionBoardComputationInput = {
  item: ProductionItemRecord;
  qaReviews: QaReviewRecord[];
  qaFindings: QaReviewFindingRecord[];
  blockers: ProductionIssueRecord[];
  shootCompleted: boolean;
  now?: Date;
};

export type ProductionBoardDerivedFields = {
  workflowStatus: ProductionBoardWorkflowStatus;
  healthState: ProductionBoardHealthState;
  legacyStatus: JobProductionStatus;
  fileMatchStatus: ProductionBoardFileMatchStatus;
  readinessScore: number;
  openBlockerCount: number;
  overdueFlag: boolean;
  daysSinceShoot: number | null;
  daysOpen: number;
  daysToDue: number | null;
  daysPastDue: number | null;
  stageAge: number;
  turnaroundDays: number | null;
  onTimeFlag: boolean | null;
  releaseLagDays: number | null;
};

type GroupValidationResult = {
  allowed: boolean;
  reasons: string[];
};

type SplitValidationResult = {
  allowed: boolean;
  reasons: string[];
};

type SplitBranchInput = {
  title?: string | null;
  production_type?: string | null;
  due_at?: string | Date | null;
  release_target?: string | null;
  assigned_to_user_id?: string | null;
  assigned_peer_reviewer_user_id?: string | null;
  assigned_release_reviewer_user_id?: string | null;
  vendor_name?: string | null;
};

const SPECIALTY_PRODUCTION_TYPE_HINTS = ["banner", "print", "specialty", "poster", "vendor", "composite"];
export const PRODUCTION_QA_GATE_KEYS = ["intake_qc", "creator_review", "peer_review", "final_release_review"] as const;
export const PRODUCTION_QA_REQUIRED_QUESTION_KEYS = [
  "files_complete_storage",
  "color_density_consistency",
  "sorting_and_roster_accuracy",
  "template_price_release_accuracy",
  "next_stage_decision"
] as const;
export const PRODUCTION_STAGE_STALL_THRESHOLDS_HOURS: Partial<Record<ProductionBoardWorkflowStatus, number>> = {
  WAITING_ON_FILES: 24,
  READY_FOR_QA: 24,
  READY_FOR_UPLOAD: 24,
  UPLOADED: 24
};
export type ProductionQaGateKey = (typeof PRODUCTION_QA_GATE_KEYS)[number];

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

export function isProductionQaGateKey(value: string | null | undefined): value is ProductionQaGateKey {
  return value != null && PRODUCTION_QA_GATE_KEYS.includes(value as ProductionQaGateKey);
}

export function getProductionQaMinimumSamplePercent(stage: ProductionQaGateKey, isLargeJob: boolean) {
  switch (stage) {
    case "intake_qc":
      return 100;
    case "creator_review":
      return isLargeJob ? 30 : 10;
    case "peer_review":
      return 10;
    case "final_release_review":
      return 5;
    default:
      return 0;
  }
}

function normalizeTimestamp(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function dayKey(value: string | Date | null | undefined) {
  const timestamp = normalizeTimestamp(value);
  return timestamp ? timestamp.slice(0, 10) : null;
}

function diffInDays(from: string | Date | null | undefined, to: Date) {
  const normalized = normalizeTimestamp(from);
  if (!normalized) {
    return null;
  }
  const start = new Date(normalized);
  const diff = to.getTime() - start.getTime();
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

function dueWindowDistance(left: string | Date | null | undefined, right: string | Date | null | undefined) {
  const leftValue = normalizeTimestamp(left);
  const rightValue = normalizeTimestamp(right);
  if (!leftValue && !rightValue) {
    return 0;
  }
  if (!leftValue || !rightValue) {
    return Number.POSITIVE_INFINITY;
  }
  const diff = Math.abs(new Date(leftValue).getTime() - new Date(rightValue).getTime());
  return diff / (24 * 60 * 60 * 1000);
}

export function deriveProductionFileMatchStatus(item: Pick<ProductionItemRecord, "file_count_expected" | "file_count_received">): ProductionBoardFileMatchStatus {
  if (item.file_count_expected == null) {
    return "UNKNOWN";
  }
  const expected = item.file_count_expected;
  const actual = item.file_count_received ?? 0;
  if (expected === 0) {
    return "NOT_APPLICABLE";
  }
  if (actual === 0) {
    return "MISSING";
  }
  if (actual === expected) {
    return "MATCHED";
  }
  if (actual > expected) {
    return "EXTRA_FILES";
  }
  if (actual > 0 && actual < expected) {
    return "PARTIAL";
  }
  return "MISMATCH";
}

function deriveReadinessScore(item: ProductionItemRecord) {
  const checks = [
    item.handoff_complete,
    item.naming_verified,
    item.folder_structure_verified,
    item.tags_or_flags_verified,
    item.file_match_status === "MATCHED" || item.file_match_status === "EXTRA_FILES",
    item.department_type === "schools" ? item.roster_received : true
  ];
  const completed = checks.filter(Boolean).length;
  return Math.round((completed / checks.length) * 100);
}

function latestQaReview(reviews: QaReviewRecord[]) {
  return [...reviews].sort((left, right) => new Date(normalizeTimestamp(right.updated_at) ?? 0).getTime() - new Date(normalizeTimestamp(left.updated_at) ?? 0).getTime())[0] ?? null;
}

function hasBlockingQaFinding(findings: QaReviewFindingRecord[]) {
  return findings.some((finding) => finding.is_blocking && !finding.resolved_at);
}

function isSpecialtyPath(item: Pick<ProductionItemRecord, "production_type" | "vendor_name" | "release_target">) {
  const productionType = normalizeText(item.production_type) ?? "";
  const releaseTarget = normalizeText(item.release_target);
  return (
    SPECIALTY_PRODUCTION_TYPE_HINTS.some((hint) => productionType.includes(hint)) ||
    Boolean(item.vendor_name) ||
    (releaseTarget != null && !["gallery", "portal", "standard_gallery", "team_gallery"].includes(releaseTarget))
  );
}

export function requiresPeerReviewer(
  item: Pick<ProductionItemRecord, "qa_required" | "workflow_status" | "creator_review_complete" | "peer_review_complete">
) {
  if (!item.qa_required) {
    return false;
  }
  return (
    item.creator_review_complete ||
    ["READY_FOR_QA", "IN_PEER_REVIEW", "READY_FOR_UPLOAD", "REWORK_REQUIRED", "UPLOADED", "READY_FOR_RELEASE"].includes(item.workflow_status)
  );
}

export function requiresReleaseReviewer(
  item: Pick<
    ProductionItemRecord,
    "workflow_status" | "upload_status" | "release_status" | "final_release_review_complete"
  >
) {
  if (item.final_release_review_complete) {
    return false;
  }
  return (
    ["UPLOADED", "READY_FOR_RELEASE"].includes(item.workflow_status) ||
    ["UPLOADED", "VERIFIED", "FAILED"].includes(item.upload_status) ||
    item.release_status === "PENDING_REVIEW"
  );
}

export function isReleaseReadyWorkflow(workflowStatus: ProductionBoardWorkflowStatus) {
  return ["READY_FOR_RELEASE", "RELEASED", "SENT_TO_VENDOR", "DELIVERED_CLOSED", "CANCELLED"].includes(workflowStatus);
}

export function getStageStallThresholdHours(workflowStatus: ProductionBoardWorkflowStatus) {
  return PRODUCTION_STAGE_STALL_THRESHOLDS_HOURS[workflowStatus] ?? null;
}

export function mapWorkflowStatusToLegacyStatus(
  workflowStatus: ProductionBoardWorkflowStatus,
  uploadStatus: ProductionBoardUploadStatus,
  blockedReason: string | null
): JobProductionStatus {
  if (blockedReason || workflowStatus === "BLOCKED") {
    return "blocked";
  }
  switch (workflowStatus) {
    case "CANCELLED":
      return "cancelled";
    case "DELIVERED_CLOSED":
      return "complete";
    case "SENT_TO_VENDOR":
      return "ordered_or_sent";
    case "RELEASED":
      return "delivered";
    case "READY_FOR_RELEASE":
      return "approved_for_final";
    case "UPLOADED":
      return "proof_sent";
    case "UPLOADING":
      return uploadStatus === "UPLOADING" ? "in_final_production" : "proof_build";
    case "READY_FOR_UPLOAD":
      return "approved_for_final";
    case "REWORK_REQUIRED":
      return "revisions_requested";
    case "IN_PEER_REVIEW":
    case "READY_FOR_QA":
      return "awaiting_internal_review";
    case "IN_PRODUCTION":
      return "editing";
    case "READY_FOR_PRODUCTION":
      return "ingest_complete";
    case "INTAKE_REVIEW":
      return "awaiting_ingest";
    case "WAITING_ON_FILES":
      return "awaiting_ingest";
    case "WAITING_ON_INTAKE":
      return "queued";
    case "ON_HOLD":
      return "queued";
    default:
      return "queued";
  }
}

export function computeProductionBoardDerivedFields(input: ProductionBoardComputationInput): ProductionBoardDerivedFields {
  const now = input.now ?? new Date();
  const openBlockers = input.blockers.filter((blocker) => blocker.status !== "resolved" && blocker.status !== "dismissed");
  const blockingQaFinding = hasBlockingQaFinding(input.qaFindings);
  const latestReview = latestQaReview(input.qaReviews);
  const fileMatchStatus = deriveProductionFileMatchStatus(input.item);
  const readinessScore = deriveReadinessScore({ ...input.item, file_match_status: fileMatchStatus });
  const overdueFlag = Boolean(
    input.item.due_at &&
      !input.item.closed_at &&
      !["DELIVERED_CLOSED", "CANCELLED"].includes(input.item.workflow_status) &&
      new Date(normalizeTimestamp(input.item.due_at) ?? 0).getTime() < now.getTime()
  );

  let workflowStatus: ProductionBoardWorkflowStatus = input.item.workflow_status;
  if (workflowStatus === "CANCELLED") {
    workflowStatus = "CANCELLED";
  } else if (workflowStatus === "ON_HOLD") {
    workflowStatus = "ON_HOLD";
  } else if (
    latestReview &&
    (latestReview.status === "failed" || latestReview.status === "rework_in_progress" || latestReview.status === "recheck_required" || latestReview.rework_required)
  ) {
    workflowStatus = "REWORK_REQUIRED";
  } else if (openBlockers.length > 0 || Boolean(input.item.blocked_reason) || blockingQaFinding) {
    workflowStatus = "BLOCKED";
  } else if (input.item.closed_at || input.item.release_status === "CLOSED") {
    workflowStatus = "DELIVERED_CLOSED";
  } else if (input.item.release_status === "DELIVERED") {
    workflowStatus = "RELEASED";
  } else if (input.item.release_status === "SENT_TO_VENDOR") {
    workflowStatus = "SENT_TO_VENDOR";
  } else if (input.item.final_release_review_complete) {
    workflowStatus = input.item.release_status === "RELEASED" ? "RELEASED" : "READY_FOR_RELEASE";
  } else if (input.item.upload_status === "UPLOADED" || input.item.upload_status === "VERIFIED") {
    workflowStatus = "UPLOADED";
  } else if (input.item.upload_status === "UPLOADING") {
    workflowStatus = "UPLOADING";
  } else if (latestReview && ["passed", "passed_with_notes", "complete"].includes(latestReview.status)) {
    workflowStatus = "READY_FOR_UPLOAD";
  } else if (input.item.peer_review_complete) {
    workflowStatus = "READY_FOR_UPLOAD";
  } else if (input.item.creator_review_complete) {
    workflowStatus = "READY_FOR_QA";
  } else if (
    input.item.handoff_complete &&
    ["MATCHED", "EXTRA_FILES"].includes(fileMatchStatus) &&
    input.item.naming_verified &&
    input.item.folder_structure_verified &&
    input.item.tags_or_flags_verified &&
    (input.item.department_type !== "schools" || input.item.roster_received)
  ) {
    workflowStatus = "READY_FOR_PRODUCTION";
  } else if (input.item.handoff_complete && ["MISSING", "PARTIAL", "MISMATCH"].includes(fileMatchStatus)) {
    workflowStatus = "WAITING_ON_FILES";
  } else if (input.item.handoff_complete) {
    workflowStatus = "INTAKE_REVIEW";
  } else if (input.shootCompleted) {
    workflowStatus = "WAITING_ON_INTAKE";
  } else if (input.item.production_start_at) {
    workflowStatus = "IN_PRODUCTION";
  } else {
    workflowStatus = "DRAFT";
  }

  let healthState: ProductionBoardHealthState = "ON_TRACK";
  if (workflowStatus === "BLOCKED" || openBlockers.some((blocker) => blocker.severity === "critical" || blocker.severity === "high")) {
    healthState = openBlockers.some((blocker) => blocker.severity === "critical") ? "BLOCKED" : "AT_RISK";
  }
  if (["MISMATCH", "MISSING"].includes(fileMatchStatus)) {
    healthState = workflowStatus === "WAITING_ON_FILES" ? "AT_RISK" : healthState;
  }
  if (overdueFlag) {
    healthState = "OVERDUE";
  } else if (readinessScore < 50 && workflowStatus !== "DRAFT") {
    healthState = healthState === "ON_TRACK" ? "WATCH" : healthState;
  }
  if ((input.item.rework_count >= 2 || input.item.qa_fail_count >= 2) && healthState === "ON_TRACK") {
    healthState = "AT_RISK";
  }
  if (workflowStatus === "BLOCKED") {
    healthState = input.item.blocked_reason || openBlockers.some((blocker) => blocker.severity === "critical") ? "BLOCKED" : "AT_RISK";
  }

  const daysSinceShoot = diffInDays(input.item.shoot_date_end ?? input.item.shoot_date_start, now);
  const daysOpen = Math.max(diffInDays(input.item.created_at, now) ?? 0, 0);
  const daysToDue = input.item.due_at ? Math.ceil((new Date(normalizeTimestamp(input.item.due_at) ?? 0).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)) : null;
  const daysPastDue = overdueFlag && input.item.due_at ? Math.max(Math.floor((now.getTime() - new Date(normalizeTimestamp(input.item.due_at) ?? 0).getTime()) / (24 * 60 * 60 * 1000)), 0) : null;
  const stageAge = Math.max(diffInDays(input.item.updated_at, now) ?? 0, 0);
  const turnaroundDays = input.item.completed_at && input.item.shoot_date_end ? Math.max(diffInDays(input.item.shoot_date_end, new Date(normalizeTimestamp(input.item.completed_at) ?? now.toISOString())) ?? 0, 0) : null;
  const onTimeFlag = input.item.completed_at && input.item.due_at
    ? new Date(normalizeTimestamp(input.item.completed_at) ?? 0).getTime() <= new Date(normalizeTimestamp(input.item.due_at) ?? 0).getTime()
    : null;
  const releaseLagDays =
    input.item.completed_at && input.item.closed_at
      ? Math.max(diffInDays(input.item.completed_at, new Date(normalizeTimestamp(input.item.closed_at) ?? now.toISOString())) ?? 0, 0)
      : null;

  return {
    workflowStatus,
    healthState,
    legacyStatus: mapWorkflowStatusToLegacyStatus(workflowStatus, input.item.upload_status, input.item.blocked_reason),
    fileMatchStatus,
    readinessScore,
    openBlockerCount: openBlockers.length,
    overdueFlag,
    daysSinceShoot,
    daysOpen,
    daysToDue,
    daysPastDue,
    stageAge,
    turnaroundDays,
    onTimeFlag,
    releaseLagDays
  };
}

export function validateProductionGrouping(items: ProductionItemRecord[]): GroupValidationResult {
  if (items.length < 2) {
    return { allowed: false, reasons: ["Select at least two production items to group."] };
  }
  const [first, ...rest] = items;
  const reasons: string[] = [];
  for (const item of rest) {
    if (item.organization_id !== first.organization_id) {
      reasons.push("All grouped items must belong to the same organization.");
    }
    if (item.department_type !== first.department_type) {
      reasons.push("All grouped items must belong to the same department.");
    }
    if (normalizeText(item.job_type) !== normalizeText(first.job_type)) {
      reasons.push("All grouped items must share the same job family or work type.");
    }
    if (normalizeText(item.release_target) !== normalizeText(first.release_target)) {
      reasons.push("Grouped items must share the same release target.");
    }
    if (dueWindowDistance(item.due_at, first.due_at) > 3) {
      reasons.push("Grouped items must stay within the same due-date window.");
    }
    if ((item.assigned_to_user_id ?? null) !== (first.assigned_to_user_id ?? null)) {
      reasons.push("Grouped items must share the same production owner.");
    }
    if (isSpecialtyPath(item) || isSpecialtyPath(first)) {
      reasons.push("Specialty or vendor paths must stay in separate production items.");
    }
  }
  return {
    allowed: reasons.length === 0,
    reasons: [...new Set(reasons)]
  };
}

export function validateProductionSplit(item: ProductionItemRecord, branches: SplitBranchInput[]): SplitValidationResult {
  if (branches.length < 2) {
    return { allowed: false, reasons: ["Provide at least two split branches."] };
  }
  const meaningfulChange = branches.some((branch) => {
    return (
      normalizeText(branch.production_type) !== normalizeText(item.production_type) ||
      normalizeText(branch.release_target) !== normalizeText(item.release_target) ||
      dueWindowDistance(branch.due_at, item.due_at) > 0 ||
      (branch.assigned_to_user_id ?? null) !== (item.assigned_to_user_id ?? null) ||
      (branch.assigned_peer_reviewer_user_id ?? null) !== (item.assigned_peer_reviewer_user_id ?? null) ||
      (branch.assigned_release_reviewer_user_id ?? null) !== (item.assigned_release_reviewer_user_id ?? null) ||
      normalizeText(branch.vendor_name) !== normalizeText(item.vendor_name)
    );
  });
  if (!meaningfulChange) {
    return {
      allowed: false,
      reasons: ["Splits must change deliverable type, deadline, owner, QA path, or vendor/release path."]
    };
  }
  return { allowed: true, reasons: [] };
}
