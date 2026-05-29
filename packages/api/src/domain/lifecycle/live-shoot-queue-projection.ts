import { isStaffingPublicationState } from "../staffing/staffing-publication-state.js";
import { isShootStatus, type ShootStatus } from "./shoot-status.js";

export const LIVE_SHOOT_QUEUE_BUCKET_REGISTRY = [
  "needs_staffing",
  "needs_review",
  "unscheduled",
  "scheduled",
  "completed"
] as const;

export type LiveShootQueueBucket = (typeof LIVE_SHOOT_QUEUE_BUCKET_REGISTRY)[number];

export const LIVE_SHOOT_QUEUE_TONE_REGISTRY = ["neutral", "info", "success", "warning", "critical"] as const;

export type LiveShootQueueTone = (typeof LIVE_SHOOT_QUEUE_TONE_REGISTRY)[number];

export interface LiveShootQueueFlag {
  code: string;
  label: string;
  tone: LiveShootQueueTone;
}

export interface LiveShootQueueStaffingSummary {
  label: string;
  tone: LiveShootQueueTone;
  assigned_count: number;
  planned_count: number;
  gap_count: number;
  lead_missing: boolean;
  staffing_state: string | null;
  publish_state: string | null;
}

export interface LiveShootQueueSyncSummary {
  label: string;
  tone: LiveShootQueueTone;
  schedule_sync_state: string | null;
  schedule_sync_required: boolean;
  manual_review_required: boolean;
  has_error: boolean;
  link_state: string | null;
}

export interface LiveShootQueueSourceContact {
  full_name: string;
}

export interface LiveShootQueueSourceIntegration {
  link_state?: string | null;
  sync_required?: boolean | null;
  manual_review_required?: boolean | null;
  last_sync_error?: string | null;
}

export interface LiveShootQueueSource {
  id: string;
  shoot_code?: string | null;
  title: string;
  department?: string | null;
  shoot_date?: string | null;
  arrival_time?: string | null;
  start_time?: string | null;
  end_time_est?: string | null;
  location_name?: string | null;
  location_address?: string | null;
  organization_display_name?: string | null;
  primary_contact_name?: string | null;
  secondary_contact_name?: string | null;
  additional_contacts?: LiveShootQueueSourceContact[] | null;
  lead_name?: string | null;
  lead_confirmed_ready?: boolean | null;
  lead_confirmed_ready_at?: string | null;
  lead_confirmed_ready_by_name?: string | null;
  lead_confirmed_ready_exception_flag?: boolean | null;
  ready_to_shoot_status?: string | null;
  ready_to_shoot_label?: string | null;
  ready_to_shoot_escalation_due?: boolean | null;
  status?: string | null;
  publish_state?: string | null;
  staffing_state?: string | null;
  missing_lead?: boolean | null;
  under_staffed?: boolean | null;
  big_shoot?: boolean | null;
  priority_label?: string | null;
  priority_label_display?: string | null;
  planned_staff_count?: number | null;
  scheduled_employee_count?: number | null;
  open_attendance_exception_count?: number | null;
  conflict_warning_count?: number | null;
  schedule_sync_state?: string | null;
  schedule_sync_required?: boolean | null;
  future_profitability_flag?: "favorable" | "neutral" | "watch" | "needs_review" | null;
  future_profitability_display?: string | null;
  integration?: LiveShootQueueSourceIntegration | null;
}

export interface LiveShootQueueEntry<TShoot extends LiveShootQueueSource = LiveShootQueueSource> {
  shoot: TShoot;
  bucket: LiveShootQueueBucket;
  bucket_label: string;
  status_label: string;
  status_tone: LiveShootQueueTone;
  next_action: string;
  key_flags: LiveShootQueueFlag[];
  staffing_summary: LiveShootQueueStaffingSummary;
  sync_summary: LiveShootQueueSyncSummary;
  summary_string: string;
  owner_label: string;
}

export interface LiveShootQueueSection<TShoot extends LiveShootQueueSource = LiveShootQueueSource> {
  id: LiveShootQueueBucket;
  title: string;
  summary: string;
  empty_state: string;
  items: LiveShootQueueEntry<TShoot>[];
}

