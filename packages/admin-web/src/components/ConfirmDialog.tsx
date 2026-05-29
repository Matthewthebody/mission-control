type Props = {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
  onCancel
}: Props) {
  if (!open) {
    return null;
  }

  return (
    <div className="confirm-dialog-backdrop" role="presentation">
      <div className="confirm-dialog panel" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <div className="eyebrow">Confirmation</div>
        <h3 id="confirm-dialog-title" className="section-title">
          {title}
        </h3>
        <p className="section-subtitle">{body}</p>
        <div className="confirm-dialog__actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={tone === "danger" ? "danger-button" : "primary-button"} type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
