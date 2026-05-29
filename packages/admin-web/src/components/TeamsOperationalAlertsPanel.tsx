import { useEffect, useMemo, useState } from "react";
import type {
  OperationalAlertAdminPayload,
  OperationalAlertDefinition,
  OperationalAlertRouteWriteInput
} from "../operationalAlertsTypes";
import {
  createTeamsOperationalAlertRoute,
  getTeamsOperationalAlerts,
  updateTeamsOperationalAlertRoute
} from "../services/teamsOperationalAlertsApi";

type Props = {
  token: string;
};

type FormState = {
  routeId: string | null;
  alertType: OperationalAlertRouteWriteInput["alert_type"];
  routeName: string;
  destinationLabel: string;
  webhookUrl: string;
  channelName: string;
  severityThreshold: OperationalAlertRouteWriteInput["severity_threshold"];
  throttleWindowMinutes: number;
  enabled: boolean;
};

const EMPTY_FORM: FormState = {
  routeId: null,
  alertType: "staff_assignment_conflict_detected",
  routeName: "",
  destinationLabel: "",
  webhookUrl: "",
  channelName: "",
  severityThreshold: "high",
  throttleWindowMinutes: 120,
  enabled: true
};

export function TeamsOperationalAlertsPanel({ token }: Props) {
  const [payload, setPayload] = useState<OperationalAlertAdminPayload | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    try {
      const next = await getTeamsOperationalAlerts(token);
      setPayload(next);
      setError("");
      setForm((current) => (current.routeId ? current : applyDefinitionDefaults(current, next.definitions[0] ?? null)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't load Teams operational alerts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  const definitionsByType = useMemo(() => {
    const map = new Map<OperationalAlertDefinition["type"], OperationalAlertDefinition>();
    for (const definition of payload?.definitions ?? []) {
      map.set(definition.type, definition);
    }
    return map;
  }, [payload]);

  async function saveRoute(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const input: OperationalAlertRouteWriteInput = {
        alert_type: form.alertType,
        delivery_channel: "teams_webhook",
        route_name: form.routeName,
        destination_label: form.destinationLabel,
        destination_config: {
          webhook_url: form.webhookUrl,
          channel_name: form.channelName || null
        },
        severity_threshold: form.severityThreshold,
        throttle_window_minutes: form.throttleWindowMinutes,
        enabled: form.enabled
      };

      if (form.routeId) {
        await updateTeamsOperationalAlertRoute(token, form.routeId, input);
        setNotice("Teams alert route updated.");
      } else {
        await createTeamsOperationalAlertRoute(token, input);
        setNotice("Teams alert route created.");
      }

      setForm(applyDefinitionDefaults(EMPTY_FORM, definitionsByType.get(form.alertType) ?? null));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't save that Teams alert route.");
    } finally {
      setWorking(false);
    }
  }

  async function toggleRoute(routeId: string, enabled: boolean) {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await updateTeamsOperationalAlertRoute(token, routeId, { enabled });
      setNotice(enabled ? "Teams alert route enabled." : "Teams alert route disabled.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't update that Teams alert route.");
    } finally {
      setWorking(false);
    }
  }

  function startEditing(routeId: string) {
    const route = payload?.routes.find((entry) => entry.id === routeId);
    if (!route) {
      return;
    }
    setNotice("");
    setError("");
    setForm({
      routeId: route.id,
      alertType: route.alert_type,
      routeName: route.route_name,
      destinationLabel: route.destination_label,
      webhookUrl: typeof route.destination_config.webhook_url === "string" ? route.destination_config.webhook_url : "",
      channelName: typeof route.destination_config.channel_name === "string" ? route.destination_config.channel_name : "",
      severityThreshold: route.severity_threshold,
      throttleWindowMinutes: route.throttle_window_minutes,
      enabled: route.enabled
    });
  }

  function resetForm() {
    setForm(applyDefinitionDefaults(EMPTY_FORM, payload?.definitions[0] ?? null));
    setNotice("");
    setError("");
  }

  function handleAlertTypeChange(nextAlertType: FormState["alertType"]) {
    const definition = definitionsByType.get(nextAlertType) ?? null;
    setForm((current) =>
      applyDefinitionDefaults(
        {
          ...current,
          alertType: nextAlertType
        },
        definition
      )
    );
  }

  return (
    <section className="panel dashboard-panel">
      <div className="section-title">Teams Operational Alerts</div>
      <p className="section-subtitle">
        Route high-signal operational alerts into Teams without moving business logic out of Mission Control.
      </p>

      {notice ? <div className="feedback-strip feedback-strip--success">{notice}</div> : null}
      {error ? <div className="feedback-strip feedback-strip--danger">{error}</div> : null}
      {payload && !payload.teams_enabled ? (
        <div className="feedback-strip feedback-strip--info">
          Teams alert delivery is disabled in this environment. Routes can still be configured for rollout.
        </div>
      ) : null}

      <div className="dashboard-summary-list">
        <div className="dashboard-summary-row">
          <span className="muted">Configured routes</span>
          <strong>{payload?.routes.length ?? 0}</strong>
        </div>
        <div className="dashboard-summary-row">
          <span className="muted">Recent deliveries</span>
          <strong>{payload?.recent_deliveries.length ?? 0}</strong>
        </div>
        <div className="dashboard-summary-row">
          <span className="muted">Last refresh</span>
          <strong>{payload?.generated_at ? new Date(payload.generated_at).toLocaleString() : "Loading..."}</strong>
        </div>
      </div>

      <form className="outlook-connection-card teams-alert-form" onSubmit={saveRoute}>
        <div className="outlook-connection-card__header">
          <div>
            <div className="eyebrow">{form.routeId ? "Edit Route" : "New Route"}</div>
            <strong>{form.routeId ? "Update Teams routing" : "Create Teams route"}</strong>
          </div>
          <div className="schedule-card-actions">
            <button type="button" className="secondary-button" onClick={resetForm} disabled={working}>
              Reset
            </button>
            <button type="submit" className="primary-button" disabled={working || loading}>
              {working ? "Saving..." : form.routeId ? "Save Route" : "Create Route"}
            </button>
          </div>
        </div>

        <div className="dashboard-grid teams-alert-form-grid">
          <label className="filter-field">
            <span>Alert Type</span>
            <select value={form.alertType} onChange={(event) => handleAlertTypeChange(event.target.value as FormState["alertType"])}>
              {(payload?.definitions ?? []).map((definition) => (
                <option key={definition.type} value={definition.type}>
                  {definition.label}
                </option>
              ))}
            </select>
          </label>

          <label className="filter-field">
            <span>Route Name</span>
            <input value={form.routeName} onChange={(event) => setForm((current) => ({ ...current, routeName: event.target.value }))} />
          </label>

          <label className="filter-field">
            <span>Destination Label</span>
            <input
              value={form.destinationLabel}
              onChange={(event) => setForm((current) => ({ ...current, destinationLabel: event.target.value }))}
            />
          </label>

          <label className="filter-field">
            <span>Webhook URL</span>
            <input
              type="url"
              value={form.webhookUrl}
              onChange={(event) => setForm((current) => ({ ...current, webhookUrl: event.target.value }))}
              placeholder="https://..."
            />
          </label>

          <label className="filter-field">
            <span>Channel Name</span>
            <input value={form.channelName} onChange={(event) => setForm((current) => ({ ...current, channelName: event.target.value }))} />
          </label>

          <label className="filter-field">
            <span>Severity Threshold</span>
            <select
              value={form.severityThreshold}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  severityThreshold: event.target.value as FormState["severityThreshold"]
                }))
              }
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>

          <label className="filter-field">
            <span>Throttle Minutes</span>
            <input
              type="number"
              min={1}
              max={10080}
              value={form.throttleWindowMinutes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  throttleWindowMinutes: Number(event.target.value || 0)
                }))
              }
            />
          </label>

          <label className="toggle-label">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
            />
            Route enabled
          </label>
        </div>

        <div className="muted">
          {(definitionsByType.get(form.alertType) ?? payload?.definitions[0])?.summary ?? "Choose a high-signal alert type for this route."}
        </div>
      </form>

      <div className="section-title with-divider">Configured Routes</div>
      {loading ? <div className="empty-state empty-state--panel">Loading Teams alert routes...</div> : null}
      {!loading && !payload?.routes.length ? <div className="empty-state empty-state--panel">No Teams alert routes are configured yet.</div> : null}
      {!loading && payload?.routes.length ? (
        <div className="outlook-list">
          {payload.routes.map((route) => {
            const definition = definitionsByType.get(route.alert_type);
            return (
              <article key={route.id} className="outlook-item">
                <div className="outlook-item__button outlook-item__button--static">
                  <div className="outlook-item__head">
                    <div>
                      <strong>{route.route_name}</strong>
                      <div className="muted">{definition?.label ?? route.alert_type}</div>
                    </div>
                    <div className="outlook-item__meta">
                      <span className={`risk-pill risk-pill--${route.enabled ? "normal" : "watch"}`}>
                        {route.enabled ? "Enabled" : "Disabled"}
                      </span>
                      <span className="meta-pill">{route.severity_threshold}</span>
                      <span className="meta-pill">{route.throttle_window_minutes} min</span>
                    </div>
                  </div>

                  <div className="dashboard-summary-list">
                    <div className="dashboard-summary-row">
                      <span className="muted">Destination</span>
                      <strong>{route.destination_label}</strong>
                    </div>
                    <div className="dashboard-summary-row">
                      <span className="muted">Webhook</span>
                      <strong>{route.masked_destination ?? "Configured"}</strong>
                    </div>
                    <div className="dashboard-summary-row">
                      <span className="muted">Recent delivery</span>
                      <strong>
                        {route.last_delivery_status
                          ? `${route.last_delivery_status} - ${route.last_delivery_at ? new Date(route.last_delivery_at).toLocaleString() : "recent"}`
                          : "No deliveries yet"}
                      </strong>
                    </div>
                    <div className="dashboard-summary-row">
                      <span className="muted">14d failures</span>
                      <strong>{route.failure_count_14d}</strong>
                    </div>
                  </div>

                  <div className="schedule-card-actions">
                    <button className="secondary-button" onClick={() => startEditing(route.id)} disabled={working}>
                      Edit
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => void toggleRoute(route.id, !route.enabled)}
                      disabled={working}
                    >
                      {route.enabled ? "Disable" : "Enable"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      <div className="section-title with-divider">Recent Teams Deliveries</div>
      {!loading && !payload?.recent_deliveries.length ? <div className="empty-state empty-state--panel">No Teams deliveries have been attempted yet.</div> : null}
      {!loading && payload?.recent_deliveries.length ? (
        <div className="outlook-list">
          {payload.recent_deliveries.map((delivery) => (
            <article key={delivery.id} className="outlook-item">
              <div className="outlook-item__button outlook-item__button--static">
                <div className="outlook-item__head">
                  <div>
                    <strong>{delivery.title}</strong>
                    <div className="muted">{delivery.route_name} - {delivery.destination_label}</div>
                  </div>
                  <span className={`risk-pill risk-pill--${delivery.status === "sent" ? "normal" : delivery.status === "throttled" ? "watch" : "critical"}`}>
                    {delivery.status}
                  </span>
                </div>
                <div className="muted">{delivery.summary}</div>
                <div className="outlook-item__meta">
                  <span className="meta-pill">{delivery.alert_type}</span>
                  <span className="meta-pill">{delivery.severity}</span>
                  <span className="meta-pill">Attempts: {delivery.attempt_count}</span>
                  <span className="meta-pill">{new Date(delivery.created_at).toLocaleString()}</span>
                </div>
                {delivery.last_error ? <div className="muted">Last error: {delivery.last_error}</div> : null}
                {delivery.deep_link ? (
                  <a href={delivery.deep_link} target="_blank" rel="noreferrer">
                    Open in Mission Control
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function applyDefinitionDefaults(current: FormState, definition: OperationalAlertDefinition | null) {
  if (!definition) {
    return current;
  }
  if (current.routeId) {
    return current;
  }
  return {
    ...current,
    alertType: definition.type,
    severityThreshold: definition.recommended_severity,
    throttleWindowMinutes: definition.recommended_throttle_minutes
  };
}
