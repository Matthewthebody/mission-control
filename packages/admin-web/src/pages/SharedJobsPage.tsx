import { useEffect, useMemo, useState } from "react";
import { HelpTooltip } from "../components/HelpTooltip";
import { usePermission } from "../components/PermissionGate";
import { SharedJobListShell } from "../components/jobs/SharedJobListShell";
import {
  BASELINE_FILTER_STATE,
  getDepartmentJobAdapterUI,
  type SharedJobListColumnDefinition,
  type SharedJobListFilterState
} from "../components/jobs/DepartmentJobAdapterUIRegistry";
import { navigateToSharedJobHash } from "../components/jobs/sharedJobRouting";
import { DetailPreviewPanel, RiskBadge, SavedViewBar, StatusPill, formatDate, formatTimeRange, humanizeToken, statusTone, useHashRouteSnapshot } from "../components/sports/SportsPrimitives";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import type { SharedJobListItem } from "../jobTruthTypes";
import { buildJobCalendarReadiness } from "../jobCalendarReadiness";
import { buildDetailsConfirmationFromJobListItem, detailsConfirmationChipLabel } from "../jobDetailsConfirmation";
import {
  buildJobMissingInfoChecklist,
  getJobMissingInfoStatusLabel,
  getJobMissingInfoStatusTone
} from "../jobMissingInfoChecklist";
import { canCreateShootRecords, canManageSchoolsHub, canManageSportsWorkspace } from "../permissions";
import { listSharedJobs } from "../services/jobsApi";
import type { SessionUser } from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  departmentType: "schools" | "sports" | null;
  routeBase: string;
};

const JOBS_PAGE_SIZES = [10, 25, 50] as const;

function readFilterState(params: URLSearchParams, departmentType: "schools" | "sports" | null): SharedJobListFilterState {
  return {
    ...BASELINE_FILTER_STATE,
    departmentType: params.get("departmentType") ?? (departmentType ?? ""),
    search: params.get("search") ?? "",
    dateRange: params.get("dateRange") ?? "all",
    organizationId: params.get("organizationId") ?? "",
    jobCategory: params.get("jobCategory") ?? "",
    primaryContactId: params.get("primaryContactId") ?? "",
    locationId: params.get("locationId") ?? "",
    accountOwnerUserId: params.get("accountOwnerUserId") ?? "",
    leadOwnerUserId: params.get("leadOwnerUserId") ?? "",
    jobStatus: params.get("jobStatus") ?? "",
    productionStatus: params.get("productionStatus") ?? "",
    releaseStatus: params.get("releaseStatus") ?? "",
    staffingStatus: params.get("staffingStatus") ?? "",
    readinessStatus: params.get("readinessStatus") ?? "",
    riskStatus: params.get("riskStatus") ?? "",
    archived: params.get("archived") ?? "active",
    schoolYear: params.get("schoolYear") ?? "",
    districtId: params.get("districtId") ?? "",
    yearbookRequired: params.get("yearbookRequired") ?? "",
    idCardsRequired: params.get("idCardsRequired") ?? "",
    rosterMode: params.get("rosterMode") ?? "",
    sportType: params.get("sportType") ?? "",
    season: params.get("season") ?? "",
    proofRequired: params.get("proofRequired") ?? "",
    bannerRequired: params.get("bannerRequired") ?? "",
    revenueShareEnabled: params.get("revenueShareEnabled") ?? ""
  };
}

function writeFilterState(routeBase: string, filters: SharedJobListFilterState, extras: Record<string, string | null | undefined> = {}) {
  navigateToSharedJobHash(routeBase, "", {
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)),
    ...extras
  });
}

function withinDateRange(item: SharedJobListItem, dateRange: string) {
  if (!dateRange || dateRange === "all") {
    return true;
  }
  const anchor = item.primary_day_date ?? item.scheduled_start_at?.slice(0, 10) ?? null;
  if (!anchor) {
    return false;
  }
  const target = new Date(anchor);
  const now = new Date();
  const diffDays = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (dateRange === "next-7") {
    return diffDays >= 0 && diffDays <= 7;
  }
  if (dateRange === "next-14") {
    return diffDays >= 0 && diffDays <= 14;
  }
  if (dateRange === "overdue") {
    return diffDays < 0;
  }
  return true;
}

function matchesYesNoFilter(value: boolean, filterValue: string) {
  if (!filterValue) {
    return true;
  }
  return filterValue === "yes" ? value : !value;
}

const CALENDAR_READINESS_FILTERS = new Set([
  "needs_date",
  "date_requested",
  "date_conflict",
  "ready_for_calendar",
  "calendar_confirmed",
  "staffing_needed",
  "shoot_manager_needed",
  "shoot_manager_assigned"
]);

function matchesSearch(item: SharedJobListItem, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) {
    return true;
  }
  const fields = [
    getJobTitle(item),
    item.job_number,
    item.event_name,
    item.organization_name,
    getDepartmentLabel(item.department_type),
    humanizeToken(item.job_category),
    getJobOwnerName(item),
    getManagementStage(item),
    getCalendarReadiness(item).label,
    item.primary_contact_name,
    item.primary_location_name
  ];
  return fields.some((field) => field?.toLowerCase().includes(query));
}

