import { DEMO_LEADERSHIP_REPORTS } from "./homeDemoData";
import { HomeSectionHeader } from "./homeShared";

export function LeadershipReportsStrip() {
  return (
    <section className="panel home-reports" aria-label="Leadership reports">
      <HomeSectionHeader
        title="Reports"
        eyebrow="Lower priority than live operations"
        help="Trends and performance for context. These stay below On Fire, staffing, clock-in, jobs-behind, and weather on purpose."
      />
      <div className="home-reports__grid">
        {DEMO_LEADERSHIP_REPORTS.map((report) => (
          <article key={report.id} className={`home-report-card home-report-card--${report.tone}`}>
            <span className="home-report-card__label">{report.label}</span>
            <strong className="home-report-card__value">{report.value}</strong>
            <span className="home-report-card__trend">{report.trend}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
