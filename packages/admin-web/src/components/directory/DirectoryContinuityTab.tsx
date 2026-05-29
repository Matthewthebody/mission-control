import type {
  DirectoryRelationshipContinuityBundle,
  DirectoryRelationshipFollowUpRecord,
  DirectoryRelationshipMemoryRecord,
  DirectoryTouchpointPlan,
  OrganizationContact
} from "../../types";
import type { DirectoryView } from "./directoryOptions";
import {
  formatDateLabel,
  formatDateTimeLabel,
  labelForCommunicationOutcome,
  labelForRelationshipFollowUpStatus,
  labelForRelationshipHealthState,
  labelForRelationshipMemoryStatus,
  labelForRelationshipMemoryType,
  labelForRelationshipMemoryVisibility,
  labelForTouchpointCategory,
  labelForTouchpointChannel,
  labelForTouchpointPlanStatus,
  summarizeText
} from "./directoryOptions";

type Props = {
  view: DirectoryView;
  selectedContact: OrganizationContact | null;
  continuity: DirectoryRelationshipContinuityBundle | null;
  continuityLoading: boolean;
  continuityError: string;
  canManage: boolean;
  onLogCommunication: () => void;
  onCreateTouchpointPlan: () => void;
  onCreateFollowUp: () => void;
  onCreateMemory: () => void;
  onUpdateTouchpointPlan: (
    plan: DirectoryTouchpointPlan,
    input: { status?: "planned" | "completed" | "skipped" | "cancelled"; completion_note?: string | null; skipped_reason?: string | null; cancelled_reason?: string | null }
  ) => void;
  onUpdateFollowUp: (
    followUp: DirectoryRelationshipFollowUpRecord,
    input: { status?: "open" | "in_progress" | "completed" | "cancelled"; resolution_note?: string | null }
  ) => void;
  onUpdateMemory: (
    memory: DirectoryRelationshipMemoryRecord,
    input: { status?: "active" | "needs_review" | "archived"; last_confirmed_at?: string | null }
  ) => void;
};

