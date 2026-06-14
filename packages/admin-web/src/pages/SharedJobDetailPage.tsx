import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ApiClientError } from "../api";
import { useActionAvailability, useVisibleSections } from "../components/PermissionGate";
import { SharedJobDetailShell } from "../components/jobs/SharedJobDetailShell";
import { ActivityTimelineList } from "../components/jobs/ActivityTimelineList";
import { getDepartmentJobAdapterUI } from "../components/jobs/DepartmentJobAdapterUIRegistry";
import {
  JobHandoffCard,
  JobNotificationFoundation,
  JobOwnershipPanel,
  JobChangeNoticesPanel,
  JobDepartmentTaskPlan,
  JobIntakeReadinessPanel,
  JobProgressTimeline,
  JobWorkPackagesPanel,
  type JobRoutingPreview,
  buildJobChangeNotices,
  buildJobIntakeManagementSummaryFromDetail,
  buildRoutingPreviewFromDetail
} from "../components/jobs/JobRoutingFoundation";
import { JobOperationalCommandPanel } from "../components/jobs/JobOperationalCommandPanel";
import { WorkflowValidationPanel } from "../components/jobs/WorkflowValidationPanel";
import {
  JOB_OPERATIONAL_APPROVAL_OPTIONS,
  OperationalApprovalRequestPanel
} from "../components/OperationalApprovalRequestPanel";
import { CommunicationHistoryPanel } from "../components/CommunicationHistoryPanel";
import { PreCallContextPanel } from "../components/PreCallContextPanel";
import { TeamsCommunicationPanel } from "../components/TeamsCommunicationPanel";
import { TeamsMeetingPanel } from "../components/TeamsMeetingPanel";
import { LocationHistorySurface } from "../components/location/LocationHistorySurface";
import {
  DayExecutionConsole,
  JobReadinessBoard,
  StaffingPlannerBoard
} from "../components/jobs/SharedJobOperations";
import {
  SharedJobApprovalsPanel,
  SharedJobDeliverablesPanel,
  SharedJobProductionPanel,
  SharedJobQaPanel
} from "../components/jobs/SharedJobProduction";
import { RecordResourcesPanel } from "../components/RecordResourcesPanel";
import { navigateToSharedJobHash, parseSharedJobIdFromPath } from "../components/jobs/sharedJobRouting";
import { StatusPill, formatDate, formatDateTime, humanizeToken, statusTone, useHashRouteSnapshot } from "../components/sports/SportsPrimitives";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceEmptyState } from "../components/workspace/WorkspaceEmptyState";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import type { WorkspaceHeaderMetaTone } from "../components/workspace/WorkspacePageHeader";
import { buildJobPriorIntelligence, type JobPriorIntelligenceItem } from "../jobPriorIntelligence";
import { listDirectoryOwnerOptions } from "../services/organizationApi";
import { buildJobPreCallContext } from "../services/preCallContextBuilders";
import { buildJobCalendarReadiness } from "../jobCalendarReadiness";
import {
  buildDetailsConfirmationFromJobDetail,
  detailsConfirmationChipLabel,
  type DetailsConfirmationCue,
  type DetailsConfirmationRecord
} from "../jobDetailsConfirmation";
import {
  buildJobMissingInfoChecklist,
  getJobMissingInfoCategoryLabel,
  getJobMissingInfoStatusLabel,
  getJobMissingInfoStatusTone
} from "../jobMissingInfoChecklist";
import {
  addSharedJobDayNote,
  addSharedJobStaffAssignment,
  archiveSharedJob,
  cancelSharedJob,
  checkInSharedJobStaff,
  createOrUpdateSharedApprovalRequest,
  createOrUpdateSharedDeliverableItem,
  createOrUpdateSharedProductionHandoff,
  createOrUpdateSharedProductionIssue,
  createOrUpdateSharedProductionItem,
  createOrUpdateSharedQaFinding,
  createOrUpdateSharedQaReview,
  createOrResolveSharedJobWatchFlag,
  getSharedJobDetail,
  markSharedJobDayReady,
  publishSharedJob,
  postponeSharedJob,
  updateSharedJobDay,
  updateSharedJobStaffAssignment,
  updateSharedReadinessItem
} from "../services/jobsApi";
import {
  canManageSchoolsHub,
  canManageSportsWorkspace,
  canViewSportsFinance
} from "../permissions";
import type { SharedJobDetailResponse, SharedWorkflowTransitionValidation } from "../jobTruthTypes";
import type { DirectoryOwnerOption, SessionUser } from "../types";
import {
  getWorkflowChangeNoticesForJob,
  WorkflowChangeNoticePanel
} from "../workflowChangeNotices";

type Props = {
  token: string;
  currentUser: SessionUser;
  departmentType: "schools" | "sports" | null;
  routeBase: string;
};

function readActiveTab(params: URLSearchParams) {
  return params.get("tab") ?? "summary";
}

function mapHeaderTone(status: string | null | undefined): WorkspaceHeaderMetaTone {
  const tone = statusTone(status);
  return tone === "danger" ? "critical" : tone;
}

function mapCalendarHeaderTone(tone: "neutral" | "info" | "success" | "warning" | "danger"): WorkspaceHeaderMetaTone {
  return tone === "danger" ? "critical" : tone;
}

function canManageDepartment(currentUser: SessionUser, departmentType: "schools" | "sports") {
  return departmentType === "schools" ? canManageSchoolsHub(currentUser) : canManageSportsWorkspace(currentUser);
}

function extractWorkflowValidation(error: unknown) {
  if (!(error instanceof ApiClientError) || !error.details || typeof error.details !== "object") {
    return null;
  }
  const details = error.details as { workflow_validation?: SharedWorkflowTransitionValidation };
  return details.workflow_validation ?? null;
}

function presentValue(value: string | null | undefined, fallback = "Not recorded") {
  return value && value.trim() ? value : fallback;
}

type JobTruthSnapshotTone = "neutral" | "info" | "success" | "warning" | "danger";

type JobTruthSnapshotItem = {
  label: string;
  value: string;
  tone?: JobTruthSnapshotTone;
  wide?: boolean;
  anchor?: string;
  navHash?: string;
};

