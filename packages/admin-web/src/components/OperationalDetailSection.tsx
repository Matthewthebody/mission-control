import { useEffect, useState } from "react";
import type { ReactNode } from "react";

type Props = {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  badge?: string | null;
  compact?: boolean;
  actions?: ReactNode;
  children: ReactNode;
};

export function OperationalDetailSection({
  title,
  summary,
  defaultOpen = false,
  badge = null,
  compact = false,
  actions = null,
  children
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  return (
    <details
      className={`ops-detail-section${compact ? " ops-detail-section--compact" : ""}`}
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary className="ops-detail-section__summary">
        <div className="ops-detail-section__copy">
          <strong>{title}</strong>
          {summary ? <div className="muted">{summary}</div> : null}
        </div>
        <div className="ops-detail-section__controls">
          {badge ? <span className="meta-pill">{badge}</span> : null}
          {actions}
          <span className="meta-pill">{open ? "Hide" : "Show"}</span>
        </div>
      </summary>
      <div className="ops-detail-section__body">{children}</div>
    </details>
  );
}