function matchesBlockedMissingFilter(item: SharedJobListItem, filterValue: string) {
  if (!filterValue) {
    return true;
  }
  const missingInfo = buildJobMissingInfoChecklist(item);
  if (filterValue === "blocked") {
    return missingInfo.blockerCount > 0 || item.production_status === "blocked" || item.blocker_count > 0 || item.open_watch_flag_count > 0;
  }
  if (filterValue === "missing_info") {
    return missingInfo.activeCount > 0;
  }
  if (filterValue === "waiting_client") {
    return missingInfo.waitingOnClientCount > 0;
  }
  if (filterValue === "waiting_internal") {
    return missingInfo.waitingOnInternalCount > 0;
  }
  if (filterValue === "clear") {
    return missingInfo.activeCount === 0 && !jobNeedsAttention(item);
  }
  return item.risk_status === filterValue;
}

function applyLocalFilters(items: SharedJobListItem[], filters: SharedJobListFilterState) {
  return items.filter((item) => {
    if (!matchesSearch(item, filters.search)) {
      return false;
    }
    if (filters.archived === "active" && item.archived_at) {
      return false;
    }
    if (filters.archived === "archived" && !item.archived_at) {
      return false;
    }
    if (filters.departmentType && item.department_type !== filters.departmentType) {
      return false;
    }
    if (filters.organizationId && item.organization_id !== filters.organizationId) {
      return false;
    }
    if (filters.jobCategory && item.job_category !== filters.jobCategory) {
      return false;
    }
    if (filters.primaryContactId && item.primary_contact_id !== filters.primaryContactId) {
      return false;
    }
    if (filters.locationId && item.primary_location_id !== filters.locationId) {
      return false;
    }
    if (filters.accountOwnerUserId && item.account_owner_user_id !== filters.accountOwnerUserId) {
      return false;
    }
    if (filters.leadOwnerUserId && item.lead_owner_user_id !== filters.leadOwnerUserId && item.account_owner_user_id !== filters.leadOwnerUserId) {
      return false;
    }
    if (filters.jobStatus) {
      if (filters.jobStatus.startsWith("stage:")) {
        if (getManagementStage(item) !== filters.jobStatus.slice("stage:".length)) {
          return false;
        }
      } else if (item.job_status !== filters.jobStatus) {
        return false;
      }
    }
    if (filters.productionStatus && item.production_status !== filters.productionStatus) {
      return false;
    }
    if (filters.releaseStatus && (item.proof_status ?? item.gallery_type ?? "") !== filters.releaseStatus) {
      return false;
    }
    if (filters.staffingStatus && item.staffing_status !== filters.staffingStatus) {
      return false;
    }
    if (filters.readinessStatus) {
      if (CALENDAR_READINESS_FILTERS.has(filters.readinessStatus)) {
        if (getCalendarReadiness(item).status !== filters.readinessStatus) {
          return false;
        }
      } else if (item.readiness_status !== filters.readinessStatus) {
        return false;
      }
    }
    if (!matchesBlockedMissingFilter(item, filters.riskStatus)) {
      return false;
    }
    if (!withinDateRange(item, filters.dateRange)) {
      return false;
    }
    if (filters.schoolYear && ((filters.schoolYear === "current" && !item.school_profile?.school_year?.includes(String(new Date().getFullYear()))) || (filters.schoolYear === "next" && !item.school_profile?.school_year?.includes(String(new Date().getFullYear() + 1))))) {
      return false;
    }
    if (filters.districtId === "assigned" && !item.school_profile?.district_id) {
      return false;
    }
    if (filters.districtId === "missing" && item.school_profile?.district_id) {
      return false;
    }
    if (!matchesYesNoFilter(item.school_profile?.yearbook_required ?? false, filters.yearbookRequired)) {
      return false;
    }
    if (!matchesYesNoFilter(item.school_profile?.id_cards_required ?? false, filters.idCardsRequired)) {
      return false;
    }
    if (filters.sportType && item.sports_profile?.sport_type !== filters.sportType) {
      return false;
    }
    if (filters.season && item.sports_profile?.season !== filters.season) {
      return false;
    }
    if (!matchesYesNoFilter(item.sports_profile?.proof_required ?? false, filters.proofRequired)) {
      return false;
    }
    if (!matchesYesNoFilter(item.sports_profile?.banner_work_required ?? false, filters.bannerRequired)) {
      return false;
    }
    if (!matchesYesNoFilter(item.sports_profile?.revenue_share_enabled ?? false, filters.revenueShareEnabled)) {
      return false;
    }
    return true;
  });
}

type SelectOption = {
  value: string;
  label: string;
};

