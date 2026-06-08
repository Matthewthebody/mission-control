import { useEffect, useMemo, useState } from "react";
import { ApiClientError } from "../api";
import { CommunicationHistoryPanel } from "../components/CommunicationHistoryPanel";
import { PreCallContextPanel } from "../components/PreCallContextPanel";
import { SharedStaffPicker } from "../components/jobs/SharedJobPickers";
import { TeamsCommunicationPanel } from "../components/TeamsCommunicationPanel";
import { TeamsMeetingPanel } from "../components/TeamsMeetingPanel";
import { humanizeToken, useHashRouteSnapshot } from "../components/sports/SportsPrimitives";
import { WorkspaceActionBar } from "../components/workspace/WorkspaceActionBar";
import { WorkspaceEmptyState } from "../components/workspace/WorkspaceEmptyState";
import { WorkspaceLoadingBlock } from "../components/workspace/WorkspaceLoadingBlock";
import { WorkspacePageHeader, type WorkspaceHeaderMeta } from "../components/workspace/WorkspacePageHeader";
import { WorkspaceSectionHeader } from "../components/workspace/WorkspaceSectionHeader";
import type { JobDepartmentType, JobPriorityLevel } from "../jobTruthTypes";
import { listSharedJobs } from "../services/jobsApi";
import { listDirectoryOwnerOptions } from "../services/organizationApi";
import { buildTaskPreCallContext } from "../services/preCallContextBuilders";
import { createSharedTask, getSharedTaskDetail, updateSharedTask } from "../services/tasksApi";
import {
  buildTaskDescriptionWithRecurrence,
  extractTaskRecurrence,
  getTaskRecurrenceLabel,
  stripTaskRecurrenceLine,
  TASK_RECURRENCE_OPTIONS,
  type TaskRecurrenceValue
} from "../taskRecurrence";
import type { SessionUser, DirectoryOwnerOption } from "../types";
import type { SharedTaskCreateInput, SharedTaskDetailResponse, SharedTaskStatus, WorkDepartmentType, WorkModelSummary } from "../workModelTypes";

type Props = {
  token: string;
  currentUser: SessionUser;
  mode: "create" | "detail";
};

type TaskFormState = {
  title: string;
  description: string;
  task_type: string;
  department_type: WorkDepartmentType;
  related_job_id: string;
  assigned_to_user_id: string;
  assigned_team_id: string;
  status: SharedTaskStatus;
  priority: JobPriorityLevel;
  due_at: string;
  recurrence: TaskRecurrenceValue;
  blocked_reason: string;
  proof_required: boolean;
  completion_notes: string;
};

const TASK_STATUS_OPTIONS: SharedTaskStatus[] = ["not_started", "in_progress", "waiting", "blocked", "review", "completed", "cancelled"];
const TASK_PRIORITY_OPTIONS: JobPriorityLevel[] = ["low", "normal", "high", "urgent"];
const DEPARTMENT_OPTIONS: WorkDepartmentType[] = ["schools", "sports", "production", "photography", "operations", "other"];
const TASK_CREATED_NOTICE_PREFIX = "mission-control-task-created:";
const DEFAULT_WORK_MODEL: WorkModelSummary[] = [
  {
    object_kind: "job_event",
    title: "Job / Event",
    description: "Real operational work object that creates workload, drives scheduling, and anchors department execution.",
    relationships: ["May create many tasks", "May have many assignments", "May render schedule entries"]
  },
  {
    object_kind: "task",
    title: "Task",
    description: "Internal execution item owned by a department or workflow, optionally linked back to a job or event.",
    relationships: ["May belong to one job / event", "May have one or more assignees"]
  },
  {
    object_kind: "assignment",
    title: "Assignment",
    description: "Person-to-work link that connects an employee to a job, task, or staffing responsibility.",
    relationships: ["May point to a job", "May point to a task", "May drive staffing schedule entries"]
  },
  {
    object_kind: "schedule_entry",
    title: "Schedule Entry",
    description: "Rendered calendar object in the shared master scheduling engine for jobs, staffing, travel, and holds.",
    relationships: ["Generated from jobs / events", "Generated from assignments", "Supports job and staffing views"]
  }
];

function createBlankTaskFormState(department: WorkDepartmentType = "schools"): TaskFormState {
  return {
    title: "",
    description: "",
    task_type: "general_follow_up",
    department_type: department,
    related_job_id: "",
    assigned_to_user_id: "",
    assigned_team_id: "",
    status: "not_started",
    priority: "normal",
    due_at: "",
    recurrence: "none",
    blocked_reason: "",
    proof_required: false,
    completion_notes: ""
  };
}

