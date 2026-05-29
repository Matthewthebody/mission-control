import type { ReactNode } from "react";

type Props = {
  eyebrow?: string;
  title: string;
  summary?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
};

export function WorkspaceSectionHeader({
  eyebrow,
  title,
  summary,
  badge = null,
  actions = null,
  compact = false,
  className = ""
}: Props) {
  return (
    <div className={`workspace-section-header${compact ? " workspace-section-header--compact" : ""}${className ? ` ${className}` : ""}`}>
      <div className="workspace-section-header__copy">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <div className="workspace-section-header__title-row">
          <h3>{title}</h3>
          {badge ? <div className="workspace-section-header__badge">{badge}</div> : null}
        </div>
        {summary ? <p>{summary}</p> : null}
      </div>
      {actions ? <div className="workspace-section-header__actions">{actions}</div> : null}
    </div>
  );
}
