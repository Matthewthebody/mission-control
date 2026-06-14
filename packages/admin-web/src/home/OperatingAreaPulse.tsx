import type { OperatingArea } from "./homeRoles";
import { OPERATING_AREA_PULSE, type AreaStatus, type OperatingAreaPulseCard } from "./homeDemoData";
import { emphasisRank, HomePill, HomeSectionHeader, isEmphasized, navigateToHash } from "./homeShared";

const STATUS_LABELS: Record<AreaStatus, string> = {
  healthy: "Healthy",
  watch: "Watch",
  urgent: "Urgent"
};

function AreaCard({ card, emphasized }: { card: OperatingAreaPulseCard; emphasized: boolean }) {
  return (
    <article className={`home-pulse-card home-pulse-card--${card.status}${emphasized ? " home-pulse-card--emphasized" : ""}`}>
      <div className="home-pulse-card__head">
        <div>
          <span className="home-pulse-card__name">{card.label}</span>
          {emphasized ? <span className="home-pulse-card__emphasis">Your area</span> : null}
        </div>
        <HomePill tone={card.status}>{STATUS_LABELS[card.status]}</HomePill>
      </div>
      <ul className="home-pulse-card__issues">
        {card.issues.slice(0, emphasized ? 3 : 3).map((issue) => (
          <li key={issue}>{issue}</li>
        ))}
      </ul>
      {card.dependency ? <p className="home-pulse-card__dependency">{card.dependency}</p> : null}
      <div className="home-pulse-card__foot">
        <span className="home-pulse-card__owner">Owner: {card.owner}</span>
        <button type="button" className="home-pulse-card__action" onClick={() => navigateToHash(card.drilldownHash)}>
          {card.nextAction}
          <span aria-hidden="true"> →</span>
        </button>
      </div>
    </article>
  );
}

export function OperatingAreaPulse({ emphasizedArea }: { emphasizedArea: OperatingArea }) {
  const cards = OPERATING_AREA_PULSE.slice().sort((left, right) => {
    const rank = emphasisRank(left.area, emphasizedArea) - emphasisRank(right.area, emphasizedArea);
    if (rank !== 0) {
      return rank;
    }
    return 0;
  });
  return (
    <section className="panel home-pulse" aria-label="Operating area pulse">
      <HomeSectionHeader
        title="Operating Areas"
        help="Each area shows status, the top issues, who owns the next action, and how it depends on other areas. The company is connected, not siloed."
      />
      <div className="home-pulse__grid">
        {cards.map((card) => (
          <AreaCard key={card.area} card={card} emphasized={isEmphasized(card.area, emphasizedArea)} />
        ))}
      </div>
    </section>
  );
}
