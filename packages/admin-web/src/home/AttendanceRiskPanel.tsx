import type { OperatingArea } from "./homeRoles";
import { DEMO_ATTENDANCE_RISK } from "./homeDemoData";
import { emphasisRank, HomePill, HomeSectionHeader } from "./homeShared";

export function AttendanceRiskPanel({ emphasizedArea }: { emphasizedArea: OperatingArea }) {
  const rows = DEMO_ATTENDANCE_RISK.slice().sort(
    (left, right) => emphasisRank(left.area, emphasizedArea) - emphasisRank(right.area, emphasizedArea)
  );
  return (
    <section className="panel home-attendance" aria-label="People and attendance risk">
      <HomeSectionHeader
        title="People / Attendance Risk"
        count={rows.length}
        help="Who is not clocked in, late, called out, missing a shift, assigned-but-not-acknowledged, or short a crew. Overtime and early clock-out are intentionally not front-and-center."
      />
      <div className="home-attendance__table" role="table">
        <div className="home-attendance__row home-attendance__row--head" role="row">
          <span role="columnheader">Employee</span>
          <span role="columnheader">Job / Shoot</span>
          <span role="columnheader">Call time</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Owner</span>
          <span role="columnheader">Action</span>
        </div>
        {rows.map((row) => (
          <div key={row.id} className="home-attendance__row" role="row">
            <span role="cell" className="home-attendance__employee">{row.employee}</span>
            <span role="cell">{row.job}</span>
            <span role="cell">{row.callTime}</span>
            <span role="cell">
              <HomePill tone={row.tone}>{row.statusLabel}</HomePill>
            </span>
            <span role="cell">{row.owner}</span>
            <span role="cell" className="home-attendance__action">{row.action}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
