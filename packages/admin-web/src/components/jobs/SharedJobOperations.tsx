import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { OverlayPanel } from "../OverlayPanel";
import { ActivityTimelineList } from "./ActivityTimelineList";
import type { SharedJobOperationalCardDefinition } from "./DepartmentJobAdapterUIRegistry";
import { SharedStaffPicker } from "./SharedJobPickers";
import { StaffAssignmentCommunicationActions } from "./StaffAssignmentCommunicationActions";
import type {
  SharedJobDay,
  SharedJobDayNoteInput,
  SharedJobDayStatusUpdateInput,
  SharedJobDetailResponse,
  SharedJobListItem,
  SharedJobReadinessItem,
  SharedJobReadinessUpdateInput,
  SharedJobReadyConfirmationInput,
  SharedJobStaffAssignment,
  SharedJobStaffAssignmentCreateInput,
  SharedJobStaffAssignmentUpdateInput,
  SharedJobWatchFlag,
  SharedJobWatchFlagInput
} from "../../jobTruthTypes";
import { listSharedJobs } from "../../services/jobsApi";
import { getDepartmentJobAdapterUI } from "./DepartmentJobAdapterUIRegistry";
import { RiskBadge, StatusPill, formatDate, formatDateTime, formatTimeRange, humanizeToken, statusTone } from "../sports/SportsPrimitives";
import { WorkspaceActionBar } from "../workspace/WorkspaceActionBar";
import { WorkspaceEmptyState } from "../workspace/WorkspaceEmptyState";
import { WorkspaceLoadingBlock } from "../workspace/WorkspaceLoadingBlock";
import { WorkspaceSectionHeader } from "../workspace/WorkspaceSectionHeader";
import type { DirectoryOwnerOption, SessionUser } from "../../types";

type OperationalCopy = {
  readinessLabel: string;
  staffingLabel: string;
  dayOfLabel: string;
  readyActionLabel: string;
  issuesLabel: string;
};

type JobDaySwitcherProps = {
  days: SharedJobDay[];
  selectedDayId: string | null;
  onSelectDayId: (dayId: string | null) => void;
};

type JobReadinessBoardProps = {
  detail: SharedJobDetailResponse;
  selectedDayId: string | null;
  onSelectDayId: (dayId: string | null) => void;
  onUpdateItem: (itemId: string, input: SharedJobReadinessUpdateInput) => Promise<void>;
  readOnly: boolean;
  copy: OperationalCopy;
  adapterCards: SharedJobOperationalCardDefinition[];
};

type StaffingPlannerBoardProps = {
  token: string;
  detail: SharedJobDetailResponse;
  selectedDayId: string | null;
  onSelectDayId: (dayId: string | null) => void;
  currentUser: SessionUser;
  canManage: boolean;
  copy: OperationalCopy;
  adapterCards: SharedJobOperationalCardDefinition[];
  staffOptions: DirectoryOwnerOption[];
  onAssignStaff: (input: SharedJobStaffAssignmentCreateInput) => Promise<void>;
  onUpdateAssignment: (assignmentId: string, input: SharedJobStaffAssignmentUpdateInput) => Promise<void>;
  onCheckIn: (assignmentId: string) => Promise<void>;
};

type DayExecutionConsoleProps = {
  detail: SharedJobDetailResponse;
  selectedDayId: string | null;
  onSelectDayId: (dayId: string | null) => void;
  currentUser: SessionUser;
  canManage: boolean;
  copy: OperationalCopy;
  adapterCards: SharedJobOperationalCardDefinition[];
  onCheckIn: (assignmentId: string) => Promise<void>;
  onUpdateAssignment: (assignmentId: string, input: SharedJobStaffAssignmentUpdateInput) => Promise<void>;
  onConfirmReady: (dayId: string, input: SharedJobReadyConfirmationInput) => Promise<void>;
  onUpdateDayStatus: (dayId: string, input: SharedJobDayStatusUpdateInput) => Promise<void>;
  onAddDayNote: (dayId: string, input: SharedJobDayNoteInput) => Promise<void>;
  onCreateOrResolveIssue: (input: SharedJobWatchFlagInput) => Promise<void>;
};

type TodayOperationsBoardProps = {
  token: string;
  currentUser: SessionUser;
  departmentType: "schools" | "sports" | null;
  routeBase: string;
  title?: string;
  summary?: string;
};

type ReadinessSection = {
  key: string;
  label: string;
  items: SharedJobReadinessItem[];
};

type ReadyConfirmationDraft = {
  on_site_confirmed: boolean;
  setup_complete: boolean;
  all_required_staff_present: boolean;
  blockers_resolved: boolean;
  equipment_ready: boolean;
  client_contact_checked_in: boolean;
  note: string;
};

const ISSUE_TYPE_OPTIONS = [
  { value: "staffing_gap", label: "Staffing gap" },
  { value: "missing_contact", label: "Missing contact" },
  { value: "location_access", label: "Location / access issue" },
  { value: "equipment", label: "Equipment issue" },
  { value: "schedule", label: "Schedule issue" },
  { value: "weather", label: "Weather" },
  { value: "client", label: "Client issue" },
  { value: "data", label: "Data / roster issue" },
  { value: "production_risk", label: "Production risk" },
  { value: "other", label: "Other" }
];

const ISSUE_SEVERITY_OPTIONS: Array<{ value: SharedJobWatchFlag["severity"]; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" }
];

const STAFF_ROLE_OPTIONS = [
  { value: "lead_photographer", label: "Lead photographer" },
  { value: "photographer", label: "Photographer" },
  { value: "assistant", label: "Assistant" },
  { value: "runner", label: "Runner" },
  { value: "support", label: "Support" }
];

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isPastDue(value: string | null) {
  if (!value) {
    return false;
  }
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) {
    return false;
  }
  return due.getTime() < Date.now();
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function getSelectedDay(detail: SharedJobDetailResponse, selectedDayId: string | null) {
  return detail.days.find((day) => day.id === selectedDayId) ?? detail.days[0] ?? null;
}

function getScopedReadinessItems(detail: SharedJobDetailResponse, selectedDayId: string | null) {
  return detail.readiness_items.filter((item) => !selectedDayId || item.job_day_id == null || item.job_day_id === selectedDayId);
}

function getScopedAssignments(detail: SharedJobDetailResponse, selectedDayId: string | null) {
  return detail.staff_assignments.filter((assignment) => !selectedDayId || assignment.job_day_id == null || assignment.job_day_id === selectedDayId);
}

function getScopedWatchFlags(detail: SharedJobDetailResponse, selectedDayId: string | null) {
  return detail.watch_flags.filter((flag) => !selectedDayId || flag.job_day_id == null || flag.job_day_id === selectedDayId);
}

