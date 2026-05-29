import type { ReactNode } from "react";

type Props = {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
};

export function ProductionProjectDrawer({ open, title, subtitle, onClose, children }: Props) {
  if (!open) {
    return null;
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-overlay__content request-card drawer-shell" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <p className="eyebrow">Production</p>
            <h3>{title}</h3>
            {subtitle ? <p className="muted">{subtitle}</p> : null}
          </div>
          <button type="button" className="secondary-button drawer-close" onClick={onClose} aria-label={`Close ${title}`}>
            Close
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