export interface LiveShootQueueProjection<TShoot extends LiveShootQueueSource = LiveShootQueueSource> {
  date: string | null;
  date_from: string | null;
  date_to: string | null;
  generated_at: string;
  summary: {
    in_view: number;
    needs_staffing: number;
    needs_review: number;
    unscheduled: number;
    scheduled: number;
    completed: number;
  };
  sections: LiveShootQueueSection<TShoot>[];
}

export const LIVE_SHOOT_QUEUE_SECTION_REGISTRY: Array<Omit<LiveShootQueueSection, "items">> = [
  {
    id: "needs_staffing",
    title: "Needs Staffing",
    summary: "Lead coverage or planned headcount is still open.",
    empty_state: "No shoots are waiting on staffing coverage right now."
  },
  {
    id: "needs_review",
    title: "Needs Review",
    summary: "Exceptions, sync concerns, or readiness warnings need leadership eyes.",
    empty_state: "No shoots are waiting on review right now."
  },
  {
    id: "unscheduled",
    title: "Unscheduled",
    summary: "Core timing or location details are still incomplete.",
    empty_state: "No unscheduled shoots are in view for this date."
  },
  {
    id: "scheduled",
    title: "Scheduled",
    summary: "Cleanly scheduled shoots that are ready for operational follow-through.",
    empty_state: "No fully scheduled shoots are in view right now."
  },
  {
    id: "completed",
    title: "Completed / Archived",
    summary: "Wrapped, completed, canceled, or otherwise historical shoots stay here for review.",
    empty_state: "No completed or archived shoots are in view for this date."
  }
];

export interface BuildLiveShootQueueProjectionOptions {
  date?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  generatedAt?: string;
}

export function buildLiveShootQueueEntry<TShoot extends LiveShootQueueSource>(shoot: TShoot): LiveShootQueueEntry<TShoot> {
  const bucket = classifyLiveShootQueueBucket(shoot);
  const staffingGap = getStaffingGap(shoot);

  return {
    shoot,
    bucket,
    bucket_label: getLiveShootQueueLabel(bucket),
    status_label: getStatusLabel(shoot, bucket),
    status_tone: getStatusTone(bucket, shoot),
    next_action: getNextAction(shoot, bucket),
    key_flags: buildKeyFlags(shoot, staffingGap),
    staffing_summary: buildStaffingSummary(shoot, staffingGap),
    sync_summary: buildSyncSummary(shoot),
    summary_string: `${buildTimeRangeLabel(shoot)} | ${buildLocationLabel(shoot)}`,
    owner_label: buildOwnerLabel(shoot)
  };
}

export function buildLiveShootQueueProjection<TShoot extends LiveShootQueueSource>(
  shoots: readonly TShoot[],
  options: BuildLiveShootQueueProjectionOptions = {}
): LiveShootQueueProjection<TShoot> {
  const entries = shoots.map((shoot) => buildLiveShootQueueEntry(shoot)).sort(compareLiveShootQueueEntries);

  return {
    date: options.date ?? null,
    date_from: options.dateFrom ?? null,
    date_to: options.dateTo ?? null,
    generated_at: options.generatedAt ?? new Date().toISOString(),
    summary: {
      in_view: entries.length,
      needs_staffing: entries.filter((entry) => entry.bucket === "needs_staffing").length,
      needs_review: entries.filter((entry) => entry.bucket === "needs_review").length,
      unscheduled: entries.filter((entry) => entry.bucket === "unscheduled").length,
      scheduled: entries.filter((entry) => entry.bucket === "scheduled").length,
      completed: entries.filter((entry) => entry.bucket === "completed").length
    },
    sections: LIVE_SHOOT_QUEUE_SECTION_REGISTRY.map((section) => ({
      ...section,
      items: entries.filter((entry) => entry.bucket === section.id)
    }))
  };
}

