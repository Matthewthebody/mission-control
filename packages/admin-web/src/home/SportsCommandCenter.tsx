import type { SessionUser } from "../types";
import {
  getWorkflowChangeNoticesForSurface,
  isWorkflowChangeNoticeAcknowledged,
  WorkflowChangeNoticePanel
} from "../workflowChangeNotices";
import { HomePill, HomeSectionHeader, navigateToHash, RelatedJobLink } from "./homeShared";
import {
  ASSOCIATION_HEALTH,
  buildRebookingSummary,
  buildSportsPulse,
  CURRENT_SEASON_WORK,
  PRODUCTION_SIGNALS,
  REBOOKING_GROUPS,
  REBOOKING_STATUS_LABELS,
  REBOOKING_STATUS_TONES,
  SPECIALTY_PRODUCTS,
  SPECIALTY_STATUS_LABELS,
  SPECIALTY_STATUS_TONES,
  STAFFING_SIGNALS,
  type SportsPulseCard
} from "./sportsDemoData";

function PulseCard({ card }: { card: SportsPulseCard }) {
  return (
    <button
      type="button"
      className={`home-command-card home-command-card--${card.tone}`}
      onClick={() => navigateToHash(card.drilldownHash)}
    >
      <span className="home-command-card__label">{card.label}</span>
      <strong className="home-command-card__value">{card.value}</strong>
      <span className="home-command-card__helper">{card.helper}</span>
      <span className="home-command-card__drill">
        {card.drilldownLabel}
        <span aria-hidden="true"> →</span>
      </span>
    </button>
  );
}

