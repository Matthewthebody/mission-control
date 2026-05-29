import { WorkspaceSectionHeader } from "./WorkspaceSectionHeader";

type WorkLaunchAction = {
  label: string;
  summary: string;
  hash: string;
  helperLabel?: string;
};

type Props = {
  eyebrow?: string;
  title?: string;
  summary?: string;
  className?: string;
  jobAction: WorkLaunchAction;
  taskAction: WorkLaunchAction;
};

export function CreateWorkLauncherPanel({
  eyebrow = "Create Work",
  title = "Choose the right kind of work",
  summary = "Jobs / Events create operational workload. Tasks are internal execution items that can stand alone or link back to a Job / Event.",
  className = "",
  jobAction,
  taskAction
}: Props) {
  return (
    <section className={`panel create-work-launcher${className ? ` ${className}` : ""}`}>
      <WorkspaceSectionHeader eyebrow={eyebrow} title={title} summary={summary} compact />
      <div className="create-work-launcher__grid">
        <button
          type="button"
          className="create-work-launcher__card create-work-launcher__card--job"
          aria-label={jobAction.label}
          onClick={() => {
            window.location.hash = jobAction.hash;
          }}
        >
          <span className="eyebrow">Job / Event</span>
          <strong>{jobAction.label}</strong>
          <p>{jobAction.summary}</p>
          <span className="create-work-launcher__helper">
            {jobAction.helperLabel ?? "Creates the real operational work object that drives scheduling, staffing, and downstream execution."}
          </span>
        </button>
        <button
          type="button"
          className="create-work-launcher__card create-work-launcher__card--task"
          aria-label={taskAction.label}
          onClick={() => {
            window.location.hash = taskAction.hash;
          }}
        >
          <span className="eyebrow">Task</span>
          <strong>{taskAction.label}</strong>
          <p>{taskAction.summary}</p>
          <span className="create-work-launcher__helper">
            {taskAction.helperLabel ?? "Creates an internal execution item for follow-through, reminders, proof-gated work, or role-owned actions."}
          </span>
        </button>
      </div>
    </section>
  );
}
