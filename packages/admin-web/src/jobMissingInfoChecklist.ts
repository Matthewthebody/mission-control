import type {
  SharedJobDetailResponse,
  SharedJobListItem,
  SharedJobReadinessItem,
  SharedJobWatchFlag
} from "./jobTruthTypes";
import { buildJobCalendarReadiness } from "./jobCalendarReadiness";

export type JobMissingInfoStatus = "open" | "waiting_on_client" | "waiting_on_internal_team" | "resolved";
export type JobMissingInfoCategory = "client" | "schedule" | "staffing" | "production" | "approval" | "internal";
export type JobMissingInfoTone = "neutral" | "success" | "warning" | "danger";

export type JobMissingInfoChecklistItem = {
  id: string;
  title: string;
  category: JobMissingInfoCategory;
  ownerLabel: string;
  dueDate: string | null;
  status: JobMissingInfoStatus;
  resolvedDate: string | null;
  notes: string | null;
  nextAction: string;
  isBlocker: boolean;
};

export type JobMissingInfoChecklistSummary = {
  items: JobMissingInfoChecklistItem[];
  activeItems: JobMissingInfoChecklistItem[];
  resolvedItems: JobMissingInfoChecklistItem[];
  activeCount: number;
  blockerCount: number;
  waitingOnClientCount: number;
  waitingOnInternalCount: number;
  resolvedCount: number;
  primaryOwner: string;
  nextAction: string;
};

function hasValue(value: string | null | undefined) {
  return Boolean(value && value.trim());
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").toLowerCase();
}

function ownerFromDepartment(department: string | null | undefined) {
  if (department === "schools") {
    return "Schools";
  }
  if (department === "sports") {
    return "Sports";
  }
  if (department === "headshots") {
    return "Photography";
  }
  if (department === "corporate") {
    return "Client Success";
  }
  return "Operations";
}

function getListDate(item: SharedJobListItem) {
  return item.primary_day_date ?? item.scheduled_start_at?.slice(0, 10) ?? null;
}

function getListStartTime(item: SharedJobListItem) {
  return item.primary_day_start_time ?? item.scheduled_start_at?.slice(11, 16) ?? null;
}

function getDetailDate(detail: SharedJobDetailResponse) {
  return detail.summary.primary_day_date ?? detail.job.scheduled_start_at?.slice(0, 10) ?? detail.days[0]?.date ?? null;
}

function getDetailStartTime(detail: SharedJobDetailResponse) {
  return detail.summary.primary_day_start_time ?? detail.job.scheduled_start_at?.slice(11, 16) ?? detail.days[0]?.start_time ?? null;
}

function getDetailEndTime(detail: SharedJobDetailResponse) {
  return detail.summary.primary_day_end_time ?? detail.job.scheduled_end_at?.slice(11, 16) ?? detail.days[0]?.end_time ?? null;
}

function getJobOwnerLabel(source: SharedJobListItem | SharedJobDetailResponse) {
  if ("job" in source) {
    return source.summary.lead_owner_name ?? source.summary.account_owner_name ?? ownerFromDepartment(source.job.department_type);
  }
  return source.lead_owner_name ?? source.account_owner_name ?? ownerFromDepartment(source.department_type);
}

function createChecklistItem(input: JobMissingInfoChecklistItem): JobMissingInfoChecklistItem {
  return input;
}

function mapStatusTone(status: JobMissingInfoStatus, isBlocker: boolean): JobMissingInfoTone {
  if (status === "resolved") {
    return "success";
  }
  if (isBlocker || status === "open") {
    return "danger";
  }
  if (status === "waiting_on_client" || status === "waiting_on_internal_team") {
    return "warning";
  }
  return "neutral";
}

function mapReadinessTitle(item: SharedJobReadinessItem) {
  const text = `${item.label} ${item.description ?? ""} ${item.notes ?? ""} ${item.section_key} ${item.source_template_key ?? ""}`.toLowerCase();
  if (item.is_complete) {
    return item.label;
  }
  if (text.includes("team") || text.includes("slot list")) {
    return "Missing team list";
  }
  if (text.includes("roster")) {
    return "Missing roster";
  }
  if (text.includes("contact") || text.includes("owner")) {
    return "Missing contact";
  }
  if (text.includes("location")) {
    return "Missing location details";
  }
  if (text.includes("approval") || text.includes("proof")) {
    return "Client approval needed";
  }
  if (text.includes("deadline")) {
    return "Missing production deadline";
  }
  return `Missing ${item.label.toLowerCase()}`;
}

