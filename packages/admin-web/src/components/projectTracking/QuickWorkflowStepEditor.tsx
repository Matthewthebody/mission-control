import { useEffect, useState } from "react";
import type { ProjectWorkflowStepStatus } from "../../projectTrackingTypes";
import {
  listWorkflowAssignableUsers,
  transitionProjectWorkflowStep,
  type WorkflowAssignableUser
} from "../../services/projectTracking";

type QuickWorkflowStep = {
  id: string;
  name: string;
  status: ProjectWorkflowStepStatus;
  assigned_user_id: string | null;
  assigned_queue: string | null;
  notes?: string | null;
  updated_at: string | null;
};

type QuickWorkflowStepEditorProps = {
  token: string;
  step: QuickWorkflowStep;
  workflowRunId: string;
  onSaved?: () => Promise<void> | void;
};

const STATUS_OPTIONS: Array<{ value: ProjectWorkflowStepStatus; label: string }> = [
  { value: "NOT_STARTED", label: "Not started" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "WAITING", label: "Waiting" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "COMPLETE", label: "Complete" }
];

const QUEUE_OPTIONS = [
  { value: "", label: "No department selected" },
  { value: "schools", label: "Schools" },
  { value: "sports", label: "Sports" },
  { value: "production", label: "Production" },
  { value: "photography", label: "Photography" },
  { value: "operations", label: "Operations" },
  { value: "other", label: "Other" }
];

function queueLabel(value: string | null | undefined) {
  if (!value) {
    return "No department";
  }
  return QUEUE_OPTIONS.find((option) => option.value === value)?.label ?? value.replace(/_/g, " ");
}

export function QuickWorkflowStepEditor({ token, step, workflowRunId, onSaved }: QuickWorkflowStepEditorProps) {
  const [assignableUsers, setAssignableUsers] = useState<WorkflowAssignableUser[]>([]);
  const [userError, setUserError] = useState("");
  const [status, setStatus] = useState<ProjectWorkflowStepStatus>(step.status);
  const [assignedUserId, setAssignedUserId] = useState(step.assigned_user_id ?? "");
  const [assignedQueue, setAssignedQueue] = useState(step.assigned_queue ?? "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setUserError("");
    listWorkflowAssignableUsers(token)
      .then((users) => {
        if (!cancelled) {
          setAssignableUsers(users);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setAssignableUsers([]);
          setUserError(loadError instanceof Error ? loadError.message : "Assignable users could not load.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    setStatus(step.status);
    setAssignedUserId(step.assigned_user_id ?? "");
    setAssignedQueue(step.assigned_queue ?? "");
    setNote(step.notes ?? "");
    setNotice("");
    setError("");
  }, [step.assigned_queue, step.assigned_user_id, step.id, step.notes, step.status]);

  const selectedUser = assignableUsers.find((user) => user.user_id === assignedUserId);

  const saveChanges = async () => {
    setSaving(true);
    setNotice("");
    setError("");
    try {
      const personLabel = selectedUser?.full_name ?? (assignedUserId ? "selected person" : "no person");
      const queue = assignedQueue || null;
      await transitionProjectWorkflowStep(token, step.id, {
        status,
        assigned_user_id: assignedUserId || null,
        assigned_queue: queue,
        notes: note.trim() || null,
        reason: `Quick update current workflow step (status: ${status}, person: ${personLabel}, queue: ${queueLabel(queue)}).`,
        last_seen_updated_at: step.updated_at
      });
      setNotice("Current step updated.");
      await onSaved?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Current step could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="quick-workflow-step-editor" aria-label="Assign and Status current step" onKeyDown={(event) => event.stopPropagation()}>
      <div className="quick-workflow-step-editor__header">
        <div>
          <strong>Update current step</strong>
          <span>{step.name}</span>
        </div>
        <a href={`#project-tracking/workflows/${workflowRunId}`}>Open Workflow</a>
      </div>
      <div className="quick-workflow-step-editor__grid">
        <label>
          <span>Current step</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as ProjectWorkflowStepStatus)}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Assigned person</span>
          <select value={assignedUserId} onChange={(event) => setAssignedUserId(event.target.value)}>
            <option value="">No person selected</option>
            {assignableUsers.map((user) => (
              <option key={user.user_id} value={user.user_id}>
                {user.full_name} - {user.department ? user.department.replace(/_/g, " ") : "Unassigned"}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Department</span>
          <select value={assignedQueue} onChange={(event) => setAssignedQueue(event.target.value)}>
            {QUEUE_OPTIONS.map((option) => (
              <option key={option.value || "none"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Shared note</span>
          <textarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Visible in queues, My Work, and the full workflow"
          />
        </label>
      </div>
      {userError ? <p className="quick-workflow-step-editor__error">{userError}</p> : null}
      {error ? <p className="quick-workflow-step-editor__error">{error}</p> : null}
      {notice ? <p className="quick-workflow-step-editor__notice">{notice}</p> : null}
      <div className="quick-workflow-step-editor__actions">
        <button type="button" className="button" disabled={saving} onClick={() => void saveChanges()}>
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}
