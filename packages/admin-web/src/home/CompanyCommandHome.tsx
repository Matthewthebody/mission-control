import type { HomeRole } from "./homeRoles";
import { buildCompanyCommandCards, type CompanyCommandCard } from "./homeDemoData";
import { canSeeLeadershipReports } from "./homePermissions";
import { CompanyNeedsAttention } from "./CompanyNeedsAttention";
import { OperatingAreaPulse } from "./OperatingAreaPulse";
import { AttendanceRiskPanel } from "./AttendanceRiskPanel";
import { WeatherImpactPanel } from "./WeatherImpactPanel";
import { LeadershipReportsStrip } from "./LeadershipReportsStrip";
import { HomeSectionHeader, navigateToHash } from "./homeShared";
import { resolveActionTarget } from "./actionTargets";

function CommandCard({ card }: { card: CompanyCommandCard }) {
  const resolved = resolveActionTarget(card.target);
  // An enabled card must perform the action its label promises. When the source
  // surface is not connected (e.g. no weather provider) we render a clearly
  // disabled state with the reason — never a dead or misleading drilldown.
  if (!resolved.available) {
    return (
      <div
        className={`home-command-card home-command-card--${card.tone} home-command-card--disabled`}
        aria-disabled="true"
      >
        <span className="home-command-card__label">{card.label}</span>
        <strong className="home-command-card__value">{card.value}</strong>
        <span className="home-command-card__helper">{card.helper}</span>
        <span className="home-command-card__drill home-command-card__drill--off">{resolved.reason}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`home-command-card home-command-card--${card.tone}`}
      onClick={() => navigateToHash(resolved.hash)}
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

      <section className="panel home-command__workflow" aria-label="Workflow command">
        <HomeSectionHeader
          title="Workflow Command"
          help="Leadership entry point for workflow oversight and demos. Open the builder to review or clone a workflow, or test how a job moves through statuses — no need to hunt through Admin."
        />
        <div className="home-command__cards">
          <button
            type="button"
            className="home-command-card home-command-card--info"
            onClick={() => navigateToHash("#project-tracking/workflow-templates")}
          >
            <span className="home-command-card__label">Workflow Builder & Templates</span>
            <strong className="home-command-card__value">Review or clone a workflow</strong>
            <span className="home-command-card__helper">Open the leadership workflow builder — milestones, controlled steps, owners, and SLAs.</span>
            <span className="home-command-card__drill">
              Open Workflow Command
              <span aria-hidden="true"> →</span>
            </span>
          </button>
          <button
            type="button"
            className="home-command-card home-command-card--info"
            onClick={() => navigateToHash("#project-tracking")}
          >
            <span className="home-command-card__label">Test a Job Workflow</span>
            <strong className="home-command-card__value">Move a job through statuses</strong>
            <span className="home-command-card__helper">Open Production Tracker to work a job from Ready through Working, Waiting, Review, Delivery, and Done.</span>
            <span className="home-command-card__drill">
              Open Production Tracker
              <span aria-hidden="true"> →</span>
            </span>
          </button>
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
