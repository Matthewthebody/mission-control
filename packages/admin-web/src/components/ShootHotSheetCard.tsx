import { ShootBriefingBody } from "./ShootBriefing";
import type { ShootBriefingViewModel } from "../services/shootHotSheet";

type Props = {
  briefing: ShootBriefingViewModel;
  expanded?: boolean;
  onToggle: () => void;
  expansionMode: "inline" | "panel";
};

export function ShootHotSheetCard({ briefing, expanded = false, onToggle, expansionMode }: Props) {
  return (
    <article className={`shoot-hot-sheet-card shoot-hot-sheet-card--${briefing.category}${expanded ? " shoot-hot-sheet-card--expanded" : ""}`}>
      <button className="shoot-hot-sheet-card__trigger" type="button" onClick={onToggle} aria-expanded={expanded}>
        <div className="shoot-hot-sheet-card__top">
          <div className={`shoot-type-chip shoot-type-chip--${briefing.category}`}>{briefing.categoryLabel}</div>
          <div className="shoot-hot-sheet-card__time" title={briefing.timeRange}>
            {briefing.timeRange}
          </div>
          <div className="shoot-hot-sheet-card__alerts" aria-label="Shoot alerts">
            {briefing.alertIndicators.map((alert) => (
              <span
                key={`${alert.kind}-${alert.label}`}
                className={`shoot-alert-indicator shoot-alert-indicator--${alert.tone}`}
                title={alert.detail}
              >
                {alert.label}
              </span>
            ))}
          </div>
        </div>

        <div className="shoot-hot-sheet-card__middle">
          <div className="shoot-hot-sheet-card__title-line">
            <strong className="shoot-hot-sheet-card__title" title={briefing.title}>
              {briefing.title}
            </strong>
            {briefing.priorityLevel && briefing.priorityLabel ? (
              <span
                className={`shoot-priority-chip shoot-priority-chip--${briefing.priorityLevel}`}
                title={briefing.priorityReasons.join(", ") || briefing.priorityLabel}
              >
                {briefing.priorityLabel}
              </span>
            ) : null}
          </div>
          <div className="shoot-hot-sheet-card__location" title={briefing.locationLine || "Location pending"}>
            {briefing.locationLine || ""}
          </div>
        </div>

        <div className="shoot-hot-sheet-card__bottom">
          <div className="shoot-hot-sheet-card__lead" title={briefing.leadName ?? "Senior photographer pending"}>
            {briefing.leadName ?? ""}
          </div>
          <div className={`shoot-hot-sheet-card__count shoot-hot-sheet-card__count--${briefing.staffingTone}`} title={briefing.staffingDetail}>
            {briefing.photographerCountLabel}
          </div>
          {briefing.specialGear.length ? (
            <div className="shoot-hot-sheet-card__gear" title={briefing.specialGear.join(", ")}>
              Gear
            </div>
          ) : null}
        </div>
      </button>

      {expanded && expansionMode === "inline" ? (
        <div className="shoot-hot-sheet-card__expanded">
          <ShootBriefingBody briefing={briefing} />
        </div>
      ) : null}
    </article>
  );
}