export function classifyLiveShootQueueBucket(shoot: LiveShootQueueSource): LiveShootQueueBucket {
  if (isCompletedStatus(shoot.status)) {
    return "completed";
  }
  if (isUnscheduledShoot(shoot)) {
    return "unscheduled";
  }
  if (Boolean(shoot.missing_lead) || getStaffingGap(shoot) > 0 || Boolean(shoot.under_staffed)) {
    return "needs_staffing";
  }
  if (needsOperationalReview(shoot)) {
    return "needs_review";
  }
  return "scheduled";
}

export function needsOperationalReview(shoot: LiveShootQueueSource): boolean {
  return Boolean(
    Number(shoot.open_attendance_exception_count ?? 0) > 0 ||
      Number(shoot.conflict_warning_count ?? 0) > 0 ||
      Boolean(shoot.lead_confirmed_ready_exception_flag) ||
      Boolean(shoot.ready_to_shoot_escalation_due) ||
      shoot.integration?.manual_review_required ||
      shoot.schedule_sync_required ||
      shoot.integration?.last_sync_error ||
      shoot.future_profitability_flag === "needs_review"
  );
}

export function compareLiveShootQueueEntries(left: LiveShootQueueEntry, right: LiveShootQueueEntry): number {
  const bucketDelta = getBucketPriority(left.bucket) - getBucketPriority(right.bucket);
  if (bucketDelta !== 0) {
    return bucketDelta;
  }

  const timeDelta = getSortTime(left.shoot) - getSortTime(right.shoot);
  if (timeDelta !== 0) {
    return timeDelta;
  }

  return left.shoot.title.localeCompare(right.shoot.title);
}

function buildKeyFlags(shoot: LiveShootQueueSource, staffingGap: number): LiveShootQueueFlag[] {
  const flags: LiveShootQueueFlag[] = [];
  const openExceptions = Number(shoot.open_attendance_exception_count ?? 0);
  const conflictWarnings = Number(shoot.conflict_warning_count ?? 0);

  if (shoot.big_shoot) {
    flags.push({
      code: "big_shoot",
      label: shoot.priority_label_display ?? "Big Shoot",
      tone: shoot.priority_label === "critical_shoot" ? "critical" : "info"
    });
  }
  if (shoot.lead_confirmed_ready) {
    flags.push({
      code: "lead_confirmed_ready",
      label: shoot.lead_confirmed_ready_exception_flag ? "Ready with exception" : "Lead Confirmed Ready",
      tone: shoot.lead_confirmed_ready_exception_flag ? "warning" : "success"
    });
  } else if (shoot.ready_to_shoot_escalation_due) {
    flags.push({
      code: "ready_to_shoot_overdue",
      label: "Lead ready overdue",
      tone: "critical"
    });
  } else if (shoot.ready_to_shoot_status === "reminder_due") {
    flags.push({
      code: "ready_to_shoot_waiting",
      label: shoot.ready_to_shoot_label ?? "Awaiting lead confirmation",
      tone: "warning"
    });
  }
  if (shoot.missing_lead) {
    flags.push({ code: "lead_missing", label: "Lead missing", tone: "critical" });
  }
  if (staffingGap > 0) {
    flags.push({ code: "staffing_gap", label: `${staffingGap} open slot${staffingGap === 1 ? "" : "s"}`, tone: "critical" });
  }
  if (openExceptions > 0) {
    flags.push({
      code: "attendance_exception",
      label: `${openExceptions} attendance issue${openExceptions === 1 ? "" : "s"}`,
      tone: "warning"
    });
  }
  if (conflictWarnings > 0) {
    flags.push({
      code: "conflict_warning",
      label: `${conflictWarnings} conflict warning${conflictWarnings === 1 ? "" : "s"}`,
      tone: "warning"
    });
  }
  if (shoot.integration?.manual_review_required || shoot.schedule_sync_required) {
    flags.push({ code: "sync_review", label: "Sync review", tone: "warning" });
  }
  if (shoot.integration?.last_sync_error) {
    flags.push({ code: "sync_error", label: "Sync error", tone: "critical" });
  }
  if (shoot.future_profitability_flag === "watch" || shoot.future_profitability_flag === "needs_review") {
    flags.push({
      code: "profitability_watch",
      label: shoot.future_profitability_display ?? "Profitability watch",
      tone: shoot.future_profitability_flag === "needs_review" ? "critical" : "warning"
    });
  }

  return flags;
}

