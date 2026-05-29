import { useEffect, useState } from "react";
import { OperationalDetailSection } from "../OperationalDetailSection";
import { buildProductionProjectsHash } from "../../services/productionProjects";
import { toGraphicsLabel } from "./graphicsNaming";
import type {
  ProductionProjectDetail,
  ProductionProjectJobType,
  ProductionProjectQaCheckKey,
  ProductionProjectQaCheckRecord,
  ProductionProjectReferenceUserOption,
  ProductionProjectStage,
  ProductionProjectStatus,
  ProductionProjectTaskStatus,
  ProductionProjectExceptionRecord,
  ProductionProjectExceptionSeverity,
  ProductionProjectExceptionStatus,
  ProductionProjectExceptionType,
  ProductionProjectFollowUpType,
  ProductionProjectFollowUpStatus,
  ProductionProjectWorkspaceView
} from "../../types";

type DraftState = {
  status: ProductionProjectStatus;
  jobType: ProductionProjectJobType;
  stage: ProductionProjectStage;
  ownerUserId: string;
  peerReviewerUserId: string;
  finalQcReviewerUserId: string;
  dueDate: string;
  followUpDate: string;
  note: string;
};

type TaskDraftState = {
  ownerUserId: string;
  dueDate: string;
  note: string;
};

type BuddyDraftState = {
  status: ProductionProjectTaskStatus;
  ownerUserId: string;
  duplicateHandlingRequired: boolean;
  cleanupCompleted: boolean;
  unresolvedGroupCount: number;
  notes: string;
};

type VirtualTeamDraftState = {
  status: ProductionProjectTaskStatus;
  ownerUserId: string;
  attributesValidated: boolean;
  coachTagsValidated: boolean;
  splitByGroupValidated: boolean;
  ambiguousMatchRequired: boolean;
  ambiguousMatchResolved: boolean;
  notes: string;
};

type ExceptionDraftState = {
  laneType: "buddy_photos" | "virtual_teams";
  exceptionType: ProductionProjectExceptionType;
  severity: ProductionProjectExceptionSeverity;
  blocking: boolean;
  assigneeUserId: string;
  notes: string;
  issueTag: string;
  followUpType: ProductionProjectFollowUpType | "";
  followUpStatus: ProductionProjectFollowUpStatus | "";
  followUpOwnerUserId: string;
  followUpNotes: string;
};

type QaReviewDraftState = {
  result: "passed" | "correction_needed" | "blocked";
  note: string;
  correctionReason: string;
  checks: ProductionProjectQaCheckRecord[];
};

type Props = {
  detail: ProductionProjectDetail | null;
  loading: boolean;
  error: string;
  workspaceView: ProductionProjectWorkspaceView;
  currentUserId: string;
  currentUserName: string;
  ownerOptions: ProductionProjectReferenceUserOption[];
  draft: DraftState;
  saving: boolean;
  onDraftChange: (next: Partial<DraftState>) => void;
  onAssignToMe: () => void;
  onMarkComplete: () => void;
  onSnooze: () => void;
  onFollowUpToday: () => void;
  onStartProduction: () => void;
  onSendToPeerReview: () => void;
  onRequestChanges: () => void;
  onMarkQaApproved: () => void;
  onMarkReadyForRelease: () => void;
  onSubmitQaReview: (payload: {
    result: "passed" | "correction_needed" | "blocked";
    note?: string | null;
    correction_reason?: string | null;
    qa_checks: ProductionProjectQaCheckRecord[];
  }) => Promise<void> | void;
  onSave: () => void;
  onOpenLinkedOrganization?: (organizationId: string) => void;
  onOpenLinkedShoot?: (shootId: string) => void;
  onTaskUpdate: (
    taskId: string,
    patch: {
      status?: ProductionProjectTaskStatus;
      owner_user_id?: string | null;
      due_date?: string | null;
      latest_note?: string | null;
      handoff_to_user_id?: string | null;
      handoff_note?: string | null;
    }
  ) => Promise<void> | void;
  onBuddyWorkflowUpdate: (patch: {
    status?: ProductionProjectTaskStatus;
    owner_user_id?: string | null;
    duplicate_handling_required?: boolean;
    cleanup_completed?: boolean;
    unresolved_group_count?: number;
    notes?: string | null;
  }) => Promise<void> | void;
  onVirtualTeamWorkflowUpdate: (patch: {
    status?: ProductionProjectTaskStatus;
    owner_user_id?: string | null;
    attributes_validated?: boolean;
    coach_tags_validated?: boolean;
    split_by_group_validated?: boolean;
    ambiguous_match_required?: boolean;
    ambiguous_match_resolved?: boolean;
    notes?: string | null;
  }) => Promise<void> | void;
  onExceptionCreate: (payload: {
    lane_type: "buddy_photos" | "virtual_teams";
    exception_type: ProductionProjectExceptionType;
    severity?: ProductionProjectExceptionSeverity;
    blocking?: boolean;
    assignee_user_id?: string | null;
    notes?: string | null;
    issue_tag?: string | null;
    follow_up_type?: ProductionProjectFollowUpType | null;
    follow_up_status?: ProductionProjectFollowUpStatus | null;
    follow_up_owner_user_id?: string | null;
    follow_up_notes?: string | null;
  }) => Promise<void> | void;
  onExceptionUpdate: (
    exceptionId: string,
    patch: {
      status?: ProductionProjectExceptionStatus;
      blocking?: boolean;
      assignee_user_id?: string | null;
      notes?: string | null;
      resolution_notes?: string | null;
      issue_tag?: string | null;
      follow_up_type?: ProductionProjectFollowUpType | null;
      follow_up_status?: ProductionProjectFollowUpStatus | null;
      follow_up_owner_user_id?: string | null;
      follow_up_notes?: string | null;
    }
  ) => Promise<void> | void;
};

const STAGE_OPTIONS: Array<{ value: ProductionProjectStage; label: string }> = [
  { value: "intake_pending", label: "Intake Pending" },
  { value: "ready_for_production", label: "Ready for Graphics" },
  { value: "in_production", label: "In Graphics" },
  { value: "blocked", label: "Blocked" },
  { value: "ready_for_qa", label: "Ready for QA" },
  { value: "in_qa_review", label: "In QA Review" },
  { value: "qa_hold", label: "QA Hold" },
  { value: "correction_needed", label: "Correction Needed" },
  { value: "ready_to_release", label: "Ready to Release" },
  { value: "released_complete", label: "Released / Complete" },
  { value: "on_hold", label: "On Hold" },
  { value: "cancelled", label: "Cancelled" }
];

const WORKFLOW_STATUS_OPTIONS: Array<{ value: ProductionProjectTaskStatus; label: string }> = [
  { value: "todo", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Complete" },
  { value: "skipped", label: "Skipped" }
];

const EXCEPTION_TYPE_OPTIONS: Array<{ value: ProductionProjectExceptionType; label: string }> = [
  { value: "buddy_unresolved_group", label: "Buddy group unresolved" },
  { value: "buddy_duplicate_handling_needed", label: "Buddy duplicate handling needed" },
  { value: "vt_ambiguous_match", label: "Virtual team ambiguous match" },
  { value: "vt_coach_tag_missing", label: "Coach tag missing" },
  { value: "vt_split_group_mismatch", label: "Split-by-group mismatch" },
  { value: "vt_attribute_validation_failed", label: "Virtual team attributes not validated" }
];

const EXCEPTION_SEVERITY_OPTIONS: Array<{ value: ProductionProjectExceptionSeverity; label: string }> = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" }
];

