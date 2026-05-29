import { useEffect } from "react";
import type { ReactNode } from "react";

type Props = {
  open: boolean;
  ariaLabel: string;
  onClose: () => void;
  children: ReactNode;
  contentClassName?: string;
  overlayClassName?: string;
};

export function OverlayPanel({ open, ariaLabel, onClose, children, contentClassName = "", overlayClassName = "" }: Props) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className={`drawer-overlay${overlayClassName ? ` ${overlayClassName}` : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={onClose}
    >
      <div
        className={`drawer-overlay__content workflow-overlay__content${contentClassName ? ` ${contentClassName}` : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="workflow-overlay__dismiss-bar">
          <button type="button" className="secondary-button workflow-overlay__dismiss" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