function uniqueOptions(values: Array<SelectOption | null | undefined>) {
  const byValue = new Map<string, string>();
  values.forEach((option) => {
    if (!option?.value || !option.label) {
      return;
    }
    byValue.set(option.value, option.label);
  });
  return [...byValue.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function buildDatabaseOptions(items: SharedJobListItem[]) {
  return {
    organizations: uniqueOptions(items.map((item) => (item.organization_id ? { value: item.organization_id, label: item.organization_name ?? item.organization_id } : null))),
    categories: uniqueOptions(items.map((item) => (item.job_category ? { value: item.job_category, label: humanizeToken(item.job_category) } : null))),
    statuses: uniqueOptions(items.map((item) => (item.job_status ? { value: item.job_status, label: humanizeToken(item.job_status) } : null))),
    productionStatuses: uniqueOptions(items.map((item) => (item.production_status ? { value: item.production_status, label: humanizeToken(item.production_status) } : null))),
    releaseStatuses: uniqueOptions(items.map((item) => {
      const value = item.proof_status ?? item.gallery_type ?? "";
      return value ? { value, label: humanizeToken(value) } : null;
    })),
    risks: uniqueOptions(items.map((item) => (item.risk_status ? { value: item.risk_status, label: humanizeToken(item.risk_status) } : null))),
    stages: uniqueOptions(items.map((item) => ({ value: `stage:${getManagementStage(item)}`, label: getManagementStage(item) }))),
    owners: uniqueOptions(
      items.flatMap((item) => [
        item.account_owner_user_id ? { value: item.account_owner_user_id, label: item.account_owner_name ?? item.account_owner_user_id } : null,
        item.lead_owner_user_id ? { value: item.lead_owner_user_id, label: item.lead_owner_name ?? item.lead_owner_user_id } : null
      ])
    )
  };
}

function getJobTitle(item: SharedJobListItem) {
  return item.title || item.event_name || item.job_number || "Untitled job";
}

function getDepartmentLabel(value: string | null | undefined) {
  switch (value) {
    case "schools":
      return "Schools";
    case "sports":
      return "Sports";
    case "headshots":
      return "Photography";
    case "corporate":
      return "Corporate";
    case "other":
      return "Specialty";
    default:
      return value ? humanizeToken(value) : "Unassigned";
  }
}

function getJobOwnerName(item: SharedJobListItem) {
  return item.lead_owner_name ?? item.account_owner_name ?? "Unassigned";
}

function formatJobDate(item: SharedJobListItem) {
  const date = item.primary_day_date ?? item.scheduled_start_at?.slice(0, 10) ?? null;
  if (!date) {
    return "TBD";
  }
  const startTime = item.primary_day_start_time ?? item.scheduled_start_at?.slice(11, 16) ?? null;
  const endTime = item.primary_day_end_time ?? item.scheduled_end_at?.slice(11, 16) ?? null;
  return `${formatDate(date)}${startTime ? ` | ${formatTimeRange(startTime, endTime)}` : ""}`;
}

function jobNeedsAttention(item: SharedJobListItem) {
  return (
    item.risk_status === "high" ||
    item.risk_status === "critical" ||
    item.readiness_status === "at_risk" ||
    item.readiness_status === "off_track" ||
    item.production_status === "blocked" ||
    item.staffing_status === "gap_flagged" ||
    item.blocker_count > 0 ||
    item.open_watch_flag_count > 0
  );
}

function getAttentionTone(item: SharedJobListItem): "neutral" | "success" | "warning" | "danger" {
  const missingInfo = buildJobMissingInfoChecklist(item);
  if (missingInfo.blockerCount > 0 || item.risk_status === "critical" || item.production_status === "blocked" || item.blocker_count > 0 || item.open_watch_flag_count > 0) {
    return "danger";
  }
  if (missingInfo.activeCount > 0 || jobNeedsAttention(item)) {
    return "warning";
  }
  return "success";
}

function getAttentionLabel(item: SharedJobListItem) {
  const missingInfo = buildJobMissingInfoChecklist(item);
  if (missingInfo.blockerCount > 0) {
    return `${missingInfo.blockerCount} blocker${missingInfo.blockerCount === 1 ? "" : "s"}`;
  }
  if (missingInfo.activeCount > 0) {
    return `${missingInfo.activeCount} missing`;
  }
  if (item.blocker_count > 0) {
    return `${item.blocker_count} blocker${item.blocker_count === 1 ? "" : "s"}`;
  }
  if (item.open_watch_flag_count > 0) {
    return `${item.open_watch_flag_count} issue${item.open_watch_flag_count === 1 ? "" : "s"}`;
  }
  if (item.production_status === "blocked") {
    return "Production blocked";
  }
  if (item.risk_status === "critical" || item.risk_status === "high") {
    return humanizeToken(item.risk_status);
  }
  if (item.readiness_status === "at_risk" || item.readiness_status === "off_track") {
    return humanizeToken(item.readiness_status);
  }
  if (item.staffing_status === "gap_flagged") {
    return "Staffing gap";
  }
  return "Clear";
}

function jobHasMissingInfo(item: SharedJobListItem) {
  return buildJobMissingInfoChecklist(item).activeCount > 0;
}

function getCalendarReadiness(item: SharedJobListItem) {
  return buildJobCalendarReadiness({
    date: item.primary_day_date ?? item.scheduled_start_at?.slice(0, 10) ?? null,
    startTime: item.primary_day_start_time ?? item.scheduled_start_at?.slice(11, 16) ?? null,
    endTime: item.primary_day_end_time ?? item.scheduled_end_at?.slice(11, 16) ?? null,
    dateOnly: !item.primary_day_start_time && !item.scheduled_start_at,
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
}

function jobReadyForCalendar(item: SharedJobListItem) {
  const readiness = getCalendarReadiness(item);
  return readiness.status === "ready_for_calendar" || readiness.status === "calendar_confirmed";
}

function jobIsActiveThisWeek(item: SharedJobListItem) {
  const anchor = item.primary_day_date ?? item.scheduled_start_at?.slice(0, 10) ?? null;
  if (!anchor) {
    return false;
  }
  const target = new Date(anchor);
  const now = new Date();
  const diffDays = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= 7;
}

function jobRecentlyCompleted(item: SharedJobListItem) {
  return item.job_status === "execution_complete" || item.production_status === "delivered" || item.production_status === "complete";
}

function getManagementStage(item: SharedJobListItem) {
  const missingInfo = buildJobMissingInfoChecklist(item);
  if (item.archived_at) {
    return "Cancelled";
  }
  if (jobRecentlyCompleted(item)) {
    return "Complete";
  }
  if (missingInfo.blockerCount > 0 || item.production_status === "blocked" || item.blocker_count > 0 || item.open_watch_flag_count > 0) {
    return "Blocked";
  }
  if (item.job_status === "draft") {
    return "Draft Intake";
  }
  if (item.job_status === "pending_confirmation") {
    return "Intake Review";
  }
  if (jobHasMissingInfo(item)) {
    return "Missing Info";
  }
  if (jobReadyForCalendar(item) && item.job_status === "confirmed") {
    return "Calendar Confirmed";
  }
  if (jobReadyForCalendar(item)) {
    return "Ready For Calendar";
  }
  if (item.job_status === "ready_to_staff" || item.job_status === "staffed") {
    return "Shoot Scheduled";
  }
  if (item.job_status === "in_progress" || item.job_status === "ready_to_execute") {
    return "Photography Prep";
  }
  if (item.production_required) {
    return "Production";
  }
  return "Client Follow-Up";
}

function getNextStep(item: SharedJobListItem) {
  const missingInfo = buildJobMissingInfoChecklist(item);
  if (missingInfo.activeCount > 0) {
    return missingInfo.nextAction;
  }
  if (item.production_status === "blocked") {
    return "Unblock production";
  }
  if (item.readiness_status === "off_track" || item.readiness_status === "at_risk") {
    return "Resolve readiness";
  }
  if (item.staffing_status === "gap_flagged" || item.staffing_status === "unassigned" || item.staffing_status === "partially_staffed") {
    return "Confirm staffing";
  }
  if (item.job_status === "draft" || item.job_status === "intake_blocked" || item.job_status === "pending_confirmation") {
    return "Confirm job details";
  }
  if (item.job_status === "execution_complete" && item.production_status !== "complete") {
    return "Move through production";
  }
  if (item.production_status === "awaiting_approval" || item.production_status === "proof_sent") {
    return "Follow up on approval";
  }
  if (item.production_status === "delivered" || item.production_status === "complete") {
    return "Review completed record";
  }
  return "Open job";
}

function buildJobManagementStats(items: SharedJobListItem[]) {
  return [
    { key: "needs-review", label: "Needs review", value: items.filter((item) => item.job_status === "draft" || item.job_status === "pending_confirmation").length, detail: "Draft or pending job intake." },
    { key: "missing-info", label: "Missing info", value: items.filter(jobHasMissingInfo).length, detail: "Roster, team, contact, date, staffing, approval, or blocker gaps." },
    { key: "waiting-client", label: "Waiting on client", value: items.filter((item) => buildJobMissingInfoChecklist(item).waitingOnClientCount > 0).length, detail: "Jobs waiting on client information or approval." },
    { key: "waiting-internal", label: "Waiting internal", value: items.filter((item) => buildJobMissingInfoChecklist(item).waitingOnInternalCount > 0).length, detail: "Jobs waiting on team assignment or internal cleanup." },
    { key: "ready-calendar", label: "Ready for calendar", value: items.filter(jobReadyForCalendar).length, detail: "Enough information to review for scheduling." },
    { key: "calendar-confirmed", label: "Calendar confirmed", value: items.filter((item) => getCalendarReadiness(item).status === "calendar_confirmed").length, detail: "Date, time, location, contact, and owner are in place." },
    { key: "details-confirm", label: "Confirm details", value: items.filter((item) => {
      const cue = buildDetailsConfirmationFromJobListItem(item);
      return cue.state === "confirmation_due" || cue.state === "reconfirm";
    }).length, detail: "Jobs close enough to the shoot that details should be verified." },
    { key: "active-week", label: "Active this week", value: items.filter(jobIsActiveThisWeek).length, detail: "Jobs with a date inside the next seven days." },
    { key: "blocked", label: "Blocked", value: items.filter((item) => item.production_status === "blocked" || item.blocker_count > 0 || item.open_watch_flag_count > 0).length, detail: "Work with blockers or open watch flags." },
    { key: "completed", label: "Recently completed", value: items.filter(jobRecentlyCompleted).length, detail: "Jobs that have reached completion or delivery." }
  ];
}

function buildIntakeReviewQueue(items: SharedJobListItem[]) {
  return [
    { key: "needs-review", label: "Needs review", value: items.filter((item) => item.job_status === "draft" || item.job_status === "pending_confirmation").length, action: "Open intake", detail: "Review client, date, owner, and first handoff." },
    { key: "missing-info", label: "Missing info", value: items.filter(jobHasMissingInfo).length, action: "Request missing info", detail: "Show exactly what is missing, who owns it, and what happens next." },
    { key: "waiting-client", label: "Waiting on client", value: items.filter((item) => buildJobMissingInfoChecklist(item).waitingOnClientCount > 0).length, action: "Follow up", detail: "Roster, contact, team list, date, or approval is outside the building." },
    { key: "waiting-internal", label: "Waiting internal", value: items.filter((item) => buildJobMissingInfoChecklist(item).waitingOnInternalCount > 0).length, action: "Assign owner", detail: "Staffing, production deadline, or internal handoff needs ownership." },
    { key: "ready-launch", label: "Ready to launch", value: items.filter((item) => !jobHasMissingInfo(item) && !jobNeedsAttention(item)).length, action: "Prepare handoff", detail: "Clean jobs ready for department handoff." },
    { key: "recently-launched", label: "Recently launched", value: items.filter((item) => item.job_status === "confirmed" || item.job_status === "ready_to_staff").length, action: "Review route", detail: "Recently approved jobs moving into operations." }
  ];
}

function getGlobalJobColumns(routeBase: string): SharedJobListColumnDefinition[] {
  return [
    {
      key: "job",
      label: "Job",
      render: (item) => (
        <div className="shared-job-table__job">
          <strong>{getJobTitle(item)}</strong>
          <span className="shared-job-table__muted">{item.job_number ?? "Draft job"}</span>
        </div>
      )
    },
    { key: "organization", label: "Organization", render: (item) => item.organization_name ?? "Unassigned" },
    { key: "date", label: "Date", render: (item) => formatJobDate(item) },
    { key: "calendar", label: "Calendar Readiness", render: (item) => {
      const readiness = getCalendarReadiness(item);
      return <StatusPill label={readiness.label} tone={readiness.tone} />;
    } },
    { key: "details_confirmation", label: "Details Confirmation", render: (item) => {
      const cue = buildDetailsConfirmationFromJobListItem(item);
      return <StatusPill label={detailsConfirmationChipLabel(cue)} tone={cue.tone} />;
    } },
    { key: "missing_info", label: "Missing Info", render: (item) => {
      const checklist = buildJobMissingInfoChecklist(item);
      const firstActive = checklist.activeItems[0];
      return firstActive ? (
        <div className="job-missing-info-cell">
          <StatusPill label={`${checklist.activeCount} open`} tone={getJobMissingInfoStatusTone(firstActive)} />
          <span>{firstActive.title}</span>
        </div>
      ) : (
        <StatusPill label="Clear" tone="success" />
      );
    } },
    { key: "department", label: "Department", render: (item) => <StatusPill label={getDepartmentLabel(item.department_type)} tone="neutral" /> },
    { key: "status", label: "Status", render: (item) => <StatusPill label={humanizeToken(item.job_status)} tone={statusTone(item.job_status)} /> },
    { key: "stage", label: "Stage", render: (item) => <StatusPill label={getManagementStage(item)} tone={jobNeedsAttention(item) ? "warning" : "info"} /> },
    { key: "owner", label: "Lead Owner", render: (item) => getJobOwnerName(item) },
    { key: "next_step", label: "Next Step", render: (item) => <span className="shared-job-table__next-step">{getNextStep(item)}</span> },
    { key: "attention", label: "Needs Attention", render: (item) => <StatusPill label={getAttentionLabel(item)} tone={getAttentionTone(item)} /> },
    {
      key: "record",
      label: "Record",
      render: (item) => (
        <button
          type="button"
          className="secondary-button shared-job-table__open-button"
          onClick={(event) => {
            event.stopPropagation();
            navigateToSharedJobHash(routeBase, item.id);
          }}
        >
          Open job
        </button>
      )
    }
  ];
}

function paginateItems<T>(items: T[], currentPage: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(currentPage, 1), totalPages);
  const startIndex = (safePage - 1) * pageSize;
  return {
    currentPage: safePage,
    totalPages,
    startIndex,
    endIndex: Math.min(startIndex + pageSize, items.length),
    items: items.slice(startIndex, startIndex + pageSize)
  };
}

export function SharedJobsPage({ token, currentUser, departmentType, routeBase }: Props) {
  const { params } = useHashRouteSnapshot();
  const adapter = departmentType ? getDepartmentJobAdapterUI(departmentType) : null;
  const [items, setItems] = useState<SharedJobListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(params.get("preview"));
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState(1);
  const filters = useMemo(() => readFilterState(params, departmentType), [departmentType, params]);
  const permissionContext = { departmentType: (departmentType ?? filters.departmentType) || null };
  const canCreateByPolicy = usePermission(currentUser, "job.create", permissionContext);
  const canUpdateByPolicy = usePermission(currentUser, "job.update", permissionContext);
  const createAllowed = canCreateByPolicy || (departmentType === "schools" ? canManageSchoolsHub(currentUser) || canCreateShootRecords(currentUser) : departmentType === "sports" ? canManageSportsWorkspace(currentUser) || canCreateShootRecords(currentUser) : canCreateShootRecords(currentUser));
  const isGlobalJobsPage = departmentType == null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void listSharedJobs(token, { department_type: departmentType ?? "all", search: null }).then((response) => {
      if (!cancelled) {
        setItems(response.jobs);
        setSelectedJobId((current) => current ?? response.jobs[0]?.id ?? null);
      }
    }).catch((loadError) => {
      if (!cancelled) {
        setItems([]);
        console.error("Unable to load shared jobs", loadError);
        setError("Jobs are not available in this demo view. Refresh if this does not resolve.");
      }
    }).finally(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [departmentType, token]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, pageSize]);

  const filteredItems = useMemo(() => applyLocalFilters(items, filters), [filters, items]);
  const pagedItems = useMemo(() => paginateItems(filteredItems, currentPage, pageSize), [currentPage, filteredItems, pageSize]);
  const selectedItem = filteredItems.find((item) => item.id === selectedJobId) ?? pagedItems.items[0] ?? null;
  const columns = useMemo(() => (adapter ? adapter.getListColumns() : getGlobalJobColumns(routeBase)), [adapter, routeBase]);
  const filterDefinitions = useMemo(() => (adapter ? adapter.getFilterDefinitions() : []), [adapter]);
  const presetViews = useMemo(() => (adapter ? adapter.getSavedViewPresets() : []), [adapter]);
  const databaseOptions = useMemo(() => buildDatabaseOptions(items), [items]);
  const activeSavedViewKey = params.get("savedView") ?? "";

  function applySavedView(view: (typeof presetViews)[number]) {
    writeFilterState(routeBase, { ...BASELINE_FILTER_STATE, ...filters, ...view.filters, departmentType: departmentType ?? filters.departmentType }, { savedView: view.key, preview: selectedItem?.id ?? null });
  }

  if (loading) {
    return <WorkspaceLoadingBlock title="Loading jobs" summary="Opening the job database." />;
  }

  const viewLibrary = presetViews;
  const visibleStart = filteredItems.length ? pagedItems.startIndex + 1 : 0;
  const visibleEnd = pagedItems.endIndex;
  const attentionCount = filteredItems.filter((item) => item.readiness_status === "at_risk" || item.readiness_status === "off_track" || item.risk_status === "high" || item.risk_status === "critical").length;
  const managementStats = isGlobalJobsPage ? buildJobManagementStats(filteredItems) : [];
  const intakeReviewQueue = isGlobalJobsPage ? buildIntakeReviewQueue(filteredItems) : [];

  return (
    <SharedJobListShell
      eyebrow={adapter?.labels.departmentBadge ?? "Database"}
      title={adapter?.listTitle ?? "Jobs"}
      summary={adapter ? `Search, filter, and review ${adapter.labels.listScope.toLowerCase()} with department-specific columns and saved views.` : "Find active jobs, review missing info, and start new job intake."}
      meta={[
        { label: `${filteredItems.length} visible`, tone: "info" },
        { label: `${attentionCount} attention`, tone: attentionCount ? "warning" : "success" }
      ]}
      actions={
        isGlobalJobsPage || createAllowed ? (
        <WorkspaceActionBar align="end">
          <button type="button" onClick={() => navigateToSharedJobHash(routeBase, "new", departmentType ? {} : { department: filters.departmentType || "sports" })} disabled={!isGlobalJobsPage && !createAllowed}>
            {isGlobalJobsPage ? "Start New Job" : adapter?.createTitle ?? "New Job"}
          </button>
        </WorkspaceActionBar>
        ) : null
      }
      savedViews={
        isGlobalJobsPage || !viewLibrary.length ? null : (
        <div className="shared-job-list__saved-views">
          <SavedViewBar views={viewLibrary.map((view) => ({ key: view.key, label: view.label }))} activeKey={activeSavedViewKey || null} onSelect={(key) => {
            const view = viewLibrary.find((candidate) => candidate.key === key);
            if (view) {
              applySavedView(view);
            }
          }} />
        </div>
        )
      }
      filters={
        <div className="shared-job-list__filter-grid">
          <label className="filter-field filter-field--wide">
            <span>Search Jobs</span>
            <input value={filters.search} onChange={(event) => writeFilterState(routeBase, { ...filters, search: event.target.value }, { preview: selectedItem?.id ?? null, savedView: activeSavedViewKey || null })} placeholder="Search by job, organization, job type, owner, or stage..." />
          </label>
          {isGlobalJobsPage ? (
            <>
              <label className="filter-field">
                <span>Department</span>
                <select value={filters.departmentType} onChange={(event) => writeFilterState(routeBase, { ...filters, departmentType: event.target.value }, { preview: selectedItem?.id ?? null })}>
                  <option value="">All departments</option>
                  <option value="schools">Schools</option>
                  <option value="sports">Sports</option>
                  <option value="headshots">Photography</option>
                  <option value="other">Specialty</option>
                </select>
              </label>
              <label className="filter-field">
                <span>Stage</span>
                <select value={filters.jobStatus} onChange={(event) => writeFilterState(routeBase, { ...filters, jobStatus: event.target.value }, { preview: selectedItem?.id ?? null })}>
                  <option value="">All stages</option>
                  {databaseOptions.stages.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Calendar readiness</span>
                <select value={filters.readinessStatus} onChange={(event) => writeFilterState(routeBase, { ...filters, readinessStatus: event.target.value }, { preview: selectedItem?.id ?? null })}>
                  <option value="">All calendar states</option>
                  <option value="needs_date">Needs date</option>
                  <option value="date_requested">Date requested</option>
                  <option value="date_conflict">Date conflict</option>
                  <option value="ready_for_calendar">Ready for calendar</option>
                  <option value="calendar_confirmed">Calendar confirmed</option>
                  <option value="staffing_needed">Staffing needed</option>
                  <option value="shoot_manager_needed">Shoot manager needed</option>
                </select>
              </label>
              <label className="filter-field">
                <span>Blocked / Missing info</span>
                <select value={filters.riskStatus} onChange={(event) => writeFilterState(routeBase, { ...filters, riskStatus: event.target.value }, { preview: selectedItem?.id ?? null })}>
                  <option value="">All jobs</option>
                  <option value="blocked">Blocked</option>
                  <option value="missing_info">Missing info</option>
                  <option value="waiting_client">Waiting on client</option>
                  <option value="waiting_internal">Waiting on internal team</option>
                  <option value="clear">Clear</option>
                </select>
              </label>
            </>
          ) : filterDefinitions.map((definition) => (
            <label key={definition.key} className="filter-field">
              <span>{definition.label}</span>
              <select value={(filters as Record<string, string>)[definition.key] ?? ""} onChange={(event) => writeFilterState(routeBase, { ...filters, [definition.key]: event.target.value }, { preview: selectedItem?.id ?? null, savedView: activeSavedViewKey || null })}>
                {definition.options.map((option) => (
                  <option key={`${definition.key}-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      }
      content={
        <div className="shared-job-list__database">
          {error ? <div className="shared-job-list__error" role="alert">{error}</div> : null}
          {isGlobalJobsPage ? (
            <section className="job-management-summary" aria-label="Job management summary">
              <div className="job-management-summary__header">
                <div>
                  <strong>Job Snapshot</strong>
                  <span>Review intake state, calendar readiness, blockers, and active work.</span>
                </div>
              </div>
              <div className="job-management-summary__cards">
                {managementStats.map((stat) => (
                  <article key={stat.key}>
                    <span>{stat.label}</span>
                    <strong>{stat.value}</strong>
                    <small>{stat.detail}</small>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          {isGlobalJobsPage ? (
            <section className="intake-review-queue" aria-label="Intake review queue">
              <div>
                <strong>Intake Review Queue</strong>
                <span>Approve intake details before preparing the first department handoff.</span>
              </div>
              <div className="intake-review-queue__cards">
                {intakeReviewQueue.map((item) => (
                  <article key={item.key}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <small>{item.detail}</small>
                    <em>{item.action}</em>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          <div className="shared-job-list__database-toolbar">
            <span>Showing {visibleStart}-{visibleEnd} of {filteredItems.length} jobs</span>
            <label className="filter-field filter-field--compact">
              <span>Per page</span>
              <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} aria-label="Jobs per page">
                {JOBS_PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>{size} per page</option>
                ))}
              </select>
            </label>
          </div>
          <div className="shared-job-list__table-wrap">
            <table className="shared-job-table">
              <thead>
                <tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
              </thead>
              <tbody>
                {pagedItems.items.map((item) => (
                  <tr key={item.id} className={selectedItem?.id === item.id ? "is-selected" : ""} onClick={() => {
                    setSelectedJobId(item.id);
                    writeFilterState(routeBase, filters, { preview: item.id, savedView: activeSavedViewKey || null });
                  }}>
                    {columns.map((column) => <td key={`${item.id}-${column.key}`}>{column.render(item)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="shared-job-list__pagination" aria-label="Jobs pagination">
            <button type="button" className="secondary-button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={pagedItems.currentPage <= 1}>
              Previous
            </button>
            <span>Page {pagedItems.currentPage} of {pagedItems.totalPages}</span>
            <button type="button" className="secondary-button" onClick={() => setCurrentPage((page) => Math.min(pagedItems.totalPages, page + 1))} disabled={pagedItems.currentPage >= pagedItems.totalPages}>
              Next
            </button>
          </div>
        </div>
      }
      emptyState={!filteredItems.length ? { title: "No jobs match these filters", summary: "Adjust search or filters to find a school, sports, photography, or specialty job.", actions: !isGlobalJobsPage && createAllowed ? <button type="button" onClick={() => navigateToSharedJobHash(routeBase, "new", departmentType ? {} : { department: filters.departmentType || "sports" })}>Create job</button> : null } : null}
      preview={
        selectedItem ? (
          <DetailPreviewPanel
            title={selectedItem.title || selectedItem.event_name || selectedItem.job_number || "Selected job"}
            subtitle={`${selectedItem.organization_name ?? "No organization"} | ${selectedItem.job_number ?? "Draft"}`}
            actions={
              <WorkspaceActionBar align="end" compact>
                <button type="button" className="secondary-button" onClick={() => navigateToSharedJobHash(routeBase, selectedItem.id)}>Open Full Job Detail</button>
                {canUpdateByPolicy ? <button type="button" className="secondary-button" onClick={() => navigateToSharedJobHash(routeBase, `${selectedItem.id}/edit`)}>Edit</button> : null}
              </WorkspaceActionBar>
            }
          >
            {(() => {
              const calendarReadiness = getCalendarReadiness(selectedItem);
              const missingInfo = buildJobMissingInfoChecklist(selectedItem);
              const detailsConfirmation = buildDetailsConfirmationFromJobListItem(selectedItem);
              return (
                <>
            <div className="shared-job-preview__grid">
              <div><span>Primary date</span><strong>{selectedItem.primary_day_date ? formatDate(selectedItem.primary_day_date) : "TBD"}</strong></div>
              <div><span>Calendar readiness</span><strong>{calendarReadiness.label}</strong></div>
              <div><span>Details confirmation</span><strong>{detailsConfirmationChipLabel(detailsConfirmation)}</strong></div>
              <div><span>Location</span><strong>{selectedItem.primary_location_name ?? "TBD"}</strong></div>
              <div><span>Contact</span><strong>{selectedItem.primary_contact_name ?? "TBD"}</strong></div>
              <div><span>Owner</span><strong>{selectedItem.account_owner_name ?? "Unassigned"}</strong></div>
              <div><span>Shoot manager</span><strong>{calendarReadiness.ownerLabel}</strong></div>
              <div><span>Stage</span><strong>{getManagementStage(selectedItem)}</strong></div>
              <div><span>Next action</span><strong>{getNextStep(selectedItem)}</strong></div>
              <div><span>Staffing</span><strong>{humanizeToken(selectedItem.staffing_status)}</strong></div>
              <div><span>Missing info</span><strong>{missingInfo.activeCount ? `${missingInfo.activeCount} open` : "Clear"}</strong></div>
              <div><span>Blockers</span><strong>{selectedItem.blocker_count ? `${selectedItem.blocker_count} open` : "Clear"}</strong></div>
              <div><span>Waiting on</span><strong>{missingInfo.activeItems[0] ? getJobMissingInfoStatusLabel(missingInfo.activeItems[0].status) : "No one"}</strong></div>
            </div>
            <div className="shared-job-preview__status-row">
              <RiskBadge level={selectedItem.risk_status} />
              <StatusPill label={calendarReadiness.label} tone={calendarReadiness.tone} />
              <StatusPill label={detailsConfirmationChipLabel(detailsConfirmation)} tone={detailsConfirmation.tone} />
              <StatusPill label={`Staffing: ${humanizeToken(selectedItem.staffing_status)}`} tone={statusTone(selectedItem.staffing_status)} />
              {missingInfo.activeItems[0] ? <StatusPill label={missingInfo.activeItems[0].title} tone={getJobMissingInfoStatusTone(missingInfo.activeItems[0])} /> : <StatusPill label="Missing info clear" tone="success" />}
              {selectedItem.blocker_count ? <StatusPill label={`${selectedItem.blocker_count} blocker${selectedItem.blocker_count === 1 ? "" : "s"}`} tone="danger" /> : null}
              <StatusPill label={humanizeToken(selectedItem.job_status)} tone={statusTone(selectedItem.job_status)} />
              <StatusPill label={humanizeToken(selectedItem.readiness_status)} tone={statusTone(selectedItem.readiness_status)} />
              <StatusPill label={humanizeToken(selectedItem.production_status)} tone={statusTone(selectedItem.production_status)} />
            </div>
            {missingInfo.activeItems.length ? (
              <div className="job-missing-info-preview" aria-label="Missing info checklist preview">
                {missingInfo.activeItems.slice(0, 3).map((item) => (
                  <div key={item.id}>
                    <strong>{item.title}</strong>
                    <span>{getJobMissingInfoStatusLabel(item.status)} | Owner: {item.ownerLabel} | Next: {item.nextAction}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <p className="shared-job-preview__done-note">
              Done = pushed to sale + admin/client/association needs complete.{" "}
              <HelpTooltip
                text="Done means the job is pushed to sale and all administrative, client, and association needs are met. Open the full job detail for the live completion stage."
                label="About done"
              />
            </p>
                </>
              );
            })()}
          </DetailPreviewPanel>
        ) : null
      }
    />
  );
}
