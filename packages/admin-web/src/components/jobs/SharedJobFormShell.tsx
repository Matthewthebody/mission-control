import type { ReactNode } from "react";
import { WorkspacePageHeader, type WorkspaceHeaderMeta } from "../workspace/WorkspacePageHeader";
import { WorkspaceActionBar } from "../workspace/WorkspaceActionBar";
import { WorkspaceSectionHeader } from "../workspace/WorkspaceSectionHeader";

type FormSection = {
  key: string;
  title: string;
  summary: string;
  issueCount?: number;
  body: ReactNode;
};

type SidebarCard = {
  key: string;
  title: string;
  body: ReactNode;
};

type Props = {
  eyebrow?: string;
  title: string;
  summary: ReactNode;
  meta?: WorkspaceHeaderMeta[];
  actions?: ReactNode;
  formIntro?: ReactNode;
  sections: FormSection[];
  sidebarCards?: SidebarCard[];
  footer: ReactNode;
};

export function SharedJobFormShell({ eyebrow, title, summary, meta = [], actions = null, formIntro = null, sections, sidebarCards = [], footer }: Props) {
  return (
    <div className="shared-job-shell shared-job-shell--form">
      <WorkspacePageHeader eyebrow={eyebrow} title={title} summary={summary} meta={meta} actions={actions} compact />
      {formIntro}
      <div className="shared-job-shell__form-layout">
        <div className="shared-job-shell__form-main">
          {sections.map((section) => (
            <section key={section.key} className={`panel shared-job-shell__section${section.issueCount ? " shared-job-shell__section--attention" : ""}`}>
              <WorkspaceSectionHeader
                title={section.title}
                summary={section.summary}
                badge={section.issueCount ? <span className="shared-job-shell__issue-badge">{section.issueCount} issue{section.issueCount === 1 ? "" : "s"}</span> : null}
                compact
              />
              <div className="shared-job-shell__section-body">{section.body}</div>
            </section>
          ))}
        </div>
        <aside className="shared-job-shell__form-sidebar">
          {sidebarCards.map((card) => (
            <section key={card.key} className="panel shared-job-shell__sidebar-card">
              <WorkspaceSectionHeader title={card.title} compact />
              <div className="shared-job-shell__sidebar-body">{card.body}</div>
            </section>
          ))}
        </aside>
      </div>
      <div className="panel shared-job-shell__sticky-footer">
        <WorkspaceActionBar align="end">{footer}</WorkspaceActionBar>
      </div>
    </div>
  );
}
