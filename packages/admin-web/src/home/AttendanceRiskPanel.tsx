import type { OperatingArea } from "./homeRoles";
import { DEMO_ATTENDANCE_RISK } from "./homeDemoData";
import { emphasisRank, HomePill, HomeSectionHeader, navigateToHash } from "./homeShared";
import { resolveActionTarget } from "./actionTargets";

export function AttendanceRiskPanel({ emphasizedArea }: { emphasizedArea: OperatingArea }) {
  const rows = DEMO_ATTENDANCE_RISK.slice().sort(
    (left, right) => emphasisRank(left.area, emphasizedArea) - emphasisRank(right.area, emphasizedArea)
  );
  const attendance = resolveActionTarget({ sourceType: "attendance" });
  return (
    <section className="panel home-attendance" aria-label="People and attendance risk">
      <HomeSectionHeader
        title="People / Attendance Risk"
        count={rows.length}
        badge="Sample data"
        help="Illustrative sample content — these are not real employees or live attendance states. Live attendance truth lives in the attendance and compliance surfaces this panel links to."
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
      {attendance.available ? (
        <div className="home-attendance__foot">
          <button type="button" className="home-attendance__open" onClick={() => navigateToHash(attendance.hash)}>
            Open Attendance
            <span aria-hidden="true"> →</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}
