import type { ReactNode } from "react";
import { HelpTooltip } from "../HelpTooltip";

export type WorkspaceHeaderMetaTone = "neutral" | "info" | "success" | "warning" | "critical";

export type WorkspaceHeaderMeta = {
  label: string;
  tone?: WorkspaceHeaderMetaTone;
};

type Props = {
  eyebrow?: string;
  title: string;
  summary?: ReactNode;
  /** When true and summary is a string, the summary is hidden behind a "?" help icon instead of shown as a paragraph. */
  summaryAsHelp?: boolean;
  meta?: WorkspaceHeaderMeta[];
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
};

export function WorkspacePageHeader({
  eyebrow,
  title,
  summary,
  summaryAsHelp = false,
  meta = [],
  actions = null,
  compact = false,
  className = ""
}: Props) {
  const summaryAsHelpText = summaryAsHelp && typeof summary === "string" ? summary : null;
  return (
    <section className={`panel workspace-page-header${compact ? " workspace-page-header--compact" : ""}${className ? ` ${className}` : ""}`}>
      <div className="workspace-page-header__main">
        <div className="workspace-page-header__copy">
          {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
          <div className="workspace-page-header__title-row">
            <h2>{title}</h2>
            {summaryAsHelpText ? <HelpTooltip text={summaryAsHelpText} label={`About ${title}`} /> : null}
          </div>
          {summary && !summaryAsHelpText ? <p>{summary}</p> : null}
        </div>
        {actions ? <div className="workspace-page-header__actions">{actions}</div> : null}
      </div>
      {meta.length ? (
        <div className="workspace-page-header__meta" aria-label="Workspace status">
          {meta.map((item) => (
            <span
              key={`${item.label}-${item.tone ?? "neutral"}`}
              className={`workspace-page-header__meta-pill workspace-page-header__meta-pill--${item.tone ?? "neutral"}`}
            >
              {item.label}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
