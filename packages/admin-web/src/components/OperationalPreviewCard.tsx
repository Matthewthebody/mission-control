import type { ReactNode } from "react";

export type OperationalPreviewTone = "neutral" | "info" | "success" | "warning" | "critical";

export type OperationalPreviewChip = {
  label: string;
  tone?: OperationalPreviewTone;
};

type Props = {
  eyebrow?: string;
  title: string;
  summary?: ReactNode;
  owner?: string;
  statusLabel?: string;
  statusTone?: OperationalPreviewTone;
  meta?: OperationalPreviewChip[];
  flags?: OperationalPreviewChip[];
  nextAction?: string;
  selected?: boolean;
  density?: "default" | "compact";
  onClick?: () => void;
  actions?: Array<{
    label: string;
    onClick: () => void;
  }>;
};

export function OperationalPreviewCard({
  eyebrow,
  title,
  summary,
  owner,
  statusLabel,
  statusTone = "neutral",
  meta = [],
  flags = [],
  nextAction,
  selected = false,
  density = "default",
  onClick,
  actions = []
}: Props) {
  const className = `ops-preview-card ops-preview-card--${density}${selected ? " ops-preview-card--selected" : ""}${onClick ? " ops-preview-card--interactive" : ""}`;
  const body = (
    <>
      <div className="ops-preview-card__header">
        <div>
          {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
          <strong className="ops-preview-card__title">{title}</strong>
        </div>
        {statusLabel ? <span className={`ops-preview-chip ops-preview-chip--${statusTone}`}>{statusLabel}</span> : null}
      </div>
      {summary ? <div className="ops-preview-card__summary">{summary}</div> : null}
      {owner ? <div className="ops-preview-card__owner">Owner: {owner}</div> : null}
      {meta.length ? (
        <div className="ops-preview-card__meta">
          {meta.map((item) => (
            <span key={`${item.label}-${item.tone ?? "neutral"}`} className={`ops-preview-chip ops-preview-chip--${item.tone ?? "neutral"}`}>
              {item.label}
            </span>
          ))}
        </div>
      ) : null}
      {flags.length ? (
        <div className="ops-preview-card__flags">
          {flags.map((item) => (
            <span key={`${item.label}-${item.tone ?? "neutral"}`} className={`ops-preview-flag ops-preview-flag--${item.tone ?? "neutral"}`}>
              {item.label}
            </span>
          ))}
        </div>
      ) : null}
      {nextAction ? (
        <div className="ops-preview-card__next">
          <span className="muted">Next</span>
          <strong>{nextAction}</strong>
        </div>
      ) : null}
    </>
  );

  if (onClick || actions.length) {
    return (
      <article className={className}>
        {onClick ? (
          <button type="button" className="ops-preview-card__surface" onClick={onClick}>
            {body}
          </button>
        ) : (
          body
        )}
        {actions.length ? (
          <div className="ops-preview-card__actions">
            {actions.map((action) => (
              <button key={action.label} type="button" className="ops-preview-card__action" onClick={action.onClick}>
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </article>
    );
  }

  return <article className={className}>{body}</article>;
}
