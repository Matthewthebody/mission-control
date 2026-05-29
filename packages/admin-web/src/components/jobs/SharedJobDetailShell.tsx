import type { ReactNode } from "react";
import { WorkspacePageHeader, type WorkspaceHeaderMeta } from "../workspace/WorkspacePageHeader";
import { WorkspaceActionBar } from "../workspace/WorkspaceActionBar";
import { WorkspaceSectionHeader } from "../workspace/WorkspaceSectionHeader";

type TabDefinition = {
  key: string;
  label: string;
};

type SummaryCard = {
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
  tabs: TabDefinition[];
  activeTab: string;
  onSelectTab: (key: string) => void;
  summaryCards?: SummaryCard[];
  bodyIntro?: ReactNode;
  body: ReactNode;
};

export function SharedJobDetailShell({
  eyebrow,
  title,
  summary,
  meta = [],
  actions = null,
  tabs,
  activeTab,
  onSelectTab,
  summaryCards = [],
  bodyIntro = null,
  body
}: Props) {
  return (
    <div className="shared-job-shell shared-job-shell--detail">
      <WorkspacePageHeader eyebrow={eyebrow} title={title} summary={summary} meta={meta} actions={actions} />
      <div className="panel shared-job-shell__tab-bar">
        <WorkspaceActionBar align="start" compact>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`secondary-button${activeTab === tab.key ? " is-active" : ""}`}
              onClick={() => onSelectTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </WorkspaceActionBar>
      </div>
      {activeTab === "summary" && summaryCards.length ? (
        <div className="shared-job-detail__card-grid">
          {summaryCards.map((card) => (
            <section key={card.key} className="panel shared-job-detail__mini-card">
              <WorkspaceSectionHeader title={card.title} compact />
              <div className="shared-job-detail__mini-body">{card.body}</div>
            </section>
          ))}
        </div>
      ) : null}
      <section className="panel shared-job-shell__surface">
        {bodyIntro}
        {body}
      </section>
    </div>
  );
}
