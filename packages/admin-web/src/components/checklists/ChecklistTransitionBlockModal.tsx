import type { ChecklistTransitionValidation } from "../../checklistTypes";
import { humanizeToken } from "../sports/SportsPrimitives";

type Props = {
  open: boolean;
  validation: ChecklistTransitionValidation | null;
  canOverride: boolean;
  overrideReason: string;
  busy?: boolean;
  onOverrideReasonChange: (value: string) => void;
  onClose: () => void;
  onConfirmOverride: () => void;
};

export function ChecklistTransitionBlockModal({
  open,
  validation,
  canOverride,
  overrideReason,
  busy = false,
  onOverrideReasonChange,
  onClose,
  onConfirmOverride
}: Props) {
  if (!open || !validation) {
    return null;
  }

  const hardBlocked = validation.hard_blocked;

  return (
    <div className="confirm-dialog-backdrop" role="presentation">
      <div className="confirm-dialog panel checklist-block-modal" role="dialog" aria-modal="true" aria-labelledby="checklist-block-title">
        <div className="eyebrow">Checklist Block</div>
        <h3 id="checklist-block-title" className="section-title">
          {hardBlocked ? "This step is blocked" : "Checklist override required"}
        </h3>
        <p className="section-subtitle">
          {hardBlocked
            ? "Required checklist work is still incomplete, so this transition cannot move forward yet."
            : "This transition is behind a soft checklist block. Review the missing work and add an override reason if you need to proceed."}
        </p>

        <div className="checklist-block-modal__issues">
          {validation.issues.map((issue, index) => (
            <article key={`${issue.template_code}-${index}`} className="checklist-block-modal__issue">
              <strong>{issue.template_name}</strong>
              <p>{issue.message}</p>
              <div className="checklist-block-modal__issue-meta">
                <span>Required status: {humanizeToken(issue.required_status)}</span>
                <span>Current status: {issue.current_status ? humanizeToken(issue.current_status) : "Not started"}</span>
                <span>{issue.progress_percent}% complete</span>
              </div>
              {issue.missing_item_labels.length ? (
                <div className="checklist-block-modal__issue-list">
                  <strong>Missing responses</strong>
                  <ul>
                    {issue.missing_item_labels.map((label) => (
                      <li key={label}>{label}</li>
                    ))}
                  </ul>
                </div>
              ) : issue.missing_item_ids.length ? (
                <div className="checklist-block-modal__issue-list">{issue.missing_item_ids.length} required response(s) still missing.</div>
              ) : null}
              {issue.missing_proof_item_labels.length ? (
                <div className="checklist-block-modal__issue-list">
                  <strong>Missing proof</strong>
                  <ul>
                    {issue.missing_proof_item_labels.map((label) => (
                      <li key={label}>{label}</li>
                    ))}
                  </ul>
                </div>
              ) : issue.missing_proof_item_ids.length ? (
                <div className="checklist-block-modal__issue-list">{issue.missing_proof_item_ids.length} proof upload(s) still missing.</div>
              ) : null}
              {issue.missing_approval ? <div className="checklist-block-modal__issue-list">Manager approval is still required.</div> : null}
            </article>
          ))}
        </div>

        {!hardBlocked && canOverride ? (
          <label className="filter-field filter-field--wide">
            <span>Override reason</span>
            <textarea rows={3} value={overrideReason} onChange={(event) => onOverrideReasonChange(event.target.value)} />
          </label>
        ) : null}

        <div className="confirm-dialog__actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Close
          </button>
          {!hardBlocked && canOverride ? (
            <button className="primary-button" type="button" onClick={onConfirmOverride} disabled={busy || !overrideReason.trim()}>
              {busy ? "Overriding..." : "Continue with Override"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
