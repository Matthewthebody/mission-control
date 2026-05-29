import type { KeyboardEvent, MouseEvent } from "react";
import { toGraphicsLabel } from "./graphicsNaming";
import type {
  ProductionLeadBoardFocus,
  ProductionLeadBoardSort,
  ProductionProjectIntakeSummary,
  ProductionProjectReferenceUserOption,
  ProductionProjectStage,
  ProductionProjectSummaryRecord,
  ProductionProjectTemplateRecord
} from "../../types";

type Props = {
  projects: ProductionProjectSummaryRecord[];
  allUnfinishedCount: number;
  summaryLine: string;
  intake: ProductionProjectIntakeSummary | null;
  selectedProjectId: string | null;
  currentUserId: string;
  ownerOptions: ProductionProjectReferenceUserOption[];
  templateOptions: ProductionProjectTemplateRecord[];
  ownerFilter: string | null;
  stepFilter: ProductionProjectStage | "all";
  sourceFilter: "manual" | "trigger" | "all";
  workflowFilter: string | null;
  sortBy: ProductionLeadBoardSort;
  focusFilter: ProductionLeadBoardFocus;
  onOpenProject: (projectId: string) => void;
  onAssignToMe: (project: ProductionProjectSummaryRecord) => void;
  onFollowUpToday: (project: ProductionProjectSummaryRecord) => void;
  onUpdateFilters: (next: {
    owner_user_id?: string | null;
    stage?: ProductionProjectStage | "all";
    source_type?: "manual" | "trigger" | "all";
    template_id?: string | null;
    lead_board_sort?: ProductionLeadBoardSort;
    lead_board_focus?: ProductionLeadBoardFocus;
  }) => void;
  onResetFilters: () => void;
};

const SORT_OPTIONS: Array<{ value: ProductionLeadBoardSort; label: string }> = [
  { value: "overdue_severity", label: "Overdue severity" },
  { value: "due_date", label: "Due date" },
  { value: "priority", label: "Priority" },
  { value: "last_touched", label: "Last touched" },
  { value: "owner", label: "Owner" },
  { value: "current_step", label: "Current step" }
];

