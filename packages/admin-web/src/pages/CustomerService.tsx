import { useEffect, useMemo, useState } from "react";
import {
  getZendeskLeadershipSummary,
  getZendeskLeadershipTicketList,
  getZendeskLeadershipTrends,
  getZendeskStatus,
  syncZendesk,
  testZendeskConnection
} from "../services/customerServiceApi";
import type {
  SessionUser,
  ZendeskConnection,
  ZendeskLeadershipSummary,
  ZendeskLeadershipTicketList,
  ZendeskLeadershipTrends,
  ZendeskStatusPayload
} from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
};

type TrendRange = ZendeskLeadershipTrends["range"];

export function CustomerService({ token, currentUser }: Props) {
  const [range, setRange] = useState<TrendRange>("7d");
  const [status, setStatus] = useState<ZendeskStatusPayload | null>(null);
  const [summary, setSummary] = useState<ZendeskLeadershipSummary | null>(null);
  const [trends, setTrends] = useState<ZendeskLeadershipTrends | null>(null);
  const [ticketList, setTicketList] = useState<ZendeskLeadershipTicketList | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const connection: ZendeskConnection | null = summary?.connection ?? status?.connection ?? null;
  const maxBacklog = useMemo(() => Math.max(...(trends?.points.map((point) => point.open_backlog_count) ?? [1])), [trends]);
  const maxFlow = useMemo(
    () => Math.max(...(trends?.points.flatMap((point) => [point.opened_count, point.resolved_count]) ?? [1])),
    [trends]
  );

  async function load() {
    setLoading(true);
    try {
      const [statusPayload, summaryPayload, trendPayload, ticketPayload] = await Promise.all([
        getZendeskStatus(token),
        getZendeskLeadershipSummary(token),
        getZendeskLeadershipTrends(token, range),
        getZendeskLeadershipTicketList(token, { status: "open", limit: 12 })
      ]);
      setStatus(statusPayload);
      setSummary(summaryPayload);
      setTrends(trendPayload);
      setTicketList(ticketPayload);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't load the Customer Service view.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [range, token]);

  async function runAction(action: "test" | "sync") {
    setWorking(true);
    setError("");
    try {
      if (action === "test") {
        const response = await testZendeskConnection(token);
        setNotice(response.message);
      } else {
        const response = await syncZendesk(token);
        setNotice(
          response.connection.demo_mode
            ? "Demo support metrics refreshed."
            : "Zendesk reporting cache refreshed from the live integration."
        );
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `We couldn't ${action} the Zendesk integration.`);
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">Leadership Dashboard</div>
          <h2>Customer Service</h2>
          <p>A read-only Zendesk scorecard for support load, response speed, backlog health, and category pressure across Schools and Sports.</p>
        </div>
        <div className="page-intro-actions">
          <div className="metric-pill">Viewer: {currentUser.fullName}</div>
          <div className="report-tab-row">
            <button className={range === "7d" ? "is-active" : ""} onClick={() => setRange("7d")}>
              Last 7 Days
            </button>
            <button className={range === "30d" ? "is-active" : ""} onClick={() => setRange("30d")}>
              Last 30 Days
            </button>
            <button className={range === "this_week" ? "is-active" : ""} onClick={() => setRange("this_week")}>
              This Week
            </button>
            <button className={range === "this_month" ? "is-active" : ""} onClick={() => setRange("this_month")}>
              This Month
            </button>
          </div>
          <button className="secondary-button" disabled={working} onClick={() => void runAction("test")}>
            {working ? "Working..." : "Test Integration"}
          </button>
          <button className="secondary-button" disabled={working} onClick={() => void runAction("sync")}>
            {working ? "Working..." : connection?.demo_mode ? "Refresh Demo Data" : "Sync Zendesk"}
          </button>
        </div>
      </section>

      {notice ? <section className="panel feedback-strip feedback-strip--success">{notice}</section> : null}
      {error ? <section className="panel feedback-strip feedback-strip--danger">{error}</section> : null}
      {connection?.demo_mode ? (
        <section className="panel feedback-strip feedback-strip--info">
          Zendesk live credentials are not configured here. Mission Control is showing demo support health so the leadership scorecard stays reviewable locally.
        </section>
      ) : null}
      {connection?.stale_sync ? (
        <section className="panel feedback-strip feedback-strip--warning">
          The Zendesk cache is stale. Run a sync before treating these trends as current.
        </section>
      ) : null}
      {connection ? (
        <section className="panel feedback-strip feedback-strip--info">
          Source: Mission Control is showing a leadership summary from the Zendesk reporting cache, not a full ticket inbox.
          {" "}
          Coverage: {connection.demo_mode ? "Demo support data for local review." : "Summary metrics, trends, and filtered ticket context."}
          {" "}
          Mapping confidence: school and account context stays partial until deeper record matching ships.
        </section>
      ) : null}

      {loading && !summary ? (
        <section className="panel loading-panel">
          <div className="section-title">Loading customer service reporting</div>
          <p className="section-subtitle">Pulling cached Zendesk KPIs, trend lines, and backlog health into the leadership scorecard.</p>
        </section>
      ) : null}

      <section className="metrics-grid">
        <article className="stat-card panel">
          <div className="eyebrow">Open Tickets</div>
          <strong>{summary?.kpis.open_tickets ?? 0}</strong>
          <span className="muted">Current open support load in the local reporting cache.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">New This Week</div>
          <strong>{summary?.kpis.new_tickets_this_week ?? 0}</strong>
          <span className="muted">{formatSigned(summary?.comparisons.new_tickets_week_over_week)} vs last week.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Resolved This Week</div>
          <strong>{summary?.kpis.resolved_tickets_this_week ?? 0}</strong>
          <span className="muted">{formatSigned(summary?.comparisons.resolved_tickets_week_over_week)} vs last week.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Unassigned</div>
          <strong>{summary?.kpis.unassigned_tickets ?? 0}</strong>
          <span className="muted">Open tickets without an assignee in Zendesk.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Median First Reply</div>
          <strong>{formatMinutes(summary?.kpis.median_first_reply_minutes)}</strong>
          <span className="muted">{formatSigned(summary?.comparisons.first_reply_change_minutes, " min")} vs last week.</span>
        </article>
        <article className="stat-card panel">
          <div className="eyebrow">Median Resolution</div>
          <strong>{formatMinutes(summary?.kpis.median_resolution_minutes)}</strong>
          <span className="muted">{formatSigned(summary?.comparisons.resolution_change_minutes, " min")} vs last week.</span>
        </article>
      </section>

      <section className="dashboard-layout customer-service-layout">
        <div className="dashboard-main">
          <section className="panel dashboard-panel">
            <div className="section-title">Support Trend Pulse</div>
            <p className="section-subtitle">Opened and resolved volume against the backlog curve, using the same cached Zendesk summary data leadership sees across the dashboard.</p>
            {!trends?.points.length ? (
              <div className="empty-state empty-state--panel">No Zendesk trend points are available yet. Run a sync to populate the reporting cache.</div>
            ) : (
              <div className="trend-chart">
                {trends.points.map((point) => (
                  <article key={point.metric_date} className="trend-bar-card">
                    <div className="trend-bar-card__bars">
                      <div className="trend-bar trend-bar--opened" style={{ height: `${(point.opened_count / Math.max(maxFlow, 1)) * 100}%` }} />
                      <div className="trend-bar trend-bar--resolved" style={{ height: `${(point.resolved_count / Math.max(maxFlow, 1)) * 100}%` }} />
                      <div className="trend-line-pill" style={{ bottom: `${(point.open_backlog_count / Math.max(maxBacklog, 1)) * 100}%` }}>
                        {point.open_backlog_count}
                      </div>
                    </div>
                    <div className="trend-bar-card__meta">
                      <strong>{point.label}</strong>
                      <span className="muted">Opened {point.opened_count} | Resolved {point.resolved_count}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel dashboard-panel">
            <div className="section-title">Category Breakdown</div>
            <p className="section-subtitle">Support mix split by the flexible category rules backing Schools, Sports, and Other.</p>
            <div className="customer-service-category-grid">
              {(summary?.category_breakdown ?? []).map((row) => (
                <article key={row.category} className="request-card customer-service-category-card">
                  <strong>{humanizeLabel(row.category)}</strong>
                  <div className="dashboard-summary-list">
                    <div className="dashboard-summary-row">
                      <span className="muted">30-day volume</span>
                      <strong>{row.total_count}</strong>
                    </div>
                    <div className="dashboard-summary-row">
                      <span className="muted">Open</span>
                      <strong>{row.open_count}</strong>
                    </div>
                    <div className="dashboard-summary-row">
                      <span className="muted">Resolved</span>
                      <strong>{row.resolved_count}</strong>
                    </div>
                    <div className="dashboard-summary-row">
                      <span className="muted">Unassigned</span>
                      <strong>{row.unassigned_count}</strong>
                    </div>
                  </div>
                </article>
              ))}
              {!summary?.category_breakdown.length ? <div className="empty-state empty-state--panel">No categorized tickets are available yet.</div> : null}
            </div>
          </section>

          <section className="panel dashboard-panel">
            <div className="section-title">Read-Only Ticket Visibility</div>
            <p className="section-subtitle">A lightweight context list for leadership only. Ticket work still lives in Zendesk.</p>
            {!ticketList?.tickets.length ? (
              <div className="empty-state empty-state--panel">There are no tickets to show for the current filter.</div>
            ) : (
              <div className="report-table-shell">
                <table className="shoots-table report-table">
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Status</th>
                      <th>Requester</th>
                      <th>Assignee</th>
                      <th>Category</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ticketList.tickets.map((ticket) => (
                      <tr key={ticket.zendesk_ticket_id}>
                        <td>
                          <strong>{ticket.subject}</strong>
                          <div className="muted">#{ticket.zendesk_ticket_id}</div>
                        </td>
                        <td>
                          <span className={`risk-pill risk-pill--${mapTicketTone(ticket.status)}`}>{humanizeLabel(ticket.status)}</span>
                          <div className="muted">{ticket.priority ? humanizeLabel(ticket.priority) : "No priority"}</div>
                        </td>
                        <td>
                          <strong>{ticket.requester_name ?? "Requester not available"}</strong>
                          <div className="muted">{ticket.organization_name ?? ticket.requester_email ?? "No organization"}</div>
                        </td>
                        <td>{ticket.assignee_name ?? "Unassigned"}</td>
                        <td>{humanizeLabel(ticket.category)}</td>
                        <td>
                          <div>{new Date(ticket.ticket_updated_at).toLocaleString()}</div>
                          {ticket.external_url ? (
                            <a href={ticket.external_url} target="_blank" rel="noreferrer">
                              Open in Zendesk
                            </a>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="panel dashboard-sidebar">
          <div className="section-title">Support Health</div>
          <p className="section-subtitle">A quick read on queue health, sync freshness, and category mapping without leaving Mission Control.</p>

          <div className="request-card">
            <strong>{humanizeLabel(connection?.provider_mode ?? "mock")}</strong>
            <div className="muted">{connection?.connection_label ?? "Loading Zendesk reporting state..."}</div>
            <div className="outlook-connection-card__meta">
              <span className={`status-pill status-pill--${mapConnectionTone(connection)}`}>{humanizeLabel(connection?.health_state ?? "disabled")}</span>
              <span className="metric-pill">Records: {connection?.records_synced ?? 0}</span>
              <span className="metric-pill">Warnings: {connection?.warning_count ?? 0}</span>
            </div>
            <div className="dashboard-summary-list">
              <div className="dashboard-summary-row">
                <span className="muted">Last sync</span>
                <strong>{connection?.last_sync_at ? new Date(connection.last_sync_at).toLocaleString() : "Not synced yet"}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Last failed sync</span>
                <strong>{connection?.last_failed_sync_at ? new Date(connection.last_failed_sync_at).toLocaleString() : "No recorded failures"}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Coverage</span>
                <strong>{connection?.demo_mode ? "Demo summary only" : "Operational summary view"}</strong>
              </div>
              <div className="dashboard-summary-row">
                <span className="muted">Drill-down source</span>
                <strong>{connection?.demo_mode ? "Mission Control demo dataset" : "Zendesk filtered views"}</strong>
              </div>
            </div>
          </div>

          <section className="sidebar-section">
            <div className="section-title">Queue Health</div>
            <div className="request-card">
              <div className="dashboard-summary-list">
                {(summary?.queue_health.aging_buckets ?? []).map((bucket) => (
                  <div key={bucket.label} className="dashboard-summary-row">
                    <span className="muted">{bucket.label}</span>
                    <strong>{bucket.count}</strong>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="sidebar-section">
            <div className="section-title">Status Breakdown</div>
            <div className="outlook-list">
              {(summary?.queue_health.status_breakdown ?? []).map((row) => (
                <article key={row.status} className="outlook-item">
                  <div className="outlook-item__button outlook-item__button--static">
                    <div className="outlook-item__head">
                      <strong>{humanizeLabel(row.status)}</strong>
                      <span className={`risk-pill risk-pill--${mapTicketTone(row.status)}`}>{row.count}</span>
                    </div>
                  </div>
                </article>
              ))}
              {!summary?.queue_health.status_breakdown.length ? <div className="empty-state">No ticket status rows are available yet.</div> : null}
            </div>
          </section>

          <section className="sidebar-section">
            <div className="section-title">Recent Sync Runs</div>
            <div className="outlook-list">
              {(status?.sync_runs ?? []).map((run) => (
                <article key={run.id} className="outlook-item">
                  <div className="outlook-item__button outlook-item__button--static">
                    <div className="outlook-item__head">
                      <strong>{humanizeLabel(run.status)} sync</strong>
                      <span className={`risk-pill risk-pill--${run.status === "error" ? "critical" : run.status === "warning" ? "watch" : "normal"}`}>
                        {run.records_synced} tickets
                      </span>
                    </div>
                    <div className="muted">{new Date(run.started_at).toLocaleString()}</div>
                    <div className="muted">{run.warnings[0] ?? run.errors[0]?.message ?? "No warnings or errors recorded."}</div>
                  </div>
                </article>
              ))}
              {!status?.sync_runs.length ? <div className="empty-state">No sync history is available yet.</div> : null}
            </div>
          </section>

          <section className="sidebar-section">
            <div className="section-title">Signal Flags</div>
            <div className="request-card">
              <div className="dashboard-summary-list">
                <div className="dashboard-summary-row">
                  <span className="muted">Backlog</span>
                  <strong>{summary?.flags.backlog_rising ? "Rising" : "Stable"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Reply speed</span>
                  <strong>{summary?.flags.reply_time_degrading ? "Slower" : "Stable"}</strong>
                </div>
                <div className="dashboard-summary-row">
                  <span className="muted">Volume spike</span>
                  <strong>{summary?.flags.unusual_ticket_spike ? "Needs eyes on it" : "Within range"}</strong>
                </div>
              </div>
            </div>
          </section>
        </aside>
      </section>
    </>
  );
}

function humanizeLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatMinutes(value?: number | null) {
  if (value === null || value === undefined) {
    return "n/a";
  }
  return `${Math.round(value)} min`;
}

function formatSigned(value?: number | null, suffix = "") {
  if (value === null || value === undefined) {
    return "No baseline yet";
  }
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value}${suffix}`;
}

function mapConnectionTone(connection: ZendeskConnection | null) {
  if (!connection) {
    return "connecting";
  }
  if (connection.health_state === "connected_error") {
    return "error";
  }
  if (connection.health_state === "connected_warning" || connection.stale_sync) {
    return "watch";
  }
  if (connection.demo_mode) {
    return "connecting";
  }
  return "connected";
}

function mapTicketTone(status: string) {
  if (["new", "open"].includes(status)) {
    return "watch";
  }
  if (["hold", "on-hold"].includes(status)) {
    return "critical";
  }
  return "normal";
}
