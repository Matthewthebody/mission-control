import { useState } from "react";
import type { StaffingPlanLifecycleView } from "../types";
import { resendStaffingReminder } from "../services/scheduleStaffing";
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

function formatClock(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

type ReminderCell = { busy?: boolean; message?: string; error?: string };

// Manager staffing-plan lifecycle panel for the Staff Assignment drawer. Thin renderer over the canonical
// read model + pure presentation helpers. The only action it owns is the cooldown-guarded Resend Reminder for
// a current pending recipient — shown only when the viewer can manage staffing.
export function StaffingLifecyclePanel({
  lifecycle,
  token,
  shootId,
  canManage
}: {
  lifecycle: StaffingPlanLifecycleView;
  token?: string;
  shootId?: string;
  canManage?: boolean;
}) {
  const [reminders, setReminders] = useState<Record<string, ReminderCell>>({});
  const canRemind = Boolean(canManage && token && shootId);

  async function resend(recipientId: string) {
    if (!token || !shootId) return;
    setReminders((prev) => ({ ...prev, [recipientId]: { busy: true } }));
    try {
      const result = await resendStaffingReminder(token, shootId, recipientId);
      const nextLabel = formatClock(result.next_reminder_allowed_at);
      setReminders((prev) => ({
        ...prev,
        [recipientId]: {
          message:
            result.status === "queued"
              ? `Reminder queued · next available ${nextLabel}`
              : `On cooldown · next available ${nextLabel}`
        }
      }));
    } catch (error) {
      setReminders((prev) => ({
        ...prev,
        [recipientId]: { error: error instanceof Error ? error.message : "Couldn't send the reminder." }
      }));
    }
  }

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
                {canRemind && recipient.response_status === "pending" && recipient.recipient_id ? (
                  <div className="staffing-lifecycle-panel__reminder">
                    <button
                      type="button"
                      className="secondary-button staffing-lifecycle-panel__remind"
                      data-testid={`remind-${recipient.employee_user_id}`}
                      disabled={reminders[recipient.recipient_id]?.busy}
                      onClick={() => resend(recipient.recipient_id as string)}
                    >
                      {reminders[recipient.recipient_id]?.busy ? "Sending…" : "Resend Reminder"}
                    </button>
                    {recipient.last_reminder_at ? (
                      <span className="muted">
                        Last reminded {formatClock(recipient.last_reminder_at)}
                        {recipient.next_reminder_allowed_at
                          ? ` · next available ${formatClock(recipient.next_reminder_allowed_at)}`
                          : ""}
                      </span>
                    ) : null}
                    {reminders[recipient.recipient_id]?.message ? (
                      <span className="muted" role="status">
                        {reminders[recipient.recipient_id]?.message}
                      </span>
                    ) : null}
                    {reminders[recipient.recipient_id]?.error ? (
                      <span className="staffing-lifecycle-panel__reminder-error" role="alert">
                        {reminders[recipient.recipient_id]?.error}
                      </span>
                    ) : null}
                  </div>
                ) : null}
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