export function ProductionLeadBoard({
  projects,
  allUnfinishedCount,
  summaryLine,
  intake,
  selectedProjectId,
  currentUserId,
  ownerOptions,
  templateOptions,
  ownerFilter,
  stepFilter,
  sourceFilter,
  workflowFilter,
  sortBy,
  focusFilter,
  onOpenProject,
  onAssignToMe,
  onFollowUpToday,
  onUpdateFilters,
  onResetFilters
}: Props) {
  const intakeIssueCount = intake
    ? intake.counts.duplicates + intake.counts.conflicts + intake.counts.sync_failures + intake.counts.stale_syncs
    : 0;
  const intakeSignals = intake
    ? [
        { label: "Sources checked", value: intake.counts.sources_considered },
        { label: "Jobs created", value: intake.counts.created },
        { label: "Source links updated", value: intake.counts.linked },
        { label: "Feed issues", value: intakeIssueCount },
        { label: "Sync failures", value: intake.counts.sync_failures },
        { label: "Stale syncs", value: intake.counts.stale_syncs }
      ]
    : [];

  return (
    <section className="panel production-lead-board">
      <div className="production-lead-board__header">
        <div>
          <div className="eyebrow">Graphics Lead Board</div>
          <h3>All Unfinished Graphics Work ({projects.length})</h3>
          <p>{summaryLine}</p>
        </div>
        <div className="production-lead-board__controls">
          <label className="filter-field production-lead-board__sort">
            <span>Sort</span>
            <select
              value={sortBy}
              onChange={(event) =>
                onUpdateFilters({
                  lead_board_sort: event.target.value as ProductionLeadBoardSort
                })
              }
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {intake ? (
        <section
          className={`production-lead-board__intake${intakeIssueCount > 0 ? " production-lead-board__intake--attention" : ""}`}
          aria-label="Graphics intake funnel"
        >
          <div className="production-lead-board__intake-summary">
            <div className="eyebrow">Graphics Intake Funnel</div>
            <h4>{intakeIssueCount > 0 ? `${intakeIssueCount} upstream intake issue${intakeIssueCount === 1 ? "" : "s"}` : "Canonical intake path healthy"}</h4>
            <p>{intake.summary_line}</p>
            <span className="production-lead-board__intake-updated">Last refreshed {formatTimestamp(intake.generated_at)}</span>
          </div>
          <div className="production-lead-board__intake-signals" role="list" aria-label="Graphics intake status">
            {intakeSignals.map((signal) => (
              <div key={signal.label} className="production-lead-board__intake-signal" role="listitem">
                <span>{signal.label}</span>
                <strong>{signal.value}</strong>
              </div>
            ))}
          </div>
          {intake.issues.length ? (
            <div className="production-lead-board__intake-issues">
              {intake.issues.slice(0, 4).map((issue) => (
                <button
                  key={issue.id}
                  type="button"
                  className="production-lead-board__intake-issue"
                  onClick={() => {
                    window.location.hash = issue.action_hash;
                  }}
                >
                  <span className={`production-lead-board__intake-issue-tone is-${issue.tone}`}>{issue.tone_label}</span>
                  <strong>{issue.title}</strong>
                  <span>{issue.summary}</span>
                  <span className="production-lead-board__intake-issue-meta">
                    {[issue.issue_kind_label, issue.source_system_label, issue.context_label].filter(Boolean).join(" | ")}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="production-lead-board__filters">
        <label className="filter-field filter-field--compact">
          <span>Lead Board Owner</span>
          <select
            aria-label="Lead Board Owner"
            value={ownerFilter ?? ""}
            onChange={(event) =>
              onUpdateFilters({
                owner_user_id: event.target.value ? (event.target.value as string | "unassigned") : null
              })
            }
          >
            <option value="">All owners</option>
            <option value="unassigned">Unassigned</option>
            {ownerOptions.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.label}
              </option>
            ))}
          </select>
        </label>

        <label className="filter-field filter-field--compact">
          <span>Lead Board Step</span>
          <select
            aria-label="Lead Board Step"
            value={stepFilter}
            onChange={(event) =>
              onUpdateFilters({
                stage: event.target.value as ProductionProjectStage | "all"
              })
            }
          >
            <option value="all">All steps</option>
            {buildStageOptions(projects).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="filter-field filter-field--compact">
          <span>Lead Board Source</span>
          <select
            aria-label="Lead Board Source"
            value={sourceFilter}
            onChange={(event) =>
              onUpdateFilters({
                source_type: event.target.value as "manual" | "trigger" | "all"
              })
            }
          >
            <option value="all">All sources</option>
            <option value="trigger">Triggered intake</option>
            <option value="manual">Manual exceptions</option>
          </select>
        </label>

        <label className="filter-field filter-field--compact">
          <span>Season / Workflow</span>
          <select
            aria-label="Season / Workflow"
            value={workflowFilter ?? ""}
            onChange={(event) =>
              onUpdateFilters({
                template_id: event.target.value || null
              })
            }
          >
            <option value="">All workflow templates</option>
            {templateOptions.map((template) => (
              <option key={template.id} value={template.id}>
                {formatWorkflowFilterLabel(template)}
              </option>
            ))}
          </select>
        </label>

        <button type="button" className="secondary-button" onClick={onResetFilters}>
          Clear Board Filters
        </button>
      </div>

      <div className="production-lead-board__focus" role="toolbar" aria-label="Lead board focus filters">
        {(
          [
            ["all", "All"],
            ["blocked", "Blocked"],
            ["overdue", "Overdue"],
            ["waiting", "Waiting"]
          ] as Array<[ProductionLeadBoardFocus, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`production-lead-board__focus-chip${focusFilter === value ? " is-active" : ""}`}
            onClick={() =>
              onUpdateFilters({
                lead_board_focus: value
              })
            }
          >
            {label}
          </button>
        ))}
      </div>

      {projects.length ? (
        <div className="production-lead-board__table" role="table" aria-label="All unfinished graphics workflow items">
          <div className="production-lead-board__table-header" role="row">
            <span>Job</span>
            <span>Current Step</span>
            <span>Due</span>
            <span>Owner / Review</span>
            <span>Signals</span>
            <span>Actions</span>
          </div>
          {projects.map((project) => {
            const accountLabel = project.linked_organization_name ?? project.linked_location_name ?? "No linked account";
            const typeLabel = toGraphicsLabel(project.linked_shoot_type_label ?? project.job_type_label);
            const shootLabel = project.linked_shoot_title ?? null;
            const sourceLabel = toGraphicsLabel(project.source_trigger_label ?? project.template_name ?? "Manual intake");
            const latestNotePreview = project.latest_note ? summarizeNote(project.latest_note) : null;
            const reviewLabel = project.pending_final_qc
              ? project.final_qc_reviewer_label ?? "Final QC unassigned"
              : project.pending_peer_review
                ? project.peer_reviewer_label ?? "Peer reviewer unassigned"
                : project.peer_reviewer_label ?? project.final_qc_reviewer_label ?? "No review gate active";
            const reviewSubLabel = project.pending_final_qc
              ? "Final QC"
              : project.pending_peer_review
                ? "Peer review"
                : null;
            const signalChips = buildSignalChips(project);

            return (
              <div
                key={project.id}
                role="row"
                className={`production-lead-row${selectedProjectId === project.id ? " production-lead-row--selected" : ""}`}
                tabIndex={0}
                aria-label={`Open ${project.title}`}
                onClick={() => onOpenProject(project.id)}
                onKeyDown={(event) => handleRowKeyDown(event, project.id, onOpenProject)}
              >
                <div className="production-lead-row__job">
                  <strong>{project.title}</strong>
                  {shootLabel ? <span className="production-lead-row__context">{shootLabel}</span> : null}
                  <span>{`${accountLabel} | ${typeLabel}`}</span>
                  <span className="production-lead-row__meta">
                    {[
                      project.linked_shoot_date_label ? `Shoot ${project.linked_shoot_date_label}` : null,
                      project.linked_shoot_code ?? null,
                      formatPhotographerCount(project.shoot_photographer_count),
                      sourceLabel
                    ]
                      .filter(Boolean)
                      .join(" | ")}
                  </span>
                  {latestNotePreview ? (
                    <span className="production-lead-row__note" title={project.latest_note ?? undefined}>
                      Comment: {latestNotePreview}
                    </span>
                  ) : null}
                </div>
                <div className="production-lead-row__cell">
                  <strong>{toGraphicsLabel(project.current_step_label)}</strong>
                  <span>{[toGraphicsLabel(project.current_step_task_type_label), toGraphicsLabel(project.production_touch_label)].filter(Boolean).join(" | ") || project.next_action}</span>
                </div>
                <div className="production-lead-row__cell">
                  <strong>{project.follow_up_label ?? project.due_label ?? "No due date"}</strong>
                  <span>{project.last_touched_label}</span>
                </div>
                <div className="production-lead-row__cell">
                  <strong>{project.owner_label}</strong>
                  <span>{reviewSubLabel ? `${reviewSubLabel}: ${reviewLabel}` : reviewLabel}</span>
                </div>
                <div className="production-lead-row__signals">
                  {signalChips.length ? (
                    signalChips.map((chip) => (
                      <span key={`${project.id}-${chip.label}`} className={`production-lead-row__chip production-lead-row__chip--${chip.tone}`}>
                        {chip.label}
                      </span>
                    ))
                  ) : (
                    <span className="production-lead-row__chip production-lead-row__chip--quiet">Healthy</span>
                  )}
                </div>
                <div className="production-lead-row__actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={(event) => handleActionClick(event, () => onOpenProject(project.id))}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={(event) => handleActionClick(event, () => onFollowUpToday(project))}
                  >
                    Follow Up
                  </button>
                  {project.owner_user_id !== currentUserId ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={(event) => handleActionClick(event, () => onAssignToMe(project))}
                    >
                      Assign To Me
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state empty-state--panel">
          {allUnfinishedCount > 0
            ? "No unfinished graphics workflow items match the current lead-board focus."
            : "No unfinished graphics workflow items match the current filters."}
        </div>
      )}
    </section>
  );
}

function humanizePriority(priority: ProductionProjectSummaryRecord["priority"]) {
  switch (priority) {
    case "critical":
      return "Critical priority";
    case "high":
      return "High priority";
    case "normal":
      return "Normal priority";
    default:
      return "Low priority";
  }
}

function buildStageOptions(projects: ProductionProjectSummaryRecord[]) {
  const uniqueStages = new Map<string, string>();
  for (const project of projects) {
    uniqueStages.set(project.stage, project.stage_label);
  }
  return [...uniqueStages.entries()]
    .map(([value, label]) => ({ value: value as ProductionProjectStage, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function formatWorkflowFilterLabel(template: ProductionProjectTemplateRecord) {
  const parts = [template.workflow_family_label];
  if (template.season_key !== "all_year") {
    parts.push(template.season_label);
  }
  parts.push(template.workflow_mode_label);
  return `${parts.join(" | ")} (${template.name})`;
}

function buildSignalChips(project: ProductionProjectSummaryRecord) {
  const chips: Array<{ label: string; tone: "critical" | "warning" | "info" | "quiet" }> = [
    {
      label: humanizePriority(project.priority),
      tone: project.priority === "critical" || project.priority === "high" ? "warning" : "quiet"
    }
  ];

  if (project.current_blocker) {
    chips.push({ label: `Blocked: ${project.current_blocker.blocker_type_label}`, tone: "critical" });
  } else if (project.blocker_count > 0) {
    chips.push({ label: "Blocked", tone: "critical" });
  }
  if (project.corrections_needed) {
    chips.push({ label: "Corrections needed", tone: "critical" });
  }
  if (project.ready_to_send) {
    chips.push({ label: "Ready to send", tone: "info" });
  } else if (project.waiting_to_send) {
    chips.push({ label: "Wait to send", tone: "warning" });
  }
  if (project.stale_active && project.stale_label) {
    chips.push({ label: project.stale_label, tone: "warning" });
  }
  const buddyWorkflowStatus = project.buddy_workflow_status;
  const hasBuddyWorkflow = buddyWorkflowStatus !== null;
  if (buddyWorkflowStatus && !["done", "skipped"].includes(buddyWorkflowStatus)) {
    chips.push({
      label: `Buddy ${humanizeTaskStatus(buddyWorkflowStatus)}`,
      tone: buddyWorkflowStatus === "blocked" ? "critical" : "warning"
    });
  }
  if (hasBuddyWorkflow && (project.buddy_unresolved_group_count ?? 0) > 0) {
    chips.push({ label: "Buddy groups unresolved", tone: "critical" });
  }
  if (hasBuddyWorkflow && project.buddy_duplicate_required) {
    chips.push({ label: "Buddy duplicate handling", tone: "warning" });
  }
  const virtualTeamWorkflowStatus = project.vt_workflow_status;
  const hasVirtualTeamWorkflow = virtualTeamWorkflowStatus !== null;
  if (virtualTeamWorkflowStatus && !["done", "skipped"].includes(virtualTeamWorkflowStatus)) {
    chips.push({
      label: `VT ${humanizeTaskStatus(virtualTeamWorkflowStatus)}`,
      tone: virtualTeamWorkflowStatus === "blocked" ? "critical" : "warning"
    });
  }
  if (hasVirtualTeamWorkflow && project.vt_ambiguous_match_required) {
    chips.push({ label: "VT ambiguous match", tone: "warning" });
  }
  if (
    hasVirtualTeamWorkflow &&
    (!project.vt_attributes_validated || !project.vt_coach_tags_validated || !project.vt_split_by_group_validated)
  ) {
    chips.push({ label: "VT validation pending", tone: "warning" });
  }

  return chips.slice(0, 5);
}

function humanizeTaskStatus(status: ProductionProjectSummaryRecord["buddy_workflow_status"]) {
  switch (status) {
    case "todo":
      return "not started";
    case "in_progress":
      return "in progress";
    case "blocked":
      return "blocked";
    case "done":
      return "complete";
    case "skipped":
      return "skipped";
    default:
      return "status";
  }
}

function formatPhotographerCount(count: number | null) {
  if (count == null || count <= 0) {
    return null;
  }
  return `${count} photographer${count === 1 ? "" : "s"}`;
}

function summarizeNote(note: string, maxLength = 72) {
  const normalized = note.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function handleRowKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  projectId: string,
  onOpenProject: (projectId: string) => void
) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  event.preventDefault();
  onOpenProject(projectId);
}

function handleActionClick(event: MouseEvent<HTMLButtonElement>, action: () => void) {
  event.stopPropagation();
  action();
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
