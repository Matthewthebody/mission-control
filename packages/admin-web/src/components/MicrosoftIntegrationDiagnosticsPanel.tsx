import { useEffect, useMemo, useState } from "react";
import type {
  MicrosoftIntegrationEventRecord,
  MicrosoftIntegrationFeatureFlags,
  MicrosoftIntegrationHealthCheck,
  MicrosoftIntegrationHealthPayload
} from "../microsoftIntegrationTypes";
import {
  getMicrosoftIntegrationHealth,
  listMicrosoftIntegrationDiagnostics
} from "../services/microsoftIntegrationObservabilityApi";

type Props = {
  token: string;
};

export function MicrosoftIntegrationDiagnosticsPanel({ token }: Props) {
  const [health, setHealth] = useState<MicrosoftIntegrationHealthPayload | null>(null);
  const [events, setEvents] = useState<MicrosoftIntegrationEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [healthPayload, eventRows] = await Promise.all([
        getMicrosoftIntegrationHealth(token),
        listMicrosoftIntegrationDiagnostics(token, { limit: 30 })
      ]);
      setHealth(healthPayload);
      setEvents(eventRows);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't load Microsoft integration diagnostics.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  const enabledFlags = useMemo(
    () =>
      Object.entries(health?.feature_flags ?? {}).filter(([, enabled]) => enabled) as Array<
        [keyof MicrosoftIntegrationFeatureFlags, boolean]
      >,
    [health]
  );
  const disabledFlags = useMemo(
    () =>
      Object.entries(health?.feature_flags ?? {}).filter(([, enabled]) => !enabled) as Array<
        [keyof MicrosoftIntegrationFeatureFlags, boolean]
      >,
    [health]
  );
  const enabledChecks = useMemo(
    () => (health?.health_checks ?? []).filter((check) => check.status !== "disabled"),
    [health]
  );
  const disabledChecks = useMemo(
    () => (health?.health_checks ?? []).filter((check) => check.status === "disabled"),
    [health]
  );
  const enabledAreas = useMemo(() => new Set(enabledChecks.map((check) => check.area)), [enabledChecks]);
  const visibleEvents = useMemo(
    () => events.filter((event) => enabledAreas.has(event.integration_area)),
    [enabledAreas, events]
  );
  const hiddenDisabledEventCount = events.length - visibleEvents.length;

  return (
    <section className="panel dashboard-panel">
      <div className="section-title">Microsoft Integration Diagnostics</div>
      <p className="section-subtitle">
        Validate active Microsoft feature flags, setup, and recent failures for the surfaces that are enabled in this
        environment. Disabled Microsoft surfaces are listed separately so they do not read as live.
      </p>

      {error ? <div className="feedback-strip feedback-strip--danger">{error}</div> : null}

      <div className="outlook-connection-card__header">
        <div className="outlook-connection-card__meta">
          <span className="metric-pill">Enabled features: {enabledFlags.length}</span>
          <span className="metric-pill">Disabled features: {disabledFlags.length}</span>
          <span className="metric-pill">
            Startup validation: {health?.startup_validation.valid ? "Ready" : "Needs review"}
          </span>
          <span className="metric-pill">
            Last refresh: {health?.generated_at ? new Date(health.generated_at).toLocaleString() : "Loading..."}
          </span>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="outlook-item__meta">
        {enabledFlags.map(([key]) => (
          <span key={key} className="meta-pill">
            {humanizeFlag(key)}
          </span>
        ))}
        {!enabledFlags.length ? <span className="meta-pill">No Microsoft features enabled</span> : null}
      </div>

      {disabledFlags.length ? (
        <section className="outlook-connection-card">
          <div className="outlook-connection-card__header">
            <div>
              <div className="eyebrow">Disabled In This Environment</div>
              <strong>Not part of the live surface</strong>
            </div>
          </div>
          <div className="outlook-item__meta">
            {disabledFlags.map(([key]) => (
              <span key={key} className="meta-pill">
                {humanizeFlag(key)}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <div className="outlook-list">
        {enabledChecks.map((check) => (
          <article key={check.area} className="outlook-item">
            <div className="outlook-item__button outlook-item__button--static">
              <div className="outlook-item__head">
                <div>
                  <strong>{humanizeArea(check.area)}</strong>
                  <div className="muted">{check.summary}</div>
                </div>
                <span className={`status-pill status-pill--${mapHealthTone(check.status)}`}>{humanizeStatus(check.status)}</span>
              </div>
              <div className="outlook-item__meta">
                <span className="meta-pill">Recent failures: {check.recent_failure_count}</span>
                <span className="meta-pill">
                  Last event: {check.last_event_at ? new Date(check.last_event_at).toLocaleString() : "None"}
                </span>
              </div>
            </div>
          </article>
        ))}
        {!enabledChecks.length ? <div className="empty-state empty-state--panel">No Microsoft feature surfaces are enabled right now.</div> : null}
      </div>

      {disabledChecks.length ? (
        <section className="outlook-connection-card">
          <div className="outlook-connection-card__header">
            <div>
              <div className="eyebrow">Disabled Health Areas</div>
              <strong>Shown separately from active checks</strong>
            </div>
          </div>
          <div className="outlook-list">
            {disabledChecks.map((check) => (
              <article key={check.area} className="outlook-item">
                <div className="outlook-item__button outlook-item__button--static">
                  <div className="outlook-item__head">
                    <div>
                      <strong>{humanizeArea(check.area)}</strong>
                      <div className="muted">{check.summary}</div>
                    </div>
                    <span className="status-pill status-pill--default">Disabled</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="outlook-connection-card">
        <div className="outlook-connection-card__header">
          <div>
            <div className="eyebrow">Startup Validation</div>
            <strong>Config and setup checks</strong>
          </div>
        </div>
        {health?.startup_validation.issues.length ? (
          <div className="outlook-list">
            {health.startup_validation.issues.map((issue) => (
              <article key={issue.code} className="outlook-item">
                <div className="outlook-item__button outlook-item__button--static">
                  <div className="outlook-item__head">
                    <div>
                      <strong>{issue.summary}</strong>
                      <div className="muted">{issue.code}</div>
                    </div>
                    <span className={`risk-pill risk-pill--${issue.severity === "error" ? "critical" : "watch"}`}>
                      {issue.severity}
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state empty-state--panel">No blocking Microsoft setup issues are active right now.</div>
        )}
      </section>

      <section className="outlook-connection-card">
        <div className="outlook-connection-card__header">
          <div>
            <div className="eyebrow">Recent Diagnostics</div>
            <strong>Latest events for enabled Microsoft surfaces</strong>
          </div>
        </div>
        {hiddenDisabledEventCount > 0 ? (
          <div className="muted">
            {hiddenDisabledEventCount} historical event{hiddenDisabledEventCount === 1 ? "" : "s"} from disabled Microsoft
            surfaces are hidden from the live diagnostics feed.
          </div>
        ) : null}
        <div className="outlook-list">
          {visibleEvents.map((event) => (
            <article key={event.id} className="outlook-item">
              <div className="outlook-item__button outlook-item__button--static">
                <div className="outlook-item__head">
                  <div>
                    <strong>{event.summary}</strong>
                    <div className="muted">
                      {humanizeArea(event.integration_area)} · {event.event_type} · {new Date(event.occurred_at).toLocaleString()}
                    </div>
                  </div>
                  <span className={`risk-pill risk-pill--${event.event_level === "error" ? "critical" : event.event_level === "warning" ? "watch" : "normal"}`}>
                    {event.event_level}
                  </span>
                </div>
                <div className="outlook-item__meta">
                  {event.event_status ? <span className="meta-pill">Status: {event.event_status}</span> : null}
                  {event.external_target ? <span className="meta-pill">Target: {event.external_target}</span> : null}
                  {event.request_id ? <span className="meta-pill">Request: {event.request_id}</span> : null}
                </div>
              </div>
            </article>
          ))}
          {!visibleEvents.length ? <div className="empty-state empty-state--panel">No enabled-surface Microsoft diagnostics have been recorded yet.</div> : null}
        </div>
      </section>
    </section>
  );
}

function humanizeFlag(value: keyof MicrosoftIntegrationFeatureFlags) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function humanizeArea(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function humanizeStatus(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function mapHealthTone(status: MicrosoftIntegrationHealthCheck["status"]) {
  if (status === "healthy") {
    return "success";
  }
  if (status === "warning") {
    return "warning";
  }
  if (status === "failing") {
    return "danger";
  }
  return "default";
}
