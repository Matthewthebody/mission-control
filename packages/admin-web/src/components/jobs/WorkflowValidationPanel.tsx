import { StatusPill, humanizeToken } from "../sports/SportsPrimitives";
import type {
  SharedJobWorkflowSummary,
  SharedWorkflowCheckpointSummary,
  SharedWorkflowTransitionValidation
} from "../../jobTruthTypes";

type Props = {
  workflow?: SharedJobWorkflowSummary | null;
  validation?: SharedWorkflowTransitionValidation | null;
  compact?: boolean;
};

function toneForState(state: SharedWorkflowCheckpointSummary["state"]) {
  switch (state) {
    case "blocked":
      return "danger";
    case "warning":
      return "warning";
    default:
      return "success";
  }
}

function checkpointMeta(checkpoint: SharedWorkflowCheckpointSummary) {
  if (checkpoint.blocker_count > 0) {
    return `${checkpoint.blocker_count} blocker${checkpoint.blocker_count === 1 ? "" : "s"}`;
  }
  if (checkpoint.warning_count > 0) {
    return `${checkpoint.warning_count} warning${checkpoint.warning_count === 1 ? "" : "s"}`;
  }
  return "Clear";
}

function ValidationIssueList({ issues }: { issues: SharedWorkflowTransitionValidation["issues"] | SharedWorkflowCheckpointSummary["issues"] }) {
  if (!issues.length) {
    return null;
  }
  return (
    <ul className="shared-job-workflow__issue-list">
      {issues.map((issue) => (
        <li key={`${issue.code}-${issue.subject_id ?? "job"}-${issue.message}`}>
          <strong>{issue.field ? humanizeToken(issue.field) : "Workflow"}:</strong> {issue.message}
        </li>
      ))}
    </ul>
  );
}

export function WorkflowValidationPanel({ workflow = null, validation = null, compact = false }: Props) {
  const checkpoints = workflow ? [workflow.publish, workflow.readiness, workflow.production, workflow.approvals, workflow.evaluations] : [];
  const visibleCheckpoints = compact ? checkpoints.filter((checkpoint) => checkpoint.state !== "clear") : checkpoints;

  if (!validation && visibleCheckpoints.length === 0) {
    return null;
  }

  return (
    <div className="shared-job-workflow__stack">
      {validation ? (
        <section className="shared-job-workflow__card shared-job-workflow__card--danger" aria-live="polite">
          <div className="shared-job-workflow__card-header">
            <div>
              <strong>Workflow transition blocked</strong>
              <p>
                {validation.target_state ? `Target state: ${humanizeToken(validation.target_state)}` : "This action cannot move forward yet."}
              </p>
            </div>
            <div className="shared-job-preview__status-row">
              <StatusPill label={validation.hard_blocked ? "Blocked" : "Override Required"} tone={validation.hard_blocked ? "danger" : "warning"} />
              <StatusPill label={`${validation.issues.length} issue${validation.issues.length === 1 ? "" : "s"}`} tone={validation.hard_blocked ? "danger" : "warning"} />
            </div>
          </div>
          <ValidationIssueList issues={validation.issues} />
        </section>
      ) : null}

      {visibleCheckpoints.length ? (
        <section className="shared-job-workflow__card">
          <div className="shared-job-workflow__card-header">
            <div>
              <strong>Workflow checkpoints</strong>
              <p>Shared readiness, production, approvals, and closeout rules for this job.</p>
            </div>
          </div>
          <div className="shared-job-workflow__grid">
            {visibleCheckpoints.map((checkpoint) => (
              <article key={checkpoint.key} className={`shared-job-workflow__checkpoint shared-job-workflow__checkpoint--${checkpoint.state}`}>
                <div className="shared-job-workflow__checkpoint-header">
                  <strong>{checkpoint.label}</strong>
                  <StatusPill label={checkpointMeta(checkpoint)} tone={toneForState(checkpoint.state)} />
                </div>
                <p>{checkpoint.summary}</p>
                {checkpoint.next_action ? <span className="shared-job-workflow__next-action">Next: {checkpoint.next_action}</span> : null}
                {!compact && checkpoint.issues.length ? <ValidationIssueList issues={checkpoint.issues.slice(0, 3)} /> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