function buildStaffingSummary(shoot: LiveShootQueueSource, staffingGap: number): LiveShootQueueStaffingSummary {
  const assignedCount = Number(shoot.scheduled_employee_count ?? 0);
  const plannedCount = Number(shoot.planned_staff_count ?? assignedCount);

  return {
    label: plannedCount > 0 ? `Staff ${assignedCount}/${plannedCount}` : `${assignedCount} assigned`,
    tone: staffingGap > 0 || Boolean(shoot.missing_lead) ? "warning" : "success",
    assigned_count: assignedCount,
    planned_count: plannedCount,
    gap_count: staffingGap,
    lead_missing: Boolean(shoot.missing_lead),
    staffing_state: shoot.staffing_state ?? null,
    publish_state: shoot.publish_state ?? null
  };
}

function buildSyncSummary(shoot: LiveShootQueueSource): LiveShootQueueSyncSummary {
  const hasError = Boolean(shoot.integration?.last_sync_error);
  const manualReviewRequired = Boolean(shoot.integration?.manual_review_required);
  const scheduleSyncRequired = Boolean(shoot.schedule_sync_required || shoot.integration?.sync_required);

  return {
    label: buildSyncLabel(shoot),
    tone: hasError ? "critical" : manualReviewRequired || scheduleSyncRequired ? "warning" : "info",
    schedule_sync_state: shoot.schedule_sync_state ?? null,
    schedule_sync_required: scheduleSyncRequired,
    manual_review_required: manualReviewRequired,
    has_error: hasError,
    link_state: shoot.integration?.link_state ?? null
  };
}

function getStatusLabel(shoot: LiveShootQueueSource, bucket: LiveShootQueueBucket): string {
  if (shoot.status) {
    return humanizeStatusLabel(shoot.status);
  }
  if (shoot.publish_state && isStaffingPublicationState(shoot.publish_state)) {
    return humanizeSnakeCaseLabel(shoot.publish_state);
  }
  return getLiveShootQueueLabel(bucket);
}

function getStatusTone(bucket: LiveShootQueueBucket, shoot: LiveShootQueueSource): LiveShootQueueTone {
  if (shoot.status && normalizeStatusValue(shoot.status) === "cancelled") {
    return "critical";
  }

  switch (bucket) {
    case "needs_staffing":
      return "critical";
    case "needs_review":
      return "warning";
    case "unscheduled":
      return "warning";
    case "completed":
      return "success";
    default:
      return "info";
  }
}

function getNextAction(shoot: LiveShootQueueSource, bucket: LiveShootQueueBucket): string {
  if (bucket === "needs_staffing") {
    return shoot.missing_lead ? "Assign lead coverage" : "Fill staffing slots";
  }
  if (bucket === "needs_review") {
    if (shoot.integration?.manual_review_required || shoot.schedule_sync_required || shoot.integration?.last_sync_error) {
      return "Resolve sync and readiness review";
    }
    if (Number(shoot.open_attendance_exception_count ?? 0) > 0) {
      return "Review same-day exceptions";
    }
    if (Number(shoot.conflict_warning_count ?? 0) > 0) {
      return "Review staffing conflicts";
    }
    if (shoot.future_profitability_flag === "needs_review") {
      return "Review profitability risk";
    }
    return "Review operational blockers";
  }
  if (bucket === "unscheduled") {
    return "Set timing and publish details";
  }
  if (bucket === "completed") {
    return "Review wrap and history";
  }
  return shoot.publish_state === "ready_to_publish" ? "Publish staffing plan" : "Open operational workspace";
}

export function getLiveShootQueueLabel(bucket: LiveShootQueueBucket): string {
  switch (bucket) {
    case "needs_staffing":
      return "Needs Staffing";
    case "needs_review":
      return "Needs Review";
    case "unscheduled":
      return "Unscheduled";
    case "completed":
      return "Completed / Archived";
    default:
      return "Scheduled";
  }
}