function parseTaskIdFromPath(path: string) {
  const normalized = path.replace(/^#/, "");
  const match = normalized.match(/^tasks\/([^/?#]+)$/i);
  if (!match) {
    return null;
  }
  return match[1] === "new" ? null : match[1];
}

function toDateTimeLocal(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function fromDetail(detail: SharedTaskDetailResponse): TaskFormState {
  return {
    title: detail.task.title,
    description: stripTaskRecurrenceLine(detail.task.description),
    task_type: detail.task.task_type,
    department_type: detail.task.department_type,
    related_job_id: detail.task.related_job_id ?? "",
    assigned_to_user_id: detail.task.assigned_to_user_id ?? "",
    assigned_team_id: detail.task.assigned_team_id ?? "",
    status: detail.task.status,
    priority: detail.task.priority,
    due_at: toDateTimeLocal(detail.task.due_at),
    recurrence: extractTaskRecurrence(detail.task.description),
    blocked_reason: detail.task.blocked_reason ?? "",
    proof_required: detail.task.proof_required,
    completion_notes: detail.task.completion_notes ?? ""
  };
}

function toPayload(form: TaskFormState): SharedTaskCreateInput {
  return {
    title: form.title.trim(),
    description: buildTaskDescriptionWithRecurrence(form.description, form.recurrence),
    task_type: form.task_type.trim() || null,
    department_type: form.department_type,
    related_job_id: form.related_job_id || null,
    assigned_to_user_id: form.assigned_to_user_id || null,
    assigned_team_id: form.assigned_team_id.trim() || null,
    status: form.status,
    priority: form.priority,
    due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
    blocked_reason: form.blocked_reason.trim() || null,
    proof_required: form.proof_required,
    completion_notes: form.completion_notes.trim() || null
  };
}

function toJobDepartmentFilter(department: WorkDepartmentType): JobDepartmentType | undefined {
  return department === "schools" || department === "sports" ? department : undefined;
}

function getTaskCreatedNoticeKey(taskId: string) {
  return `${TASK_CREATED_NOTICE_PREFIX}${taskId}`;
}

function rememberCreatedTask(taskId: string, title: string) {
  try {
    window.sessionStorage.setItem(getTaskCreatedNoticeKey(taskId), title);
  } catch {
    // Session storage is only used for a cross-route success notice.
  }
}

function consumeCreatedTaskTitle(taskId: string) {
  try {
    const key = getTaskCreatedNoticeKey(taskId);
    const title = window.sessionStorage.getItem(key);
    if (title) {
      window.sessionStorage.removeItem(key);
    }
    return title;
  } catch {
    return null;
  }
}

export function SharedTaskPage({ token, currentUser, mode }: Props) {
  const { path, params } = useHashRouteSnapshot();
  const taskId = mode === "detail" ? parseTaskIdFromPath(path) : null;
  const initialDepartment = (params.get("department") as WorkDepartmentType | null) ?? "schools";
  const initialRelatedJobId = params.get("jobId") ?? "";
  const [formState, setFormState] = useState<TaskFormState>(() => {
    const next = createBlankTaskFormState(initialDepartment);
    next.related_job_id = initialRelatedJobId;
    next.assigned_to_user_id = currentUser.id;
    return next;
  });
  const [detail, setDetail] = useState<SharedTaskDetailResponse | null>(null);
  const [ownerOptions, setOwnerOptions] = useState<DirectoryOwnerOption[]>([]);
  const [jobSearch, setJobSearch] = useState("");
  const [jobResults, setJobResults] = useState<Array<{ id: string; job_number: string | null; title: string }>>([]);
  const [loading, setLoading] = useState(mode === "detail");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const readOnly = Boolean(detail && !detail.policy.actions.update);
  const modelCards = detail?.work_model ?? DEFAULT_WORK_MODEL;
  const selectedJobLabel = useMemo(() => {
    if (detail?.related_job) {
      return [detail.related_job.job_number, detail.related_job.title].filter(Boolean).join(" | ");
    }
    const fromSearch = jobResults.find((job) => job.id === formState.related_job_id);
    return fromSearch ? [fromSearch.job_number, fromSearch.title].filter(Boolean).join(" | ") : "";
  }, [detail?.related_job, formState.related_job_id, jobResults]);
  const effectiveAssigneeLabel =
    ownerOptions.find((option) => option.user_id === formState.assigned_to_user_id)?.full_name ??
    (formState.assigned_to_user_id === currentUser.id ? currentUser.fullName : "");

  useEffect(() => {
    void listDirectoryOwnerOptions(token)
      .then((response) => setOwnerOptions(response.owners))
      .catch(() => setOwnerOptions([]));
  }, [token]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void listSharedJobs(token, {
        department_type: toJobDepartmentFilter(formState.department_type),
        search: jobSearch.trim() || undefined
      })
        .then((response) =>
          setJobResults(
            response.jobs.slice(0, 12).map((job) => ({
              id: job.id,
              job_number: job.job_number,
              title: job.title
            }))
          )
        )
        .catch(() => setJobResults([]));
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [formState.department_type, jobSearch, token]);

  useEffect(() => {
    if (!taskId || mode !== "detail") {
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getSharedTaskDetail(token, taskId)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setDetail(response);
        setFormState(fromDetail(response));
        const createdTitle = consumeCreatedTaskTitle(response.task.id);
        if (createdTitle) {
          setNotice(`Task created: ${createdTitle}. It is now open and available in My Tasks.`);
        }
        setError("");
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof ApiClientError ? loadError.message : "We couldn't load this task.");
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
  }, [mode, taskId, token]);

  function updateField<K extends keyof TaskFormState>(key: K, value: TaskFormState[K]) {
    if (readOnly) {
      return;
    }
    setFormState((current) => ({ ...current, [key]: value }));
  }

  async function persist() {
    if (!formState.title.trim()) {
      setError("Task title is required.");
      return;
    }
    if (formState.status === "blocked" && !formState.blocked_reason.trim()) {
      setError("Blocked tasks need a reason.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      if (mode === "detail" && taskId) {
        const response = await updateSharedTask(token, taskId, toPayload(formState));
        setDetail(response);
        setFormState(fromDetail(response));
        setNotice("Task updated.");
        return;
      }
      const created = await createSharedTask(token, toPayload(formState));
      setDetail(created);
      setFormState(fromDetail(created));
      rememberCreatedTask(created.task.id, created.task.title);
      setNotice(`Task created: ${created.task.title}. It is now open and available in My Tasks.`);
      window.location.hash = `#tasks/${created.task.id}`;
    } catch (persistError) {
      setError(persistError instanceof ApiClientError ? persistError.message : "We couldn't save this task right now.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <WorkspaceLoadingBlock title="Loading task" summary="Opening the shared task workspace and linked job context." />;
  }

  const headerMeta: WorkspaceHeaderMeta[] = detail
    ? [
        { label: detail.task.task_number, tone: "info" },
        { label: humanizeToken(detail.task.status), tone: detail.task.status === "blocked" ? "critical" : detail.task.status === "review" ? "warning" : "neutral" },
        { label: detail.task.department_label, tone: "neutral" }
      ]
    : [
        { label: "Task", tone: "info" },
        { label: humanizeToken(formState.department_type), tone: "neutral" }
      ];

  return (
    <div className="shared-task-page">
      <WorkspacePageHeader
        eyebrow="Work Model"
        title={mode === "detail" && detail ? detail.task.title : "New Task"}
        summary="Tasks are internal execution items. Use them for follow-through, reminders, proof-gated steps, and department-owned action items without confusing them with Jobs / Events."
        meta={headerMeta}
        actions={
          <WorkspaceActionBar compact>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#jobs/new")}>
              New Job / Event
            </button>
            <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#my-schedule")}>
              My Schedule
            </button>
            {detail?.related_job ? (
              <button type="button" className="secondary-button" onClick={() => (window.location.hash = `#jobs/${detail.related_job?.id}`)}>
                Open Linked Job
              </button>
            ) : null}
          </WorkspaceActionBar>
        }
        compact
      />

      {notice ? (
        <div className="success-banner shared-task-page__success">
          <span>{notice}</span>
          <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#tasks")}>
            Open My Tasks
          </button>
        </div>
      ) : null}
      {error ? <div className="error-banner">{error}</div> : null}

      <section className="panel shared-task-page__model-panel">
        <WorkspaceSectionHeader
          eyebrow="Operating Model"
          title="One workload model, four distinct objects"
          summary="Jobs / Events create workload. Tasks execute work. Assignments link people to work. Schedule entries render time-based work in the master schedule."
          compact
        />
        <div className="shared-task-page__model-grid">
          {modelCards.map((card) => (
            <article key={card.object_kind} className="shared-task-page__model-card">
              <div className="eyebrow">{humanizeToken(card.object_kind)}</div>
              <strong>{card.title}</strong>
              <p>{card.description}</p>
              <ul className="shared-task-page__model-list">
                {card.relationships.map((relationship) => (
                  <li key={relationship}>{relationship}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <div className="shared-task-page__layout">
        <section className="panel shared-task-page__form-panel">
          <WorkspaceSectionHeader
            eyebrow="Task Create Flow"
            title={mode === "detail" ? "Task Detail" : "Create internal execution work"}
            summary="Capture the department owner, optional linked Job / Event, assignee, due timing, proof needs, and the current execution state in one place."
            compact
          />
          <div className="field-grid shared-task-page__grid">
            <label className="filter-field filter-field--wide">
              <span>Task title</span>
              <input value={formState.title} onChange={(event) => updateField("title", event.target.value)} disabled={readOnly} />
            </label>
            <label className="filter-field">
              <span>Assign to Department</span>
              <select
                value={formState.department_type}
                onChange={(event) => updateField("department_type", event.target.value as WorkDepartmentType)}
                disabled={readOnly || Boolean(detail?.related_job)}
              >
                {DEPARTMENT_OPTIONS.map((department) => (
                  <option key={department} value={department}>
                    {humanizeToken(department)}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Task type</span>
              <input value={formState.task_type} onChange={(event) => updateField("task_type", event.target.value)} disabled={readOnly} />
            </label>
            <label className="filter-field">
              <span>Status</span>
              <select value={formState.status} onChange={(event) => updateField("status", event.target.value as SharedTaskStatus)} disabled={readOnly}>
                {TASK_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {humanizeToken(status)}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Priority</span>
              <select value={formState.priority} onChange={(event) => updateField("priority", event.target.value as JobPriorityLevel)} disabled={readOnly}>
                {TASK_PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>
                    {humanizeToken(priority)}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              <span>Due date / time</span>
              <input type="datetime-local" value={formState.due_at} onChange={(event) => updateField("due_at", event.target.value)} disabled={readOnly} />
            </label>
            <label className="filter-field">
              <span>Repeat</span>
              <select
                value={formState.recurrence}
                onChange={(event) => updateField("recurrence", event.target.value as TaskRecurrenceValue)}
                disabled={readOnly}
              >
                {TASK_RECURRENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="filter-field filter-field--wide">
              <span>Related Job / Event search</span>
              <input
                value={jobSearch}
                onChange={(event) => setJobSearch(event.target.value)}
                placeholder="Search by job number or title"
                disabled={readOnly}
              />
            </label>
            <label className="filter-field filter-field--wide">
              <span>Related Job / Event</span>
              <select value={formState.related_job_id} onChange={(event) => updateField("related_job_id", event.target.value)} disabled={readOnly}>
                <option value="">No linked job / event</option>
                {jobResults.map((job) => (
                  <option key={job.id} value={job.id}>
                    {[job.job_number, job.title].filter(Boolean).join(" | ")}
                  </option>
                ))}
              </select>
              <div className="shared-task-page__helper">Jobs / Events create workload. Tasks can belong to one when they are execution follow-through.</div>
            </label>
            <SharedStaffPicker
              label="Assign to Team Member"
              value={formState.assigned_to_user_id}
              onChange={(value) => updateField("assigned_to_user_id", value)}
              options={ownerOptions}
              emptyLabel="Choose team member"
              disabled={readOnly}
            />
            <label className="shared-job-form__toggle">
              <input
                type="checkbox"
                checked={formState.proof_required}
                onChange={(event) => updateField("proof_required", event.target.checked)}
                disabled={readOnly}
              />
              <span>Proof required before completion</span>
            </label>
            <label className="filter-field filter-field--wide">
              <span>Description</span>
              <textarea rows={4} value={formState.description} onChange={(event) => updateField("description", event.target.value)} disabled={readOnly} />
            </label>
            {formState.status === "blocked" ? (
              <label className="filter-field filter-field--wide">
                <span>Blocked reason</span>
                <textarea rows={3} value={formState.blocked_reason} onChange={(event) => updateField("blocked_reason", event.target.value)} disabled={readOnly} />
              </label>
            ) : null}
            <label className="filter-field filter-field--wide">
              <span>Completion notes</span>
              <textarea rows={3} value={formState.completion_notes} onChange={(event) => updateField("completion_notes", event.target.value)} disabled={readOnly} />
            </label>
          </div>
        </section>

        <aside className="shared-task-page__sidebar">
          <section className="panel shared-task-page__sidebar-card">
            <WorkspaceSectionHeader title="Task Summary" summary="Keep the distinction visible to staff so the wrong object does not get created." compact />
            <div className="shared-task-page__summary-strip">
              <div>
                <span className="eyebrow">Object</span>
                <strong>Task</strong>
                <p>Internal execution item</p>
              </div>
              <div>
                <span className="eyebrow">Linked Job</span>
                <strong>{selectedJobLabel || "Optional"}</strong>
                <p>{selectedJobLabel ? "Anchored to real workload" : "Can stand alone"}</p>
              </div>
              <div>
                <span className="eyebrow">Schedule</span>
                <strong>Shared engine</strong>
                <p>Jobs and assignments still render through one master schedule.</p>
              </div>
              <div>
                <span className="eyebrow">Assignee</span>
                <strong>{effectiveAssigneeLabel || "Unassigned"}</strong>
                <p>{effectiveAssigneeLabel ? "Internal execution owner" : "Assign now or leave open for triage."}</p>
              </div>
              <div>
                <span className="eyebrow">Repeat</span>
                <strong>{getTaskRecurrenceLabel(formState.recurrence)}</strong>
                <p>{formState.recurrence === "none" ? "One-time task" : "Recurring task"}</p>
              </div>
            </div>
          </section>
          <section className="panel shared-task-page__sidebar-card">
            <WorkspaceSectionHeader title="Create Guidance" compact />
            <div className="shared-task-page__guidance">
              <p>Use a Job / Event when you are creating a shoot, event, production batch, or other real operational work object.</p>
              <p>Use a Task when you are creating internal follow-through like confirm roster, prep travel packet, upload gallery, or complete QA.</p>
            </div>
          </section>
          {detail?.assignments.length ? (
            <section className="panel shared-task-page__sidebar-card">
              <WorkspaceSectionHeader title="Assignments" compact />
              <div className="shared-task-page__assignment-list">
                {detail.assignments.map((assignment) => (
                  <article key={assignment.id} className="shared-task-page__assignment-card">
                    <strong>{assignment.user_name ?? assignment.user_id}</strong>
                    <span>{humanizeToken(assignment.assignment_type)}</span>
                    <span>{humanizeToken(assignment.status)}</span>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          {detail?.related_job ? (
            <section className="panel shared-task-page__sidebar-card">
              <WorkspaceSectionHeader title="Linked Job / Event" compact />
              <div className="shared-task-page__guidance">
                <strong>{[detail.related_job.job_number, detail.related_job.title].filter(Boolean).join(" | ")}</strong>
                <p>{humanizeToken(detail.related_job.department_type)} | {humanizeToken(detail.related_job.job_status)}</p>
              </div>
            </section>
          ) : null}
          {detail ? (
            <TeamsCommunicationPanel
              token={token}
              currentUser={currentUser}
              objectType="task"
              objectId={detail.task.id}
              title="Task Communications"
              summary="Send an internal update or open the linked Teams destination for this task without turning the task page into a chat surface."
            />
          ) : null}
          {detail ? (
            <TeamsMeetingPanel
              token={token}
              currentUser={currentUser}
              objectType="task"
              objectId={detail.task.id}
              title="Task Teams Meeting"
              summary="Start or join a Teams meeting tied to this task when follow-through needs a quick call or screen share."
              renderPreCallContext={(meetingView) => (
                <PreCallContextPanel token={token} definition={buildTaskPreCallContext(detail, meetingView)} />
              )}
              onPostCallSaved={() => {
                void getSharedTaskDetail(token, detail.task.id)
                  .then((response) => {
                    setDetail(response);
                    setFormState(fromDetail(response));
                  })
                  .catch(() => undefined);
              }}
            />
          ) : null}
          {detail ? (
            <CommunicationHistoryPanel
              token={token}
              currentUser={currentUser}
              objectType="task"
              objectId={detail.task.id}
              title="Task Communication History"
              summary="Show the latest Teams message and meeting metadata tied to this task so follow-through stays visible without a separate conversation surface."
            />
          ) : null}
        </aside>
      </div>

      <section className="panel shared-task-page__footer">
        <WorkspaceActionBar align="end">
          <button type="button" className="secondary-button" onClick={() => (window.location.hash = "#home")}>
            Cancel
          </button>
          <button type="button" onClick={() => void persist()} disabled={saving || readOnly}>
            {saving ? "Saving..." : mode === "detail" ? "Save Task" : "Create Task"}
          </button>
        </WorkspaceActionBar>
      </section>

      {!detail && mode === "detail" && !loading ? (
        <WorkspaceEmptyState
          title="Task not found"
          summary="This internal task could not be loaded. It may have been deleted or you may not have access."
        />
      ) : null}
    </div>
  );
}
