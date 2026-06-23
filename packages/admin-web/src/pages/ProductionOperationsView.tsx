import { useCallback, useEffect, useState } from "react";
import { ApiClientError } from "../api";
import { HelpTooltip } from "../components/HelpTooltip";
import {
  getProductionOperations,
  PRODUCTION_METRIC_LABELS,
  PRODUCTION_METRIC_STAGE,
  type ProductionMetric,
  type ProductionOperations,
  type ProductionRow
} from "../services/productionOperationsApi";

// June 18 — dense Production / Graphics operating tracker over GET /api/production/operations. Metric
// chips come straight from the server (displayed count === filtered total); clicking a chip URL-filters
// the table by the canonical stage; a row opens an in-viewport quick-view (Production Truth Snapshot).
// All state (stage filter + selected record) is URL-backed so refresh + Back/Forward restore it.

type Props = { token: string };

function readHash(): { stage: string | null; selected: string | null } {
  const [, query = ""] = window.location.hash.split("?");
  const params = new URLSearchParams(query);
  return { stage: params.get("stage"), selected: params.get("project") };
}

function writeHash(next: { stage: string | null; selected: string | null }) {
  const params = new URLSearchParams();
  if (next.stage) params.set("stage", next.stage);
  if (next.selected) params.set("project", next.selected);
  const root = window.location.hash.replace(/^#/, "").split("?")[0] || "production/operations";
  window.location.hash = `#${root}${params.toString() ? `?${params.toString()}` : ""}`;
}

const RISK_LABEL: Record<string, string> = { none: "On track", warning: "At risk", critical: "Critical" };

export function ProductionOperationsView({ token }: Props) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [data, setData] = useState<ProductionOperations | null>(null);
  const [hash, setHash] = useState(readHash);

  useEffect(() => {
    const onHash = () => setHash(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const payload = await getProductionOperations(token, { stage: hash.stage });
      setData(payload);
      setState("ready");
    } catch (e) {
      // an API failure shows an honest error — it never falls back to demo data.
      setError(e instanceof ApiClientError ? e.message : "We couldn't load the production queue right now.");
      setData(null);
      setState("error");
    }
  }, [token, hash.stage]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedRow = data?.rows.find((r) => r.source_id === hash.selected) ?? null;

  return (
    <section className="production-operations" aria-label="Production operating queue">
      <div className="directory-card__header">
        <div className="production-operations__title">
          <strong>Production / Graphics</strong>
          {/* Progressive help — the explanatory copy is on demand, not permanently occupying the page. */}
          <HelpTooltip
            label="Help: Production queue"
            text="A dense operating queue over canonical production work. Every metric count is computed on the server and equals its filtered rows (displayed = filtered). Click a metric chip to filter by stage; open a row for the Production Truth Snapshot."
          />
        </div>
        <button type="button" className="secondary-button" onClick={() => void load()}>Refresh</button>
      </div>

      {/* metric chips — each count is the server's filtered total; clicking filters by stage where applicable */}
      <div className="production-operations__metrics" role="group" aria-label="Production metrics">
        {(data?.metrics ?? []).map((m: ProductionMetric) => {
          const stage = PRODUCTION_METRIC_STAGE[m.key] ?? null;
          const active = stage && hash.stage === stage;
          return (
            <button
              key={m.key}
              type="button"
              className={`meta-pill production-operations__metric${active ? " production-operations__metric--active" : ""}`}
              aria-pressed={Boolean(active)}
              disabled={!m.available}
              title={m.available ? undefined : m.reason}
              onClick={() => writeHash({ stage: active ? null : stage, selected: null })}
            >
              <span className="production-operations__metric-label">{PRODUCTION_METRIC_LABELS[m.key] ?? m.key}</span>
              <span className="production-operations__metric-count">{m.available ? m.count : "—"}</span>
            </button>
          );
        })}
      </div>

      {hash.stage ? (
        <div className="production-operations__activefilter">
          Filtered to stage: <strong>{hash.stage}</strong>{" "}
          <button type="button" className="link-button" onClick={() => writeHash({ stage: null, selected: hash.selected })}>Clear</button>
        </div>
      ) : null}

      {state === "loading" ? (
        <div className="empty-state empty-state--panel" aria-busy="true">Loading the production queue…</div>
      ) : state === "error" ? (
        <div className="empty-state empty-state--panel" role="alert">
          {error}{" "}
          <button type="button" className="link-button" onClick={() => void load()}>Retry</button>
        </div>
      ) : !data || data.rows.length === 0 ? (
        <div className="empty-state empty-state--panel">No production work matches this view.</div>
      ) : (
        <table className="production-operations__table">
          <thead>
            <tr>
              <th scope="col">Work item</th>
              <th scope="col">Stage</th>
              <th scope="col">Live step</th>
              <th scope="col">Owner</th>
              <th scope="col">Due</th>
              <th scope="col">Next action</th>
              <th scope="col">Missing</th>
              <th scope="col">Blockers</th>
              <th scope="col">Risk</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row: ProductionRow) => (
              <tr
                key={row.source_id}
                className={`production-operations__row${hash.selected === row.source_id ? " production-operations__row--selected" : ""}`}
                aria-selected={hash.selected === row.source_id}
              >
                <td>
                  <button type="button" className="directory-link-button" onClick={() => writeHash({ stage: hash.stage, selected: row.source_id })}>
                    {row.title}
                  </button>
                </td>
                <td>{row.stage}</td>
                <td>{row.current_step ?? "—"}</td>
                <td>{row.owner_user_id ? "Assigned" : <span className="meta-pill meta-pill--warning">Unowned</span>}</td>
                <td>{row.due_date ?? "—"}</td>
                <td>{row.next_action ?? "—"}</td>
                <td>{row.missing_inputs > 0 ? row.missing_inputs : "—"}</td>
                <td>{row.blocker_count > 0 ? row.blocker_count : "—"}</td>
                <td>
                  <span className={`meta-pill production-operations__risk production-operations__risk--${row.risk}`}>{RISK_LABEL[row.risk]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedRow ? (
        <aside className="production-operations__drawer" role="dialog" aria-label={`Production snapshot: ${selectedRow.title}`}>
          <div className="directory-card__header">
            <strong>Production Truth Snapshot</strong>
            <button type="button" className="secondary-button" aria-label="Close production snapshot" onClick={() => writeHash({ stage: hash.stage, selected: null })}>Close</button>
          </div>
          <dl className="production-operations__snapshot">
            <div><dt>Work item</dt><dd>{selectedRow.title}</dd></div>
            <div><dt>Stage</dt><dd>{selectedRow.stage}</dd></div>
            <div><dt>Current workflow step</dt><dd>{selectedRow.current_step ?? "No active step"}</dd></div>
            <div><dt>Blocker</dt><dd>{selectedRow.waiting_on ?? (selectedRow.blocker_count ? "Blocked" : "None")}</dd></div>
            <div><dt>Missing inputs</dt><dd>{selectedRow.missing_inputs}</dd></div>
            <div><dt>Approval</dt><dd>{selectedRow.approval_state}</dd></div>
            <div><dt>Owner</dt><dd>{selectedRow.owner_user_id ? "Assigned" : "Unowned"}</dd></div>
            <div><dt>Promised / due</dt><dd>{selectedRow.due_date ?? "—"}</dd></div>
            <div><dt>Risk</dt><dd>{RISK_LABEL[selectedRow.risk]}</dd></div>
            <div><dt>Next action</dt><dd>{selectedRow.next_action ?? "—"}</dd></div>
            <div><dt>Age in stage</dt><dd>{selectedRow.age_in_stage_days != null ? `${selectedRow.age_in_stage_days}d` : "—"}</dd></div>
            <div><dt>Source</dt><dd>{selectedRow.provenance} · {selectedRow.source_id}</dd></div>
          </dl>
          <a className="secondary-button" href={selectedRow.exact_destination_hash}>Open Full Record</a>
        </aside>
      ) : null}
    </section>
  );
}
