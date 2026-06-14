import type { HomeRole } from "./homeRoles";
import { buildCompanyCommandCards, type CompanyCommandCard } from "./homeDemoData";
import { canSeeLeadershipReports } from "./homePermissions";
import { CompanyNeedsAttention } from "./CompanyNeedsAttention";
import { OperatingAreaPulse } from "./OperatingAreaPulse";
import { AttendanceRiskPanel } from "./AttendanceRiskPanel";
import { WeatherImpactPanel } from "./WeatherImpactPanel";
import { LeadershipReportsStrip } from "./LeadershipReportsStrip";
import { HomeSectionHeader, navigateToHash } from "./homeShared";

function CommandCard({ card }: { card: CompanyCommandCard }) {
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

export function CompanyCommandHome({ role }: { role: HomeRole }) {
  const cards = buildCompanyCommandCards();
  return (
    <>
      <section className="panel home-command__toprow" aria-label="Company command top row">
        <HomeSectionHeader
          title="Today across the company"
          help="What is happening today, and what could hurt us today. Every card is a drilldown."
        />
        <div className="home-command__cards">
          {cards.map((card) => (
            <CommandCard key={card.id} card={card} />
          ))}
        </div>
      </section>

      <CompanyNeedsAttention emphasizedArea={role.emphasizedArea} />
      <OperatingAreaPulse emphasizedArea={role.emphasizedArea} />
      <AttendanceRiskPanel emphasizedArea={role.emphasizedArea} />
      <WeatherImpactPanel emphasizedArea={role.emphasizedArea} />
      {canSeeLeadershipReports(role) ? <LeadershipReportsStrip /> : null}
    </>
  );
}
