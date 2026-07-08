import { useCallback, useEffect, useState } from "react";
import { ApiClientError } from "../api";
import { HelpTooltip } from "../components/HelpTooltip";
import {
  getSchoolsLeadershipOperations,
  leadershipActionLabel,
  leadershipCategoryLabel,
  LEADERSHIP_SECTION_LABELS,
  LEADERSHIP_SEVERITY_LABELS,
  LEADERSHIP_SEVERITY_PILL,
  LEADERSHIP_TIME_LABELS,
  type LeadershipCategory,
  type LeadershipIssue,
  type LeadershipSection,
  type LeadershipSeverity,
  type SchoolsLeadershipOperations
} from "../services/schoolsLeadershipOperationsApi";

// Phase 6A — Schools Leadership & CSR operating board over GET /api/schools/leadership/operations.
// Two sections (current season / building next season). Each category is rendered explicitly: an
// available category shows its server count and either a dense issue table or a calm "all clear"
// empty state; an UNAVAILABLE category shows an honest "Not connected yet" state carrying the
// backend reason — never a fabricated zero, never an implied "no issues". Every count comes straight
// from the server (displayed === filtered). A row's primary action is only clickable when the server
// says `can_act`; otherwise the row still offers a plain "Open" deep-link to the exact record.

type Props = { token: string };

const SECTION_ORDER: LeadershipSection[] = ["current_season", "building_next_season"];

// A category can carry hundreds of issues (e.g. every school shoot this week). Rendering all of them
// makes one enormous unusable table, so each category shows a bounded window of rows. This never fakes
// the total — the category count pill always shows the true server count, and a disclosure line states
// exactly how many are shown vs the total.
export const CATEGORY_ROW_LIMIT = 12;

function maxSeverity(issues: LeadershipIssue[]): LeadershipSeverity {
  if (issues.some((i) => i.severity === "critical")) return "critical";
  if (issues.some((i) => i.severity === "warning")) return "warning";
  return "info";
}

export function SchoolsLeadershipOperations({ token }: Props) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [data, setData] = useState<SchoolsLeadershipOperations | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const payload = await getSchoolsLeadershipOperations(token);
      setData(payload);
      setState("ready");
    } catch (e) {
      // an API failure shows an honest error — it never falls back to demo data.
      setError(e instanceof ApiClientError ? e.message : "We couldn't load the Schools leadership board right now.");
      setData(null);
      setState("error");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // The read model derives scope on the server: "own" = the schools this user personally owns (field /
  // graphic / office own-only users); "all" = every school. NOTE: the Schools CSR role
  // (schools_client_success), like leadership and admins, is granted the "all" scope — it is NOT
  // owner-scoped — so the page never invents a "my schools" framing for a user the server scoped to
  // "all". Title / subtitle / help / badge all follow the server scope, so an own-scoped user sees an
  // honest "My Schools" framing and an all-scoped user sees the leadership framing.
  const isOwnScope = data?.scope === "own";
  const scopeLabel = isOwnScope ? "My schools" : "All schools";
  const pageTitle = isOwnScope ? "My Schools Operations" : "Schools Leadership";
  const pageSubtitle = isOwnScope
    ? "The schools you own this season, and what to line up for next."
    : "Everything that needs a decision this season, and what to line up for next.";
  const helpText = isOwnScope
    ? "An operating board over the canonical Schools you personally own. Every category count is computed on the server and equals its listed rows (displayed = filtered). A category with no connected source shows as 'Not connected yet' with the reason — never a fabricated zero."
    : "An operating board over canonical Schools records. Every category count is computed on the server and equals its listed rows (displayed = filtered). A category with no connected source shows as 'Not connected yet' with the reason — never a fabricated zero. Open a record with the exact deep-link; the primary action is only offered when it is actionable.";

  return (
    <section className="production-operations" aria-label={`${pageTitle} operating board`}>
      <div className="directory-card__header">
        <div className="production-operations__title">
          <strong>{pageTitle}</strong>
          {data ? (
            <span className="meta-pill" aria-label={`Scope: ${scopeLabel}`}>{scopeLabel}</span>
          ) : null}
          {/* Progressive help — explanatory copy on demand, not permanently occupying the page. */}
          <HelpTooltip label={`Help: ${pageTitle}`} text={helpText} />
        </div>
        <button type="button" className="secondary-button" onClick={() => void load()}>Refresh</button>
      </div>
      <p className="section-subtitle">{pageSubtitle}</p>

      {state === "loading" ? (
        <div className="empty-state empty-state--panel" aria-busy="true">Loading the Schools leadership board…</div>
      ) : state === "error" ? (
        <div className="empty-state empty-state--panel" role="alert">
          {error}{" "}
          <button type="button" className="link-button" onClick={() => void load()}>Retry</button>
        </div>
      ) : !data ? (
        <div className="empty-state empty-state--panel">No Schools leadership data is available.</div>
      ) : (
        SECTION_ORDER.map((section) => (
          <LeadershipSectionBlock key={section} section={section} categories={data.sections[section]} />
        ))
      )}
    </section>
  );
}