function buildOwnerLabel(shoot: LiveShootQueueSource): string {
  if (shoot.lead_name) {
    return `Lead ${shoot.lead_name}`;
  }
  if (shoot.organization_display_name) {
    return shoot.organization_display_name;
  }
  if (shoot.primary_contact_name) {
    return `Contact ${shoot.primary_contact_name}`;
  }
  return "Lead pending";
}

function buildSyncLabel(shoot: LiveShootQueueSource): string {
  if (shoot.integration?.manual_review_required) {
    return "Sync review";
  }
  if (shoot.integration?.last_sync_error) {
    return "Sync error";
  }
  if (shoot.schedule_sync_required || shoot.integration?.sync_required) {
    return "Sync pending";
  }
  return shoot.integration?.link_state === "linked" ? "Linked to Outlook" : "Mission Control only";
}

function buildLocationLabel(shoot: LiveShootQueueSource): string {
  if (shoot.location_name) {
    return shoot.location_name;
  }
  if (shoot.location_address) {
    return shoot.location_address.split(",").slice(0, 2).join(", ");
  }
  return "Location pending";
}

function buildTimeRangeLabel(shoot: LiveShootQueueSource): string {
  const arrival = formatOptionalTime(shoot.arrival_time);
  const start = formatOptionalTime(shoot.start_time);
  const end = formatOptionalTime(shoot.end_time_est);

  if (arrival === "TBD" && start === "TBD") {
    return `Time pending${end !== "TBD" ? ` | Ends ${end}` : ""}`;
  }

  return `Arrival ${arrival} | Shoot ${start}${end !== "TBD" ? ` - ${end}` : ""}`;
}

function isCompletedStatus(status?: string | null): boolean {
  if (!status) {
    return false;
  }
  const normalized = normalizeStatusValue(status);
  return ["shoot_complete", "post_production", "complete", "completed", "delivered", "closed", "cancelled", "wrapped", "archived"].includes(normalized);
}

function isUnscheduledShoot(shoot: LiveShootQueueSource): boolean {
  const normalizedStatus = normalizeStatusValue(shoot.status);
  return normalizedStatus === "planning" || normalizedStatus === "draft" || normalizedStatus === "tentative" || (!shoot.arrival_time && !shoot.start_time);
}

function getStaffingGap(shoot: LiveShootQueueSource): number {
  const planned = Number(shoot.planned_staff_count ?? 0);
  const assigned = Number(shoot.scheduled_employee_count ?? 0);

  if (!planned || planned <= assigned) {
    return 0;
  }

  return planned - assigned;
}

function getBucketPriority(bucket: LiveShootQueueBucket): number {
  switch (bucket) {
    case "needs_staffing":
      return 0;
    case "needs_review":
      return 1;
    case "unscheduled":
      return 2;
    case "scheduled":
      return 3;
    case "completed":
      return 4;
  }
}

function getSortTime(shoot: LiveShootQueueSource): number {
  return new Date(shoot.arrival_time ?? shoot.start_time ?? shoot.end_time_est ?? `${shoot.shoot_date ?? getLocalDateString()}T23:59:00`).getTime();
}

function humanizeStatusLabel(value: string): string {
  if (isShootStatus(value)) {
    return humanizeRegisteredStatusLabel(value);
  }
  return humanizeSnakeCaseLabel(value);
}

function humanizeRegisteredStatusLabel(status: ShootStatus): string {
  switch (status) {
    case "READY":
      return "Ready";
    case "SHOOT_COMPLETE":
      return "Shoot Complete";
    case "POST_PRODUCTION":
      return "Post-Production";
    case "ON_HOLD":
      return "On Hold";
    default:
      return humanizeSnakeCaseLabel(status);
  }
}

function humanizeSnakeCaseLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeStatusValue(value?: string | null): string {
  return value ? value.trim().toLowerCase().replace(/\s+/g, "_").replace(/canceled/g, "cancelled") : "";
}

function formatOptionalTime(value?: string | null): string {
  if (!value) {
    return "TBD";
  }
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });
}

function getLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