function buildJobTruthSnapshot(
  detail: SharedJobDetailResponse,
  calendarReadiness: ReturnType<typeof buildJobCalendarReadiness> | null,
  missingInfoChecklist: ReturnType<typeof buildJobMissingInfoChecklist>,
  routingPreview: JobRoutingPreview,
  detailsConfirmation: DetailsConfirmationCue
): JobTruthSnapshotItem[] {
  const shootDate = detail.summary.primary_day_date ?? detail.job.scheduled_start_at?.slice(0, 10) ?? null;
  return [
    { label: "Job name", value: detail.job.title || detail.job.event_name || detail.job.job_number || "Untitled job" },
    { label: "Organization", value: detail.summary.organization_name ?? "Organization not set" },
    { label: "Job type", value: humanizeToken(detail.job.job_category) },
    { label: "Shoot date", value: shootDate ? formatDate(shootDate) : "Date TBD" },
    { label: "Calendar readiness", value: calendarReadiness?.label ?? "Needs date", tone: calendarReadiness?.tone ?? "warning", anchor: "jobdetail-calendar-readiness" },
    { label: "Details confirmation", value: detailsConfirmationChipLabel(detailsConfirmation), tone: detailsConfirmation.tone, anchor: "jobdetail-details-confirmation" },
    { label: "Staffing readiness", value: humanizeToken(detail.job.staffing_status), tone: statusTone(detail.job.staffing_status), navHash: `#operations/staffing?area=staffing${shootDate ? `&date=${shootDate}` : ""}` },
    { label: "Current stage", value: humanizeToken(routingPreview.currentStage) },
    { label: "Current owner", value: routingPreview.currentOwner },
    { label: "Next action", value: missingInfoChecklist.activeCount ? missingInfoChecklist.nextAction : routingPreview.firstNextAction, wide: true },
    { label: "Blocked status", value: routingPreview.blockerLabel, tone: routingPreview.blockerStatus === "blocked" ? "danger" : routingPreview.blockerStatus === "watch" ? "warning" : "success", anchor: "jobdetail-blockers" },
    { label: "Missing info", value: `${missingInfoChecklist.activeCount} open`, tone: missingInfoChecklist.activeCount ? "warning" : "success", anchor: "jobdetail-missing-info" },
    { label: "Priority", value: humanizeToken(detail.job.priority_level), tone: detail.job.priority_level === "urgent" || detail.job.priority_level === "high" ? "danger" : detail.job.priority_level === "normal" ? "neutral" : "info" }
  ];
}

const COMPLETION_STAGES = [
  "Not ready",
  "Ready for calendar",
  "Ready for shoot",
  "In production",
  "Pushed to sale",
  "Admin complete",
  "Done"
] as const;

// Stages 0-3 are derived from real operational data. "Pushed to sale" and the
// admin/association completion stages live in Captura/admin today, so they are
// shown as explanatory targets rather than tracked Mission Control state.
const COMPLETION_TRACKED_MAX_INDEX = 3;

const COMPLETION_PRODUCTION_ACTIVE = new Set<string>([
  "awaiting_ingest",
  "ingest_complete",
  "editing",
  "awaiting_internal_review",
  "proof_build",
  "proof_sent",
  "awaiting_approval",
  "revisions_requested",
  "approved_for_production",
  "approved_for_final",
  "in_final_production",
  "ordered_or_printed",
  "ordered_or_sent",
  "packaged"
]);

function deriveCompletionStageIndex(
  detail: SharedJobDetailResponse,
  calendarReadiness: ReturnType<typeof buildJobCalendarReadiness> | null
): number {
  if (["complete", "delivered", "closed"].includes(detail.job.job_status)) {
    return 6;
  }
  if (detail.job.production_status && COMPLETION_PRODUCTION_ACTIVE.has(detail.job.production_status)) {
    return 3;
  }
  if (["ready", "on_track"].includes(detail.job.readiness_status)) {
    return 2;
  }
  if (calendarReadiness && calendarReadiness.tone === "success") {
    return 1;
  }
  return 0;
}

function buildJobNotes(detail: SharedJobDetailResponse, selectedDay: SharedJobDetailResponse["days"][number] | null) {
  const clientNotes =
    detail.prep_readiness?.client_prep?.primary_location?.client_facing_notes ??
    detail.job.contact_override_note ??
    detail.sports_profile?.client_expectations_notes ??
    detail.school_profile?.special_instructions ??
    null;
  const shootNotes = [
    selectedDay?.access_notes ? `Access: ${selectedDay.access_notes}` : null,
    selectedDay?.parking_notes ? `Parking: ${selectedDay.parking_notes}` : null,
    selectedDay?.setup_notes ? `Setup: ${selectedDay.setup_notes}` : null,
    selectedDay?.travel_notes ? `Travel: ${selectedDay.travel_notes}` : null,
    detail.prep_readiness?.employee_briefing?.primary_location?.employee_facing_notes ?? null
  ].filter((note): note is string => Boolean(note && note.trim()));
  const productionNotes = detail.production_items
    .map((item) => item.production_notes ?? item.internal_notes ?? item.post_shoot_eval_summary)
    .filter((note): note is string => Boolean(note && note.trim()));
  return [
    { label: "Client-facing notes", value: presentValue(clientNotes, "No client-facing notes recorded.") },
    { label: "Internal notes", value: presentValue(detail.job.description_internal, "No internal notes recorded.") },
    { label: "Shoot notes", value: shootNotes.length ? shootNotes.slice(0, 3).join(" ") : "No shoot notes recorded." },
    { label: "Production notes", value: productionNotes.length ? productionNotes.slice(0, 2).join(" ") : "No production notes recorded." }
  ];
}

function buildWorkflowReviewNotice(params: URLSearchParams, jobTitle: string, routingPreview: JobRoutingPreview) {
  if (params.get("notice") !== "workflow_review") {
    return null;
  }
  const workflowName = params.get("workflowName") ?? routingPreview.workflowRouteLabel;
  const jobType = params.get("jobType") ?? routingPreview.jobTypeLabel;
  const director = params.get("director") ?? `${routingPreview.nextDepartment} Director`;
  return {
    title: `Review workflow selection for ${jobTitle || "this job"}`,
    body: `Mission Control selected ${workflowName} based on ${jobType}. Please confirm the workflow and update it if needed.`,
    director
  };
}

function getDetailsConfirmationStorageKey(jobId: string) {
  return `mission-control:details-confirmation:${jobId}`;
}

function navigateToHash(hash: string) {
  window.location.hash = hash;
}

function scrollToJobDetailAnchor(anchorId: string) {
  if (typeof document === "undefined") {
    return;
  }
  const target = document.getElementById(anchorId);
  if (!target) {
    return;
  }
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.classList.add("shared-job-detail__anchor--flash");
  window.setTimeout(() => target.classList.remove("shared-job-detail__anchor--flash"), 1400);
}

