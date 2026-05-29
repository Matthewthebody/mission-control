import { OperationalDetailSection } from "../OperationalDetailSection";
import { OperationalPreviewCard } from "../OperationalPreviewCard";
import type { OrganizationOperationsHub } from "../../types";

type Props = {
  operationsHub: OrganizationOperationsHub | null;
  canManage: boolean;
  onLogTouchpoint: () => void;
  onCreateContact: () => void;
  onLinkExistingContact: () => void;
};

export function DirectoryOperationsTab({
  operationsHub,
  canManage,
  onLogTouchpoint,
  onCreateContact,
  onLinkExistingContact
}: Props) {
  if (!operationsHub) {
    return <div className="empty-state empty-state--panel">No operations summary is available for this organization yet.</div>;
  }

  const healthTone =
    operationsHub.summary.relationship_health_state === "at_risk"
      ? "critical"
      : operationsHub.summary.relationship_health_state === "watch"
        ? "warning"
        : "success";

  return (
    <div className="directory-section-stack">
      <section className="request-card">
        <div className="directory-card__header">
          <div>
            <strong>Relationship Health</strong>
            <div className="muted">{operationsHub.summary.relationship_health_summary}</div>
          </div>
          {canManage ? (
            <div className="page-intro-actions page-intro-actions--compact">
              <button type="button" onClick={onLogTouchpoint}>
                Log communication
              </button>
              <button type="button" className="secondary-button" onClick={onCreateContact}>
                New contact
              </button>
              <button type="button" className="secondary-button" onClick={onLinkExistingContact}>
                Link existing contact
              </button>
            </div>
          ) : null}
        </div>

        <div className="metrics-grid metrics-grid--compact">
          <article className="metric-card">
            <div className="metric-card__label">Health State</div>
            <strong className="metric-card__value">{operationsHub.summary.relationship_health_state.replace(/_/g, " ")}</strong>
            <div className={`ops-preview-chip ops-preview-chip--${healthTone}`}>{operationsHub.summary.next_action}</div>
          </article>
          <article className="metric-card">
            <div className="metric-card__label">Last Touch</div>
            <strong className="metric-card__value">{operationsHub.summary.last_touch_label}</strong>
            <div className="muted">{operationsHub.summary.owner_label}</div>
          </article>
          <article className="metric-card">
            <div className="metric-card__label">Follow-Up</div>
            <strong className="metric-card__value">{operationsHub.summary.follow_up_label}</strong>
            <div className="muted">{operationsHub.summary.follow_up_date ? "Tracked in continuity" : "No follow-up scheduled"}</div>
          </article>
        </div>

        <div className="directory-chip-row">
          {operationsHub.health_cues.map((cue) => (
            <span key={cue.code} className={`ops-preview-chip ops-preview-chip--${cue.tone === "good" ? "success" : cue.tone}`}>
              {cue.label}
            </span>
          ))}
        </div>
      </section>

      <OperationalDetailSection
        title={`Contact Cleanup (${operationsHub.queues.contact_cleanup.count})`}
        summary="Resolve primary-owner gaps, incomplete contact data, and duplicate cleanup work."
        defaultOpen={operationsHub.queues.contact_cleanup.count > 0}
      >
        <OperationsQueueList items={operationsHub.queues.contact_cleanup.items} />
      </OperationalDetailSection>

      <OperationalDetailSection
        title={`Follow-Up (${operationsHub.queues.follow_up.count})`}
        summary="Keep outreach and next-step ownership explicit instead of buried in notes."
        defaultOpen={operationsHub.queues.follow_up.count > 0}
      >
        <OperationsQueueList items={operationsHub.queues.follow_up.items} />
      </OperationalDetailSection>

      <OperationalDetailSection
        title={`Linked Production (${operationsHub.queues.projects.count})`}
        summary="Keep production follow-up visible from the account context instead of forcing operators to hunt in a separate workspace."
        defaultOpen={operationsHub.queues.projects.count > 0}
      >
        <OperationsQueueList items={operationsHub.queues.projects.items} />
      </OperationalDetailSection>

      <OperationalDetailSection
        title={`Timeline (${operationsHub.timeline.length})`}
        summary="Best-effort account activity across touchpoints, shoots, duplicate review, issues, and reminders."
      >
        <div className="directory-section-stack">
          {operationsHub.timeline.map((item) => (
            <article
              key={item.id}
              className={`request-card${item.action_hash ? " request-card--interactive" : ""}`}
              onClick={() => {
                if (item.action_hash) {
                  window.location.hash = item.action_hash;
                }
              }}
            >
              <div className="directory-card__header">
                <div>
                  <strong>{item.title}</strong>
                  <div className="muted">
                    {new Date(item.occurred_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </div>
                </div>
                <div className="directory-chip-row">
                  <span className={`ops-preview-chip ops-preview-chip--${item.tone === "good" ? "success" : item.tone}`}>{item.kind.replace(/_/g, " ")}</span>
                  {item.due_label ? <span className="meta-pill">{item.due_label}</span> : null}
                </div>
              </div>
              <p>{item.summary}</p>
              <p className="muted">Owner: {item.owner_label}</p>
            </article>
          ))}
          {!operationsHub.timeline.length ? <div className="empty-state empty-state--panel">No timeline activity has been captured yet.</div> : null}
        </div>
      </OperationalDetailSection>
    </div>
  );
}

function OperationsQueueList({ items }: { items: OrganizationOperationsHub["queues"]["contact_cleanup"]["items"] }) {
  if (!items.length) {
    return <div className="empty-state empty-state--panel">Nothing is open in this queue right now.</div>;
  }

  return (
    <div className="ops-preview-list">
      {items.map((item) => (
        <OperationalPreviewCard
          key={item.id}
          title={item.title}
          summary={item.summary}
          owner={item.owner_label}
          statusLabel={item.tone.replace(/_/g, " ")}
          statusTone={item.tone === "good" ? "success" : item.tone}
          meta={item.due_label ? [{ label: item.due_label, tone: "info" }] : []}
          nextAction={item.next_action}
          onClick={() => {
            window.location.hash = item.action_hash;
          }}
        />
      ))}
    </div>
  );
}