const EXCEPTION_STATUS_OPTIONS: Array<{ value: ProductionProjectExceptionStatus; label: string }> = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" }
];

const FOLLOW_UP_TYPE_OPTIONS: Array<{ value: ProductionProjectFollowUpType; label: string }> = [
  { value: "training", label: "Training follow-up" },
  { value: "ops_followup", label: "Operations follow-up" },
  { value: "coaching", label: "Coaching follow-up" },
  { value: "process_update", label: "Process update" }
];

const FOLLOW_UP_STATUS_OPTIONS: Array<{ value: ProductionProjectFollowUpStatus; label: string }> = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "complete", label: "Complete" }
];

const QA_CHECK_OPTIONS: Array<{ key: ProductionProjectQaCheckKey; label: string; detail: string }> = [
  {
    key: "count_reconciliation",
    label: "Count reconciliation complete",
    detail: "Capture, export, and upload counts align for the active lanes."
  },
  {
    key: "blocking_exceptions",
    label: "No blocking exceptions",
    detail: "All blocking exceptions are resolved or dismissed."
  },
  {
    key: "buddy_workflow",
    label: "Buddy workflow complete",
    detail: "Buddy sorting and duplicate handling are complete when required."
  },
  {
    key: "virtual_team",
    label: "Virtual team validation complete",
    detail: "Coach tags, group splits, and ambiguous matches are resolved."
  },
  {
    key: "asset_validation",
    label: "Presets/assets validated",
    detail: "Graphics presets and background packs are confirmed for this job."
  },
  {
    key: "final_review_notes",
    label: "Final review notes captured",
    detail: "Release notes or final QA observations are recorded."
  }
];

const QA_CHECK_STATUS_OPTIONS: Array<{ value: ProductionProjectQaCheckRecord["status"]; label: string }> = [
  { value: "pass", label: "Pass" },
  { value: "needs_review", label: "Needs Review" },
  { value: "fail", label: "Fail" },
  { value: "not_applicable", label: "Not Applicable" }
];