function groupReadinessItems(items: SharedJobReadinessItem[]) {
  const groups = new Map<string, SharedJobReadinessItem[]>();
  for (const item of items) {
    const current = groups.get(item.section_key) ?? [];
    groups.set(item.section_key, [...current, item]);
  }
  return [...groups.entries()]
    .map<ReadinessSection>(([key, sectionItems]) => ({
      key,
      label: humanizeToken(key),
      items: [...sectionItems].sort((left, right) => left.sort_order - right.sort_order || left.label.localeCompare(right.label))
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function buildReadinessMetrics(items: SharedJobReadinessItem[]) {
  const requiredItems = items.filter((item) => item.is_required);
  const completedRequired = requiredItems.filter((item) => item.is_complete).length;
  const blockers = items.filter((item) => item.is_blocker && !item.is_complete);
  const overdue = items.filter((item) => !item.is_complete && isPastDue(item.due_at));
  const completionPercent = requiredItems.length ? Math.round((completedRequired / requiredItems.length) * 100) : items.every((item) => item.is_complete) ? 100 : 0;
  return {
    blockers,
    overdue,
    completionPercent,
    requiredCount: requiredItems.length,
    completedRequired
  };
}

function describeTimeUntilExecution(day: SharedJobDay | null, detail: SharedJobDetailResponse) {
  const anchor = day?.date ?? detail.summary.primary_day_date ?? detail.job.scheduled_start_at?.slice(0, 10) ?? null;
  if (!anchor) {
    return "Execution date TBD";
  }
  const target = new Date(anchor);
  const now = new Date();
  const diffDays = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    return "Execution date passed";
  }
  if (diffDays === 0) {
    return "Execution is today";
  }
  if (diffDays === 1) {
    return "1 day until execution";
  }
  return `${diffDays} days until execution`;
}

function isAssignedUser(assignments: SharedJobStaffAssignment[], userId: string) {
  return assignments.some((assignment) => assignment.user_id === userId);
}

function isLeadUser(assignments: SharedJobStaffAssignment[], userId: string) {
  return assignments.some((assignment) => assignment.user_id === userId && assignment.is_lead);
}

function getCoverage(detail: SharedJobDetailResponse, selectedDayId: string | null) {
  const scopedAssignments = getScopedAssignments(detail, selectedDayId);
  const required = detail.job.estimated_staff_count ?? 0;
  const assigned = scopedAssignments.filter((assignment) => assignment.assignment_status !== "cancelled").length;
  const checkedIn = scopedAssignments.filter((assignment) => assignment.check_in_at && !assignment.check_out_at && assignment.assignment_status !== "absent").length;
  const readyPresent = scopedAssignments.filter((assignment) => assignment.is_ready_present).length;
  const leadAssigned = scopedAssignments.some((assignment) => assignment.is_lead);
  const absentCount = scopedAssignments.filter((assignment) => assignment.assignment_status === "absent").length;
  const openGapCount = Math.max(required - assigned, 0) + (leadAssigned ? 0 : 1) + absentCount;
  return {
    required,
    assigned,
    checkedIn,
    readyPresent,
    leadAssigned,
    absentCount,
    openGapCount
  };
}

function jobCardSubtitle(item: SharedJobListItem) {
  return [
    item.organization_name ?? "No organization",
    item.primary_location_name ?? "Location TBD",
    item.primary_day_date ? formatDate(item.primary_day_date) : "Date TBD"
  ].join(" | ");
}

export function JobDaySwitcher({ days, selectedDayId, onSelectDayId }: JobDaySwitcherProps) {
  if (days.length <= 1) {
    return null;
  }

  return (
    <div className="shared-job-ops__day-switcher" role="tablist" aria-label="Job day selector">
      {days.map((day) => (
        <button
          key={day.id}
          type="button"
          role="tab"
          aria-selected={selectedDayId === day.id}
          className={`secondary-button${selectedDayId === day.id ? " is-active" : ""}`}
          onClick={() => onSelectDayId(day.id)}
        >
          <span>{day.day_label || formatDate(day.date)}</span>
          <small>{formatTimeRange(day.start_time, day.end_time)}</small>
        </button>
      ))}
    </div>
  );
}

export function ReadinessProgressCard({
  completionPercent,
  readinessStatus,
  blockerCount,
  overdueCount,
  scopeLabel
}: {
  completionPercent: number;
  readinessStatus: string;
  blockerCount: number;
  overdueCount: number;
  scopeLabel: string;
}) {
  return (
    <section className="shared-job-ops__metric-card">
      <WorkspaceSectionHeader title="Readiness Progress" compact />
      <div className="shared-job-ops__metric-value">{completionPercent}%</div>
      <div className="shared-job-ops__metric-row">
        <StatusPill label={humanizeToken(readinessStatus)} tone={statusTone(readinessStatus)} />
        <span>{scopeLabel}</span>
      </div>
      <div className="shared-job-ops__metric-grid">
        <span>
          <strong>{blockerCount}</strong>
          <small>Blockers</small>
        </span>
        <span>
          <strong>{overdueCount}</strong>
          <small>Overdue</small>
        </span>
      </div>
    </section>
  );
}

export function ReadinessBlockerBanner({
  blockers,
  overdue,
  timeUntilExecution,
  onJumpToItem,
  canOverride
}: {
  blockers: SharedJobReadinessItem[];
  overdue: SharedJobReadinessItem[];
  timeUntilExecution: string;
  onJumpToItem: (itemId: string) => void;
  canOverride: boolean;
}) {
  if (!blockers.length && !overdue.length) {
    return null;
  }

  return (
    <section className="shared-job-ops__banner shared-job-ops__banner--warning" role="alert">
      <div className="shared-job-ops__banner-copy">
        <strong>{blockers.length} blocker{blockers.length === 1 ? "" : "s"} still open</strong>
        <span>{timeUntilExecution}</span>
        {overdue.length ? <span>{overdue.length} required item{overdue.length === 1 ? "" : "s"} overdue</span> : null}
      </div>
      <div className="shared-job-ops__banner-actions">
        {blockers.slice(0, 4).map((item) => (
          <button key={item.id} type="button" className="secondary-button" onClick={() => onJumpToItem(item.id)}>
            {item.label}
          </button>
        ))}
        {canOverride ? <span className="shared-job-ops__banner-note">Leadership override available if blockers must be bypassed.</span> : null}
      </div>
    </section>
  );
}

export function ReadinessSectionCard({
  section,
  notes,
  onNoteChange,
  onSaveNote,
  onToggleItem,
  readOnly
}: {
  section: ReadinessSection;
  notes: Record<string, string>;
  onNoteChange: (itemId: string, note: string) => void;
  onSaveNote: (itemId: string) => void;
  onToggleItem: (item: SharedJobReadinessItem) => void;
  readOnly: boolean;
}) {
  return (
    <section className="shared-job-ops__section-card" data-section={section.key}>
      <div className="shared-job-detail__list-card-header">
        <div>
          <h3>{section.label}</h3>
          <p className="shared-job-sidebar__muted">{section.items.filter((item) => item.is_complete).length} of {section.items.length} complete</p>
        </div>
      </div>
      <div className="shared-job-ops__readiness-items">
        {section.items.map((item) => {
          const noteDraft = notes[item.id] ?? item.notes ?? "";
          return (
            <article key={item.id} id={`readiness-item-${item.id}`} className={`shared-job-ops__readiness-item${item.is_blocker && !item.is_complete ? " is-attention" : ""}`}>
              <div className="shared-job-ops__readiness-main">
                <div className="shared-job-ops__readiness-header">
                  <strong>{item.label}</strong>
                  <div className="shared-job-ops__readiness-pills">
                    {item.is_required ? <StatusPill label="Required" tone="info" /> : null}
                    {item.is_blocker ? <StatusPill label="Blocker" tone={item.is_complete ? "success" : "warning"} /> : null}
                    <StatusPill label={item.is_complete ? "Complete" : "Open"} tone={item.is_complete ? "success" : "neutral"} />
                  </div>
                </div>
                <div className="shared-job-ops__readiness-meta">
                  <span>{item.description ?? "No additional detail yet."}</span>
                  <span>{item.due_at ? `Due ${formatDateTime(item.due_at)}` : "No due timing"}</span>
                  <span>{item.completed_by_name ? `Completed by ${item.completed_by_name}` : "Not completed yet"}</span>
                </div>
              </div>
              <div className="shared-job-ops__readiness-actions">
                {!readOnly ? (
                  <button type="button" className="secondary-button" onClick={() => onToggleItem(item)}>
                    {item.is_complete ? "Mark Incomplete" : "Mark Complete"}
                  </button>
                ) : null}
              </div>
              <div className="shared-job-ops__note-row">
                <label className="filter-field filter-field--wide">
                  <span>Readiness note</span>
                  <textarea
                    rows={2}
                    value={noteDraft}
                    onChange={(event) => onNoteChange(item.id, event.target.value)}
                    disabled={readOnly}
                  />
                </label>
                {!readOnly ? (
                  <WorkspaceActionBar align="end" compact>
                    <button type="button" className="secondary-button" onClick={() => onSaveNote(item.id)}>
                      Save Note
                    </button>
                  </WorkspaceActionBar>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function JobReadinessBoard({
  detail,
  selectedDayId,
  onSelectDayId,
  onUpdateItem,
  readOnly,
  copy,
  adapterCards
}: JobReadinessBoardProps) {
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const selectedDay = getSelectedDay(detail, selectedDayId);
  const scopedItems = getScopedReadinessItems(detail, selectedDay?.id ?? null);
  const sections = groupReadinessItems(scopedItems);
  const metrics = buildReadinessMetrics(scopedItems);
  const readinessCards = adapterCards.filter((card) => card.placement === "readiness");

  useEffect(() => {
    setItemNotes(Object.fromEntries(scopedItems.map((item) => [item.id, item.notes ?? ""])));
  }, [detail.readiness_items, scopedItems]);

  return (
    <div className="shared-job-ops shared-job-ops--readiness">
      <div className="shared-job-ops__header">
        <div>
          <h2>{copy.readinessLabel}</h2>
          <p className="shared-job-sidebar__muted">Shared readiness items grouped by section so Schools and Sports can tune content without forking the engine.</p>
        </div>
        <JobDaySwitcher days={detail.days} selectedDayId={selectedDay?.id ?? null} onSelectDayId={onSelectDayId} />
      </div>

      <ReadinessBlockerBanner
        blockers={metrics.blockers}
        overdue={metrics.overdue}
        timeUntilExecution={describeTimeUntilExecution(selectedDay, detail)}
        onJumpToItem={(itemId) => {
          document.getElementById(`readiness-item-${itemId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
        canOverride={!readOnly}
      />

      <div className="shared-job-ops__metric-grid shared-job-ops__metric-grid--readiness">
        <ReadinessProgressCard
          completionPercent={metrics.completionPercent}
          readinessStatus={detail.status.readiness_status}
          blockerCount={metrics.blockers.length}
          overdueCount={metrics.overdue.length}
          scopeLabel={selectedDay ? selectedDay.day_label || formatDate(selectedDay.date) : "Job-level scope"}
        />
        <section className="shared-job-ops__metric-card">
          <WorkspaceSectionHeader title="Execution Timing" compact />
          <div className="shared-job-ops__metric-value">{selectedDay ? formatDate(selectedDay.date) : "TBD"}</div>
          <div className="shared-job-ops__metric-row">
            <span>{describeTimeUntilExecution(selectedDay, detail)}</span>
            <StatusPill label={humanizeToken(detail.job.risk_status)} tone={statusTone(detail.job.risk_status)} />
          </div>
        </section>
        <section className="shared-job-ops__metric-card">
          <WorkspaceSectionHeader title="Completion State" compact />
          <div className="shared-job-ops__metric-value">{metrics.completedRequired}/{metrics.requiredCount || scopedItems.length || 0}</div>
          <div className="shared-job-ops__metric-row">
            <span>Required items complete</span>
            <StatusPill label={humanizeToken(detail.job.readiness_status)} tone={statusTone(detail.job.readiness_status)} />
          </div>
        </section>
        <section className="shared-job-ops__metric-card">
          <WorkspaceSectionHeader title="Quick Actions" compact />
          <div className="shared-job-ops__metric-list">
            <span>{metrics.blockers.length ? "Resolve blockers before execution" : "No blockers open"}</span>
            <span>{metrics.overdue.length ? "Overdue items need attention" : "No overdue items"}</span>
            <span>{selectedDay?.onsite_contact_name ?? detail.summary.primary_contact_name ?? "Primary contact missing"}</span>
          </div>
        </section>
      </div>

      <div className="shared-job-ops__content-grid">
        <div className="shared-job-ops__main">
          {sections.length ? (
            sections.map((section) => (
              <ReadinessSectionCard
                key={section.key}
                section={section}
                notes={itemNotes}
                onNoteChange={(itemId, note) => setItemNotes((current) => ({ ...current, [itemId]: note }))}
                onSaveNote={(itemId) => void onUpdateItem(itemId, { note: itemNotes[itemId] ?? "" })}
                onToggleItem={(item) => void onUpdateItem(item.id, { is_complete: !item.is_complete, note: itemNotes[item.id] ?? item.notes ?? "" })}
                readOnly={readOnly}
              />
            ))
          ) : (
            <WorkspaceEmptyState
              title="No readiness items"
              summary="Shared readiness items appear here when the job is published or when a department template seeds the checklist."
              compact
            />
          )}
        </div>
        <aside className="shared-job-ops__sidebar">
          {readinessCards.map((card) => (
            <section key={card.key} className="shared-job-shell__sidebar-card">
              <WorkspaceSectionHeader title={card.title} compact />
              <div className="shared-job-shell__sidebar-body">{card.body}</div>
            </section>
          ))}
        </aside>
      </div>
    </div>
  );
}

export function StaffCoverageMeter({
  required,
  assigned,
  checkedIn,
  readyPresent
}: {
  required: number;
  assigned: number;
  checkedIn: number;
  readyPresent: number;
}) {
  const denominator = Math.max(required, assigned, 1);
  return (
    <section className="shared-job-ops__metric-card">
      <WorkspaceSectionHeader title="Coverage Meter" compact />
      <div className="shared-job-ops__coverage-rail" aria-hidden="true">
        <span style={{ width: `${Math.min((assigned / denominator) * 100, 100)}%` }} />
        <span className="is-secondary" style={{ width: `${Math.min((checkedIn / denominator) * 100, 100)}%` }} />
        <span className="is-success" style={{ width: `${Math.min((readyPresent / denominator) * 100, 100)}%` }} />
      </div>
      <div className="shared-job-ops__metric-grid">
        <span><strong>{required}</strong><small>Target</small></span>
        <span><strong>{assigned}</strong><small>Assigned</small></span>
        <span><strong>{checkedIn}</strong><small>Checked in</small></span>
        <span><strong>{readyPresent}</strong><small>Ready present</small></span>
      </div>
    </section>
  );
}

export function CoverageGapBanner({
  coverage,
  canManage
}: {
  coverage: ReturnType<typeof getCoverage>;
  canManage: boolean;
}) {
  const reasons: string[] = [];
  if (!coverage.leadAssigned) {
    reasons.push("No lead assigned");
  }
  if (coverage.required > coverage.assigned) {
    reasons.push(`${coverage.required - coverage.assigned} staff still needed`);
  }
  if (coverage.absentCount) {
    reasons.push(`${coverage.absentCount} absent without replacement`);
  }
  if (coverage.checkedIn < Math.min(coverage.required, coverage.assigned)) {
    reasons.push("Checked-in count below target");
  }
  if (!reasons.length) {
    return null;
  }

  return (
    <section className="shared-job-ops__banner shared-job-ops__banner--danger" role="alert">
      <div className="shared-job-ops__banner-copy">
        <strong>Coverage gap detected</strong>
        <span>{reasons.join(" | ")}</span>
      </div>
      {canManage ? <span className="shared-job-ops__banner-note">Assign staff, request backup, or mark an override from the staffing panel.</span> : null}
    </section>
  );
}

export function StaffAssignmentPanel({
  token,
  currentUser,
  jobId,
  assignment,
  canManage,
  canSelfManage,
  onCheckIn,
  onUpdateAssignment
}: {
  token: string;
  currentUser: SessionUser;
  jobId: string;
  assignment: SharedJobStaffAssignment;
  canManage: boolean;
  canSelfManage: boolean;
  onCheckIn: () => void;
  onUpdateAssignment: (input: SharedJobStaffAssignmentUpdateInput) => void;
}) {
  return (
    <article className={`shared-job-ops__assignment-card${assignment.assignment_status === "absent" ? " is-attention" : ""}`}>
      <div className="shared-job-ops__assignment-main">
        <div className="shared-job-ops__assignment-header">
          <strong>{assignment.user_name ?? assignment.user_id}</strong>
          <div className="shared-job-ops__assignment-pills">
            {assignment.is_lead ? <StatusPill label="Lead" tone="info" /> : null}
            <StatusPill label={humanizeToken(assignment.assignment_role)} tone="neutral" />
            <StatusPill label={humanizeToken(assignment.assignment_status)} tone={statusTone(assignment.assignment_status)} />
          </div>
        </div>
        <div className="shared-job-ops__assignment-meta">
          <span>{assignment.job_day_id ? "Day-specific assignment" : "Whole-job coverage"}</span>
          <span>{assignment.check_in_at ? `Checked in ${formatDateTime(assignment.check_in_at)}` : "Not checked in"}</span>
          <span>{assignment.check_out_at ? `Checked out ${formatDateTime(assignment.check_out_at)}` : "Still active"}</span>
          <span>{assignment.notes ?? "No staffing note"}</span>
        </div>
        <StaffAssignmentCommunicationActions token={token} currentUser={currentUser} jobId={jobId} assignment={assignment} />
      </div>
      <WorkspaceActionBar align="end" compact>
        {!assignment.check_in_at && (canManage || canSelfManage) ? (
          <button type="button" className="secondary-button" onClick={onCheckIn}>
            Check In
          </button>
        ) : null}
        {assignment.check_in_at && !assignment.check_out_at && (canManage || canSelfManage) ? (
          <button type="button" className="secondary-button" onClick={() => onUpdateAssignment({ assignment_status: "checked_out" })}>
            Check Out
          </button>
        ) : null}
        {canManage ? (
          <>
            {!assignment.is_lead ? (
              <button type="button" className="secondary-button" onClick={() => onUpdateAssignment({ is_lead: true })}>
                Mark Lead
              </button>
            ) : null}
            {assignment.assignment_status !== "absent" ? (
              <button type="button" className="secondary-button" onClick={() => onUpdateAssignment({ assignment_status: "absent" })}>
                Mark Absent
              </button>
            ) : null}
            <button type="button" className="secondary-button" onClick={() => onUpdateAssignment({ request_backup: true, notes: assignment.notes ?? "Backup requested from the staffing planner." })}>
              Request Backup
            </button>
          </>
        ) : null}
      </WorkspaceActionBar>
    </article>
  );
}

export function StaffingPlannerBoard({
  token,
  detail,
  selectedDayId,
  onSelectDayId,
  currentUser,
  canManage,
  copy,
  adapterCards,
  staffOptions,
  onAssignStaff,
  onUpdateAssignment,
  onCheckIn
}: StaffingPlannerBoardProps) {
  const [draft, setDraft] = useState({
    user_id: "",
    assignment_role: "photographer",
    job_day_id: "",
    is_lead: false,
    notes: ""
  });
  const selectedDay = getSelectedDay(detail, selectedDayId);
  const assignments = uniqueById(getScopedAssignments(detail, selectedDay?.id ?? null));
  const coverage = getCoverage(detail, selectedDay?.id ?? null);
  const staffingCards = adapterCards.filter((card) => card.placement === "staffing");

  return (
    <div className="shared-job-ops shared-job-ops--staffing">
      <div className="shared-job-ops__header">
        <div>
          <h2>{copy.staffingLabel}</h2>
          <p className="shared-job-sidebar__muted">One staffing planner for assignment, gaps, presence, and lead coverage across every department.</p>
        </div>
        <JobDaySwitcher days={detail.days} selectedDayId={selectedDay?.id ?? null} onSelectDayId={onSelectDayId} />
      </div>

      <CoverageGapBanner coverage={coverage} canManage={canManage} />

      <div className="shared-job-ops__metric-grid">
        <section className="shared-job-ops__metric-card">
          <WorkspaceSectionHeader title="Staffing Status" compact />
          <div className="shared-job-ops__metric-value">{humanizeToken(detail.status.staffing_status)}</div>
          <div className="shared-job-ops__metric-row">
            <StatusPill label={humanizeToken(detail.status.staffing_status)} tone={statusTone(detail.status.staffing_status)} />
            <span>{selectedDay ? selectedDay.day_label || formatDate(selectedDay.date) : "Job-level scope"}</span>
          </div>
        </section>
        <StaffCoverageMeter required={coverage.required} assigned={coverage.assigned} checkedIn={coverage.checkedIn} readyPresent={coverage.readyPresent} />
        <section className="shared-job-ops__metric-card">
          <WorkspaceSectionHeader title="Coverage Summary" compact />
          <div className="shared-job-ops__metric-grid">
            <span><strong>{coverage.openGapCount}</strong><small>Open gaps</small></span>
            <span><strong>{coverage.leadAssigned ? 1 : 0}</strong><small>Lead assigned</small></span>
            <span><strong>{coverage.absentCount}</strong><small>Absent</small></span>
            <span><strong>{coverage.checkedIn}</strong><small>Present</small></span>
          </div>
        </section>
      </div>

      <div className="shared-job-ops__content-grid">
        <div className="shared-job-ops__main">
          {canManage ? (
            <section className="shared-job-ops__section-card">
              <WorkspaceSectionHeader title="Assign Staff" summary="Use the shared staff picker and keep job-level or day-level coverage in the same framework." />
              <div className="shared-job-form__grid">
                <SharedStaffPicker
                  label="Staff member"
                  value={draft.user_id}
                  onChange={(value) => setDraft((current) => ({ ...current, user_id: value }))}
                  options={staffOptions}
                  emptyLabel="Choose staff"
                />
                <label className="filter-field">
                  <span>Role on job</span>
                  <select value={draft.assignment_role} onChange={(event) => setDraft((current) => ({ ...current, assignment_role: event.target.value }))}>
                    {STAFF_ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="filter-field">
                  <span>Assignment scope</span>
                  <select value={draft.job_day_id} onChange={(event) => setDraft((current) => ({ ...current, job_day_id: event.target.value }))}>
                    <option value="">Whole job</option>
                    {detail.days.map((day) => (
                      <option key={day.id} value={day.id}>
                        {day.day_label || formatDate(day.date)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="shared-job-form__toggle">
                  <input type="checkbox" checked={draft.is_lead} onChange={(event) => setDraft((current) => ({ ...current, is_lead: event.target.checked }))} />
                  <span>Assign as lead</span>
                </label>
                <label className="filter-field filter-field--wide">
                  <span>Staffing note</span>
                  <textarea rows={2} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} />
                </label>
              </div>
              <WorkspaceActionBar align="end">
                <button
                  type="button"
                  onClick={() => {
                    if (!draft.user_id) {
                      return;
                    }
                    void onAssignStaff({
                      user_id: draft.user_id,
                      assignment_role: draft.assignment_role,
                      job_day_id: draft.job_day_id || null,
                      is_lead: draft.is_lead,
                      notes: draft.notes || null
                    }).then(() =>
                      setDraft({
                        user_id: "",
                        assignment_role: "photographer",
                        job_day_id: "",
                        is_lead: false,
                        notes: ""
                      })
                    );
                  }}
                >
                  Add Assignment
                </button>
              </WorkspaceActionBar>
            </section>
          ) : null}

          {assignments.length ? (
            <div className="shared-job-ops__assignment-list">
              {assignments.map((assignment) => (
                    <StaffAssignmentPanel
                      key={assignment.id}
                      token={token}
                      currentUser={currentUser}
                      jobId={detail.job.id}
                      assignment={assignment}
                      canManage={canManage}
                      canSelfManage={assignment.user_id === currentUser.id}
                  onCheckIn={() => void onCheckIn(assignment.id)}
                  onUpdateAssignment={(input) => void onUpdateAssignment(assignment.id, input)}
                />
              ))}
            </div>
          ) : (
            <WorkspaceEmptyState title="No staff assigned" summary="Add crew assignments here so readiness and day-of coverage stay connected to the shared status engine." compact />
          )}
        </div>
        <aside className="shared-job-ops__sidebar">
          {staffingCards.map((card) => (
            <section key={card.key} className="shared-job-shell__sidebar-card">
              <WorkspaceSectionHeader title={card.title} compact />
              <div className="shared-job-shell__sidebar-body">{card.body}</div>
            </section>
          ))}
        </aside>
      </div>
    </div>
  );
}

export function DayStatusCard({
  day,
  canManage,
  onUpdateStatus,
  onOpenReadyModal
}: {
  day: SharedJobDay;
  canManage: boolean;
  onUpdateStatus: (status: SharedJobDayStatusUpdateInput["day_status"]) => void;
  onOpenReadyModal: () => void;
}) {
  return (
    <section className="shared-job-ops__metric-card">
      <WorkspaceSectionHeader title="Day Status" compact />
      <div className="shared-job-ops__metric-value">{humanizeToken(day.day_status)}</div>
      <div className="shared-job-ops__metric-row">
        <StatusPill label={humanizeToken(day.day_status)} tone={statusTone(day.day_status)} />
        <span>{formatDate(day.date)}</span>
      </div>
      <WorkspaceActionBar align="start" compact>
        <button type="button" className="secondary-button" onClick={onOpenReadyModal}>
          Mark Ready
        </button>
        {canManage ? (
          <>
            <button type="button" className="secondary-button" onClick={() => onUpdateStatus("in_progress")}>
              In Progress
            </button>
            <button type="button" className="secondary-button" onClick={() => onUpdateStatus("complete")}>
              Complete
            </button>
            <button type="button" className="secondary-button" onClick={() => onUpdateStatus("postponed")}>
              Postpone
            </button>
            <button type="button" className="secondary-button" onClick={() => onUpdateStatus("cancelled")}>
              Cancel
            </button>
          </>
        ) : null}
      </WorkspaceActionBar>
    </section>
  );
}

export function CheckInRosterPanel({
  assignments,
  currentUser,
  canManage,
  onCheckIn,
  onUpdateAssignment
}: {
  assignments: SharedJobStaffAssignment[];
  currentUser: SessionUser;
  canManage: boolean;
  onCheckIn: (assignmentId: string) => void;
  onUpdateAssignment: (assignmentId: string, input: SharedJobStaffAssignmentUpdateInput) => void;
}) {
  if (!assignments.length) {
    return <WorkspaceEmptyState title="No roster yet" summary="Assignments will appear here once staffing is planned." compact />;
  }

  return (
    <section className="shared-job-ops__section-card">
      <WorkspaceSectionHeader title="Check-In Roster" summary="Day-of presence is tied directly to the shared staffing assignments." />
      <div className="shared-job-ops__roster-list">
        {assignments.map((assignment) => {
          const canSelfManage = assignment.user_id === currentUser.id;
          const state =
            assignment.assignment_status === "absent"
              ? "Absent"
              : assignment.check_in_at
                ? assignment.check_out_at
                  ? "Checked Out"
                  : "Checked In"
                : "Not Arrived";
          return (
            <article key={assignment.id} className="shared-job-ops__roster-row">
              <div className="shared-job-ops__roster-main">
                <strong>{assignment.user_name ?? assignment.user_id}</strong>
                <span>{humanizeToken(assignment.assignment_role)}</span>
                <span>{state}</span>
                <span>{assignment.notes ?? "No note"}</span>
              </div>
              <WorkspaceActionBar align="end" compact>
                {!assignment.check_in_at && (canManage || canSelfManage) ? (
                  <button type="button" className="secondary-button" onClick={() => onCheckIn(assignment.id)}>
                    Check In
                  </button>
                ) : null}
                {assignment.check_in_at && !assignment.check_out_at && (canManage || canSelfManage) ? (
                  <button type="button" className="secondary-button" onClick={() => onUpdateAssignment(assignment.id, { assignment_status: "checked_out" })}>
                    Check Out
                  </button>
                ) : null}
                {canManage && assignment.assignment_status !== "absent" ? (
                  <button type="button" className="secondary-button" onClick={() => onUpdateAssignment(assignment.id, { assignment_status: "absent" })}>
                    Mark Absent
                  </button>
                ) : null}
              </WorkspaceActionBar>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function ReadyConfirmationModal({
  open,
  copy,
  day,
  onClose,
  onSubmit
}: {
  open: boolean;
  copy: OperationalCopy;
  day: SharedJobDay | null;
  onClose: () => void;
  onSubmit: (input: SharedJobReadyConfirmationInput) => void;
}) {
  const [draft, setDraft] = useState<ReadyConfirmationDraft>({
    on_site_confirmed: true,
    setup_complete: true,
    all_required_staff_present: true,
    blockers_resolved: true,
    equipment_ready: true,
    client_contact_checked_in: true,
    note: ""
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    setDraft({
      on_site_confirmed: true,
      setup_complete: true,
      all_required_staff_present: true,
      blockers_resolved: true,
      equipment_ready: true,
      client_contact_checked_in: true,
      note: ""
    });
  }, [open]);

  return (
    <OverlayPanel open={open} ariaLabel={`${copy.readyActionLabel} confirmation`} onClose={onClose} contentClassName="shared-job-ops__modal-panel">
      <div className="panel shared-job-ops__modal-card">
        <WorkspaceSectionHeader
          title={copy.readyActionLabel}
          summary={day ? `${day.day_label || formatDate(day.date)} | ${formatTimeRange(day.start_time, day.end_time)}` : "Ready confirmation"}
        />
        <div className="shared-job-ops__toggle-list">
          {([
            ["on_site_confirmed", "On site confirmed"],
            ["setup_complete", "Setup complete"],
            ["all_required_staff_present", "All required staff present"],
            ["blockers_resolved", "Blockers resolved"],
            ["equipment_ready", "Equipment ready"],
            ["client_contact_checked_in", "Client contact checked in"]
          ] as const).map(([key, label]) => (
            <label key={key} className="shared-job-form__toggle">
              <input
                type="checkbox"
                checked={draft[key]}
                onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.checked }))}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <label className="filter-field filter-field--wide">
          <span>Ready note</span>
          <textarea rows={4} value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} />
        </label>
        <WorkspaceActionBar align="end">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onSubmit(draft);
              onClose();
            }}
          >
            Confirm Ready
          </button>
        </WorkspaceActionBar>
      </div>
    </OverlayPanel>
  );
}

export function ReadyConfirmationCard({
  day,
  currentUser,
  assignments,
  canManage,
  copy,
  onOpen
}: {
  day: SharedJobDay;
  currentUser: SessionUser;
  assignments: SharedJobStaffAssignment[];
  canManage: boolean;
  copy: OperationalCopy;
  onOpen: () => void;
}) {
  const today = getLocalDateString();
  const showAction = day.date === today && (canManage || isLeadUser(assignments, currentUser.id));
  return (
    <section className="shared-job-ops__metric-card">
      <WorkspaceSectionHeader title="Lead Ready" compact />
      <div className="shared-job-ops__metric-value">{day.ready_confirmed_at ? "Confirmed" : "Waiting"}</div>
      <div className="shared-job-ops__metric-row">
        <StatusPill label={day.ready_confirmed_at ? "Ready confirmed" : "Awaiting confirmation"} tone={day.ready_confirmed_at ? "success" : "warning"} />
        <span>{day.ready_confirmed_at ? formatDateTime(day.ready_confirmed_at) : "No confirmation yet"}</span>
      </div>
      {showAction ? (
        <WorkspaceActionBar align="start" compact>
          <button type="button" onClick={onOpen}>
            {copy.readyActionLabel}
          </button>
        </WorkspaceActionBar>
      ) : null}
    </section>
  );
}

export function ExecutionIssuesPanel({
  flags,
  canManage,
  issueLabel,
  selectedDayId,
  onCreateOrResolveIssue
}: {
  flags: SharedJobWatchFlag[];
  canManage: boolean;
  issueLabel: string;
  selectedDayId: string | null;
  onCreateOrResolveIssue: (input: SharedJobWatchFlagInput) => void;
}) {
  const [draft, setDraft] = useState({
    flag_type: "staffing_gap",
    severity: "medium" as SharedJobWatchFlag["severity"],
    title: "",
    description: ""
  });

  return (
    <section className="shared-job-ops__section-card">
      <WorkspaceSectionHeader title={issueLabel} summary="Real-time issues become shared exceptions and show up in the broader operations feed." />
      {canManage ? (
        <div className="shared-job-form__grid">
          <label className="filter-field">
            <span>Issue type</span>
            <select value={draft.flag_type} onChange={(event) => setDraft((current) => ({ ...current, flag_type: event.target.value }))}>
              {ISSUE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Severity</span>
            <select value={draft.severity} onChange={(event) => setDraft((current) => ({ ...current, severity: event.target.value as SharedJobWatchFlag["severity"] }))}>
              {ISSUE_SEVERITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field filter-field--wide">
            <span>Issue title</span>
            <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
          </label>
          <label className="filter-field filter-field--wide">
            <span>Issue note</span>
            <textarea rows={3} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
          </label>
        </div>
      ) : null}
      {canManage ? (
        <WorkspaceActionBar align="end">
          <button
            type="button"
            onClick={() => {
              if (!draft.title.trim()) {
                return;
              }
              onCreateOrResolveIssue({
                job_day_id: selectedDayId,
                flag_type: draft.flag_type,
                severity: draft.severity,
                title: draft.title.trim(),
                description: draft.description.trim() || draft.title.trim(),
                status: "open"
              });
              setDraft({ flag_type: "staffing_gap", severity: "medium", title: "", description: "" });
            }}
          >
            Log Issue
          </button>
        </WorkspaceActionBar>
      ) : null}
      {flags.length ? (
        <div className="shared-job-ops__issues-list">
          {flags.map((flag) => (
            <article key={flag.id} className={`shared-job-ops__issue-card shared-job-ops__issue-card--${flag.severity}`}>
              <div className="shared-job-ops__issue-main">
                <div className="shared-job-ops__assignment-header">
                  <strong>{flag.title}</strong>
                  <div className="shared-job-ops__assignment-pills">
                    <RiskBadge level={flag.severity} />
                    <StatusPill label={humanizeToken(flag.status)} tone={statusTone(flag.status)} />
                  </div>
                </div>
                <div className="shared-job-ops__assignment-meta">
                  <span>{flag.description}</span>
                  <span>{flag.owner_name ?? "Unassigned"}</span>
                  <span>{flag.due_at ? `Due ${formatDateTime(flag.due_at)}` : "No due time"}</span>
                </div>
              </div>
              {canManage && flag.status !== "resolved" ? (
                <WorkspaceActionBar align="end" compact>
                  <button type="button" className="secondary-button" onClick={() => onCreateOrResolveIssue({ id: flag.id, status: "resolved" })}>
                    Resolve
                  </button>
                  <button type="button" className="secondary-button" onClick={() => onCreateOrResolveIssue({ id: flag.id, status: "dismissed" })}>
                    Dismiss
                  </button>
                </WorkspaceActionBar>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <WorkspaceEmptyState title="No open issues" summary="Day-of problems, missing contacts, and escalations will appear here once they are logged." compact />
      )}
    </section>
  );
}

export function DayNotesComposer({
  onSubmit
}: {
  onSubmit: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <section className="shared-job-ops__section-card">
      <WorkspaceSectionHeader title="Day Notes" summary="Capture a short execution note without losing context in private messages." />
      <label className="filter-field filter-field--wide">
        <span>Execution note</span>
        <textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Arrival, setup, client, weather, or anything leadership should see later." />
      </label>
      <WorkspaceActionBar align="end">
        <button
          type="button"
          onClick={() => {
            if (!note.trim()) {
              return;
            }
            onSubmit(note.trim());
            setNote("");
          }}
        >
          Add Note
        </button>
      </WorkspaceActionBar>
    </section>
  );
}

export function ExecutionTimelineCard({
  activity,
  selectedDayId
}: {
  activity: SharedJobDetailResponse["activity"];
  selectedDayId: string | null;
}) {
  const items = activity.filter((entry) => !selectedDayId || entry.job_day_id == null || entry.job_day_id === selectedDayId);
  if (!items.length) {
    return <WorkspaceEmptyState title="No execution activity yet" summary="Day-level changes, staffing updates, and ready confirmations will appear here." compact />;
  }
  return (
    <section className="shared-job-ops__section-card">
      <WorkspaceSectionHeader title="Execution Timeline" summary="Every meaningful operational action stays visible in one audit-friendly stream." />
      <ActivityTimelineList entries={items} limit={12} />
    </section>
  );
}

export function DayExecutionConsole({
  detail,
  selectedDayId,
  onSelectDayId,
  currentUser,
  canManage,
  copy,
  adapterCards,
  onCheckIn,
  onUpdateAssignment,
  onConfirmReady,
  onUpdateDayStatus,
  onAddDayNote,
  onCreateOrResolveIssue
}: DayExecutionConsoleProps) {
  const [readyModalOpen, setReadyModalOpen] = useState(false);
  const selectedDay = getSelectedDay(detail, selectedDayId);
  const selectedAssignments = uniqueById(getScopedAssignments(detail, selectedDay?.id ?? null));
  const openFlags = getScopedWatchFlags(detail, selectedDay?.id ?? null).filter((flag) => flag.status === "open" || flag.status === "acknowledged");
  const openReadiness = getScopedReadinessItems(detail, selectedDay?.id ?? null).filter((item) => !item.is_complete && item.is_blocker);
  const coverage = getCoverage(detail, selectedDay?.id ?? null);
  const dayCards = adapterCards.filter((card) => card.placement === "day-of");

  if (!selectedDay) {
    return <WorkspaceEmptyState title="No job day yet" summary="Create a day before using the shared day-of execution console." compact />;
  }

  return (
    <div className="shared-job-ops shared-job-ops--day-of">
      <div className="shared-job-ops__header">
        <div>
          <h2>{copy.dayOfLabel}</h2>
          <p className="shared-job-sidebar__muted">One day-of console for check-in, lead confirmation, open gaps, and execution notes across departments.</p>
        </div>
        <JobDaySwitcher days={detail.days} selectedDayId={selectedDay.id} onSelectDayId={onSelectDayId} />
      </div>

      <div className="shared-job-ops__metric-grid">
        <DayStatusCard
          day={selectedDay}
          canManage={canManage}
          onOpenReadyModal={() => setReadyModalOpen(true)}
          onUpdateStatus={(dayStatus) => {
            const note =
              dayStatus === "postponed" || dayStatus === "cancelled"
                ? window.prompt(`Reason to mark this day ${humanizeToken(dayStatus).toLowerCase()}`, "") ?? ""
                : "";
            if ((dayStatus === "postponed" || dayStatus === "cancelled") && !note.trim()) {
              return;
            }
            void onUpdateDayStatus(selectedDay.id, { day_status: dayStatus, note: note.trim() || null });
          }}
        />
        <ReadyConfirmationCard
          day={selectedDay}
          currentUser={currentUser}
          assignments={selectedAssignments}
          canManage={canManage}
          copy={copy}
          onOpen={() => setReadyModalOpen(true)}
        />
        <section className="shared-job-ops__metric-card">
          <WorkspaceSectionHeader title="Check-In Summary" compact />
          <div className="shared-job-ops__metric-grid">
            <span><strong>{coverage.assigned}</strong><small>Assigned</small></span>
            <span><strong>{coverage.checkedIn}</strong><small>Checked in</small></span>
            <span><strong>{coverage.readyPresent}</strong><small>Ready present</small></span>
            <span><strong>{openFlags.length}</strong><small>Open issues</small></span>
          </div>
        </section>
        <section className="shared-job-ops__metric-card">
          <WorkspaceSectionHeader title="Open Blockers" compact />
          <div className="shared-job-ops__metric-list">
            {openReadiness.length ? openReadiness.slice(0, 4).map((item) => <span key={item.id}>{item.label}</span>) : <span>No blocker items still open.</span>}
          </div>
        </section>
      </div>

      <div className="shared-job-ops__day-layout">
        <div className="shared-job-ops__day-left">
          <CheckInRosterPanel
            assignments={selectedAssignments}
            currentUser={currentUser}
            canManage={canManage}
            onCheckIn={(assignmentId) => onCheckIn(assignmentId)}
            onUpdateAssignment={(assignmentId, input) => onUpdateAssignment(assignmentId, input)}
          />
        </div>
        <div className="shared-job-ops__day-center">
          <section className="shared-job-ops__section-card">
            <WorkspaceSectionHeader title="Open Readiness Blockers" summary="The day-of console keeps unresolved blockers visible until they are closed or explicitly overridden." />
            {openReadiness.length ? (
              <div className="shared-job-ops__metric-list">
                {openReadiness.map((item) => (
                  <span key={item.id}>{item.label}</span>
                ))}
              </div>
            ) : (
              <WorkspaceEmptyState title="No blocker items open" summary="Shared readiness blockers are fully resolved for this scope." compact />
            )}
          </section>
          <DayNotesComposer onSubmit={(note) => onAddDayNote(selectedDay.id, { note })} />
          <ExecutionTimelineCard activity={detail.activity} selectedDayId={selectedDay.id} />
        </div>
        <div className="shared-job-ops__day-right">
          <ExecutionIssuesPanel
            flags={openFlags}
            canManage={canManage || isAssignedUser(selectedAssignments, currentUser.id)}
            issueLabel={copy.issuesLabel}
            selectedDayId={selectedDay.id}
            onCreateOrResolveIssue={(input) => onCreateOrResolveIssue(input)}
          />
          {dayCards.map((card) => (
            <section key={card.key} className="shared-job-shell__sidebar-card">
              <WorkspaceSectionHeader title={card.title} compact />
              <div className="shared-job-shell__sidebar-body">{card.body}</div>
            </section>
          ))}
        </div>
      </div>

      <ReadyConfirmationModal
        open={readyModalOpen}
        copy={copy}
        day={selectedDay}
        onClose={() => setReadyModalOpen(false)}
        onSubmit={(input) => {
          void onConfirmReady(selectedDay.id, input);
        }}
      />
    </div>
  );
}

export function DepartmentReadinessSummaryCard({ jobs }: { jobs: SharedJobListItem[] }) {
  const atRisk = jobs.filter((job) => job.readiness_status === "at_risk" || job.readiness_status === "off_track").length;
  const avgProgress = jobs.length ? Math.round(jobs.reduce((total, job) => total + (job.readiness_percent ?? 0), 0) / jobs.length) : 0;
  return (
    <section className="panel shared-job-ops__summary-card">
      <WorkspaceSectionHeader title="Readiness Summary" compact />
      <div className="shared-job-ops__metric-grid">
        <span><strong>{jobs.length}</strong><small>Jobs today</small></span>
        <span><strong>{atRisk}</strong><small>At risk</small></span>
        <span><strong>{avgProgress}%</strong><small>Avg progress</small></span>
      </div>
    </section>
  );
}

export function DepartmentStaffingSummaryCard({ jobs }: { jobs: SharedJobListItem[] }) {
  const gaps = jobs.filter((job) => job.staffing_status === "gap_flagged" || job.staffing_status === "unassigned" || job.assigned_staff_count < (job.estimated_staff_count ?? 0)).length;
  const checkedIn = jobs.reduce((total, job) => total + (job.checked_in_staff_count ?? 0), 0);
  return (
    <section className="panel shared-job-ops__summary-card">
      <WorkspaceSectionHeader title="Staffing Summary" compact />
      <div className="shared-job-ops__metric-grid">
        <span><strong>{gaps}</strong><small>Open gaps</small></span>
        <span><strong>{checkedIn}</strong><small>Checked in</small></span>
        <span><strong>{jobs.filter((job) => job.staffing_status === "ready_confirmed").length}</strong><small>Ready</small></span>
      </div>
    </section>
  );
}

export function LeadReadyFeedCard({ jobs, routeBase }: { jobs: SharedJobListItem[]; routeBase: string }) {
  const readyItems = jobs.filter((job) => job.staffing_status === "ready_confirmed" || job.checked_in_staff_count > 0);
  return (
    <section className="panel shared-job-ops__summary-card">
      <WorkspaceSectionHeader title="Lead Ready Feed" compact />
      {readyItems.length ? (
        <div className="shared-job-ops__feed-list">
          {readyItems.slice(0, 6).map((job) => (
            <button key={job.id} type="button" className="shared-job-ops__feed-item" onClick={() => (window.location.hash = `${routeBase}/${job.id}?tab=day-of`)}>
              <strong>{job.job_number ?? job.title}</strong>
              <span>{job.lead_owner_name ?? "Lead unassigned"}</span>
              <span>{job.staffing_status === "ready_confirmed" ? "Ready confirmed" : `${job.checked_in_staff_count} checked in`}</span>
            </button>
          ))}
        </div>
      ) : (
        <WorkspaceEmptyState title="No ready confirmations yet" summary="Lead confirmations and active check-ins will land here as the day moves." compact />
      )}
    </section>
  );
}

export function CheckInMonitorCard({ jobs, routeBase }: { jobs: SharedJobListItem[]; routeBase: string }) {
  return (
    <section className="panel shared-job-ops__summary-card">
      <WorkspaceSectionHeader title="Check-In Monitor" compact />
      {jobs.length ? (
        <div className="shared-job-ops__feed-list">
          {jobs.slice(0, 6).map((job) => (
            <button key={job.id} type="button" className="shared-job-ops__feed-item" onClick={() => (window.location.hash = `${routeBase}/${job.id}?tab=day-of`)}>
              <strong>{job.job_number ?? job.title}</strong>
              <span>{jobCardSubtitle(job)}</span>
              <span>{job.checked_in_staff_count}/{job.assigned_staff_count} checked in</span>
            </button>
          ))}
        </div>
      ) : (
        <WorkspaceEmptyState title="No jobs today" summary="When there are live jobs on the calendar, check-in counts will appear here." compact />
      )}
    </section>
  );
}

export function TodayOperationsBoard({ token, currentUser, departmentType, routeBase, title = "Today Operations", summary = "Live readiness, staffing, and lead-ready visibility for jobs happening today." }: TodayOperationsBoardProps) {
  const [jobs, setJobs] = useState<SharedJobListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const adapter = departmentType ? getDepartmentJobAdapterUI(departmentType) : null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void listSharedJobs(token, {
      department_type: departmentType ?? "all",
      day_date: getLocalDateString()
    })
      .then((response) => {
        if (!cancelled) {
          setJobs(response.jobs);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setJobs([]);
          setError(loadError instanceof Error ? loadError.message : "We couldn't load today's operations.");
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
  }, [departmentType, token]);

  const readyCount = jobs.filter((job) => job.staffing_status === "ready_confirmed").length;
  const gapCount = jobs.filter((job) => job.staffing_status === "gap_flagged" || job.assigned_staff_count < (job.estimated_staff_count ?? 0)).length;
  const notReadyCount = jobs.filter((job) => job.readiness_status !== "ready").length;
  const criticalIssues = jobs.filter((job) => job.risk_status === "critical" || job.blocker_count > 0).length;

  if (loading) {
    return <WorkspaceLoadingBlock title="Loading today operations" summary="Pulling live readiness, staffing, and lead-ready state from the shared job truth layer." />;
  }

  return (
    <section className="shared-job-ops__today-board">
      <WorkspaceSectionHeader title={title} summary={summary} />
      {error ? <div className="shared-job-list__error" role="alert">{error}</div> : null}
      <div className="shared-job-ops__metric-grid">
        <section className="panel shared-job-ops__summary-card">
          <WorkspaceSectionHeader title="Jobs Today" compact />
          <div className="shared-job-ops__metric-value">{jobs.length}</div>
          <div className="shared-job-ops__metric-row">
            <span>{adapter?.labels.departmentBadge ?? "All departments"}</span>
            <span>{getLocalDateString()}</span>
          </div>
        </section>
        <section className="panel shared-job-ops__summary-card">
          <WorkspaceSectionHeader title="Not Ready" compact />
          <div className="shared-job-ops__metric-value">{notReadyCount}</div>
          <div className="shared-job-ops__metric-row">
            <StatusPill label="Needs attention" tone={notReadyCount ? "warning" : "success"} />
            <span>{jobs.length ? `${Math.round(((jobs.length - notReadyCount) / jobs.length) * 100)}% ready-ish` : "No live jobs"}</span>
          </div>
        </section>
        <section className="panel shared-job-ops__summary-card">
          <WorkspaceSectionHeader title="Staffing Gaps" compact />
          <div className="shared-job-ops__metric-value">{gapCount}</div>
          <div className="shared-job-ops__metric-row">
            <StatusPill label="Coverage watch" tone={gapCount ? "danger" : "success"} />
            <span>{jobs.reduce((total, job) => total + (job.checked_in_staff_count ?? 0), 0)} checked in</span>
          </div>
        </section>
        <section className="panel shared-job-ops__summary-card">
          <WorkspaceSectionHeader title="Lead Ready" compact />
          <div className="shared-job-ops__metric-value">{readyCount}</div>
          <div className="shared-job-ops__metric-row">
            <StatusPill label="Confirmations received" tone={readyCount ? "info" : "neutral"} />
            <span>{criticalIssues} critical alerts</span>
          </div>
        </section>
      </div>

      <div className="shared-job-ops__today-layout">
        <div className="shared-job-ops__today-main">
          <section className="panel shared-job-ops__summary-card">
            <WorkspaceSectionHeader title="Jobs Happening Today" summary="Grouped cards keep live execution visible without leaving the department workspace." />
            {jobs.length ? (
              <div className="shared-job-ops__today-card-list">
                {jobs.map((job) => (
                  <button key={job.id} type="button" className="shared-job-ops__today-card" onClick={() => (window.location.hash = `${routeBase}/${job.id}?tab=day-of`)}>
                    <div className="shared-job-ops__today-card-header">
                      <div>
                        <strong>{job.job_number ?? job.title}</strong>
                        <span>{job.title}</span>
                      </div>
                      <RiskBadge level={job.risk_status} />
                    </div>
                    <div className="shared-job-ops__assignment-meta">
                      <span>{jobCardSubtitle(job)}</span>
                      <span>{job.lead_owner_name ?? "Lead unassigned"}</span>
                      <span>{job.checked_in_staff_count}/{job.assigned_staff_count} checked in</span>
                    </div>
                    <div className="shared-job-preview__status-row">
                      <StatusPill label={humanizeToken(job.readiness_status)} tone={statusTone(job.readiness_status)} />
                      <StatusPill label={humanizeToken(job.staffing_status)} tone={statusTone(job.staffing_status)} />
                      <StatusPill label={job.blocker_count ? `${job.blocker_count} blockers` : "No blockers"} tone={job.blocker_count ? "warning" : "success"} />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <WorkspaceEmptyState title="No jobs today" summary="When today’s jobs land on the schedule, this board becomes the live execution monitor." compact />
            )}
          </section>
        </div>
        <div className="shared-job-ops__today-side">
          <DepartmentReadinessSummaryCard jobs={jobs} />
          <DepartmentStaffingSummaryCard jobs={jobs} />
          <LeadReadyFeedCard jobs={jobs} routeBase={routeBase} />
          <CheckInMonitorCard jobs={jobs} routeBase={routeBase} />
        </div>
      </div>
    </section>
  );
}
