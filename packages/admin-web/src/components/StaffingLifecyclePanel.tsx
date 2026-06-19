import type { StaffingPlanLifecycleView } from "../types";
import {
  acknowledgmentSummaryLabel,
  coverageSummaryLabel,
  draftComparisonLabel,
  notificationStatusLabel,
  operationalReadinessLabel,
  publishedVersionLabel,
  recipientCarryForwardLabel,
  recipientLeadLabel,
  recipientStatusLabel
} from "../pages/staffingLifecyclePresentation";

// Manager staffing-plan lifecycle panel for the Staff Assignment drawer. Thin renderer over the
// canonical read model + the pure presentation helpers — no data fetching, no notification claims.
export function StaffingLifecyclePanel({ lifecycle }: { lifecycle: StaffingPlanLifecycleView }) {
  return (
    <div className="staffing-lifecycle-panel" data-testid="staffing-lifecycle-panel">
      <div className="staffing-lifecycle-panel__summary">
        <div className="eyebrow">Staffing Plan</div>
        <strong data-testid="lifecycle-readiness">{operationalReadinessLabel(lifecycle)}</strong>
        <ul className="staffing-lifecycle-panel__facts">
          <li data-testid="lifecycle-coverage">{coverageSummaryLabel(lifecycle)}</li>
          <li data-testid="lifecycle-version">{publishedVersionLabel(lifecycle)}</li>
          <li data-testid="lifecycle-draft">{draftComparisonLabel(lifecycle)}</li>
          <li data-testid="lifecycle-ack">{acknowledgmentSummaryLabel(lifecycle)}</li>
        </ul>
        {lifecycle.republish_required ? (
          <div className="staffing-lifecycle-panel__republish" data-testid="lifecycle-republish">
            Draft Changes — Republish Required
          </div>
        ) : null}
        <div className="muted" data-testid="lifecycle-notification">
          {notificationStatusLabel(lifecycle)}
        </div>
      </div>
      {lifecycle.recipients.length ? (
        <ul className="staffing-lifecycle-panel__recipients">
          {lifecycle.recipients.map((recipient) => {
            const lead = recipientLeadLabel(recipient);
            const carry = recipientCarryForwardLabel(recipient);
            return (
              <li
                key={recipient.recipient_id ?? recipient.employee_user_id}
                className="staffing-lifecycle-panel__recipient"
                data-testid={`lifecycle-recipient-${recipient.employee_user_id}`}
              >
                <span className="staffing-lifecycle-panel__name">
                  {recipient.employee_name ?? "Assigned employee"}
                </span>
                <span className="staffing-lifecycle-panel__status">{recipientStatusLabel(recipient)}</span>
                {lead ? <span className="staffing-lifecycle-panel__lead">{lead}</span> : null}
                {recipient.decline_reason ? (
                  <span className="staffing-lifecycle-panel__reason">Reason: {recipient.decline_reason}</span>
                ) : null}
                {carry ? <span className="staffing-lifecycle-panel__carry muted">{carry}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="muted" data-testid="lifecycle-empty">
          No assigned staff yet.
        </div>
      )}
    </div>
  );
}