export function ProductionProjectDetailPanel({
  detail,
  loading,
  error,
  workspaceView,
  currentUserId,
  currentUserName,
  ownerOptions,
  draft,
  saving,
  onDraftChange,
  onAssignToMe,
  onMarkComplete,
  onSnooze,
  onFollowUpToday,
  onStartProduction,
  onSendToPeerReview,
  onRequestChanges,
  onMarkQaApproved,
  onMarkReadyForRelease,
  onSubmitQaReview,
  onSave,
  onOpenLinkedOrganization,
  onOpenLinkedShoot,
  onTaskUpdate,
  onBuddyWorkflowUpdate,
  onVirtualTeamWorkflowUpdate,
  onExceptionCreate,
  onExceptionUpdate
}: Props) {
  const [taskDrafts, setTaskDrafts] = useState<Record<string, TaskDraftState>>({});
  const [buddyDraft, setBuddyDraft] = useState<BuddyDraftState>({
    status: "todo",
    ownerUserId: "",
    duplicateHandlingRequired: false,
    cleanupCompleted: false,
    unresolvedGroupCount: 0,
    notes: ""
  });
  const [virtualTeamDraft, setVirtualTeamDraft] = useState<VirtualTeamDraftState>({
    status: "todo",
    ownerUserId: "",
    attributesValidated: false,
    coachTagsValidated: false,
    splitByGroupValidated: false,
    ambiguousMatchRequired: false,
    ambiguousMatchResolved: false,
    notes: ""
  });
  const [exceptionDraft, setExceptionDraft] = useState<ExceptionDraftState>({
    laneType: "buddy_photos",
    exceptionType: "buddy_unresolved_group",
    severity: "normal",
    blocking: true,
    assigneeUserId: "",
    notes: "",
    issueTag: "",
    followUpType: "",
    followUpStatus: "",
    followUpOwnerUserId: "",
    followUpNotes: ""
  });
  const [qaReviewDraft, setQaReviewDraft] = useState<QaReviewDraftState>({
    result: "passed",
    note: "",
    correctionReason: "",
    checks: QA_CHECK_OPTIONS.map((check) => ({
      key: check.key,
      label: check.label,
      status: "needs_review"
    }))
  });

  useEffect(() => {
    if (!detail) {
      setTaskDrafts({});
      setBuddyDraft({
        status: "todo",
        ownerUserId: "",
        duplicateHandlingRequired: false,
        cleanupCompleted: false,
        unresolvedGroupCount: 0,
        notes: ""
      });
      setVirtualTeamDraft({
        status: "todo",
        ownerUserId: "",
        attributesValidated: false,
        coachTagsValidated: false,
        splitByGroupValidated: false,
        ambiguousMatchRequired: false,
        ambiguousMatchResolved: false,
        notes: ""
      });
      setExceptionDraft({
        laneType: "buddy_photos",
        exceptionType: "buddy_unresolved_group",
        severity: "normal",
        blocking: true,
        assigneeUserId: "",
        notes: "",
        issueTag: "",
        followUpType: "",
        followUpStatus: "",
        followUpOwnerUserId: "",
        followUpNotes: ""
      });
      setQaReviewDraft({
        result: "passed",
        note: "",
        correctionReason: "",
        checks: QA_CHECK_OPTIONS.map((check) => ({
          key: check.key,
          label: check.label,
          status: "needs_review"
        }))
      });
      return;
    }
    setTaskDrafts(
      Object.fromEntries(
        detail.tasks.map((task) => [
          task.id,
          {
            ownerUserId: task.owner_user_id ?? "",
            dueDate: task.due_date ?? "",
            note: task.latest_note ?? ""
          }
        ])
      )
    );
    if (detail.buddy_workflow) {
      setBuddyDraft({
        status: detail.buddy_workflow.status,
        ownerUserId: detail.buddy_workflow.owner_user_id ?? "",
        duplicateHandlingRequired: detail.buddy_workflow.duplicate_handling_required,
        cleanupCompleted: Boolean(detail.buddy_workflow.cleanup_completed_at),
        unresolvedGroupCount: detail.buddy_workflow.unresolved_group_count ?? 0,
        notes: detail.buddy_workflow.notes ?? ""
      });
    }
    if (detail.virtual_team_workflow) {
      setVirtualTeamDraft({
        status: detail.virtual_team_workflow.status,
        ownerUserId: detail.virtual_team_workflow.owner_user_id ?? "",
        attributesValidated: detail.virtual_team_workflow.attributes_validated,
        coachTagsValidated: detail.virtual_team_workflow.coach_tags_validated,
        splitByGroupValidated: detail.virtual_team_workflow.split_by_group_validated,
        ambiguousMatchRequired: detail.virtual_team_workflow.ambiguous_match_required,
        ambiguousMatchResolved: Boolean(detail.virtual_team_workflow.ambiguous_match_resolved_at),
        notes: detail.virtual_team_workflow.notes ?? ""
      });
    }

    const latestReview = detail.reviews[0];
    setQaReviewDraft({
      result: latestReview?.result === "correction_needed" ? "correction_needed" : latestReview?.result === "blocked" ? "blocked" : "passed",
      note: "",
      correctionReason: "",
      checks:
        latestReview?.qa_checks?.length
          ? latestReview.qa_checks.map((check) => ({
              key: check.key,
              label: check.label,
              status: check.status,
              notes: check.notes ?? ""
            }))
          : QA_CHECK_OPTIONS.map((check) => ({
              key: check.key,
              label: check.label,
              status: "needs_review"
            }))
    });
  }, [detail]);

  if (loading) {
    return (
      <aside className="panel projects-detail-panel">
        <div className="section-title">Loading graphics detail</div>
        <p className="section-subtitle">Pulling the job state, QA history, blockers, and checklist detail.</p>
      </aside>
    );
  }

  if (error) {
    return (
      <aside className="panel projects-detail-panel">
        <div className="section-title">Graphics Detail Unavailable</div>
        <p className="section-subtitle">{error}</p>
      </aside>
    );
  }

  if (!detail) {
    return (
      <aside className="panel projects-detail-panel">
        <div className="section-title">Graphics Detail</div>
        <p className="section-subtitle">Select a graphics workflow item to see owner, blockers, QA handoff, and release readiness.</p>
      </aside>
    );
  }

  const { project, tasks, reviews, events, task_handoffs, task_events, workflow_summary, buddy_workflow, virtual_team_workflow, exceptions } = detail;
  const approvalSummary = detail.approval_summary;
  const firstName = currentUserName.split(" ")[0] ?? "Me";
  const stepGuidance = buildStepGuidance(project, workflow_summary, currentUserId, workspaceView);
  const qaChecklistComplete = qaReviewDraft.checks.every(
    (check) => check.status === "pass" || check.status === "not_applicable"
  );
  const linkedShootMeta = [
    project.linked_shoot_code,
    project.linked_shoot_date_label ? `Shoot ${project.linked_shoot_date_label}` : null,
    formatPhotographerCount(project.shoot_photographer_count),
    project.linked_shoot_importance_label ?? project.source_trigger_label
  ]
    .filter(Boolean)
    .join(" | ");

  function updateTaskDraft(taskId: string, next: Partial<TaskDraftState>) {
    setTaskDrafts((current) => ({
      ...current,
      [taskId]: {
        ownerUserId: current[taskId]?.ownerUserId ?? "",
        dueDate: current[taskId]?.dueDate ?? "",
        note: current[taskId]?.note ?? "",
        ...next
      }
    }));
  }

  function getTaskDraft(taskId: string): TaskDraftState {
    return taskDrafts[taskId] ?? { ownerUserId: "", dueDate: "", note: "" };
  }

  return (
    <aside className="panel projects-detail-panel">
      <div className="dashboard-panel__header">
        <div>
          <div className="eyebrow">{toGraphicsLabel(project.job_type_label)}</div>
          <div className="section-title">{project.title}</div>
          <p className="section-subtitle">{project.summary ?? project.created_reason}</p>
        </div>
        <div className="projects-header-chips">
          <span className={`ops-preview-chip ops-preview-chip--${project.status_tone}`}>{project.stage_label}</span>
          <span className="meta-pill">{project.qa_state_label}</span>
          <span className="meta-pill">{project.release_state_label}</span>
        </div>
      </div>

      <div className="projects-context-grid">
        <article className="metric-card">
          <div className="metric-card__label">Owning Queue</div>
          <strong className="metric-card__value">{toGraphicsLabel(project.team_owner_label)}</strong>
          <div className="muted">{project.health_signal_label}</div>
        </article>
        <article className="metric-card">
          <div className="metric-card__label">Owner</div>
          <strong className="metric-card__value">{project.owner_label}</strong>
          <div className="muted">{project.due_label ?? "No due date set"}</div>
        </article>
        <article className="metric-card">
          <div className="metric-card__label">QA / Release</div>
          <strong className="metric-card__value">{project.qa_state_label}</strong>
          <div className="muted">{project.release_state_label}</div>
        </article>
        <article className="metric-card">
          <div className="metric-card__label">Linked Shoot</div>
          <strong className="metric-card__value">{project.linked_shoot_title ?? project.linked_shoot_code ?? project.linked_organization_name ?? "Unlinked"}</strong>
          <div className="muted">{linkedShootMeta || "Manual creation"}</div>
        </article>
      </div>

      <div className="projects-quick-actions">
        <button type="button" className="secondary-button" onClick={onAssignToMe} disabled={saving}>
          Assign To {firstName}
        </button>
        {project.stage !== "in_production" ? (
          <button type="button" className="secondary-button" onClick={onStartProduction} disabled={saving}>
            Start Graphics Work
          </button>
        ) : null}
        {project.stage !== "ready_for_qa" ? (
          <button type="button" className="secondary-button" onClick={onSendToPeerReview} disabled={saving}>
            Send To QA
          </button>
        ) : null}
        {project.stage !== "in_qa_review" ? (
          <button type="button" className="secondary-button" onClick={onMarkQaApproved} disabled={saving}>
            Start QA Review
          </button>
        ) : null}
        {project.stage !== "correction_needed" ? (
          <button type="button" className="secondary-button" onClick={onRequestChanges} disabled={saving}>
            Request Correction
          </button>
        ) : null}
        {project.stage !== "ready_to_release" ? (
          <button
            type="button"
            className="secondary-button"
            onClick={onMarkReadyForRelease}
            disabled={saving || !workflow_summary.can_move_to_ready_to_release}
            title={
              workflow_summary.can_move_to_ready_to_release
                ? undefined
                : workflow_summary.blocked_reasons.join(", ")
            }
          >
            Mark Ready To Release
          </button>
        ) : null}
        <button type="button" className="secondary-button" onClick={onFollowUpToday} disabled={saving}>
          Follow Up Today
        </button>
        <button type="button" className="secondary-button" onClick={onSnooze} disabled={saving}>
          Snooze 2 Days
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={onMarkComplete}
          disabled={saving || !workflow_summary.can_release}
          title={workflow_summary.can_release ? undefined : workflow_summary.blocked_reasons.join(", ")}
        >
          Release Job
        </button>
      </div>

      {approvalSummary && approvalSummary.open_count > 0 ? (
        <div className="projects-approval-banner">
          <strong>{approvalSummary.blocking_open_count > 0 ? "Protected graphics action waiting on approval." : "Open graphics approval activity."}</strong>
          <span>
            {approvalSummary.blocking_open_count} blocking open, {approvalSummary.overdue_count} overdue, {approvalSummary.escalated_count} escalated.
          </span>
          <a className="secondary-button" href="#approvals?tab=operational">
            Open Approvals
          </a>
        </div>
      ) : null}

      {workflow_summary.release_blocked ? (
        <div className="projects-release-warning">
          <strong>Release blocked.</strong>
          <ul className="projects-inline-list">
            {workflow_summary.blocked_reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="projects-step-guidance" aria-labelledby="production-step-guidance-title">
        <div className="projects-step-guidance__header">
          <div className="eyebrow">Current Step Guidance</div>
          <h4 id="production-step-guidance-title">{stepGuidance.title}</h4>
          <p>{stepGuidance.summary}</p>
        </div>
        <ul className="projects-step-guidance__list">
          {stepGuidance.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
        <div className="projects-step-guidance__role">
          <strong>{stepGuidance.roleTitle}</strong>
          <span>{stepGuidance.roleSummary}</span>
        </div>
        <div className="projects-step-guidance__links">
          {stepGuidance.links.map((link) => (
            <a key={link.label} className="secondary-button" href={link.hash}>
              {link.label}
            </a>
          ))}
        </div>
      </section>

      <section className="form-grid form-grid--compact">
        <label className="filter-field">
          <span>Status</span>
          <select value={draft.status} onChange={(event) => onDraftChange({ status: event.target.value as ProductionProjectStatus })}>
            <option value="new">New</option>
            <option value="active">Active</option>
            <option value="blocked">Blocked</option>
            <option value="waiting">Waiting</option>
            <option value="completed">Completed</option>
            <option value="canceled">Canceled</option>
          </select>
        </label>
        <label className="filter-field">
          <span>Workflow State</span>
          <select value={draft.stage} onChange={(event) => onDraftChange({ stage: event.target.value as ProductionProjectStage })}>
            {STAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Graphics Owner</span>
          <select value={draft.ownerUserId} onChange={(event) => onDraftChange({ ownerUserId: event.target.value })}>
            <option value="">Unassigned</option>
            {ownerOptions.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Peer Reviewer</span>
          <select value={draft.peerReviewerUserId} onChange={(event) => onDraftChange({ peerReviewerUserId: event.target.value })}>
            <option value="">Unassigned</option>
            {ownerOptions.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Final QC Reviewer</span>
          <select value={draft.finalQcReviewerUserId} onChange={(event) => onDraftChange({ finalQcReviewerUserId: event.target.value })}>
            <option value="">Unassigned</option>
            {ownerOptions.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span>Due Date</span>
          <input type="date" value={draft.dueDate} onChange={(event) => onDraftChange({ dueDate: event.target.value })} />
        </label>
        <label className="filter-field">
          <span>Follow-Up Date</span>
          <input type="date" value={draft.followUpDate} onChange={(event) => onDraftChange({ followUpDate: event.target.value })} />
        </label>
        <label className="filter-field filter-field--wide">
          <span>Short Note</span>
          <textarea rows={3} value={draft.note} onChange={(event) => onDraftChange({ note: event.target.value })} />
        </label>
      </section>

      <div className="page-intro-actions page-intro-actions--compact">
        <button type="button" onClick={onSave} disabled={saving}>
          {saving ? "Saving..." : "Save Graphics Update"}
        </button>
      </div>

      <OperationalDetailSection
        title="Blockers"
        summary="Structured blocker data keeps dependencies visible and gives the next owner a real action path."
        defaultOpen={Boolean(project.current_blocker)}
      >
        {project.current_blocker ? (
          <div className="projects-context-list">
            <div><strong>Type:</strong> {project.current_blocker.blocker_type_label}</div>
            <div><strong>Reason:</strong> {project.current_blocker.reason}</div>
            <div><strong>Owner:</strong> {project.current_blocker.blocker_owner_label ?? "Unassigned"}</div>
            <div><strong>Dependency:</strong> {project.current_blocker.dependency ?? "None captured"}</div>
            <div><strong>Target:</strong> {project.current_blocker.expected_resolution_label ?? "No target date"}</div>
            {project.current_blocker.notes ? <div><strong>Notes:</strong> {project.current_blocker.notes}</div> : null}
          </div>
        ) : (
          <div className="empty-state empty-state--panel">No active blockers right now.</div>
        )}
      </OperationalDetailSection>

      <OperationalDetailSection
        title="QA Review Checklist"
        summary="QA approvals stay enforceable by capturing a checklist, notes, and the final outcome."
        defaultOpen
      >
        <div className="qa-checklist-grid">
          {qaReviewDraft.checks.map((check) => (
            <div key={check.key} className="qa-checklist-item">
              <div>
                <strong>{check.label}</strong>
                <div className="muted">{QA_CHECK_OPTIONS.find((option) => option.key === check.key)?.detail}</div>
              </div>
              <label className="field">
                <span>Status</span>
                <select
                  value={check.status}
                  onChange={(event) =>
                    setQaReviewDraft((current) => ({
                      ...current,
                      checks: current.checks.map((entry) =>
                        entry.key === check.key ? { ...entry, status: event.target.value as ProductionProjectQaCheckRecord["status"] } : entry
                      )
                    }))
                  }
                >
                  {QA_CHECK_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Notes</span>
                <input
                  type="text"
                  value={check.notes ?? ""}
                  placeholder="Optional note for this check."
                  onChange={(event) =>
                    setQaReviewDraft((current) => ({
                      ...current,
                      checks: current.checks.map((entry) =>
                        entry.key === check.key ? { ...entry, notes: event.target.value } : entry
                      )
                    }))
                  }
                />
              </label>
            </div>
          ))}
        </div>
        <div className="qa-checklist-summary">
          <strong>{qaChecklistComplete ? "Checklist complete" : "Checklist incomplete"}</strong>
          <span className="muted">
            {qaChecklistComplete
              ? "All required checks are marked as pass or not applicable."
              : "Mark each QA check as pass, fail, or not applicable before approving."}
          </span>
        </div>
        <div className="qa-review-notes">
          <label className="field">
            <span>QA Review Note</span>
            <textarea
              rows={3}
              value={qaReviewDraft.note}
              placeholder="Capture QA summary notes or observations."
              onChange={(event) => setQaReviewDraft((current) => ({ ...current, note: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Correction Reason (if returning)</span>
            <input
              type="text"
              value={qaReviewDraft.correctionReason}
              placeholder="Reason for correction if QA is returning the job."
              onChange={(event) => setQaReviewDraft((current) => ({ ...current, correctionReason: event.target.value }))}
            />
          </label>
        </div>
        <div className="button-row">
          <button
            type="button"
            className="primary-button"
            onClick={() =>
              onSubmitQaReview({
                result: "passed",
                note: qaReviewDraft.note || null,
                correction_reason: null,
                qa_checks: qaReviewDraft.checks
              })
            }
            disabled={saving || !qaChecklistComplete}
          >
            Mark QA Passed
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              onSubmitQaReview({
                result: "blocked",
                note: qaReviewDraft.note || null,
                correction_reason: qaReviewDraft.correctionReason || null,
                qa_checks: qaReviewDraft.checks
              })
            }
            disabled={saving}
          >
            Hold In QA
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              onSubmitQaReview({
                result: "correction_needed",
                note: qaReviewDraft.note || null,
                correction_reason: qaReviewDraft.correctionReason || null,
                qa_checks: qaReviewDraft.checks
              })
            }
            disabled={saving}
          >
            Request Corrections
          </button>
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection
        title={`QA / Review History (${reviews.length})`}
        summary="QA stays visible as a real handoff stage, with correction reasons and reviewer history."
      >
        {reviews.length ? (
          <div className="projects-event-list">
            {reviews.map((review) => (
              <article key={review.id} className="projects-event-card">
                <strong>{review.result_label}</strong>
                <p>{review.review_stage_label}</p>
                <div className="muted">
                  {review.reviewer_label ?? "System reviewer"} | {formatTimestamp(review.created_at)}
                </div>
                {review.correction_reason ? <div className="muted">Correction: {review.correction_reason}</div> : null}
                {review.reassigned_owner_label ? <div className="muted">Returned to: {review.reassigned_owner_label}</div> : null}
                {review.note ? <p>{review.note}</p> : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state empty-state--panel">No QA or correction history yet.</div>
        )}
      </OperationalDetailSection>

      <OperationalDetailSection
        title="Deadline Ladder"
        summary="The ordered task ladder shows due dates, review gates, and dependency readiness in one place."
        defaultOpen
      >
        <div className="projects-ladder-list">
          {workflow_summary.deadline_ladder.map((step) => (
            <article key={step.task_id} className={`projects-ladder-step projects-ladder-step--${step.status}`}>
              <div>
                <strong>{step.title}</strong>
                <div className="muted">
                  {step.task_type_label} | {step.status_label} | {step.dependency_state_label}
                </div>
              </div>
              <div className="projects-ladder-step__meta">
                <span>{step.owner_label ?? "Owner unassigned"}</span>
                <span>{step.due_label ?? "No deadline"}</span>
              </div>
            </article>
          ))}
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection
        title="Buddy Photos & Virtual Teams"
        summary="Track buddy sorting, virtual team validation, and exceptions before release."
        defaultOpen
      >
        <div className="projects-workflow-grid">
          <div className="projects-workflow-card">
            <div className="section-title">Buddy Photos</div>
            <p className="section-subtitle">
              {buddy_workflow ? "Buddy workflow tracked for this job." : "No buddy workflow recorded yet."}
            </p>
            <label className="filter-field">
              <span>Status</span>
              <select
                value={buddyDraft.status}
                onChange={(event) => setBuddyDraft((current) => ({ ...current, status: event.target.value as ProductionProjectTaskStatus }))}
              >
                {WORKFLOW_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Owner</span>
              <select
                value={buddyDraft.ownerUserId}
                onChange={(event) => setBuddyDraft((current) => ({ ...current, ownerUserId: event.target.value }))}
              >
                <option value="">Unassigned</option>
                {ownerOptions.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field checkbox-field">
              <input
                type="checkbox"
                checked={buddyDraft.duplicateHandlingRequired}
                onChange={(event) => setBuddyDraft((current) => ({ ...current, duplicateHandlingRequired: event.target.checked }))}
              />
              <span>Duplicate handling required</span>
            </label>
            <label className="filter-field checkbox-field">
              <input
                type="checkbox"
                checked={buddyDraft.cleanupCompleted}
                onChange={(event) => setBuddyDraft((current) => ({ ...current, cleanupCompleted: event.target.checked }))}
              />
              <span>Cleanup completed</span>
            </label>
            <label className="filter-field">
              <span>Unresolved group count</span>
              <input
                type="number"
                min={0}
                value={buddyDraft.unresolvedGroupCount}
                onChange={(event) =>
                  setBuddyDraft((current) => ({
                    ...current,
                    unresolvedGroupCount: Number(event.target.value || 0)
                  }))
                }
              />
            </label>
            <label className="filter-field">
              <span>Notes</span>
              <textarea
                value={buddyDraft.notes}
                onChange={(event) => setBuddyDraft((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Record buddy cleanup notes or exceptions."
              />
            </label>
            <button
              type="button"
              className="primary-button"
              disabled={saving}
              onClick={() =>
                onBuddyWorkflowUpdate({
                  status: buddyDraft.status,
                  owner_user_id: buddyDraft.ownerUserId || null,
                  duplicate_handling_required: buddyDraft.duplicateHandlingRequired,
                  cleanup_completed: buddyDraft.cleanupCompleted,
                  unresolved_group_count: buddyDraft.unresolvedGroupCount,
                  notes: buddyDraft.notes || null
                })
              }
            >
              Save Buddy Workflow
            </button>
          </div>

          <div className="projects-workflow-card">
            <div className="section-title">Virtual Teams</div>
            <p className="section-subtitle">
              {virtual_team_workflow ? "Virtual team validation tracked for this job." : "No virtual team workflow recorded yet."}
            </p>
            <label className="filter-field">
              <span>Status</span>
              <select
                value={virtualTeamDraft.status}
                onChange={(event) =>
                  setVirtualTeamDraft((current) => ({ ...current, status: event.target.value as ProductionProjectTaskStatus }))
                }
              >
                {WORKFLOW_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Owner</span>
              <select
                value={virtualTeamDraft.ownerUserId}
                onChange={(event) => setVirtualTeamDraft((current) => ({ ...current, ownerUserId: event.target.value }))}
              >
                <option value="">Unassigned</option>
                {ownerOptions.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field checkbox-field">
              <input
                type="checkbox"
                checked={virtualTeamDraft.attributesValidated}
                onChange={(event) => setVirtualTeamDraft((current) => ({ ...current, attributesValidated: event.target.checked }))}
              />
              <span>Attributes validated</span>
            </label>
            <label className="filter-field checkbox-field">
              <input
                type="checkbox"
                checked={virtualTeamDraft.coachTagsValidated}
                onChange={(event) => setVirtualTeamDraft((current) => ({ ...current, coachTagsValidated: event.target.checked }))}
              />
              <span>Coach tags validated</span>
            </label>
            <label className="filter-field checkbox-field">
              <input
                type="checkbox"
                checked={virtualTeamDraft.splitByGroupValidated}
                onChange={(event) => setVirtualTeamDraft((current) => ({ ...current, splitByGroupValidated: event.target.checked }))}
              />
              <span>Split-by-group validated</span>
            </label>
            <label className="filter-field checkbox-field">
              <input
                type="checkbox"
                checked={virtualTeamDraft.ambiguousMatchRequired}
                onChange={(event) => setVirtualTeamDraft((current) => ({ ...current, ambiguousMatchRequired: event.target.checked }))}
              />
              <span>Ambiguous match review required</span>
            </label>
            <label className="filter-field checkbox-field">
              <input
                type="checkbox"
                checked={virtualTeamDraft.ambiguousMatchResolved}
                onChange={(event) => setVirtualTeamDraft((current) => ({ ...current, ambiguousMatchResolved: event.target.checked }))}
              />
              <span>Ambiguous match resolved</span>
            </label>
            <label className="filter-field">
              <span>Notes</span>
              <textarea
                value={virtualTeamDraft.notes}
                onChange={(event) => setVirtualTeamDraft((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Capture VT validation notes."
              />
            </label>
            <button
              type="button"
              className="primary-button"
              disabled={saving}
              onClick={() =>
                onVirtualTeamWorkflowUpdate({
                  status: virtualTeamDraft.status,
                  owner_user_id: virtualTeamDraft.ownerUserId || null,
                  attributes_validated: virtualTeamDraft.attributesValidated,
                  coach_tags_validated: virtualTeamDraft.coachTagsValidated,
                  split_by_group_validated: virtualTeamDraft.splitByGroupValidated,
                  ambiguous_match_required: virtualTeamDraft.ambiguousMatchRequired,
                  ambiguous_match_resolved: virtualTeamDraft.ambiguousMatchResolved,
                  notes: virtualTeamDraft.notes || null
                })
              }
            >
              Save Virtual Team Workflow
            </button>
          </div>
        </div>

        <div className="projects-workflow-exceptions">
          <div className="section-title">Exceptions</div>
          <p className="section-subtitle">Ambiguous matches and unresolved groups stay visible until resolved.</p>
          {exceptions.length ? (
            <div className="projects-workflow-exception-list">
              {exceptions.map((exception: ProductionProjectExceptionRecord) => (
                <div key={exception.id} className="projects-workflow-exception">
                  <div>
                    <strong>{exception.exception_type_label}</strong>
                    <div className="muted">
                      {exception.lane_type === "buddy_photos" ? "Buddy Photos" : "Virtual Teams"} | {exception.severity_label} |{" "}
                      {exception.status_label}
                    </div>
                    {exception.notes ? <div className="muted">Notes: {exception.notes}</div> : null}
                    {exception.issue_tag ? <div className="muted">Issue tag: {exception.issue_tag}</div> : null}
                    {exception.follow_up_type ? (
                      <div className="muted">
                        Follow-up: {humanizeValue(exception.follow_up_type)} ({exception.follow_up_status ?? "open"})
                      </div>
                    ) : null}
                    {exception.follow_up_owner_label ? (
                      <div className="muted">Follow-up owner: {exception.follow_up_owner_label}</div>
                    ) : null}
                    {exception.resolution_notes ? <div className="muted">Resolution: {exception.resolution_notes}</div> : null}
                    {exception.follow_up_notes ? <div className="muted">Follow-up notes: {exception.follow_up_notes}</div> : null}
                  </div>
                  <div className="projects-workflow-exception-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        onExceptionUpdate(exception.id, {
                          status: exception.status === "open" ? "resolved" : "open"
                        })
                      }
                    >
                      {exception.status === "open" ? "Resolve" : "Reopen"}
                    </button>
                    {exception.follow_up_type && exception.follow_up_status !== "complete" ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          onExceptionUpdate(exception.id, {
                            follow_up_status: "complete"
                          })
                        }
                      >
                        Mark Follow-up Complete
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        onExceptionUpdate(exception.id, {
                          status: "dismissed"
                        })
                      }
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">No buddy or virtual team exceptions logged yet.</div>
          )}

          <div className="projects-workflow-exception-create">
            <div className="section-title">Log new exception</div>
            <div className="projects-workflow-exception-form">
              <label className="filter-field">
                <span>Lane</span>
                <select
                  value={exceptionDraft.laneType}
                  onChange={(event) => setExceptionDraft((current) => ({ ...current, laneType: event.target.value as ExceptionDraftState["laneType"] }))}
                >
                  <option value="buddy_photos">Buddy Photos</option>
                  <option value="virtual_teams">Virtual Teams</option>
                </select>
              </label>
              <label className="filter-field">
                <span>Type</span>
                <select
                  value={exceptionDraft.exceptionType}
                  onChange={(event) =>
                    setExceptionDraft((current) => ({ ...current, exceptionType: event.target.value as ProductionProjectExceptionType }))
                  }
                >
                  {EXCEPTION_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Severity</span>
                <select
                  value={exceptionDraft.severity}
                  onChange={(event) =>
                    setExceptionDraft((current) => ({ ...current, severity: event.target.value as ProductionProjectExceptionSeverity }))
                  }
                >
                  {EXCEPTION_SEVERITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field checkbox-field">
                <input
                  type="checkbox"
                  checked={exceptionDraft.blocking}
                  onChange={(event) => setExceptionDraft((current) => ({ ...current, blocking: event.target.checked }))}
                />
                <span>Blocking release</span>
              </label>
              <label className="filter-field">
                <span>Assignee</span>
                <select
                  value={exceptionDraft.assigneeUserId}
                  onChange={(event) => setExceptionDraft((current) => ({ ...current, assigneeUserId: event.target.value }))}
                >
                  <option value="">Unassigned</option>
                  {ownerOptions.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Notes</span>
                <textarea
                  value={exceptionDraft.notes}
                  onChange={(event) => setExceptionDraft((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Capture what needs to be resolved."
                />
              </label>
              <label className="filter-field">
                <span>Issue tag</span>
                <input
                  type="text"
                  value={exceptionDraft.issueTag}
                  onChange={(event) => setExceptionDraft((current) => ({ ...current, issueTag: event.target.value }))}
                  placeholder="Tag recurring issues like background_cleanup."
                />
              </label>
              <label className="filter-field">
                <span>Follow-up type</span>
                <select
                  value={exceptionDraft.followUpType}
                  onChange={(event) =>
                    setExceptionDraft((current) => ({ ...current, followUpType: event.target.value as ExceptionDraftState["followUpType"] }))
                  }
                >
                  <option value="">No follow-up</option>
                  {FOLLOW_UP_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Follow-up status</span>
                <select
                  value={exceptionDraft.followUpStatus}
                  onChange={(event) =>
                    setExceptionDraft((current) => ({ ...current, followUpStatus: event.target.value as ExceptionDraftState["followUpStatus"] }))
                  }
                >
                  <option value="">Not set</option>
                  {FOLLOW_UP_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Follow-up owner</span>
                <select
                  value={exceptionDraft.followUpOwnerUserId}
                  onChange={(event) => setExceptionDraft((current) => ({ ...current, followUpOwnerUserId: event.target.value }))}
                >
                  <option value="">Unassigned</option>
                  {ownerOptions.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                <span>Follow-up notes</span>
                <input
                  type="text"
                  value={exceptionDraft.followUpNotes}
                  onChange={(event) => setExceptionDraft((current) => ({ ...current, followUpNotes: event.target.value }))}
                  placeholder="Follow-up action notes."
                />
              </label>
            </div>
            <button
              type="button"
              className="primary-button"
              disabled={saving}
              onClick={() => {
                void onExceptionCreate({
                  lane_type: exceptionDraft.laneType,
                  exception_type: exceptionDraft.exceptionType,
                  severity: exceptionDraft.severity,
                  blocking: exceptionDraft.blocking,
                  assignee_user_id: exceptionDraft.assigneeUserId || null,
                  notes: exceptionDraft.notes || null,
                  issue_tag: exceptionDraft.issueTag || null,
                  follow_up_type: exceptionDraft.followUpType || null,
                  follow_up_status: exceptionDraft.followUpStatus || null,
                  follow_up_owner_user_id: exceptionDraft.followUpOwnerUserId || null,
                  follow_up_notes: exceptionDraft.followUpNotes || null
                });
                setExceptionDraft((current) => ({ ...current, notes: "", issueTag: "", followUpNotes: "" }));
              }}
            >
              Log Exception
            </button>
          </div>
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection
        title={`Checklist (${tasks.length})`}
        summary="Move graphics work forward by clearing required task work, capturing short notes, and keeping ownership visible."
        defaultOpen
      >
        <div className="projects-task-list">
          {tasks.map((task) => {
            const taskDraft = getTaskDraft(task.id);
            return (
              <article key={task.id} className={`projects-task-card projects-task-card--${task.status}`}>
                <div className="projects-task-card__header">
                  <div>
                    <strong>{task.title}</strong>
                    {task.summary ? <div className="muted">{task.summary}</div> : null}
                  </div>
                  <div className="projects-task-badges">
                    <span className="meta-pill">{task.task_type_label}</span>
                    <span className="meta-pill">{humanizeValue(task.status)}</span>
                  </div>
                </div>
                <div className="projects-task-card__meta">
                  <span>{task.required ? "Required" : "Optional"}</span>
                  <span>{task.due_label ?? "No task due date"}</span>
                  <span>{task.owner_label ?? "Owner unassigned"}</span>
                  <span>{task.dependency_state_label}</span>
                  {task.blocks_release ? <span>Release gate</span> : null}
                  {task.handoff_required ? <span>Handoff required</span> : null}
                </div>
                {task.blocking_dependencies.length ? (
                  <div className="projects-task-dependency">
                    Waiting on:{" "}
                    {task.blocking_dependencies.map((dependency) => `${dependency.title} (${dependency.status_label})`).join(", ")}
                  </div>
                ) : null}
                {task.last_handoff_at ? (
                  <div className="muted">
                    Last handoff: {task.last_handoff_to_label ?? "Unassigned"} | {formatTimestamp(task.last_handoff_at)}
                  </div>
                ) : null}
                <div className="form-grid form-grid--compact projects-task-edit-grid">
                  <label className="filter-field">
                    <span>Task Owner</span>
                    <select value={taskDraft.ownerUserId} onChange={(event) => updateTaskDraft(task.id, { ownerUserId: event.target.value })}>
                      <option value="">Unassigned</option>
                      {ownerOptions.map((owner) => (
                        <option key={owner.id} value={owner.id}>
                          {owner.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="filter-field">
                    <span>Task Due Date</span>
                    <input type="date" value={taskDraft.dueDate} onChange={(event) => updateTaskDraft(task.id, { dueDate: event.target.value })} />
                  </label>
                  <label className="filter-field filter-field--wide">
                    <span>Task Note / Resolution Note</span>
                    <textarea
                      rows={2}
                      value={taskDraft.note}
                      onChange={(event) => updateTaskDraft(task.id, { note: event.target.value })}
                      placeholder="Capture blocker, handoff, or completion context."
                    />
                  </label>
                </div>
                <div className="projects-task-card__actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={saving}
                    onClick={() =>
                      void onTaskUpdate(task.id, {
                        owner_user_id: taskDraft.ownerUserId || null,
                        due_date: taskDraft.dueDate || null,
                        latest_note: taskDraft.note || null
                      })
                    }
                  >
                    Save Details
                  </button>
                  {taskDraft.ownerUserId && taskDraft.ownerUserId !== task.owner_user_id ? (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={saving}
                      onClick={() =>
                        void onTaskUpdate(task.id, {
                          handoff_to_user_id: taskDraft.ownerUserId,
                          handoff_note: taskDraft.note || null,
                          latest_note: taskDraft.note || null,
                          due_date: taskDraft.dueDate || null
                        })
                      }
                    >
                      Handoff
                    </button>
                  ) : null}
                  {taskDraft.ownerUserId !== currentUserId ? (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={saving}
                      onClick={() =>
                        void onTaskUpdate(task.id, {
                          owner_user_id: currentUserId,
                          due_date: taskDraft.dueDate || null,
                          latest_note: taskDraft.note || null
                        })
                      }
                    >
                      Assign To {firstName}
                    </button>
                  ) : null}
                  {task.status !== "in_progress" ? (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={saving}
                      onClick={() =>
                        void onTaskUpdate(task.id, {
                          status: "in_progress",
                          owner_user_id: taskDraft.ownerUserId || null,
                          due_date: taskDraft.dueDate || null,
                          latest_note: taskDraft.note || null
                        })
                      }
                    >
                      Working
                    </button>
                  ) : null}
                  {task.status !== "done" ? (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={saving}
                      onClick={() =>
                        void onTaskUpdate(task.id, {
                          status: "done",
                          owner_user_id: taskDraft.ownerUserId || null,
                          due_date: taskDraft.dueDate || null,
                          latest_note: taskDraft.note || null
                        })
                      }
                    >
                      Done
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={saving}
                      onClick={() =>
                        void onTaskUpdate(task.id, {
                          status: "todo",
                          owner_user_id: taskDraft.ownerUserId || null,
                          due_date: taskDraft.dueDate || null,
                          latest_note: taskDraft.note || null
                        })
                      }
                    >
                      Reopen
                    </button>
                  )}
                  {task.status !== "blocked" ? (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={saving}
                      onClick={() =>
                        void onTaskUpdate(task.id, {
                          status: "blocked",
                          owner_user_id: taskDraft.ownerUserId || null,
                          due_date: taskDraft.dueDate || null,
                          latest_note: taskDraft.note || null
                        })
                      }
                    >
                      Blocked
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection
        title={`Task Handoffs (${task_handoffs.length})`}
        summary="Explicit handoffs keep the next owner and transition note visible instead of hiding responsibility in comments."
      >
        {task_handoffs.length ? (
          <div className="projects-event-list">
            {task_handoffs.map((handoff) => (
              <article key={handoff.id} className="projects-event-card">
                <strong>{handoff.task_title}</strong>
                <p>
                  {handoff.from_user_label ?? "Unassigned"} {"->"} {handoff.to_user_label ?? "Unassigned"}
                </p>
                <div className="muted">
                  {handoff.created_by_label ?? "Mission Control"} | {formatTimestamp(handoff.created_at)}
                </div>
                {handoff.note ? <p>{handoff.note}</p> : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state empty-state--panel">No task handoffs recorded yet.</div>
        )}
      </OperationalDetailSection>

      <OperationalDetailSection
        title="Graphics Source And Linked Shoot"
        summary="Keep the graphics tracker tied to the real shoot, deliverable, and business context."
      >
        <div className="projects-context-list">
          <div><strong>Created Reason:</strong> {toGraphicsLabel(project.created_reason)}</div>
          <div><strong>Intake Source:</strong> {toGraphicsLabel(project.source_trigger_label ?? "Manual item")}</div>
          <div><strong>Organization:</strong> {project.linked_organization_name ?? "None linked"}</div>
          <div><strong>Location:</strong> {project.linked_location_name ?? "None linked"}</div>
          <div><strong>Shoot:</strong> {project.linked_shoot_code ?? project.linked_shoot_title ?? "None linked"}</div>
        </div>
        {project.linked_organization_id || project.linked_shoot_id ? (
          <div className="page-intro-actions page-intro-actions--compact">
            {project.linked_organization_id && onOpenLinkedOrganization ? (
              <button type="button" className="secondary-button" onClick={() => onOpenLinkedOrganization(project.linked_organization_id!)}>
                Open Account
              </button>
            ) : null}
            {project.linked_shoot_id && onOpenLinkedShoot ? (
              <button type="button" className="secondary-button" onClick={() => onOpenLinkedShoot(project.linked_shoot_id!)}>
                Open Shoot
              </button>
            ) : null}
          </div>
        ) : null}
      </OperationalDetailSection>

      <OperationalDetailSection
        title={`Task Activity (${task_events.length})`}
        summary="Task event history preserves deadline changes, ownership changes, handoffs, and completion context."
      >
        {task_events.length ? (
          <div className="projects-event-list">
            {task_events.map((event) => (
              <article key={event.id} className="projects-event-card">
                <strong>{event.task_title}</strong>
                <p>{event.summary}</p>
                <div className="muted">
                  {event.actor_name ?? "Mission Control"} | {formatTimestamp(event.created_at)}
                </div>
                {event.note ? <p>{event.note}</p> : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state empty-state--panel">No task event history yet.</div>
        )}
      </OperationalDetailSection>

      <OperationalDetailSection
        title={`Recent Events (${events.length})`}
        summary="Append-only event history for stage changes, assignments, blockers, and release activity."
      >
        <div className="projects-event-list">
          {events.map((event) => (
            <article key={event.id} className="projects-event-card">
              <strong>{event.summary}</strong>
              {event.note ? <p>{event.note}</p> : null}
              <div className="muted">
                {event.actor_name ?? "Mission Control"} | {formatTimestamp(event.created_at)}
              </div>
            </article>
          ))}
        </div>
      </OperationalDetailSection>
    </aside>
  );
}

function buildStepGuidance(
  project: ProductionProjectDetail["project"],
  workflowSummary: ProductionProjectDetail["workflow_summary"],
  currentUserId: string,
  workspaceView: ProductionProjectWorkspaceView
) {
  const view = workspaceView === "lead_board" ? "lead_board" : "staff_workspace";
  const links = [
    { label: "Workflow Rules", hash: buildProductionProjectsHash({ queue: "team_queue", view }) },
    { label: "Peer Review SOP", hash: buildProductionProjectsHash({ queue: "qa_queue", stage: "ready_for_qa", view }) },
    { label: "Release Standards", hash: buildProductionProjectsHash({ queue: "ready_to_release_queue", stage: "ready_to_release", view }) }
  ];

  let title = toGraphicsLabel(project.current_step_label || project.stage_label);
  let summary = "Keep the next action tied to the task ladder, review gates, and release rules instead of moving the job by feel.";
  let bullets = [
    "Keep the real owner, due date, and short handoff note current on the task that actually moved.",
    "Use blockers and correction reasons to explain why the work stopped instead of hiding it in side messages.",
    "Do not skip QA, final QC, or release gates just to clear the queue."
  ];

  switch (project.stage) {
    case "intake_pending":
    case "ready_for_production":
      title = toGraphicsLabel(project.current_step_label) || "Kickoff before active work";
      summary = "This job is still in kickoff territory. Graphics should not force it into active work until intake context and ownership are clear.";
      bullets = [
        "Confirm the linked shoot, account, source, and note context before graphics starts touching files.",
        "Assign the real graphics owner and due date before the job moves into active work.",
        "Do not move this job into active graphics work until intake is clear."
      ];
      break;
    case "in_production":
      title = toGraphicsLabel(project.current_step_label) || "Active graphics work";
      summary = "Graphics work should advance through the task ladder, not through ad hoc status edits.";
      bullets = [
        "Work the top unfinished task first and keep the next handoff explicit.",
        "Capture blockers or missing inputs in the task note the next person will actually read.",
        "Use handoffs when work changes owners instead of silently swapping names."
      ];
      break;
    case "ready_for_qa":
      title = toGraphicsLabel(project.current_step_label) || "Peer review handoff";
      summary = "Peer review checks completeness and obvious misses before final QC can safely begin.";
      bullets = [
        "Send to peer review only after graphics work is actually complete for this step.",
        "Return corrections with a real reason and the right owner, not a vague note.",
        "Do not jump straight to release from peer review."
      ];
      break;
    case "in_qa_review":
      title = toGraphicsLabel(project.current_step_label) || "Final QC review";
      summary = "Final QC is the last quality gate before release. It should verify correction history, gate clearance, and send safety together.";
      bullets = [
        "Check correction history, release blockers, and task completion together before clearing QC.",
        "If the job is not safe to send, return it cleanly instead of forcing it forward.",
        "Final QC should never be treated like a lightweight visual glance."
      ];
      break;
    case "blocked":
    case "correction_needed":
      title = toGraphicsLabel(project.current_step_label) || "Correction and blocker cleanup";
      summary = "Blocked or returned work needs a clear reason, a real owner, and an honest path back into QA.";
      bullets = [
        "Make the blocker or correction reason specific enough that the next owner knows what to fix.",
        "Return the work to the right owner before it leaves review.",
        "Clear the blocker note and update the task ladder before sending the job back to QA."
      ];
      break;
    case "ready_to_release":
      title = toGraphicsLabel(project.current_step_label) || "Controlled release";
      summary = workflowSummary.release_blocked
        ? "Release is still blocked. Clear the remaining gates and blockers before the send step."
        : "This job is in the final controlled release lane. Keep release standards stricter than normal workflow movement.";
      bullets = [
        "Release only when required tasks, peer review, and final QC are actually clear.",
        "Wait-to-send is a controlled final action, not a parking lot for unfinished work.",
        "Approval banners and release blockers must be cleared before the job is sent."
      ];
      break;
    case "released_complete":
      title = project.current_step_label || "Released and closed";
      summary = "Released work should close with clean history, not a loose trail of notes and reopened tasks.";
      bullets = [
        "Confirm the send step is truly done before closing the job.",
        "If work reopens, reopen the task that changed instead of inventing shadow follow-up.",
        "Keep completion notes short and factual so reporting stays trustworthy."
      ];
      break;
    default:
      break;
  }

  let roleTitle = workspaceView === "lead_board" ? "Manager follow-up" : "Operator focus";
  let roleSummary =
    workspaceView === "lead_board"
      ? "Use this detail view to clear blockers, assign the right owner, and confirm the current step is still honest."
      : "Move the job through the task ladder with explicit ownership, notes, and gate discipline.";

  if (project.pending_final_qc || project.final_qc_reviewer_user_id === currentUserId) {
    roleTitle = "Final QC focus";
    roleSummary = "Check correction history, release blockers, and send readiness together before clearing the final gate.";
  } else if (project.pending_peer_review || project.peer_reviewer_user_id === currentUserId) {
    roleTitle = "Peer review focus";
    roleSummary = "Peer review should catch completeness and obvious misses before the job enters final QC.";
  } else if (project.owner_user_id === currentUserId) {
    roleTitle = "Owner focus";
    roleSummary = "Keep your task ownership honest, move only the work you can clear, and use handoffs instead of silent reassignment.";
  }

  return { title, summary, bullets, roleTitle, roleSummary, links };
}

function formatPhotographerCount(count: number | null) {
  if (count == null || count <= 0) {
    return null;
  }
  return `${count} photographer${count === 1 ? "" : "s"}`;
}

function humanizeValue(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}
