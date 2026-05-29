import type { ReactNode } from "react";

type Props = {
  title: string;
  summary?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
};

export function WorkspaceEmptyState({ title, summary = null, actions = null, compact = false, className = "" }: Props) {
  return (
    <div className={`empty-state empty-state--panel workspace-empty-state${compact ? " workspace-empty-state--compact" : ""}${className ? ` ${className}` : ""}`}>
      <div className="workspace-empty-state__copy">
        <strong>{title}</strong>
        {summary ? <p>{summary}</p> : null}
      </div>
      {actions ? <div className="workspace-empty-state__actions">{actions}</div> : null}
    </div>
  );
}