export function SportsCommandCenter({ currentUser }: { currentUser: SessionUser }) {
  const sportsNotices = getWorkflowChangeNoticesForSurface({ surface: "sports", currentUser, includeAllAudience: true });
  const requiresAck = sportsNotices.filter((notice) => notice.requiresAcknowledgement);
  const informationalChanges = sportsNotices.filter((notice) => !notice.requiresAcknowledgement);
  const unacknowledged = requiresAck.filter((notice) => !isWorkflowChangeNoticeAcknowledged(notice.id)).length;

  const pulse = buildSportsPulse(unacknowledged);
  const rebooking = buildRebookingSummary();
  const specialtyForJosh = SPECIALTY_PRODUCTS.filter(
    (product) => product.status !== "complete" && product.status !== "ready_to_fulfill"
  );

  return (
    <>
      <section className="panel home-command__toprow" aria-label="Sports pulse">
        <HomeSectionHeader
          title="Sports Pulse"
          help="Is sports okay today? Exception-driven, not vanity metrics. Every card is a drilldown."
        />
        <div className="home-command__cards">
          {pulse.map((card) => (
            <PulseCard key={card.id} card={card} />
          ))}
        </div>
      </section>

      {/* The most important workflow: changes that must be acknowledged, reusing the
          real change-acknowledgement engine (per-notice acknowledge + diff). */}
      {requiresAck.length > 0 ? (
        <WorkflowChangeNoticePanel
          notices={requiresAck}
          title="Changes Requiring Acknowledgement"
          summary="What changed, who is affected, and who still needs to acknowledge it — prioritized for shoots happening soon."
        />
      ) : (
        <section className="panel" aria-label="Changes requiring acknowledgement">
          <HomeSectionHeader title="Changes Requiring Acknowledgement" help="Time, location, roster, staffing, and gallery-deadline changes that need a crew or client to acknowledge." />
          <div className="home-empty">
            <strong>No changes waiting on acknowledgement.</strong>
            <p>Time, location, roster, staffing, and gallery-deadline changes that need a crew or client to acknowledge will appear here.</p>
          </div>
        </section>
      )}

      <div className="sports-cc-split">
        <section className="panel sports-cc-panel" aria-label="Current season">
          <HomeSectionHeader title="Current Season" help="The work being executed right now — today's operational fires, kept separate from next-season retention." />
          <ul className="sports-cc-list">
            {CURRENT_SEASON_WORK.map((item) => (
              <li key={item.id} className={`sports-cc-row sports-cc-row--${item.tone}`}>
                <div className="sports-cc-row__main">
                  <div className="sports-cc-row__head">
                    <strong>{item.association}</strong>
                    <span className="sports-cc-row__due">{item.when}</span>
                  </div>
                  <p className="sports-cc-row__sub">{item.signal}</p>
                </div>
                <div className="sports-cc-row__side">
                  <span className="sports-cc-row__owner">Owner: {item.owner}</span>
                  <span className="sports-cc-row__action">{item.nextAction}</span>
                  {item.relatedJobId ? <RelatedJobLink jobName={item.jobName} /> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel sports-cc-panel" aria-label="Building next season">
          <HomeSectionHeader title="Building Next Season" help="Rebooking and retention. A group is rebooked once the job is created and on the calendar with a date that works — a signed agreement is not required." />
          <div className="sports-cc-rebook-summary">
            <div className="sports-cc-rebook-metric">
              <strong>{rebooking.percent}%</strong>
              <span>Rebooked</span>
            </div>
            <div className="sports-cc-rebook-detail">
              <span>{rebooking.rebooked} of {rebooking.expectedReturning} expected returning groups</span>
              <span>{rebooking.needsFollowUp} need follow-up · {rebooking.atRisk} at risk</span>
            </div>
          </div>
          <ul className="sports-cc-list">
            {REBOOKING_GROUPS.filter((group) => group.status !== "rebooked")
              .slice(0, 5)
              .map((group) => (
                <li key={group.id} className={`sports-cc-row sports-cc-row--${REBOOKING_STATUS_TONES[group.status]}`}>
                  <div className="sports-cc-row__main">
                    <div className="sports-cc-row__head">
                      <strong>{group.association}</strong>
                      <HomePill tone={REBOOKING_STATUS_TONES[group.status]}>{REBOOKING_STATUS_LABELS[group.status]}</HomePill>
                    </div>
                    <p className="sports-cc-row__sub">
                      {group.program ? `${group.program} · ` : ""}
                      {group.nextAction}
                    </p>
                  </div>
                  <div className="sports-cc-row__side">
                    <span className="sports-cc-row__owner">Owner: {group.owner}</span>
                    {group.dueAt ? <span className="sports-cc-row__action">{group.dueAt}</span> : null}
                    <button type="button" className="sports-cc-link" onClick={() => navigateToHash("#sports/accounts")}>
                      Open association →
                    </button>
                  </div>
                </li>
              ))}
          </ul>
        </section>
      </div>

      <section className="panel" aria-label="Specialty product tracker">
        <HomeSectionHeader
          title="Specialty Product Tracker"
          count={specialtyForJosh.length}
          help="Where each specialty product sits — especially work sent to Mike, client revisions, items awaiting your approval, and anything blocking gallery release."
        />
        <ul className="sports-cc-list">
          {specialtyForJosh.map((product) => (
            <li key={product.id} className={`sports-cc-row sports-cc-row--${SPECIALTY_STATUS_TONES[product.status]}`}>
              <div className="sports-cc-row__main">
                <div className="sports-cc-row__head">
                  <strong>{product.product}</strong>
                  <HomePill tone={SPECIALTY_STATUS_TONES[product.status]}>{SPECIALTY_STATUS_LABELS[product.status]}</HomePill>
                  {product.blockingRelease ? <HomePill tone="critical">Blocks release</HomePill> : null}
                </div>
                <p className="sports-cc-row__sub">
                  {product.association} · {product.jobName}
                  {product.ageWithMike ? ` · ${product.ageWithMike}` : ""}
                </p>
                <div className="sports-cc-row__flags">
                  {product.needsJoshApproval ? <span className="sports-cc-flag">Needs your approval</span> : null}
                  {product.needsClientApproval ? <span className="sports-cc-flag">Client approval</span> : null}
                  {product.withMike ? <span className="sports-cc-flag">With Mike</span> : null}
                </div>
              </div>
              <div className="sports-cc-row__side">
                <span className="sports-cc-row__owner">Owner: {product.owner}</span>
                {product.dueAt ? <span className="sports-cc-row__action">{product.dueAt}</span> : null}
                <button type="button" className="sports-cc-link" onClick={() => navigateToHash("#sports/graphics")}>
                  Open in production →
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="sports-cc-split">
        <section className="panel sports-cc-panel" aria-label="Production and gallery release">
          <HomeSectionHeader title="Production &amp; Gallery Release" help="Sports-relevant production signals — what is blocked, behind delivery, or waiting on your approval to release. Not Spencer's full production board." />
          <ul className="sports-cc-list">
            {PRODUCTION_SIGNALS.map((signal) => (
              <li key={signal.id} className={`sports-cc-row sports-cc-row--${signal.tone}`}>
                <div className="sports-cc-row__main">
                  <div className="sports-cc-row__head">
                    <strong>{signal.association}</strong>
                    {signal.needsJoshApproval ? <HomePill tone="warning">Your approval</HomePill> : null}
                  </div>
                  <p className="sports-cc-row__sub">{signal.state}</p>
                </div>
                <div className="sports-cc-row__side">
                  <span className="sports-cc-row__owner">Owner: {signal.owner}</span>
                  <span className="sports-cc-row__action">{signal.due}</span>
                  {signal.relatedJobId ? <RelatedJobLink jobName={signal.jobName} /> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel sports-cc-panel" aria-label="Staffing and photography readiness">
          <HomeSectionHeader title="Staffing / Photography Readiness" help="Are upcoming sports shoots staffed and ready? Risk signals only — staffing is owned with Photography / Carisa." />
          <ul className="sports-cc-list">
            {STAFFING_SIGNALS.map((signal) => (
              <li key={signal.id} className={`sports-cc-row sports-cc-row--${signal.tone}`}>
                <div className="sports-cc-row__main">
                  <div className="sports-cc-row__head">
                    <strong>{signal.association}</strong>
                    <span className="sports-cc-row__due">{signal.when}</span>
                  </div>
                  <p className="sports-cc-row__sub">{signal.issue}</p>
                </div>
                <div className="sports-cc-row__side">
                  <span className="sports-cc-row__owner">Owner: {signal.owner}</span>
                  {signal.relatedJobId ? <RelatedJobLink jobName={signal.jobName} /> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="panel" aria-label="Association health">
        <HomeSectionHeader title="Association Health" help="Sports is relationship-and-season-centric. A quick read on which associations are healthy, watch, or at risk." />
        <div className="sports-cc-health-grid">
          {ASSOCIATION_HEALTH.map((association) => (
            <article key={association.id} className={`sports-cc-health-card sports-cc-health-card--${association.status}`}>
              <div className="sports-cc-health-card__head">
                <strong>{association.association}</strong>
                <HomePill tone={association.status}>{association.statusLabel}</HomePill>
              </div>
              <p>{association.signal}</p>
              <div className="sports-cc-health-card__foot">
                <span>Owner: {association.owner}</span>
                <button type="button" className="sports-cc-link" onClick={() => navigateToHash("#sports/accounts")}>
                  Open →
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {informationalChanges.length > 0 ? (
        <WorkflowChangeNoticePanel
          notices={informationalChanges}
          title="Recently Changed"
          summary="Recent sports changes that do not require an acknowledgement."
          compact
        />
      ) : null}
    </>
  );
}
