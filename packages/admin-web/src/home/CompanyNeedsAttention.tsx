import { useEffect, useState } from "react";
import { getExceptionWorkspace } from "../services/exceptionsApi";
import {
  buildUrgentWindowRows,
  URGENT_WINDOW_CATEGORY_LABELS,
  type UrgentWindowRow
} from "./urgentWindow";
import { HomePill, HomeSectionHeader, navigateToHash } from "./homeShared";

// Live Urgent Watch panel (renamed from "Needs Attention" — that name belongs
// to the Compliance Workspace, where #needs-attention routes; two features must
// not share it). Fed by the SAME canonical exception read model
// (GET /api/exceptions → urgent_watch_item) that powers the "On Fire" card and
// the Urgent Window page, so the header count, the card count, and the
// destination page can never disagree. No demo rows, ever: loading, error, and
// empty are all honest states.

const VISIBLE_ROWS = 6;

type PanelState =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; rows: UrgentWindowRow[] };

function NeedsAttentionRow({ row }: { row: UrgentWindowRow }) {
  return (
    <li className={`home-na-row home-na-row--${row.severity === "blocking" ? "critical" : row.severity === "at_risk" ? "high" : "medium"}`}>
      <div className="home-na-row__main">
        <div className="home-na-row__head">
          <HomePill tone={row.severity === "blocking" ? "critical" : row.severity === "at_risk" ? "high" : "medium"}>
            {row.severityLabel}
          </HomePill>
          <span className="home-na-row__area">{URGENT_WINDOW_CATEGORY_LABELS[row.category]}</span>
          {row.timeLabel ? <span className="home-na-row__timing">{row.timeLabel}</span> : null}
        </div>
        <strong className="home-na-row__title">{row.title}</strong>
        <p className="home-na-row__issue">{row.summary}</p>
      </div>
      <div className="home-na-row__side">
        <span className="home-na-row__owner">Owner: {row.ownerLabel}</span>
        <button type="button" className="home-na-row__action" onClick={() => navigateToHash(row.destinationHash)}>
          {row.nextActionLabel}
          <span aria-hidden="true"> →</span>
        </button>
      </div>
    </li>
  );
}

export function CompanyNeedsAttention({ token }: { token?: string }) {
  const [panel, setPanel] = useState<PanelState>({ state: "loading" });

  useEffect(() => {
    if (!token) {
      setPanel({ state: "error" });
      return;
    }
    let cancelled = false;
    setPanel({ state: "loading" });
    getExceptionWorkspace(token)
      .then((workspace) => {
        if (cancelled) return;
        const rows = buildUrgentWindowRows(workspace.items, Date.now()).filter((row) => row.status === "open");
        setPanel({ state: "ready", rows });
      })
      .catch(() => {
        if (!cancelled) setPanel({ state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const openRows = panel.state === "ready" ? panel.rows : [];
  return (
    <section className="panel home-needs-attention" aria-label="Company urgent watch">
      <HomeSectionHeader
        title="Urgent Watch"
        count={panel.state === "ready" ? openRows.length : undefined}
        help="Live, tracked operational issues from the canonical exception feed — the same records the Urgent Window works. Resolving the source record clears it here."
      />
      {panel.state === "loading" ? (
        <div className="home-empty">
          <strong>Loading live issues…</strong>
        </div>
      ) : panel.state === "error" ? (
        <div className="home-empty">
          <strong>Live issue feed unavailable.</strong>
          <p>
            We could not load the exception feed.{" "}
            <a href="#urgent-window">Open the Urgent Window</a> to see tracked issues directly.
          </p>
        </div>
      ) : openRows.length === 0 ? (
        <div className="home-empty">
          <strong>No open attention items right now.</strong>
          <p>Open urgent-watch issues — staffing, attendance, workflow, and production — appear here the moment they are tracked.</p>
        </div>
      ) : (
        <>
          <ul className="home-needs-attention__list">
            {openRows.slice(0, VISIBLE_ROWS).map((row) => (
              <NeedsAttentionRow key={row.id} row={row} />
            ))}
          </ul>
          {openRows.length > VISIBLE_ROWS ? (
            <a className="home-needs-attention__more" href="#urgent-window?status=open">
              See all {openRows.length} open issues in the Urgent Window →
            </a>
          ) : null}
        </>
      )}
    </section>
  );
}