function mapReadinessCategory(item: SharedJobReadinessItem): JobMissingInfoCategory {
  const text = normalizeText(`${item.section_key} ${item.label} ${item.source_template_key ?? ""}`);
  if (text.includes("approval") || text.includes("proof")) {
    return "approval";
  }
  if (text.includes("staff") || text.includes("photo") || text.includes("assignment")) {
    return "staffing";
  }
  if (text.includes("production") || text.includes("deadline")) {
    return "production";
  }
  if (text.includes("schedule") || text.includes("date") || text.includes("time")) {
    return "schedule";
  }
  if (text.includes("contact") || text.includes("client") || text.includes("roster") || text.includes("team")) {
    return "client";
  }
  return "internal";
}

function mapReadinessStatus(item: SharedJobReadinessItem): JobMissingInfoStatus {
  if (item.is_complete) {
    return "resolved";
  }
  const text = normalizeText(`${item.section_key} ${item.label} ${item.description ?? ""} ${item.notes ?? ""}`);
  if (text.includes("client") || text.includes("approval") || text.includes("roster") || text.includes("contact") || text.includes("team")) {
    return "waiting_on_client";
  }
  if (text.includes("staff") || text.includes("production") || text.includes("assignment") || text.includes("internal")) {
    return "waiting_on_internal_team";
  }
  return item.is_blocker ? "open" : "waiting_on_internal_team";
}

function readinessItemToChecklist(item: SharedJobReadinessItem, ownerLabel: string): JobMissingInfoChecklistItem {
  const status = mapReadinessStatus(item);
  const title = mapReadinessTitle(item);
  return createChecklistItem({
    id: `readiness-${item.id}`,
    title,
    category: mapReadinessCategory(item),
    ownerLabel: item.completed_by_name ?? ownerLabel,
    dueDate: item.due_at,
    status,
    resolvedDate: item.completed_at,
    notes: item.notes ?? item.description,
    nextAction: status === "resolved" ? "Keep this note for blocker history." : title.startsWith("Missing") ? title.replace("Missing", "Collect").trim() : "Resolve this readiness item.",
    isBlocker: item.is_blocker && !item.is_complete
  });
}

function watchFlagToChecklist(flag: SharedJobWatchFlag, ownerLabel: string): JobMissingInfoChecklistItem {
  const flagText = normalizeText(`${flag.flag_type} ${flag.title} ${flag.description ?? ""}`);
  const isResolved = flag.status === "resolved" || flag.status === "dismissed";
  let title = flag.title;
  let category: JobMissingInfoCategory = "internal";
  let status: JobMissingInfoStatus = isResolved ? "resolved" : "open";
  let nextAction = "Review and clear the watch flag.";

  if (flagText.includes("approval") || flagText.includes("proof")) {
    title = "Client approval needed";
    category = "approval";
    status = isResolved ? "resolved" : "waiting_on_client";
    nextAction = "Follow up with the client approver.";
  } else if (flagText.includes("staff") || flagText.includes("coverage") || flagText.includes("assignment")) {
    title = "Missing photographer assignment";
    category = "staffing";
    status = isResolved ? "resolved" : "waiting_on_internal_team";
    nextAction = "Assign or confirm coverage.";
  } else if (flagText.includes("calendar") || flagText.includes("schedule") || flagText.includes("date")) {
    title = "Calendar conflict";
    category = "schedule";
    status = isResolved ? "resolved" : "waiting_on_internal_team";
    nextAction = "Resolve the schedule conflict.";
  }

  return createChecklistItem({
    id: `watch-${flag.id}`,
    title,
    category,
    ownerLabel: flag.owner_name ?? ownerLabel,
    dueDate: flag.due_at,
    status,
    resolvedDate: flag.resolved_at,
    notes: flag.description,
    nextAction,
    isBlocker: !isResolved && (flag.severity === "high" || flag.severity === "critical")
  });
}

function dedupeItems(items: JobMissingInfoChecklistItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.title}-${item.status}-${item.ownerLabel}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function sortItems(items: JobMissingInfoChecklistItem[]) {
  const rank: Record<JobMissingInfoStatus, number> = {
    open: 0,
    waiting_on_client: 1,
    waiting_on_internal_team: 2,
    resolved: 3
  };
  return [...items].sort((a, b) => rank[a.status] - rank[b.status] || a.title.localeCompare(b.title));
}

function buildSummary(items: JobMissingInfoChecklistItem[], primaryOwner: string): JobMissingInfoChecklistSummary {
  const sorted = sortItems(dedupeItems(items));
  const activeItems = sorted.filter((item) => item.status !== "resolved");
  const resolvedItems = sorted.filter((item) => item.status === "resolved");
  const nextAction = activeItems[0]?.nextAction ?? (resolvedItems.length ? "Review resolved blocker history." : "No missing information is active.");
  return {
    items: sorted,
    activeItems,
    resolvedItems,
    activeCount: activeItems.length,
    blockerCount: activeItems.filter((item) => item.isBlocker).length,
    waitingOnClientCount: activeItems.filter((item) => item.status === "waiting_on_client").length,
    waitingOnInternalCount: activeItems.filter((item) => item.status === "waiting_on_internal_team").length,
    resolvedCount: resolvedItems.length,
    primaryOwner,
    nextAction
  };
}

