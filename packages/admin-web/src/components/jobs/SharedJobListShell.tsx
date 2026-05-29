import type { ReactNode } from "react";
import { WorkspaceFilterToolbar } from "../workspace/WorkspaceFilterToolbar";
import { WorkspacePageHeader, type WorkspaceHeaderMeta } from "../workspace/WorkspacePageHeader";
import { WorkspaceEmptyState } from "../workspace/WorkspaceEmptyState";

type Props = {
  eyebrow?: string;
  title: string;
  summary: ReactNode;
  meta?: WorkspaceHeaderMeta[];
  actions?: ReactNode;
  savedViews?: ReactNode;
  filters?: ReactNode;
  viewSwitcher?: ReactNode;
  content: ReactNode;
  preview?: ReactNode;
  bulkActions?: ReactNode;
  emptyState?: {
    title: string;
    summary: ReactNode;
    actions?: ReactNode;
  } | null;
};

export function SharedJobListShell({
  eyebrow,
  title,
  summary,
  meta = [],
  actions = null,
  savedViews = null,
  filters = null,
  viewSwitcher = null,
  content,
  preview = null,
  bulkActions = null,
  emptyState = null
}: Props) {
  return (
    <div className="shared-job-shell shared-job-shell--list">
      <WorkspacePageHeader eyebrow={eyebrow} title={title} summary={summary} meta={meta} actions={actions} compact />
      {savedViews || filters || viewSwitcher ? (
        <WorkspaceFilterToolbar className="shared-job-shell__toolbar">
          <div className="shared-job-shell__toolbar-grid">
            {savedViews ? <div className="shared-job-shell__toolbar-block">{savedViews}</div> : null}
            {filters ? <div className="shared-job-shell__toolbar-block">{filters}</div> : null}
            {viewSwitcher ? <div className="shared-job-shell__toolbar-block shared-job-shell__toolbar-block--compact">{viewSwitcher}</div> : null}
          </div>
        </WorkspaceFilterToolbar>
      ) : null}
      {bulkActions ? <div className="panel shared-job-shell__bulk-bar">{bulkActions}</div> : null}
      <div className={`shared-job-shell__split${preview ? " shared-job-shell__split--preview" : ""}`}>
        <section className="panel shared-job-shell__surface">
          {emptyState ? <WorkspaceEmptyState title={emptyState.title} summary={emptyState.summary} actions={emptyState.actions ?? null} /> : content}
        </section>
        {preview ? <aside className="panel shared-job-shell__preview">{preview}</aside> : null}
      </div>
    </div>
  );
}