export function SharedJobDetailPage({ token, currentUser, departmentType, routeBase }: Props) {
  const { path, params } = useHashRouteSnapshot();
  const jobId = parseSharedJobIdFromPath(path);
  const [detail, setDetail] = useState<SharedJobDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [workflowError, setWorkflowError] = useState<SharedWorkflowTransitionValidation | null>(null);
  const [staffOptions, setStaffOptions] = useState<DirectoryOwnerOption[]>([]);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [detailsConfirmationRecord, setDetailsConfirmationRecord] = useState<DetailsConfirmationRecord | null>(null);
  const activeTab = readActiveTab(params);

  useEffect(() => {
    if (!jobId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getSharedJobDetail(token, jobId)
      .then((response) => {
        if (!cancelled) {
          setDetail(response);
          setError("");
          setWorkflowError(null);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setDetail(null);
          setError(loadError instanceof ApiClientError ? loadError.message : "We couldn't load this job detail right now.");
          setWorkflowError(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, token]);

  useEffect(() => {
    let cancelled = false;
    void listDirectoryOwnerOptions(token)
      .then((response) => {
        if (!cancelled) {
          setStaffOptions(response.owners);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStaffOptions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!detail?.days.length) {
      setSelectedDayId(null);
      return;
    }
    if (!selectedDayId || !detail.days.some((day) => day.id === selectedDayId)) {
      setSelectedDayId(detail.days[0].id);
    }
  }, [detail?.days, selectedDayId]);

  useEffect(() => {
    if (!detail?.job.id || typeof window === "undefined") {
      setDetailsConfirmationRecord(null);
      return;
    }
    const raw = window.localStorage.getItem(getDetailsConfirmationStorageKey(detail.job.id));
    if (!raw) {
      setDetailsConfirmationRecord(null);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as DetailsConfirmationRecord;
      setDetailsConfirmationRecord(parsed?.confirmedAt ? parsed : null);
    } catch {
      setDetailsConfirmationRecord(null);
    }
  }, [detail?.job.id]);

  const activeDepartment = (detail?.job.department_type ?? departmentType ?? "sports") as "schools" | "sports";
  const adapter = useMemo(() => getDepartmentJobAdapterUI(activeDepartment), [activeDepartment]);
  const actions = useActionAvailability(detail?.policy);
  const sections = useVisibleSections(detail?.policy);
  const hasPolicy = Boolean(detail?.policy);
  const sectionVisible = (key: string) => !sections[key] || sections[key] !== "hidden";
  const canViewFinance =
    activeDepartment === "sports"
      ? hasPolicy
        ? sectionVisible("financial")
        : sectionVisible("financial") && canViewSportsFinance(currentUser)
      : false;
  const canManageRecord = hasPolicy ? Boolean(actions.update) : canManageDepartment(currentUser, activeDepartment);
  const canManageReadiness = hasPolicy ? Boolean(actions.manage_readiness) : canManageRecord;
  const canAssignStaff = hasPolicy ? Boolean(actions.assign_staff) : canManageRecord;
  const canMarkReady = hasPolicy ? Boolean(actions.mark_ready) : canManageRecord;
  const canManageProduction = hasPolicy ? Boolean(actions.manage_production) : canManageRecord;
  const canManageApprovals = hasPolicy ? Boolean(actions.manage_approvals) : canManageProduction;
  const canManageQa = hasPolicy ? Boolean(actions.manage_qa) : canManageProduction;
  const canManageDeliverables = hasPolicy ? Boolean(actions.manage_deliverables) : canManageProduction;
  const canManageWatchFlags = hasPolicy ? Boolean(actions.manage_watch_flags) : canManageRecord;
  const selectedDay = detail?.days.find((day) => day.id === selectedDayId) ?? detail?.days[0] ?? null;
  const calendarReadiness = detail
    ? buildJobCalendarReadiness({
        date: detail.summary.primary_day_date,
        startTime: detail.summary.primary_day_start_time,
        endTime: detail.summary.primary_day_end_time,
        dateOnly: !detail.summary.primary_day_start_time,
        primaryLocationName: detail.summary.primary_location_name,
        primaryContactName: detail.summary.primary_contact_name,
        staffingStatus: detail.status.staffing_status,
        readinessStatus: detail.status.readiness_status,
        riskStatus: detail.status.risk_status,
        jobStatus: detail.status.job_status,
        blockerCount: detail.status.blocker_count,
        openWatchFlagCount: detail.status.open_watch_flag_count,
        leadOwnerName: detail.summary.lead_owner_name,
        accountOwnerName: detail.summary.account_owner_name,
        estimatedStaffCount: detail.job.estimated_staff_count
      })
    : null;
  const jobChangeNotices = useMemo(
    () =>
      detail
        ? getWorkflowChangeNoticesForJob(detail.job.id, currentUser, {
            includeAcknowledged: true,
            includeAllAudience: true
          })
        : [],
    [currentUser, detail]
  );
  const operationalCards = detail ? adapter.getOperationalCards({ detail, currentUser, canViewFinance, selectedDay }) : [];
  const operationalCopy = adapter.getOperationalCopy();
  const adapterTabs = detail
    ? adapter
        .getDetailTabs({ detail, currentUser, canViewFinance, selectedDay })
        .filter((tab) => !["summary", "days", "readiness", "staffing", "day-of", "production", "approvals", "qa", "deliverables", "activity"].includes(tab.key))
    : [];

  async function reload() {
    if (!jobId) {
      return;
    }
    const next = await getSharedJobDetail(token, jobId);
    setDetail(next);
    setWorkflowError(null);
  }

  async function runDetailMutation(factory: () => Promise<SharedJobDetailResponse>, fallback: string) {
    try {
      const next = await factory();
      setDetail(next);
      setError("");
      setWorkflowError(null);
    } catch (mutationError) {
      setWorkflowError(extractWorkflowValidation(mutationError));
      setError(mutationError instanceof ApiClientError ? mutationError.message : fallback);
    }
  }

  async function runLifecycle(action: "publish" | "cancel" | "postpone" | "archive") {
    if (!jobId) {
      return;
    }
    try {
      if (action === "publish") {
        await publishSharedJob(token, jobId);
      } else if (action === "archive") {
        if (!window.confirm("Archive this job?")) {
          return;
        }
        await archiveSharedJob(token, jobId);
      } else {
        const reason = window.prompt(`Reason to ${action} this job`, "");
        if (!reason?.trim()) {
          return;
        }
        if (action === "cancel") {
          await cancelSharedJob(token, jobId, { reason });
        } else {
          await postponeSharedJob(token, jobId, { reason });
        }
      }
      await reload();
    } catch (mutationError) {
      setWorkflowError(extractWorkflowValidation(mutationError));
      setError(mutationError instanceof ApiClientError ? mutationError.message : `We couldn't ${action} this job.`);
    }
  }

  function confirmDetails() {
    if (!detail?.job.id) {
      return;
    }
    const nextRecord: DetailsConfirmationRecord = {
      confirmedAt: new Date().toISOString(),
      confirmedByName: currentUser.fullName || currentUser.email || "Mission Control"
    };
    setDetailsConfirmationRecord(nextRecord);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(getDetailsConfirmationStorageKey(detail.job.id), JSON.stringify(nextRecord));
    }
  }

  if (loading) {
    return <WorkspaceLoadingBlock title="Loading job detail" summary="Opening the shared job detail shell with department-specific tabs." />;
  }

  if (!detail) {
    return <WorkspaceEmptyState title="Job detail unavailable" summary={error || "This shared job could not be opened."} actions={<button type="button" onClick={() => navigateToSharedJobHash(routeBase)}>Back to jobs</button>} />;
  }

  const tabs = [
    { key: "summary", label: "Summary" },
    { key: "days", label: "Days" },
    ...(sectionVisible("readiness") ? [{ key: "readiness", label: "Readiness" }] : []),
    ...(sectionVisible("staffing") ? [{ key: "staffing", label: "Staffing" }] : []),
    ...(sectionVisible("day_of") ? [{ key: "day-of", label: "Day Of" }] : []),
    ...(sectionVisible("production") ? [{ key: "production", label: "Production" }] : []),
    ...(sectionVisible("approvals") ? [{ key: "approvals", label: "Approvals" }] : []),
    ...(sectionVisible("qa") ? [{ key: "qa", label: "QA" }] : []),
    ...(sectionVisible("deliverables") ? [{ key: "deliverables", label: "Deliverables" }] : []),
    ...(sectionVisible("activity") ? [{ key: "activity", label: "Activity" }] : []),
    ...adapterTabs.map((tab) => ({ key: tab.key, label: tab.label }))
  ];
  const resolvedTab = tabs.some((tab) => tab.key === activeTab) ? activeTab : "summary";
  const missingInfoChecklist = buildJobMissingInfoChecklist(detail);
  const routingPreview = buildRoutingPreviewFromDetail(detail);
  const intakeSummary = buildJobIntakeManagementSummaryFromDetail(detail);
  const routingChangeNotices = buildJobChangeNotices(detail);
  const detailsConfirmation = buildDetailsConfirmationFromJobDetail(detail, detailsConfirmationRecord);
  const jobTruthSnapshot = buildJobTruthSnapshot(detail, calendarReadiness, missingInfoChecklist, routingPreview, detailsConfirmation);
  const jobNotes = buildJobNotes(detail, selectedDay);
  const priorIntelligence = buildJobPriorIntelligence(detail);
  const workflowReviewNotice = buildWorkflowReviewNotice(params, detail.job.title || detail.job.event_name || detail.job.job_number || "this job", routingPreview);
  const completionStageIndex = deriveCompletionStageIndex(detail, calendarReadiness);

  const summaryCards = [
    {
      key: "truth-snapshot",
      title: "Job Truth Snapshot",
      body: (
        <div className="shared-job-truth-snapshot" aria-label="Job truth snapshot">
          {jobTruthSnapshot.map((item) => {
            const baseClass = item.wide
              ? "shared-job-truth-snapshot__item shared-job-truth-snapshot__item--wide"
              : "shared-job-truth-snapshot__item";
            const content = (
              <>
                <span>{item.label}</span>
                {item.tone ? <StatusPill label={item.value} tone={item.tone} /> : <strong>{item.value}</strong>}
              </>
            );
            if (item.anchor) {
              return (
                <button
                  key={item.label}
                  type="button"
                  className={`${baseClass} shared-job-truth-snapshot__item--jump`}
                  onClick={() => scrollToJobDetailAnchor(item.anchor!)}
                  aria-label={`${item.label}: ${item.value}. Jump to details`}
                >
                  {content}
                </button>
              );
            }
            if (item.navHash) {
              return (
                <button
                  key={item.label}
                  type="button"
                  className={`${baseClass} shared-job-truth-snapshot__item--jump`}
                  onClick={() => navigateToHash(item.navHash!)}
                  aria-label={`${item.label}: ${item.value}. Open Staff Assignment Board`}
                >
                  {content}
                </button>
              );
            }
            return (
              <div key={item.label} className={baseClass}>
                {content}
              </div>
            );
          })}
        </div>
      )
    },
    {
      key: "overview",
      title: "Overview",
      body: (
        <div className="shared-job-detail__kv">
          <span>Organization: {detail.summary.organization_name ?? "Unassigned"}</span>
          <span>Location: {detail.summary.primary_location_name ?? "TBD"}</span>
          <span>Contact: {detail.summary.primary_contact_name ?? "TBD"}</span>
          <span>Owner: {detail.summary.account_owner_name ?? "Unassigned"}</span>
        </div>
      )
    },
    {
      key: "operations",
      title: "Operations Snapshot",
      body: (
        <div className="shared-job-detail__kv">
          <span>Calendar: {calendarReadiness?.label ?? "Needs date"}</span>
          <span>Readiness: {detail.status.readiness_percent}% complete</span>
          <span>Staffing: {humanizeToken(detail.status.staffing_status)}</span>
          <span>Blockers: {detail.status.blocker_count}</span>
          <span>Open watch flags: {detail.status.open_watch_flag_count}</span>
        </div>
      )
    },
    {
      key: "missing-info",
      title: "Missing Info Checklist",
      body: (
        <div className="shared-job-form__stack" id="jobdetail-missing-info">
          <div className="shared-job-preview__status-row">
            {missingInfoChecklist.activeItems[0] ? (
              <StatusPill label={`${missingInfoChecklist.activeCount} open`} tone={getJobMissingInfoStatusTone(missingInfoChecklist.activeItems[0])} />
            ) : (
              <StatusPill label="Clear" tone="success" />
            )}
            {missingInfoChecklist.resolvedCount ? <StatusPill label={`${missingInfoChecklist.resolvedCount} resolved`} tone="success" /> : null}
          </div>
          <div className="shared-job-detail__kv">
            <span>Owner: {missingInfoChecklist.primaryOwner}</span>
            <span>Next action: {missingInfoChecklist.nextAction}</span>
            <span>Waiting on client: {missingInfoChecklist.waitingOnClientCount}</span>
            <span>Waiting internal: {missingInfoChecklist.waitingOnInternalCount}</span>
          </div>
        </div>
      )
    },
    {
      key: "calendar-readiness",
      title: "Calendar Readiness",
      body: calendarReadiness ? (
        <div className="shared-job-form__stack" id="jobdetail-calendar-readiness">
          <div className="shared-job-preview__status-row">
            <StatusPill label={calendarReadiness.label} tone={calendarReadiness.tone} />
            <StatusPill label={calendarReadiness.staffingLabel} tone={calendarReadiness.staffingLabel === "Shoot manager assigned" ? "success" : "warning"} />
          </div>
          <div className="shared-job-detail__kv">
            <span>Schedule: {calendarReadiness.scheduleLabel}</span>
            <span>Shoot manager: {calendarReadiness.ownerLabel}</span>
            <span>Next scheduling action: {calendarReadiness.nextAction}</span>
          </div>
        </div>
      ) : null
    },
    {
      key: "details-confirmation",
      title: "Details Confirmation",
      body: (
        <div className="shared-job-form__stack" id="jobdetail-details-confirmation">
          <div className="shared-job-preview__status-row">
            <StatusPill label={detailsConfirmationChipLabel(detailsConfirmation)} tone={detailsConfirmation.tone} />
            {detailsConfirmation.missingCount ? <StatusPill label={`${detailsConfirmation.missingCount} detail${detailsConfirmation.missingCount === 1 ? "" : "s"} to verify`} tone="warning" /> : null}
          </div>
          <p className="shared-job-sidebar__muted">{detailsConfirmation.summary}</p>
          <div className="shared-job-detail__kv">
            <span>Owner: {detailsConfirmation.ownerLabel}</span>
            <span>Next action: {detailsConfirmation.nextAction}</span>
            {detailsConfirmation.confirmationDueDate ? <span>Major confirmation: {formatDate(detailsConfirmation.confirmationDueDate)}</span> : null}
            {detailsConfirmation.finalDueDate ? <span>Final check: {formatDate(detailsConfirmation.finalDueDate)}</span> : null}
            {detailsConfirmation.confirmedAt ? <span>Confirmed: {formatDateTime(detailsConfirmation.confirmedAt)}</span> : null}
          </div>
          {detailsConfirmation.state === "confirmed" && detailsConfirmation.confirmedAt ? null : (
            <WorkspaceActionBar compact>
              <button type="button" className="secondary-button" onClick={confirmDetails}>
                Confirm details
              </button>
            </WorkspaceActionBar>
          )}
        </div>
      )
    },
    {
      key: "definition-of-done",
      title: "Definition of done",
      body: (
        <div className="shared-job-form__stack">
          <p className="shared-job-detail__done-definition">
            Done means the job is pushed to sale and all administrative, client, and association needs are met.
          </p>
          <ol className="shared-job-detail__done-ladder" aria-label="Completion stages">
            {COMPLETION_STAGES.map((stage, index) => {
              const state =
                index === completionStageIndex
                  ? "current"
                  : index < completionStageIndex
                    ? "passed"
                    : index > COMPLETION_TRACKED_MAX_INDEX
                      ? "future"
                      : "upcoming";
              return (
                <li key={stage} className={`shared-job-detail__done-stage shared-job-detail__done-stage--${state}`}>
                  {stage}
                </li>
              );
            })}
          </ol>
          <p className="shared-job-sidebar__muted">
            Pushed-to-sale and admin/association completion are tracked in Captura/admin today; Mission Control shows the current operational stage.
          </p>
        </div>
      )
    },
    {
      key: "watch",
      title: "Watch Flags",
      body: detail.watch_flags.length ? <div className="shared-job-detail__kv">{detail.watch_flags.slice(0, 4).map((flag) => <span key={flag.id}>{flag.title}</span>)}</div> : <div className="shared-job-sidebar__muted">No open watch flags.</div>
    }
  ].filter((card) => card.key !== "watch" || sectionVisible("watch_flags"));

  summaryCards.splice(1, 0, {
    key: "routing-foundation",
    title: "Job Progress",
    body: (
      <div className="shared-job-form__stack">
        <JobIntakeReadinessPanel summary={intakeSummary} />
        <JobOwnershipPanel preview={routingPreview} compact />
        <JobProgressTimeline preview={routingPreview} />
        <JobHandoffCard preview={routingPreview} />
        <JobNotificationFoundation preview={routingPreview} />
        <JobChangeNoticesPanel notices={routingChangeNotices} />
      </div>
    )
  });

  summaryCards.push(
    ...operationalCards
      .filter((card) => card.placement === "readiness" || card.placement === "today")
      .map((card) => ({
        key: card.key,
        title: card.title,
        body: <>{card.body}</>
      }))
  );

  let body: ReactNode = <div />;
  if (resolvedTab === "summary") {
    body = (
      <div className="shared-job-detail__stack">
        {error ? <div className="shared-job-list__error" role="alert">{error}</div> : null}
        <JobOperationalCommandPanel token={token} jobId={detail.job.id} prepReadiness={detail.prep_readiness} />
        <WorkflowChangeNoticePanel
          notices={jobChangeNotices}
          title="Job Change Notices"
          summary="Recent location, schedule, staffing, and job-note changes tied to this job."
          compact
        />
        {sectionVisible("watch_flags") && detail.watch_flags.length ? (
          <section className="shared-job-detail__list-card">
            <h3>Open watch flags</h3>
            <div className="shared-job-detail__kv">{detail.watch_flags.map((flag) => <span key={flag.id}>{flag.title} | {humanizeToken(flag.severity)}</span>)}</div>
          </section>
        ) : null}
        <section className="shared-job-detail__list-card" id="jobdetail-blockers" aria-labelledby="missing-info-checklist-title">
          <div className="shared-job-detail__list-card-header">
            <div>
              <h3 id="missing-info-checklist-title">Missing Info and Blockers</h3>
              <p className="shared-job-sidebar__muted">Track exactly what is missing, who owns it, who we are waiting on, and what must happen next.</p>
            </div>
            <WorkspaceActionBar align="end" compact>
              <StatusPill label={`${missingInfoChecklist.activeCount} open`} tone={missingInfoChecklist.activeItems[0] ? getJobMissingInfoStatusTone(missingInfoChecklist.activeItems[0]) : "success"} />
              {missingInfoChecklist.resolvedCount ? <StatusPill label={`${missingInfoChecklist.resolvedCount} resolved`} tone="success" /> : null}
            </WorkspaceActionBar>
          </div>
          {missingInfoChecklist.activeItems.length ? (
            <div className="job-missing-info-list">
              {missingInfoChecklist.activeItems.map((item) => (
                <article key={item.id} className="job-missing-info-item">
                  <div>
                    <strong>{item.title}</strong>
                    <span>{getJobMissingInfoCategoryLabel(item.category)} | Owner: {item.ownerLabel}</span>
                  </div>
                  <div>
                    <StatusPill label={getJobMissingInfoStatusLabel(item.status)} tone={getJobMissingInfoStatusTone(item)} />
                    {item.dueDate ? <span>Due {formatDate(item.dueDate)}</span> : null}
                  </div>
                  <p>{item.nextAction}</p>
                  {item.notes ? <small>{item.notes}</small> : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="shared-job-sidebar__muted">No active missing-info items are blocking this job.</p>
          )}
          {missingInfoChecklist.resolvedItems.length ? (
            <div className="job-missing-info-history">
              <strong>Resolved blocker history</strong>
              {missingInfoChecklist.resolvedItems.slice(0, 4).map((item) => (
                <span key={item.id}>{item.title} resolved{item.resolvedDate ? ` ${formatDate(item.resolvedDate)}` : ""}.</span>
              ))}
            </div>
          ) : null}
        </section>
        <section className="shared-job-detail__list-card" aria-label="Department tasks and work packages">
          <div className="shared-job-detail__list-card-header">
            <div>
              <h3>Department Tasks and Work Packages</h3>
              <p className="shared-job-sidebar__muted">The active department route, owner, due date, status, and next package are kept together here.</p>
            </div>
            <StatusPill label={`${routingPreview.workPackages.length} packages`} tone="info" />
          </div>
          <JobWorkPackagesPanel preview={routingPreview} />
          <JobDepartmentTaskPlan preview={routingPreview} compact />
        </section>
        <section className="shared-job-detail__list-card" aria-label="Job notes">
          <div className="shared-job-detail__list-card-header">
            <div>
              <h3>Notes</h3>
              <p className="shared-job-sidebar__muted">Client, internal, shoot, and production notes that help the next team act without hunting through tabs.</p>
            </div>
          </div>
          <div className="shared-job-notes-grid">
            {jobNotes.map((note) => (
              <article key={note.label}>
                <span>{note.label}</span>
                <p>{note.value}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="shared-job-detail__list-card">
          <h3>Evaluations and Closeout</h3>
          <p className="shared-job-sidebar__muted">
            Post-shoot closeout, shoot check-ins, mileage qualification, auto-flags, and future pre-shoot brief notes stay tied to this canonical job.
          </p>
          <div className="shared-job-detail__actions">
            <button type="button" onClick={() => {
              window.location.hash = `#job-closeout/jobs/${detail.job.id}`;
            }}>
              Open Job Closeout
            </button>
          </div>
        </section>
        <JobPriorIntelligencePanel intelligence={priorIntelligence} />
        <LocationHistorySurface
          variant="detail"
          token={token}
          locationName={detail.summary.primary_location_name}
          locationAddress={detail.summary.primary_location_address}
        />
        <RecordResourcesPanel
          token={token}
          objectType="job"
          objectId={detail.job.id}
          title="Job Resources"
          summary="Keep day-of packets, contracts, SOPs, proofs, and support files attached to this job."
        />
        <TeamsCommunicationPanel
          token={token}
          currentUser={currentUser}
          objectType="job"
          objectId={detail.job.id}
          title="Teams Messaging"
          summary="Open the linked Teams destination for this job or send a short internal update without moving business logic into Teams."
        />
        <TeamsMeetingPanel
          token={token}
          currentUser={currentUser}
          objectType="job"
          objectId={detail.job.id}
          title="Teams Meeting"
          summary="Create or update the internal Teams meeting linked to this job. Video calling and screen sharing stay native to Teams."
          renderPreCallContext={(meetingView) => (
            <PreCallContextPanel token={token} definition={buildJobPreCallContext(detail, selectedDay, meetingView)} />
          )}
          onPostCallSaved={() => {
            void reload();
          }}
        />
        <CommunicationHistoryPanel
          token={token}
          currentUser={currentUser}
          objectType="job"
          objectId={detail.job.id}
          summary="Show the latest Teams messaging and meeting activity tied to this job without turning the record into a conversation transcript."
        />
        <OperationalApprovalRequestPanel
          token={token}
          sourceModule="jobs"
          sourceEntityType="job"
          sourceEntityId={detail.job.id}
          sourceEntityLabel={detail.job.job_number ?? detail.job.title}
          title="Job Approvals"
          summary="Request operational approvals for reschedules, staffing overrides, exceptions, and fee decisions tied to this job."
          canCreate={canManageRecord || canAssignStaff || canManageApprovals}
          requestOptions={JOB_OPERATIONAL_APPROVAL_OPTIONS}
        />
        <section className="shared-job-detail__list-card">
          <h3>Recent activity</h3>
          <ActivityTimelineList entries={detail.activity} limit={8} />
        </section>
      </div>
    );
  } else if (resolvedTab === "days") {
    body = (
      <div className="shared-job-detail__stack">
        {detail.days.map((day) => (
          <section key={day.id} className="shared-job-detail__list-card">
            <div className="shared-job-detail__list-card-header">
              <h3>{day.day_label || formatDate(day.date)}</h3>
              <WorkspaceActionBar align="end" compact>
                <StatusPill label={humanizeToken(day.day_status)} tone={statusTone(day.day_status)} />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setSelectedDayId(day.id);
                    navigateToSharedJobHash(routeBase, detail.job.id, { tab: "day-of" });
                  }}
                >
                  Open Day Of
                </button>
              </WorkspaceActionBar>
            </div>
            <div className="shared-job-detail__kv">
              <span>{formatDate(day.date)} | {day.start_time || "TBD"} - {day.end_time || "TBD"}</span>
              <span>{day.location_name ?? "Location TBD"}</span>
              <span>Lead: {day.lead_user_name ?? "Unassigned"}</span>
              <span>Status: {humanizeToken(day.day_status)}</span>
            </div>
          </section>
        ))}
      </div>
    );
  } else if (resolvedTab === "readiness") {
    body = (
      <JobReadinessBoard
        detail={detail}
        selectedDayId={selectedDayId}
        onSelectDayId={setSelectedDayId}
        onUpdateItem={(itemId, input) => runDetailMutation(() => updateSharedReadinessItem(token, detail.job.id, itemId, input), "We couldn't update that readiness item.")}
        readOnly={!canManageReadiness}
        copy={operationalCopy}
        adapterCards={operationalCards}
      />
    );
  } else if (resolvedTab === "staffing") {
    body = (
      <StaffingPlannerBoard
        token={token}
        detail={detail}
        selectedDayId={selectedDayId}
        onSelectDayId={setSelectedDayId}
        currentUser={currentUser}
        canManage={canAssignStaff}
        copy={operationalCopy}
        adapterCards={operationalCards}
        staffOptions={staffOptions}
        onAssignStaff={(input) => runDetailMutation(() => addSharedJobStaffAssignment(token, detail.job.id, input), "We couldn't add that staff assignment.")}
        onUpdateAssignment={(assignmentId, input) => runDetailMutation(() => updateSharedJobStaffAssignment(token, detail.job.id, assignmentId, input), "We couldn't update that staff assignment.")}
        onCheckIn={(assignmentId) => runDetailMutation(() => checkInSharedJobStaff(token, detail.job.id, assignmentId), "We couldn't record that check-in.")}
      />
    );
  } else if (resolvedTab === "day-of") {
    body = (
      <DayExecutionConsole
        detail={detail}
        selectedDayId={selectedDayId}
        onSelectDayId={setSelectedDayId}
        currentUser={currentUser}
        canManage={canManageRecord || canMarkReady}
        copy={operationalCopy}
        adapterCards={operationalCards}
        onCheckIn={(assignmentId) => runDetailMutation(() => checkInSharedJobStaff(token, detail.job.id, assignmentId), "We couldn't record that check-in.")}
        onUpdateAssignment={(assignmentId, input) => runDetailMutation(() => updateSharedJobStaffAssignment(token, detail.job.id, assignmentId, input), "We couldn't update that staffing state.")}
        onConfirmReady={(dayId, input) => runDetailMutation(() => markSharedJobDayReady(token, detail.job.id, dayId, input), "We couldn't confirm that day as ready.")}
        onUpdateDayStatus={(dayId, input) => runDetailMutation(() => updateSharedJobDay(token, detail.job.id, dayId, input), "We couldn't update that day status.")}
        onAddDayNote={(dayId, input) => runDetailMutation(() => addSharedJobDayNote(token, detail.job.id, dayId, input), "We couldn't save that day note.")}
        onCreateOrResolveIssue={(input) => runDetailMutation(() => createOrResolveSharedJobWatchFlag(token, detail.job.id, input), "We couldn't update that execution issue.")}
      />
    );
  } else if (resolvedTab === "production") {
    body = (
      <SharedJobProductionPanel
        token={token}
        detail={detail}
        currentUser={currentUser}
        canManage={canManageProduction}
        canViewFinance={canViewFinance}
        staffOptions={staffOptions}
        onSaveProductionItem={(input, productionItemId) =>
          runDetailMutation(
            () => createOrUpdateSharedProductionItem(token, detail.job.id, input, productionItemId),
            "We couldn't update that production item."
          )
        }
        onSaveHandoff={(productionItemId, input, handoffId) =>
          runDetailMutation(
            () => createOrUpdateSharedProductionHandoff(token, detail.job.id, productionItemId, input, handoffId),
            "We couldn't update that downstream handoff."
          )
        }
        onSaveApproval={(productionItemId, input, approvalId) =>
          runDetailMutation(
            () => createOrUpdateSharedApprovalRequest(token, detail.job.id, productionItemId, input, approvalId),
            "We couldn't update that approval request."
          )
        }
        onSaveQaReview={(productionItemId, input, qaReviewId) =>
          runDetailMutation(
            () => createOrUpdateSharedQaReview(token, detail.job.id, productionItemId, input, qaReviewId),
            "We couldn't update that QA review."
          )
        }
        onSaveQaFinding={(productionItemId, qaReviewId, input, findingId) =>
          runDetailMutation(
            () => createOrUpdateSharedQaFinding(token, detail.job.id, productionItemId, qaReviewId, input, findingId),
            "We couldn't update that QA finding."
          )
        }
        onSaveDeliverable={(productionItemId, input, deliverableId) =>
          runDetailMutation(
            () => createOrUpdateSharedDeliverableItem(token, detail.job.id, productionItemId, input, deliverableId),
            "We couldn't update that deliverable."
          )
        }
        onSaveIssue={(productionItemId, input, issueId) =>
          runDetailMutation(
            () => createOrUpdateSharedProductionIssue(token, detail.job.id, productionItemId, input, issueId),
            "We couldn't update that production issue."
          )
        }
      />
    );
  } else if (resolvedTab === "approvals") {
    body = (
      <SharedJobApprovalsPanel
        detail={detail}
        currentUser={currentUser}
        canManage={canManageApprovals}
        canViewFinance={canViewFinance}
        staffOptions={staffOptions}
        onSaveProductionItem={(input, productionItemId) =>
          runDetailMutation(
            () => createOrUpdateSharedProductionItem(token, detail.job.id, input, productionItemId),
            "We couldn't update that production item."
          )
        }
        onSaveHandoff={(productionItemId, input, handoffId) =>
          runDetailMutation(
            () => createOrUpdateSharedProductionHandoff(token, detail.job.id, productionItemId, input, handoffId),
            "We couldn't update that downstream handoff."
          )
        }
        onSaveApproval={(productionItemId, input, approvalId) =>
          runDetailMutation(
            () => createOrUpdateSharedApprovalRequest(token, detail.job.id, productionItemId, input, approvalId),
            "We couldn't update that approval request."
          )
        }
        onSaveQaReview={(productionItemId, input, qaReviewId) =>
          runDetailMutation(
            () => createOrUpdateSharedQaReview(token, detail.job.id, productionItemId, input, qaReviewId),
            "We couldn't update that QA review."
          )
        }
        onSaveQaFinding={(productionItemId, qaReviewId, input, findingId) =>
          runDetailMutation(
            () => createOrUpdateSharedQaFinding(token, detail.job.id, productionItemId, qaReviewId, input, findingId),
            "We couldn't update that QA finding."
          )
        }
        onSaveDeliverable={(productionItemId, input, deliverableId) =>
          runDetailMutation(
            () => createOrUpdateSharedDeliverableItem(token, detail.job.id, productionItemId, input, deliverableId),
            "We couldn't update that deliverable."
          )
        }
        onSaveIssue={(productionItemId, input, issueId) =>
          runDetailMutation(
            () => createOrUpdateSharedProductionIssue(token, detail.job.id, productionItemId, input, issueId),
            "We couldn't update that production issue."
          )
        }
      />
    );
  } else if (resolvedTab === "qa") {
    body = (
      <SharedJobQaPanel
        detail={detail}
        currentUser={currentUser}
        canManage={canManageQa}
        canViewFinance={canViewFinance}
        staffOptions={staffOptions}
        onSaveProductionItem={(input, productionItemId) =>
          runDetailMutation(
            () => createOrUpdateSharedProductionItem(token, detail.job.id, input, productionItemId),
            "We couldn't update that production item."
          )
        }
        onSaveHandoff={(productionItemId, input, handoffId) =>
          runDetailMutation(
            () => createOrUpdateSharedProductionHandoff(token, detail.job.id, productionItemId, input, handoffId),
            "We couldn't update that downstream handoff."
          )
        }
        onSaveApproval={(productionItemId, input, approvalId) =>
          runDetailMutation(
            () => createOrUpdateSharedApprovalRequest(token, detail.job.id, productionItemId, input, approvalId),
            "We couldn't update that approval request."
          )
        }
        onSaveQaReview={(productionItemId, input, qaReviewId) =>
          runDetailMutation(
            () => createOrUpdateSharedQaReview(token, detail.job.id, productionItemId, input, qaReviewId),
            "We couldn't update that QA review."
          )
        }
        onSaveQaFinding={(productionItemId, qaReviewId, input, findingId) =>
          runDetailMutation(
            () => createOrUpdateSharedQaFinding(token, detail.job.id, productionItemId, qaReviewId, input, findingId),
            "We couldn't update that QA finding."
          )
        }
        onSaveDeliverable={(productionItemId, input, deliverableId) =>
          runDetailMutation(
            () => createOrUpdateSharedDeliverableItem(token, detail.job.id, productionItemId, input, deliverableId),
            "We couldn't update that deliverable."
          )
        }
        onSaveIssue={(productionItemId, input, issueId) =>
          runDetailMutation(
            () => createOrUpdateSharedProductionIssue(token, detail.job.id, productionItemId, input, issueId),
            "We couldn't update that production issue."
          )
        }
      />
    );
  } else if (resolvedTab === "deliverables") {
    body = (
      <SharedJobDeliverablesPanel
        detail={detail}
        currentUser={currentUser}
        canManage={canManageDeliverables}
        canViewFinance={canViewFinance}
        staffOptions={staffOptions}
        onSaveProductionItem={(input, productionItemId) =>
          runDetailMutation(
            () => createOrUpdateSharedProductionItem(token, detail.job.id, input, productionItemId),
            "We couldn't update that production item."
          )
        }
        onSaveHandoff={(productionItemId, input, handoffId) =>
          runDetailMutation(
            () => createOrUpdateSharedProductionHandoff(token, detail.job.id, productionItemId, input, handoffId),
            "We couldn't update that downstream handoff."
          )
        }
        onSaveApproval={(productionItemId, input, approvalId) =>
          runDetailMutation(
            () => createOrUpdateSharedApprovalRequest(token, detail.job.id, productionItemId, input, approvalId),
            "We couldn't update that approval request."
          )
        }
        onSaveQaReview={(productionItemId, input, qaReviewId) =>
          runDetailMutation(
            () => createOrUpdateSharedQaReview(token, detail.job.id, productionItemId, input, qaReviewId),
            "We couldn't update that QA review."
          )
        }
        onSaveQaFinding={(productionItemId, qaReviewId, input, findingId) =>
          runDetailMutation(
            () => createOrUpdateSharedQaFinding(token, detail.job.id, productionItemId, qaReviewId, input, findingId),
            "We couldn't update that QA finding."
          )
        }
        onSaveDeliverable={(productionItemId, input, deliverableId) =>
          runDetailMutation(
            () => createOrUpdateSharedDeliverableItem(token, detail.job.id, productionItemId, input, deliverableId),
            "We couldn't update that deliverable."
          )
        }
        onSaveIssue={(productionItemId, input, issueId) =>
          runDetailMutation(
            () => createOrUpdateSharedProductionIssue(token, detail.job.id, productionItemId, input, issueId),
            "We couldn't update that production issue."
          )
        }
      />
    );
  } else if (resolvedTab === "activity") {
    body = detail.activity.length ? (
      <ActivityTimelineList entries={detail.activity} />
    ) : (
      <WorkspaceEmptyState title="No activity yet" summary="Audit history appears here as the job moves through execution." compact />
    );
  } else {
    const adapterTab = adapterTabs.find((tab) => tab.key === resolvedTab);
    body = adapterTab?.body ?? <div />;
  }

  const workflowIntro =
    resolvedTab === "summary" || workflowError ? (
      <WorkflowValidationPanel
        workflow={resolvedTab === "summary" ? detail.workflow ?? null : null}
        validation={workflowError}
        compact={resolvedTab !== "summary"}
      />
    ) : null;
  const detailIntro =
    workflowReviewNotice || workflowIntro ? (
      <div className="shared-job-form__stack">
        {workflowReviewNotice ? (
          <section className="feedback-strip feedback-strip--info" role="status" aria-label="Workflow review notice">
            <div className="feedback-strip__content">
              <strong>{workflowReviewNotice.title}</strong>
              <span>{workflowReviewNotice.body}</span>
              <span>For: {workflowReviewNotice.director}</span>
            </div>
          </section>
        ) : null}
        {workflowIntro}
      </div>
    ) : null;

  return (
    <SharedJobDetailShell
      eyebrow={adapter.labels.departmentBadge}
      title={detail.job.job_number ?? detail.job.title}
      summary={`${detail.summary.organization_name ?? "No organization"} | ${detail.job.title || detail.job.event_name || "Untitled job"} | ${detail.summary.primary_day_date ? formatDate(detail.summary.primary_day_date) : "Date TBD"}`}
      meta={[
        { label: humanizeToken(detail.job.job_status), tone: mapHeaderTone(detail.job.job_status) },
        calendarReadiness ? { label: calendarReadiness.label, tone: mapCalendarHeaderTone(calendarReadiness.tone) } : { label: "Needs date", tone: "warning" },
        { label: humanizeToken(detail.job.readiness_status), tone: mapHeaderTone(detail.job.readiness_status) },
        { label: humanizeToken(detail.job.staffing_status), tone: mapHeaderTone(detail.job.staffing_status) },
        { label: humanizeToken(detail.job.production_status), tone: mapHeaderTone(detail.job.production_status) }
      ]}
      actions={
        <WorkspaceActionBar align="end">
          <button type="button" className="secondary-button" onClick={() => navigateToSharedJobHash(routeBase)}>
            Back to Jobs
          </button>
          {canManageRecord ? (
            <button type="button" className="secondary-button" onClick={() => navigateToSharedJobHash(routeBase, `${detail.job.id}/edit`)}>
              Edit
            </button>
          ) : null}
          {!detail.job.published_at && (hasPolicy ? Boolean(actions.publish) : canManageRecord) ? <button type="button" className="secondary-button" onClick={() => void runLifecycle("publish")}>Publish</button> : null}
          {(hasPolicy ? Boolean(actions.cancel) : canManageRecord) ? <button type="button" className="secondary-button" onClick={() => void runLifecycle("postpone")}>Postpone</button> : null}
          {(hasPolicy ? Boolean(actions.cancel) : canManageRecord) ? <button type="button" className="secondary-button" onClick={() => void runLifecycle("cancel")}>Cancel</button> : null}
          {(hasPolicy ? Boolean(actions.archive) : canManageRecord) ? <button type="button" className="secondary-button" onClick={() => void runLifecycle("archive")}>Archive</button> : null}
        </WorkspaceActionBar>
      }
      tabs={tabs}
      activeTab={resolvedTab}
      onSelectTab={(key) => navigateToSharedJobHash(routeBase, detail.job.id, { tab: key === "summary" ? null : key })}
      summaryCards={summaryCards}
      bodyIntro={detailIntro}
      body={body}
    />
  );
}

function JobPriorIntelligencePanel({
  intelligence
}: {
  intelligence: ReturnType<typeof buildJobPriorIntelligence>;
}) {
  return (
    <section className="shared-job-detail__list-card" aria-label="Prior job intelligence">
      <div className="shared-job-detail__list-card-header">
        <div>
          <h3>Prior Job Intelligence</h3>
          <p className="shared-job-sidebar__muted">Institutional memory from Resource Library, organization notes, prior closeouts, and similar work.</p>
        </div>
        <StatusPill label={`${intelligence.items.length} memory item${intelligence.items.length === 1 ? "" : "s"}`} tone={intelligence.items.length ? "info" : "neutral"} />
      </div>
      {intelligence.items.length ? (
        <div className="shared-job-notes-grid">
          {intelligence.items.slice(0, 6).map((item) => (
            <PriorIntelligenceCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="empty-state empty-state--panel">
          <strong>{intelligence.emptyTitle}</strong>
          <p>{intelligence.emptySummary}</p>
        </div>
      )}
    </section>
  );
}

function PriorIntelligenceCard({ item }: { item: JobPriorIntelligenceItem }) {
  return (
    <article>
      <span>{item.label}</span>
      <p><strong>{item.title}</strong></p>
      <p>{item.summary}</p>
      <div className="shared-job-preview__status-row">
        <StatusPill label={item.owner} tone={item.tone} />
        <span className="meta-pill">{item.source}</span>
      </div>
      {item.updatedAt ? <small>Updated {formatDate(item.updatedAt)}</small> : null}
      {item.href ? <a className="secondary-button" href={item.href}>Open related context</a> : null}
    </article>
  );
}
