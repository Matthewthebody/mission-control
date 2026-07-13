import type { ReactNode } from "react";
import { HelpTooltip } from "../components/HelpTooltip";
import type { OperatingArea } from "./homeRoles";

export function navigateToHash(hash: string) {
  window.location.hash = hash;
}

export function HomeSectionHeader({
  title,
  help,
  count,
  eyebrow,
  badge
}: {
  title: string;
  help?: string;
  count?: number;
  eyebrow?: string;
  /** Honest-contract label, e.g. "Sample data" — a panel without a live source must say so. */
  badge?: string;
}) {
  return (
    <div className="home-section__head">
      <div className="home-section__head-text">
        {eyebrow ? <span className="home-section__eyebrow">{eyebrow}</span> : null}
        <h3>
          {title}
          {typeof count === "number" ? <span className="home-section__count">{count}</span> : null}
        </h3>
        {badge ? (
          <span className="home-command-card__badge home-command-card__badge--sample">{badge}</span>
        ) : null}
      </div>
      {help ? <HelpTooltip text={help} label={`About ${title}`} /> : null}
    </div>
  );
}

export function HomePill({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`home-pill home-pill--${tone}`}>{children}</span>;
}

// Demo jobs are not real records, so a related-job affordance links to the real
// Jobs database rather than a dead per-job hash. Keeps the no-fake-UI discipline.
export function RelatedJobLink({ jobName }: { jobName: string }) {
  return (
    <a className="home-related-job" href="#jobs">
      {jobName}
      <span aria-hidden="true"> →</span>
    </a>
  );
}

const RELATED_AREAS: Partial<Record<OperatingArea, OperatingArea[]>> = {
  schools: ["production"],
  sports: ["weather", "staffing"],
  photography: ["staffing", "sports"],
  staffing: ["photography", "sports"],
  production: ["schools"],
  client_success: ["schools"]
};

// Lower rank rises first. The emphasized area rises, closely-related areas rise a
// little, everything else keeps its place — emphasis never hides company issues.
export function emphasisRank(area: OperatingArea, emphasizedArea: OperatingArea): number {
  if (emphasizedArea === "company") {
    return 1;
  }
  if (area === emphasizedArea) {
    return 0;
  }
  if (RELATED_AREAS[emphasizedArea]?.includes(area)) {
    return 0.5;
  }
  return 1;
}

export function isEmphasized(area: OperatingArea, emphasizedArea: OperatingArea): boolean {
  return emphasizedArea !== "company" && area === emphasizedArea;
}