function LeadershipSectionBlock({
  section,
  categories
}: {
  section: LeadershipSection;
  categories: LeadershipCategory[];
}) {
  // Section total = sum of the available categories' server counts (unavailable categories add nothing —
  // they are not zero, they are simply not connected, so they never inflate or deflate the total).
  const openCount = categories.reduce((sum, c) => sum + (c.available ? c.count : 0), 0);

  return (
    <div className="production-operations__section">
      <h3 className="production-operations__section-title">
        {LEADERSHIP_SECTION_LABELS[section]} <span className="meta-pill">{openCount} open</span>
      </h3>
      {categories.map((category) => (
        <LeadershipCategoryBlock key={category.category} category={category} />
      ))}
    </div>
  );
}

function LeadershipCategoryBlock({ category }: { category: LeadershipCategory }) {
  const label = leadershipCategoryLabel(category.category);

  // Unavailable by design — honest "not connected" state carrying the backend reason. Not a zero.
  if (!category.available) {
    return (
      <div className="production-operations__category">
        <div className="directory-card__header">
          <strong>{label}</strong>
          <span className="meta-pill" title={category.reason}>Not connected yet</span>
        </div>
        <div className="empty-state empty-state--panel">{category.reason}</div>
      </div>
    );
  }

  const severity = maxSeverity(category.issues);

  return (
    <div className="production-operations__category">
      <div className="directory-card__header">
        <strong>{label}</strong>
        <span className={category.count > 0 ? LEADERSHIP_SEVERITY_PILL[severity] : "meta-pill"}>{category.count}</span>
      </div>
      {category.issues.length === 0 ? (
        <div className="empty-state empty-state--panel">All clear — nothing needs attention here.</div>
      ) : (
        <table className="production-operations__table">
          <thead>
            <tr>
              <th scope="col">School</th>
              <th scope="col">District</th>
              <th scope="col">What needs attention</th>
              <th scope="col">Owner</th>
              <th scope="col">When</th>
              <th scope="col">Severity</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {category.issues.slice(0, CATEGORY_ROW_LIMIT).map((issue) => (
              <tr key={issue.issue_id} className="production-operations__row">
                <td>{issue.school_name ?? "School"}</td>
                <td>{issue.district_name ?? "—"}</td>
                <td>
                  {issue.reason}
                  {issue.focus_reason ? <div className="section-subtitle">{issue.focus_reason}</div> : null}
                </td>
                <td>{issue.owner_name ?? <span className="meta-pill meta-pill--warning">Unowned</span>}</td>
                <td>{issue.date_deadline ?? LEADERSHIP_TIME_LABELS[issue.time_state]}</td>
                <td>
                  <span className={LEADERSHIP_SEVERITY_PILL[issue.severity]}>{LEADERSHIP_SEVERITY_LABELS[issue.severity]}</span>
                </td>
                <td>
                  <LeadershipRowAction issue={issue} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {category.available && category.count > CATEGORY_ROW_LIMIT ? (
        <p className="section-subtitle">
          Showing the first {CATEGORY_ROW_LIMIT} of {category.count}. Open a record to act on it.
        </p>
      ) : null}
    </div>
  );
}

function LeadershipRowAction({ issue }: { issue: LeadershipIssue }) {
  // Only present the primary action as clickable when the server says it is actionable.
  if (issue.can_act && issue.primary_action) {
    return (
      <a className="secondary-button" href={issue.exact_destination_hash} title={issue.focus_reason}>
        {leadershipActionLabel(issue.primary_action)}
      </a>
    );
  }
  // Viewing the record is always safe — offer a plain deep-link, never the action verb.
  return (
    <a className="link-button" href={issue.exact_destination_hash} title={issue.focus_reason}>
      Open
    </a>
  );
}