export function DirectoryContinuityTab({
  view,
  selectedContact,
  continuity,
  continuityLoading,
  continuityError,
  canManage,
  onLogCommunication,
  onCreateTouchpointPlan,
  onCreateFollowUp,
  onCreateMemory,
  onUpdateTouchpointPlan,
  onUpdateFollowUp,
  onUpdateMemory
}: Props) {
  if (continuityLoading) {
    return <section className="request-card empty-state empty-state--panel">Loading relationship continuity...</section>;
  }

  if (continuityError) {
    return <section className="request-card empty-state empty-state--panel">{continuityError}</section>;
  }

  if (!continuity) {
    return <section className="request-card empty-state empty-state--panel">No relationship continuity is available yet.</section>;
  }

  const scopeLabel =
    view === "contacts" && selectedContact
      ? `Focused contact: ${selectedContact.full_name}`
      : continuity.scope === "contact"
        ? "Contact continuity"
        : "Account continuity";

  const openFollowUps = continuity.follow_ups.filter((followUp) => followUp.status !== "completed" && followUp.status !== "cancelled");
  const activePlans = continuity.touchpoint_plans.filter((plan) => plan.status !== "completed" && plan.status !== "cancelled" && plan.status !== "skipped");
  const activeMemory = continuity.relationship_memory.filter((entry) => entry.status !== "archived");

  return (
    <section className="directory-section-stack">
      <article className="request-card">
        <div className="directory-card__header">
          <div>
            <strong>Relationship Continuity</strong>
            <div className="muted">
              Keep planned touchpoints, communication history, reusable memory, and owed next steps in one operational surface.
            </div>
          </div>
          {canManage ? (
            <div className="page-intro-actions page-intro-actions--compact">
              <button type="button" onClick={onLogCommunication}>
                Log communication
              </button>
              <button type="button" className="secondary-button" onClick={onCreateTouchpointPlan}>
                Plan touchpoint
              </button>
              <button type="button" className="secondary-button" onClick={onCreateFollowUp}>
                Add follow-up
              </button>
              <button type="button" className="secondary-button" onClick={onCreateMemory}>
                Add memory
              </button>
            </div>
          ) : null}
        </div>
        <p className="muted">{scopeLabel}</p>
        <div className="metrics-grid metrics-grid--compact">
          <article className="metric-card">
            <div className="metric-card__label">Relationship Health</div>
            <strong className="metric-card__value">{labelForRelationshipHealthState(continuity.summary.relationship_health_state)}</strong>
            <div className="muted">{continuity.summary.relationship_health_summary}</div>
          </article>
          <article className="metric-card">
            <div className="metric-card__label">Next Touchpoint</div>
            <strong className="metric-card__value">{continuity.summary.next_touchpoint_due_at ? formatDateLabel(continuity.summary.next_touchpoint_due_at) : "None planned"}</strong>
            <div className="muted">{continuity.summary.next_touchpoint_label}</div>
          </article>
          <article className="metric-card">
            <div className="metric-card__label">Open Follow-Ups</div>
            <strong className="metric-card__value">{continuity.summary.open_follow_up_count}</strong>
            <div className="muted">
              {continuity.summary.overdue_follow_up_count > 0
                ? `${continuity.summary.overdue_follow_up_count} overdue`
                : "No overdue follow-ups"}
            </div>
          </article>
          <article className="metric-card">
            <div className="metric-card__label">Memory Review</div>
            <strong className="metric-card__value">{continuity.summary.active_memory_count}</strong>
            <div className="muted">
              {continuity.summary.needs_review_memory_count > 0
                ? `${continuity.summary.needs_review_memory_count} need review`
                : "Reviewed memory is current"}
            </div>
          </article>
        </div>
      </article>

      <div className="detail-grid">
        <article className="request-card">
          <div className="directory-card__header">
            <div>
              <strong>Touchpoint Timeline</strong>
              <div className="muted">Planned relationship moments should become completed, skipped with reason, or visibly overdue.</div>
            </div>
          </div>
          <div className="directory-section-stack">
            {activePlans.slice(0, 6).map((plan) => (
              <article key={plan.id} className="request-card directory-entity-card">
                <div className="directory-card__header">
                  <div>
                    <strong>{plan.title}</strong>
                    <div className="muted">
                      {labelForTouchpointCategory(plan.category)} • {formatDateTimeLabel(plan.due_at)}
                    </div>
                  </div>
                  <div className="directory-chip-row">
                    <span className="meta-pill">{labelForTouchpointPlanStatus(plan.status)}</span>
                    {plan.owner_name ? <span className="meta-pill">{plan.owner_name}</span> : null}
                  </div>
                </div>
                <p>{summarizeText(plan.summary, "No planning note added yet.")}</p>
                {plan.backup_owner?.full_name ? <p className="muted">Backup owner: {plan.backup_owner.full_name}</p> : null}
                {canManage ? (
                  <div className="request-card__actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => onUpdateTouchpointPlan(plan, { status: "completed" })}
                    >
                      Mark complete
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        const reason = window.prompt("Why was this touchpoint skipped?");
                        if (!reason?.trim()) return;
                        onUpdateTouchpointPlan(plan, { status: "skipped", skipped_reason: reason.trim() });
                      }}
                    >
                      Skip with reason
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
            {!activePlans.length ? <div className="empty-state empty-state--panel">No planned touchpoints are open right now.</div> : null}
          </div>
        </article>

        <article className="request-card">
          <div className="directory-card__header">
            <div>
              <strong>Next Steps</strong>
              <div className="muted">Promises and customer asks should stay visible until they are actually handled.</div>
            </div>
          </div>
          <div className="directory-section-stack">
            {openFollowUps.slice(0, 6).map((followUp) => (
              <article key={followUp.id} className="request-card directory-entity-card">
                <div className="directory-card__header">
                  <div>
                    <strong>{followUp.title}</strong>
                    <div className="muted">{formatDateTimeLabel(followUp.due_at)}</div>
                  </div>
                  <div className="directory-chip-row">
                    <span className="meta-pill">{labelForRelationshipFollowUpStatus(followUp.status)}</span>
                    {followUp.owner?.full_name ? <span className="meta-pill">{followUp.owner.full_name}</span> : null}
                  </div>
                </div>
                <p>{summarizeText(followUp.summary, "No follow-up summary logged yet.")}</p>
                {followUp.backup_owner?.full_name ? <p className="muted">Backup owner: {followUp.backup_owner.full_name}</p> : null}
                {canManage ? (
                  <div className="request-card__actions">
                    {followUp.status === "open" || followUp.status === "overdue" ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => onUpdateFollowUp(followUp, { status: "in_progress" })}
                      >
                        Start work
                      </button>
                    ) : null}
                    {followUp.status !== "completed" && followUp.status !== "cancelled" ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          const resolution = window.prompt("Resolution note (optional)") ?? null;
                          onUpdateFollowUp(followUp, { status: "completed", resolution_note: resolution?.trim() || null });
                        }}
                      >
                        Mark complete
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
            {!openFollowUps.length ? <div className="empty-state empty-state--panel">No open follow-ups are owed right now.</div> : null}
          </div>
        </article>
      </div>

      <div className="detail-grid">
        <article className="request-card">
          <div className="directory-card__header">
            <div>
              <strong>Communication History</strong>
              <div className="muted">Keep a short record of meaningful conversations, confirmations, and issue handling.</div>
            </div>
          </div>
          <div className="directory-section-stack">
            {continuity.communication_logs.slice(0, 8).map((entry) => (
              <article key={entry.id} className="request-card directory-entity-card">
                <div className="directory-card__header">
                  <div>
                    <strong>{entry.subject || labelForTouchpointChannel(entry.channel)}</strong>
                    <div className="muted">
                      {formatDateTimeLabel(entry.occurred_at)}
                      {entry.category ? ` • ${labelForTouchpointCategory(entry.category)}` : ""}
                    </div>
                  </div>
                  <div className="directory-chip-row">
                    {entry.outcome_state ? <span className="meta-pill">{labelForCommunicationOutcome(entry.outcome_state)}</span> : null}
                    {entry.owner_name ? <span className="meta-pill">{entry.owner_name}</span> : null}
                  </div>
                </div>
                <p>{entry.summary}</p>
                {entry.outcome ? <p className="muted">Outcome: {entry.outcome}</p> : null}
                {entry.follow_up_date ? <p className="muted">Follow-up due {formatDateLabel(entry.follow_up_date)}</p> : null}
                {entry.relationship_memory_suggested ? <p className="muted">Reusable memory suggestion captured from this communication.</p> : null}
              </article>
            ))}
            {!continuity.communication_logs.length ? <div className="empty-state empty-state--panel">No communication history has been logged yet.</div> : null}
          </div>
        </article>

        <article className="request-card">
          <div className="directory-card__header">
            <div>
              <strong>Relationship Memory</strong>
              <div className="muted">Store reusable preferences and operational context, not one-off drama or raw note history.</div>
            </div>
          </div>
          <div className="directory-section-stack">
            {activeMemory.slice(0, 8).map((entry) => (
              <article key={entry.id} className="request-card directory-entity-card">
                <div className="directory-card__header">
                  <div>
                    <strong>{entry.summary}</strong>
                    <div className="muted">
                      {labelForRelationshipMemoryType(entry.memory_type)} • {labelForRelationshipMemoryVisibility(entry.visibility)}
                    </div>
                  </div>
                  <div className="directory-chip-row">
                    <span className="meta-pill">{labelForRelationshipMemoryStatus(entry.status)}</span>
                    {entry.last_confirmed_at ? <span className="meta-pill">Confirmed {formatDateLabel(entry.last_confirmed_at)}</span> : null}
                  </div>
                </div>
                <p>{entry.why_it_matters}</p>
                {entry.source_label ? <p className="muted">Source: {entry.source_label}</p> : null}
                {canManage ? (
                  <div className="request-card__actions">
                    {entry.status !== "active" ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => onUpdateMemory(entry, { status: "active", last_confirmed_at: entry.last_confirmed_at ?? new Date().toISOString().slice(0, 10) })}
                      >
                        Mark active
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => onUpdateMemory(entry, { status: "needs_review" })}
                      >
                        Needs review
                      </button>
                    )}
                    {entry.status !== "archived" ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => onUpdateMemory(entry, { status: "archived" })}
                      >
                        Archive
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
            {!activeMemory.length ? <div className="empty-state empty-state--panel">No reusable relationship memory is active yet.</div> : null}
          </div>
        </article>
      </div>
    </section>
  );
}