function buildListDerivedItems(item: SharedJobListItem): JobMissingInfoChecklistItem[] {
  const ownerLabel = getJobOwnerLabel(item);
  const ownerDepartment = ownerFromDepartment(item.department_type);
  const items: JobMissingInfoChecklistItem[] = [];
  const date = getListDate(item);
  const startTime = getListStartTime(item);
  const calendarReadiness = buildJobCalendarReadiness({
    date,
    startTime,
    endTime: item.primary_day_end_time ?? item.scheduled_end_at?.slice(11, 16) ?? null,
    dateOnly: !startTime,
    locationId: item.primary_location_id,
    contactId: item.primary_contact_id,
    primaryLocationName: item.primary_location_name,
    primaryContactName: item.primary_contact_name,
    staffingStatus: item.staffing_status,
    readinessStatus: item.readiness_status,
    riskStatus: item.risk_status,
    jobStatus: item.job_status,
    blockerCount: item.blocker_count,
    openWatchFlagCount: item.open_watch_flag_count,
    leadOwnerName: item.lead_owner_name,
    accountOwnerName: item.account_owner_name,
    estimatedStaffCount: item.estimated_staff_count
  });

  if (!hasValue(item.primary_contact_id) && !hasValue(item.primary_contact_name)) {
    items.push(createChecklistItem({ id: "derived-contact", title: "Missing contact", category: "client", ownerLabel: "Client Success", dueDate: item.client_deadline_at, status: "waiting_on_client", resolvedDate: null, notes: "Primary contact is not recorded.", nextAction: "Collect the primary contact.", isBlocker: true }));
  }
  if (!hasValue(item.primary_location_id) && !hasValue(item.primary_location_name)) {
    items.push(createChecklistItem({ id: "derived-location", title: "Missing location details", category: "schedule", ownerLabel: ownerDepartment, dueDate: date, status: "waiting_on_client", resolvedDate: null, notes: "Location is not ready for scheduling.", nextAction: "Confirm the shoot location.", isBlocker: true }));
  }
  if (!date) {
    items.push(createChecklistItem({ id: "derived-date", title: "Missing shoot date", category: "schedule", ownerLabel: ownerDepartment, dueDate: null, status: "waiting_on_client", resolvedDate: null, notes: "Shoot date is not recorded.", nextAction: "Confirm the shoot date.", isBlocker: true }));
  } else if (!startTime) {
    items.push(createChecklistItem({ id: "derived-call-time", title: "Missing call time", category: "schedule", ownerLabel: ownerDepartment, dueDate: date, status: "waiting_on_client", resolvedDate: null, notes: "Date exists, but call time is not final.", nextAction: "Confirm call time and expected end time.", isBlocker: false }));
  }
  if (item.school_profile && !hasValue(item.school_profile.roster_source)) {
    items.push(createChecklistItem({ id: "derived-roster", title: "Missing roster", category: "client", ownerLabel: "Schools", dueDate: item.school_profile.submission_deadline ?? item.client_deadline_at, status: "waiting_on_client", resolvedDate: null, notes: "Roster source is not recorded.", nextAction: "Request the roster from the school.", isBlocker: true }));
  }
  if (item.sports_profile && (!hasValue(item.sports_profile.league_name) || !item.sports_profile.estimated_team_count)) {
    items.push(createChecklistItem({ id: "derived-team-list", title: "Missing team list", category: "client", ownerLabel: "Sports", dueDate: item.client_deadline_at, status: "waiting_on_client", resolvedDate: null, notes: "League or team count is incomplete.", nextAction: "Collect team list and league details.", isBlocker: true }));
  }
  if (item.staffing_status === "unassigned" || item.staffing_status === "partially_staffed" || item.staffing_status === "gap_flagged") {
    items.push(createChecklistItem({ id: "derived-photographer-assignment", title: item.staffing_status === "gap_flagged" ? "Calendar conflict" : "Missing photographer assignment", category: "staffing", ownerLabel: ownerDepartment, dueDate: date, status: "waiting_on_internal_team", resolvedDate: null, notes: calendarReadiness.summary, nextAction: item.staffing_status === "gap_flagged" ? "Resolve staffing or calendar coverage." : "Assign photographer coverage.", isBlocker: item.staffing_status === "gap_flagged" }));
  }
  if (!hasValue(item.lead_owner_name) && !hasValue(item.account_owner_name)) {
    items.push(createChecklistItem({ id: "derived-shoot-manager", title: "Missing shoot manager", category: "staffing", ownerLabel: ownerDepartment, dueDate: date, status: "waiting_on_internal_team", resolvedDate: null, notes: "No lead owner is recorded.", nextAction: "Assign the shoot manager.", isBlocker: false }));
  }
  if (item.production_required && !item.production_deadline_at && ["awaiting_ingest", "editing", "awaiting_internal_review", "proof_build", "proof_sent", "awaiting_approval", "blocked"].includes(item.production_status)) {
    items.push(createChecklistItem({ id: "derived-production-deadline", title: "Missing production deadline", category: "production", ownerLabel: "Production", dueDate: item.client_deadline_at, status: "waiting_on_internal_team", resolvedDate: null, notes: "Production deadline is not recorded.", nextAction: "Set the production deadline.", isBlocker: false }));
  }
  if (item.production_status === "awaiting_approval" || item.production_status === "proof_sent" || item.proof_status === "awaiting_approval") {
    items.push(createChecklistItem({ id: "derived-client-approval", title: "Client approval needed", category: "approval", ownerLabel: "Client Success", dueDate: item.client_deadline_at, status: "waiting_on_client", resolvedDate: null, notes: "Proof or approval is waiting on the client.", nextAction: "Follow up on client approval.", isBlocker: false }));
  }
  if (item.production_status === "blocked" || item.blocker_count > 0 || item.open_watch_flag_count > 0) {
    items.push(createChecklistItem({ id: "derived-internal-blocker", title: "Waiting on internal team", category: "internal", ownerLabel, dueDate: date, status: "waiting_on_internal_team", resolvedDate: null, notes: "There is an active blocker or watch flag on this job.", nextAction: "Open the package and clear the active blocker.", isBlocker: true }));
  }

  return items;
}

