import { useEffect, useMemo, useState } from "react";
import type { ProjectWorkflowInstance, ProjectWorkflowStep } from "../../projectTrackingTypes";
import {
  getProjectWorkflowInstance,
  transitionProjectWorkflowStep
} from "../../services/projectTracking";

type QuickWorkflowMoveStep = {
  id: string;
  name: string;
  workflow_run_id: string;
  status: ProjectWorkflowStep["status"];
  assigned_user_id: string | null;
  assigned_queue: string | null;
  updated_at: string | null;
};

type QuickWorkflowNextStepMoverProps = {
  token: string;
  workflowRunId: string;
  step: QuickWorkflowMoveStep;
  pillClassName?: string;
  onSaved?: () => Promise<void> | void;
};

const TERMINAL_STATUSES = new Set(["COMPLETE", "SKIPPED"]);

function flattenWorkflowSteps(workflow: ProjectWorkflowInstance | null) {
  return workflow?.milestones.flatMap((milestone) => milestone.steps) ?? [];
}

function validNextSteps(workflow: ProjectWorkflowInstance | null, currentStepId: string) {
  const steps = flattenWorkflowSteps(workflow);
  const directDependents = steps.filter(
    (candidate) => !TERMINAL_STATUSES.has(candidate.status) && candidate.dependency_step_ids.includes(currentStepId)
  );
  if (directDependents.length) {
    return directDependents;
  }
  const currentIndex = steps.findIndex((candidate) => candidate.id === currentStepId);
  if (currentIndex < 0) {
    return [];
  }
  return steps.slice(currentIndex + 1).filter((candidate) => !TERMINAL_STATUSES.has(candidate.status)).slice(0, 1);
}

function cleanStepName(value: string) {
  return value.replace(/\s+\/\s+/g, " and ");
}

export function QuickWorkflowNextStepMover({ token, workflowRunId, step, pillClassName = "project-tracking-step-pill--production", onSaved }: QuickWorkflowNextStepMoverProps) {
  const [workflow, setWorkflow] = useState<ProjectWorkflowInstance | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState("");
  const [note, setNote] = useState("");
  const [keepOwner, setKeepOwner] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!open) {
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setError("");
    getProjectWorkflowInstance(token, workflowRunId)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setWorkflow(payload);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setWorkflow(null);
          setError(loadError instanceof Error ? loadError.message : "Workflow steps could not load.");
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
  }, [open, token, workflowRunId]);

  const nextSteps = useMemo(() => validNextSteps(workflow, step.id), [step.id, workflow]);

  useEffect(() => {
    setSelectedStepId(nextSteps[0]?.id ?? "");
  }, [nextSteps]);

  useEffect(() => {
    setNote("");
    setKeepOwner(true);
    setNotice("");
    setError("");
  }, [step.id]);

  const selectedStep = nextSteps.find((candidate) => candidate.id === selectedStepId) ?? null;
  const canMove = Boolean(selectedStep) && !TERMINAL_STATUSES.has(step.status);
  const currentStepName = cleanStepName(step.name);
  const selectedStepName = selectedStep ? cleanStepName(selectedStep.name) : "";

  const moveForward = async () => {
    if (!selectedStep) {
      return;
    }
    const trimmedNote = note.trim();
    setSaving(true);
    setNotice("");
    setError("");
    try {
      const completedWorkflow = await transitionProjectWorkflowStep(token, step.id, {
        status: "COMPLETE",
        notes: trimmedNote || null,
        reason: trimmedNote || `Moved current step forward to ${selectedStepName}.`,
        last_seen_updated_at: step.updated_at
      });
      const refreshedNextStep = flattenWorkflowSteps(completedWorkflow).find((candidate) => candidate.id === selectedStep.id) ?? selectedStep;
      await transitionProjectWorkflowStep(token, refreshedNextStep.id, {
        status: "IN_PROGRESS",
        assigned_user_id: keepOwner ? step.assigned_user_id : null,
        assigned_queue: refreshedNextStep.assigned_queue ?? step.assigned_queue,
        notes: trimmedNote || null,
        reason: `Moved workflow forward from ${currentStepName} to ${cleanStepName(refreshedNextStep.name)}.`,
        last_seen_updated_at: refreshedNextStep.updated_at
      });
      setNotice(`Step moved forward. Moved to next step: ${cleanStepName(refreshedNextStep.name)}`);
      setOpen(false);
      await onSaved?.();
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Workflow step could not move forward.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="quick-next-step-mover">
      <button
        type="button"
        className={`project-tracking-step-pill project-tracking-step-pill--button project-tracking-step-pill--move ${pillClassName}`}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        {currentStepName}
        <span aria-hidden="true">v</span>
      </button>
      {notice ? <small className="quick-next-step-mover__notice">{notice}</small> : null}
      {open ? (
        <div className="quick-next-step-mover__panel" aria-label="Move to next step" onClick={(event) => event.stopPropagation()}>
          <div className="quick-next-step-mover__header">
            <strong>Move to next step</strong>
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          <label>
            <span>Current</span>
            <input value={currentStepName} readOnly />
          </label>
          <label>
            <span>Next step</span>
            <select value={selectedStepId} disabled={loading || !nextSteps.length} onChange={(event) => setSelectedStepId(event.target.value)}>
              {nextSteps.length ? (
                nextSteps.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {cleanStepName(candidate.name)}
                  </option>
                ))
              ) : (
                <option value="">No next step available</option>
              )}
            </select>
          </label>
          <label>
            <span>Add a note (optional)</span>
            <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <label className="quick-next-step-mover__checkbox">
            <input type="checkbox" checked={keepOwner} onChange={(event) => setKeepOwner(event.target.checked)} />
            <span>Keep assigned to current owner</span>
          </label>
          {loading ? <p className="quick-next-step-mover__muted">Loading next steps...</p> : null}
          {!loading && !nextSteps.length ? (
            <p className="quick-next-step-mover__error">No valid next step is available. Open Workflow for closeout or send-back review.</p>
          ) : null}
          {error ? <p className="quick-next-step-mover__error">{error}</p> : null}
          <button type="button" className="button" disabled={!canMove || saving} onClick={() => void moveForward()}>
            {saving ? "Moving..." : "Move to next step"}
          </button>
        </div>
      ) : null}
    </span>
  );
}
