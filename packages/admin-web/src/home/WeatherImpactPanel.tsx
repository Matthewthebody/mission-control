import type { OperatingArea } from "./homeRoles";
import { DEMO_WEATHER_IMPACT, type WeatherImpactItem } from "./homeDemoData";
import { emphasisRank, HomePill, HomeSectionHeader, RelatedJobLink } from "./homeShared";

const LEVEL_RANK: Record<WeatherImpactItem["level"], number> = { urgent: 0, watch: 1 };

const BACKUP_LABELS: Record<WeatherImpactItem["indoorBackup"], string> = {
  yes: "Indoor backup ready",
  no: "No indoor backup listed",
  na: "Indoor backup n/a"
};

function WeatherRow({ item }: { item: WeatherImpactItem }) {
  return (
    <article className={`home-weather-row home-weather-row--${item.level}`}>
      <div className="home-weather-row__main">
        <div className="home-weather-row__head">
          <HomePill tone={item.level === "urgent" ? "critical" : "watch"}>{item.risk}</HomePill>
          {item.indoorBackup === "no" ? <span className="home-weather-row__backup home-weather-row__backup--no">No indoor backup</span> : null}
        </div>
        <strong className="home-weather-row__job">{item.job}</strong>
        <p className="home-weather-row__plan">Plan: {item.plan}</p>
        <span className="home-weather-row__backup-note">{BACKUP_LABELS[item.indoorBackup]}</span>
      </div>
      <div className="home-weather-row__side">
        <span className="home-weather-row__owner">Owner: {item.owner}</span>
        <span className={`home-weather-row__ack${item.acknowledged ? " home-weather-row__ack--done" : ""}`}>
          {item.acknowledged ? "✓ " : ""}
          {item.acknowledgment}
        </span>
        {item.relatedJobId ? <RelatedJobLink jobName="Open shoot" /> : null}
      </div>
    </article>
  );
}

export function WeatherImpactPanel({ emphasizedArea }: { emphasizedArea: OperatingArea }) {
  const items = DEMO_WEATHER_IMPACT.slice().sort((left, right) => {
    const level = LEVEL_RANK[left.level] - LEVEL_RANK[right.level];
    if (level !== 0) {
      return level;
    }
    return emphasisRank(left.area, emphasizedArea) - emphasisRank(right.area, emphasizedArea);
  });
  return (
    <section className="panel home-weather" aria-label="Weather impact">
      <HomeSectionHeader
        title="Weather Impact"
        count={items.length}
        help="Weather tied to specific jobs: which shoots are affected, who owns the plan, whether the crew acknowledged it, and whether there is an indoor backup."
      />
      <div className="home-weather__list">
        {items.map((item) => (
          <WeatherRow key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
