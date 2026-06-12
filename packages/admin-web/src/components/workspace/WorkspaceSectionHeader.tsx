import type { ReactNode } from "react";
import { HelpTooltip } from "../HelpTooltip";

type Props = {
  eyebrow?: string;
  title: string;
  summary?: ReactNode;
  /** When true and summary is a string, the summary is hidden behind a "?" help icon instead of shown as a paragraph. */
  summaryAsHelp?: boolean;
  badge?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
};

export function WorkspaceSectionHeader({
  eyebrow,
  title,
  summary,
  summaryAsHelp = false,
  badge = null,
  actions = null,
  compact = false,
  className = ""
}: Props) {
  const summaryAsHelpText = summaryAsHelp && typeof summary === "string" ? summary : null;
  return (
    <div className={`workspace-section-header${compact ? " workspace-section-header--compact" : ""}${className ? ` ${className}` : ""}`}>
      <div className="workspace-section-header__copy">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <div className="workspace-section-header__title-row">
          <h3>{title}</h3>
          {summaryAsHelpText ? <HelpTooltip text={summaryAsHelpText} label={`About ${title}`} /> : null}
          {badge ? <div className="workspace-section-header__badge">{badge}</div> : null}
        </div>
        {summary && !summaryAsHelpText ? <p>{summary}</p> : null}
      </div>
      {actions ? <div className="workspace-section-header__actions">{actions}</div> : null}
    </div>
  );
}
