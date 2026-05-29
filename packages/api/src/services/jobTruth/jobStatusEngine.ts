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
import type {
  JobProductionStatus,
  JobReadinessStatus,
  JobRiskStatus,
  JobStaffingStatus,
  JobStatus
} from "../../domain/jobTruth/index.js";

type StatusInput = {
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
  watchFlags: JobWatchFlagRecord[];
  activity?: ActivityLogEntryRecord[];
};

function priorityRank(status: JobProductionStatus) {
  const ranking: Record<JobProductionStatus, number> = {
    blocked: 100,
    awaiting_approval: 90,
    awaiting_internal_review: 88,
    revisions_requested: 85,
    proof_sent: 80,
    proof_build: 70,
    editing: 60,
    ingest_complete: 50,
    awaiting_ingest: 40,
    queued: 30,
    approved_for_final: 27,
    approved_for_production: 25,
    in_final_production: 24,
    ordered_or_printed: 20,
    ordered_or_sent: 19,
    packaged: 15,
    delivered: 10,
    complete: 5,
    cancelled: 1,
    not_created: 0
  };
  return ranking[status] ?? 0;
}

function deriveProductionStatus(items: ProductionItemRecord[], productionRequired: boolean): JobProductionStatus {
  if (!productionRequired) {
    return "not_created";
  }
  if (items.length === 0) {
    return "not_created";
  }
  return [...items].sort((left, right) => priorityRank(right.status) - priorityRank(left.status))[0].status;
}

function deriveStaffingStatus(job: JobRecord, assignments: JobStaffAssignmentRecord[], days: JobDayRecord[]): JobStaffingStatus {
  const requiredCount = job.estimated_staff_count ?? 0;
  const activeAssignments = assignments.filter((assignment) => assignment.assignment_status !== "cancelled" && assignment.assignment_status !== "absent");
  const checkedInCount = activeAssignments.filter((assignment) => assignment.check_in_at && !assignment.check_out_at).length;
  const readyConfirmed = days.some((day) => day.ready_confirmed_at) || activeAssignments.some((assignment) => assignment.is_ready_present);
  const leadAssigned = activeAssignments.some((assignment) => assignment.is_lead);

  if (!leadAssigned || activeAssignments.length === 0) {
    return "unassigned";
  }
  if (activeAssignments.some((assignment) => assignment.assignment_status === "absent")) {
    return "gap_flagged";
  }
  if (readyConfirmed) {
    return "ready_confirmed";
  }
  if (checkedInCount > 0) {
    return "checked_in";
  }
  if (requiredCount > 0 && activeAssignments.length < requiredCount) {
    return "partially_staffed";
  }
  return "staffed";
}

function deriveReadinessStatus(
  job: JobRecord,
  readinessItems: JobReadinessItemRecord[],
  staffingStatus: JobStaffingStatus,
  watchFlags: JobWatchFlagRecord[]
): { readinessStatus: JobReadinessStatus; readinessPercent: number } {
  const requiredItems = readinessItems.filter((item) => item.is_required);
  const completeRequired = requiredItems.filter((item) => item.is_complete).length;
  const readinessPercent = requiredItems.length === 0 ? 100 : Math.round((completeRequired / requiredItems.length) * 100);
  const blockerIncomplete = readinessItems.some((item) => item.is_blocker && !item.is_complete);
  const criticalFlags = watchFlags.some(
    (flag) => (flag.status === "open" || flag.status === "acknowledged" || flag.status === "snoozed") && (flag.severity === "critical" || flag.severity === "high")
  );
  const scheduledStart = job.scheduled_start_at ? new Date(job.scheduled_start_at).getTime() : null;
  const within72Hours = scheduledStart != null && scheduledStart - Date.now() <= 72 * 60 * 60 * 1000;

  if ((blockerIncomplete && within72Hours) || criticalFlags || staffingStatus === "gap_flagged") {
    return { readinessStatus: "off_track", readinessPercent };
  }
  if (blockerIncomplete || staffingStatus === "unassigned" || staffingStatus === "partially_staffed") {
    return { readinessStatus: "at_risk", readinessPercent };
  }
  if (requiredItems.some((item) => !item.is_complete)) {
    return { readinessStatus: "on_track", readinessPercent };
  }
  return { readinessStatus: "ready", readinessPercent };
}

function deriveRiskStatus(watchFlags: JobWatchFlagRecord[], readinessStatus: JobReadinessStatus): JobRiskStatus {
  const openFlags = watchFlags.filter((flag) => flag.status === "open" || flag.status === "acknowledged" || flag.status === "snoozed");
  if (openFlags.some((flag) => flag.severity === "critical")) {
    return "critical";
  }
  if (openFlags.some((flag) => flag.severity === "high") || readinessStatus === "off_track") {
    return "high";
  }
  if (openFlags.some((flag) => flag.severity === "medium") || readinessStatus === "at_risk") {
    return "medium";
  }
  if (openFlags.length > 0 || readinessStatus === "on_track") {
    return "low";
  }
  return "none";
}

function deriveJobStatus(
  job: JobRecord,
  staffingStatus: JobStaffingStatus,
  readinessStatus: JobReadinessStatus,
  days: JobDayRecord[]
): JobStatus {
  if (job.archived_at) {
    return "archived";
  }
  if (job.cancelled_at) {
    return "cancelled";
  }
  if (!job.published_at) {
    return "draft";
  }
  if (days.some((day) => day.day_status === "in_progress")) {
    return "in_progress";
  }
  if (days.length > 0 && days.every((day) => day.day_status === "complete")) {
    return "execution_complete";
  }
  if (readinessStatus === "off_track") {
    return "intake_blocked";
  }
  if (staffingStatus === "unassigned" || staffingStatus === "partially_staffed") {
    return "ready_to_staff";
  }
  if (readinessStatus === "ready") {
    return "ready_to_execute";
  }
  if (staffingStatus === "staffed") {
    return "staffed";
  }
  return "confirmed";
}

export function calculateJobStatusSnapshot(input: StatusInput): JobStatusSnapshot {
  const staffingStatus = deriveStaffingStatus(input.job, input.staffAssignments, input.days);
  const { readinessStatus, readinessPercent } = deriveReadinessStatus(input.job, input.readinessItems, staffingStatus, input.watchFlags);
  const productionStatus = deriveProductionStatus(input.productionItems, input.job.production_required);
  const riskStatus = deriveRiskStatus(input.watchFlags, readinessStatus);
  const jobStatus = deriveJobStatus(input.job, staffingStatus, readinessStatus, input.days);

  return {
    readiness_percent: readinessPercent,
    job_status: jobStatus,
    production_status: productionStatus,
    staffing_status: staffingStatus,
    readiness_status: readinessStatus,
    risk_status: riskStatus,
    blocker_count: input.readinessItems.filter((item) => item.is_blocker && !item.is_complete).length,
    open_watch_flag_count: input.watchFlags.filter((flag) => flag.status === "open" || flag.status === "acknowledged" || flag.status === "snoozed").length
  };
}
