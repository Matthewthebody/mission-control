import { useEffect, useState } from "react";
import type { CentralJobDepartment, CentralJobDraftListItem } from "../../jobIntakeTypes";
import { listCentralJobDrafts } from "../../services/centralJobIntakeApi";
import { OverlayPanel } from "../OverlayPanel";
import { WorkspaceEmptyState } from "../workspace/WorkspaceEmptyState";
import { WorkspaceLoadingBlock } from "../workspace/WorkspaceLoadingBlock";
import { WorkspaceSectionHeader } from "../workspace/WorkspaceSectionHeader";

type Props = {
  open: boolean;
  token: string;
  department: CentralJobDepartment;
  launchLabel: string;
  onClose: () => void;
  onResumeDraft: (draftId: string) => void;
};

export function ResumeDraftsDrawer({ open, token, department, launchLabel, onClose, onResumeDraft }: Props) {
  const [drafts, setDrafts] = useState<CentralJobDraftListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void listCentralJobDrafts(token, { department })
      .then((response) => {
        if (!cancelled) {
          setDrafts(response.drafts);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "We couldn't load saved drafts right now.");
          setDrafts([]);
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
  }, [department, open, token]);

  if (!open) {
    return null;
  }

  return (
    <OverlayPanel
      open={open}
      ariaLabel={`${launchLabel} resume job drafts`}
      onClose={onClose}
      overlayClassName="job-intake-drawer-overlay"
      contentClassName="job-intake-drawer"
    >
      <div className="job-intake-drawer__layout">
        <header className="panel job-intake-drawer__header">
          <div>
            <div className="eyebrow">{launchLabel}</div>
            <h2>Resume Drafts</h2>
            <p>Pick up an existing {department === "schools" ? "school" : "sports"} intake draft without starting over.</p>
          </div>
          <div className="job-intake-drawer__header-meta">
            <span className={`job-intake-launcher-card__badge job-intake-launcher-card__badge--${department}`}>
              {department === "schools" ? "Schools drafts" : "Sports drafts"}
            </span>
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}

        {loading ? (
          <WorkspaceLoadingBlock
            title="Loading saved drafts"
            summary="Pulling your most relevant intake drafts first so you can resume without hunting through the database."
          />
        ) : null}

        {!loading && !drafts.length ? (
          <WorkspaceEmptyState
            title="No drafts to resume"
            summary={`No ${department} intake drafts are currently waiting for follow-through.`}
            actions={
              <button type="button" className="secondary-button" onClick={onClose}>
                Close
              </button>
            }
          />
        ) : null}

        {!loading && drafts.length ? (
          <section className="panel job-intake-resume-drafts">
            <WorkspaceSectionHeader
              title="Saved intake drafts"
              summary="These drafts are ordered with jobs assigned to you or last touched by you first."
              badge={<span className="workspace-page-header__meta-pill">{drafts.length} drafts</span>}
            />
            <div className="dashboard-stack">
              {drafts.map((draft) => {
                const organizationLabel = draft.organization_display_name ?? draft.unresolved_organization_name ?? "Organization pending";
                const dateLabel = draft.start_date ?? "Date pending";
                return (
                  <div key={draft.id} className="request-card job-intake-resume-drafts__card">
                    <div>
                      <strong>{draft.title}</strong>
                      <div className="muted">
                        {organizationLabel} | {dateLabel}
                      </div>
                      <div className="muted">
                        Last updated {formatRelativeTimestamp(draft.updated_at)}
                        {draft.job_owner_name ? ` | Owner: ${draft.job_owner_name}` : ""}
                      </div>
                    </div>
                    <div className="request-card__actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          onResumeDraft(draft.id);
                        }}
                      >
                        Resume Draft
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </OverlayPanel>
  );
}

function formatRelativeTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}
