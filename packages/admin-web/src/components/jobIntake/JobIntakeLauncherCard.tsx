import { WorkspaceActionBar } from "../workspace/WorkspaceActionBar";
import { WorkspaceSectionHeader } from "../workspace/WorkspaceSectionHeader";

type Props = {
  department: "schools" | "sports";
  contextLabel: string;
  canCreate: boolean;
  onQuickCreate: () => void;
  onSmartPaste: () => void;
  onImportFile: () => void;
  onResumeDrafts: () => void;
};

export function JobIntakeLauncherCard({
  department,
  contextLabel,
  canCreate,
  onQuickCreate,
  onSmartPaste,
  onImportFile,
  onResumeDrafts
}: Props) {
  const summary =
    department === "schools"
      ? "Start a school job draft from the Schools board without duplicating work into a second system."
      : "Start a sports job draft from the Sports workspace and publish it into the same canonical job backend.";

  return (
    <section className="panel job-intake-launcher-card" aria-label={`${contextLabel} new job intake`}>
      <WorkspaceSectionHeader
        eyebrow={contextLabel}
        title="New Job Intake"
        summary={summary}
        badge={
          <span className={`job-intake-launcher-card__badge job-intake-launcher-card__badge--${department}`}>
            {department === "schools" ? "Schools default" : "Sports default"}
          </span>
        }
      />
      <div className="job-intake-launcher-card__body">
        <div className="job-intake-launcher-card__copy">
          <p>
            Quick Create, Smart Paste, Import File, and Resume Drafts all feed the same canonical intake backend.
            Bulk import defaults to draft creation until a lead or admin explicitly publishes valid rows.
          </p>
          {!canCreate ? (
            <div className="job-intake-launcher-card__notice">
              You can review intake entry points here, but you need shoot-create access to start a new job.
            </div>
          ) : null}
        </div>
        <WorkspaceActionBar align="start" className="job-intake-launcher-card__actions">
          <button type="button" onClick={onQuickCreate} disabled={!canCreate}>
            Quick Create
          </button>
          <button type="button" className="secondary-button" onClick={onSmartPaste} disabled={!canCreate}>
            Smart Paste
          </button>
          <button type="button" className="secondary-button" onClick={onImportFile} disabled={!canCreate}>
            Import File
          </button>
          <button type="button" className="secondary-button" onClick={onResumeDrafts} disabled={!canCreate}>
            Resume Drafts
          </button>
        </WorkspaceActionBar>
      </div>
    </section>
  );
}
