import type { ReactNode } from "react";

export type WorkspaceHeaderMetaTone = "neutral" | "info" | "success" | "warning" | "critical";

export type WorkspaceHeaderMeta = {
  label: string;
  tone?: WorkspaceHeaderMetaTone;
};

type Props = {
  eyebrow?: string;
  title: string;
  summary?: ReactNode;
  meta?: WorkspaceHeaderMeta[];
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
};

export function WorkspacePageHeader({
  eyebrow,
  title,
  summary,
  meta = [],
  actions = null,
  compact = false,
  className = ""
}: Props) {
  return (
    <section className={`panel workspace-page-header${compact ? " workspace-page-header--compact" : ""}${className ? ` ${className}` : ""}`}>
      <div className="workspace-page-header__main">
        <div className="workspace-page-header__copy">
          {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
          <h2>{title}</h2>
          {summary ? <p>{summary}</p> : null}
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
