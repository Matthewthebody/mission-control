import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ApiClientError } from "../api";
import { useActionAvailability, useVisibleSections } from "../components/PermissionGate";
import { SharedJobDetailShell } from "../components/jobs/SharedJobDetailShell";
import { ActivityTimelineList } from "../components/jobs/ActivityTimelineList";
import { getDepartmentJobAdapterUI } from "../components/jobs/DepartmentJobAdapterUIRegistry";
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
import { listDirectoryOwnerOptions } from "../services/organizationApi";
import { buildJobPreCallContext } from "../services/preCallContextBuilders";
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

export function SharedJobDetailPage({ token, currentUser, departmentType, routeBase }: Props) {
  const { path, params } = useHashRouteSnapshot();
  const jobId = parseSharedJobIdFromPath(path);
  const [detail, setDetail] = useState<SharedJobDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [workflowError, setWorkflowError] = useState<SharedWorkflowTransitionValidation | null>(null);
  const [staffOptions, setStaffOptions] = useState<DirectoryOwnerOption[]>([]);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
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

  const summaryCards = [
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
          <span>Readiness: {detail.status.readiness_percent}% complete</span>
          <span>Staffing: {humanizeToken(detail.status.staffing_status)}</span>
          <span>Blockers: {detail.status.blocker_count}</span>
          <span>Open watch flags: {detail.status.open_watch_flag_count}</span>
        </div>
      )
    },
    {
      key: "watch",
      title: "Watch Flags",
      body: detail.watch_flags.length ? <div className="shared-job-detail__kv">{detail.watch_flags.slice(0, 4).map((flag) => <span key={flag.id}>{flag.title}</span>)}</div> : <div className="shared-job-sidebar__muted">No open watch flags.</div>
    }
  ].filter((card) => card.key !== "watch" || sectionVisible("watch_flags"));

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
        <section className="shared-job-detail__list-card">
          <h3>Evaluations / Closeout</h3>
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

  return (
    <SharedJobDetailShell
      eyebrow={adapter.labels.departmentBadge}
      title={detail.job.job_number ?? detail.job.title}
      summary={`${detail.summary.organization_name ?? "No organization"} | ${detail.job.title || detail.job.event_name || "Untitled job"} | ${detail.summary.primary_day_date ? formatDate(detail.summary.primary_day_date) : "Date TBD"}`}
      meta={[
        { label: humanizeToken(detail.job.job_status), tone: mapHeaderTone(detail.job.job_status) },
        { label: humanizeToken(detail.job.readiness_status), tone: mapHeaderTone(detail.job.readiness_status) },
        { label: humanizeToken(detail.job.staffing_status), tone: mapHeaderTone(detail.job.staffing_status) },
        { label: humanizeToken(detail.job.production_status), tone: mapHeaderTone(detail.job.production_status) }
      ]}
      actions={
        <WorkspaceActionBar align="end">
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
      bodyIntro={workflowIntro}
      body={body}
    />
  );
}