function buildDetailDerivedItems(detail: SharedJobDetailResponse): JobMissingInfoChecklistItem[] {
  const listLike = {
    ...detail.job,
    organization_name: detail.summary.organization_name,
    primary_location_name: detail.summary.primary_location_name,
    primary_location_address: detail.summary.primary_location_address,
    primary_contact_name: detail.summary.primary_contact_name,
    account_owner_name: detail.summary.account_owner_name,
    lead_owner_user_id: detail.summary.lead_owner_user_id,
    lead_owner_name: detail.summary.lead_owner_name,
    primary_day_date: getDetailDate(detail),
    primary_day_start_time: getDetailStartTime(detail),
    primary_day_end_time: getDetailEndTime(detail),
    primary_day_label: detail.summary.primary_day_label,
    school_profile: detail.school_profile,
    sports_profile: detail.sports_profile,
    department_summary: detail.summary.department_summary,
    proof_status: detail.summary.proof_status,
    open_watch_flag_count: detail.status.open_watch_flag_count,
    readiness_percent: detail.status.readiness_percent,
    blocker_count: detail.status.blocker_count,
    day_count: detail.days.length,
    assigned_staff_count: detail.staff_assignments.length,
    checked_in_staff_count: detail.staff_assignments.filter((assignment) => assignment.check_in_at).length,
    ready_present_count: detail.staff_assignments.filter((assignment) => assignment.is_ready_present).length
  } satisfies SharedJobListItem;
  return buildListDerivedItems(listLike);
}

export function buildJobMissingInfoChecklist(source: SharedJobListItem | SharedJobDetailResponse): JobMissingInfoChecklistSummary {
  const primaryOwner = getJobOwnerLabel(source);
  if ("job" in source) {
    return buildSummary([
      ...buildDetailDerivedItems(source),
      ...source.readiness_items.map((item) => readinessItemToChecklist(item, primaryOwner)),
      ...source.watch_flags.map((flag) => watchFlagToChecklist(flag, primaryOwner))
    ], primaryOwner);
  }
  return buildSummary(buildListDerivedItems(source), primaryOwner);
}

export function getJobMissingInfoStatusLabel(status: JobMissingInfoStatus) {
  if (status === "waiting_on_client") {
    return "Waiting on client";
  }
  if (status === "waiting_on_internal_team") {
    return "Waiting on internal team";
  }
  if (status === "resolved") {
    return "Resolved";
  }
  return "Open";
}

export function getJobMissingInfoStatusTone(item: Pick<JobMissingInfoChecklistItem, "status" | "isBlocker">): JobMissingInfoTone {
  return mapStatusTone(item.status, item.isBlocker);
}

export function getJobMissingInfoCategoryLabel(category: JobMissingInfoCategory) {
  if (category === "client") {
    return "Client info";
  }
  if (category === "schedule") {
    return "Schedule";
  }
  if (category === "staffing") {
    return "Staffing";
  }
  if (category === "production") {
    return "Production";
  }
  if (category === "approval") {
    return "Approval";
  }
  return "Internal";
}
