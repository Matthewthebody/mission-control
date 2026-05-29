import { useEffect, useMemo, useState } from "react";
import type { Socket } from "socket.io-client";
import { apiFetch } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LocationIntelligencePanel } from "../components/LocationIntelligencePanel";
import { MicrosoftIntegrationDiagnosticsPanel } from "../components/MicrosoftIntegrationDiagnosticsPanel";
import { MondaySchoolAdminPanel } from "../components/MondaySchoolAdminPanel";
import { TeamsOperationalAlertsPanel } from "../components/TeamsOperationalAlertsPanel";
import { getIntegrationGovernance } from "../services/integrationGovernanceApi";
import { syncZendesk, testZendeskConnection } from "../services/customerServiceApi";
import type {
  IntegrationConflictReview,
  IntegrationGovernancePayload,
  IntegrationGovernanceProviderSummary,
  IntegrationLinkedRecordSummary,
  IntegrationSourceOfTruthRule,
  OutlookCalendar,
  OutlookCalendarConnectResponse,
  OutlookCalendarEvent,
  OutlookCalendarStatusPayload,
  SessionUser
} from "../types";

type Props = {
  token: string;
  currentUser: SessionUser;
  socket: Socket | null;
};

type OutlookResetScope = "mock_preview" | "graph_live_connection" | "pilot_tenant_test_data";
type PendingAction =
  | "disconnect"
  | "sync"
  | "reset_mock_preview"
  | "reset_graph_live_connection"
  | "reset_pilot_tenant_test_data"
  | null;
type PreviewWindow = "today" | "3day" | "week";
type OutlookPilotState =
  | "feature_disabled"
  | "configured_disconnected"
  | "mock_connected"
  | "connected_zero_calendars"
  | "connected_healthy"
  | "connected_attention";

export function OutlookIntegration({ token, currentUser, socket }: Props) {
  const [routeContext, setRouteContext] = useState(() => readIntegrationRouteContext());
  const [date, setDate] = useState(getLocalDateString());
  const [previewWindow, setPreviewWindow] = useState<PreviewWindow>("3day");
  const [overlapOnly, setOverlapOnly] = useState(false);
  const [governance, setGovernance] = useState<IntegrationGovernancePayload | null>(null);
  const [status, setStatus] = useState<OutlookCalendarStatusPayload | null>(null);
  const [calendars, setCalendars] = useState<OutlookCalendar[]>([]);
  const [events, setEvents] = useState<OutlookCalendarEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [zendeskWorking, setZendeskWorking] = useState(false);
  const [visibilityWorkingId, setVisibilityWorkingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  useEffect(() => {
    const callbackNotice = consumeOutlookNoticeFromHash();
    if (callbackNotice) {
      setNotice(describeOutlookNotice(callbackNotice));
    }
  }, []);

  useEffect(() => {
    const onHashChange = () => setRouteContext(readIntegrationRouteContext());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const eventsQuery = useMemo(() => {
    const params = new URLSearchParams({
      date,
      window: previewWindow,
      enabled_only: "true"
    });
    if (overlapOnly) {
      params.set("overlap_only", "true");
    }
    return params.toString();
  }, [date, overlapOnly, previewWindow]);

  async function load() {
    setLoading(true);
    try {
      const [governancePayload, statusPayload, calendarRows, eventRows] = await Promise.all([
        getIntegrationGovernance(token),
        apiFetch<OutlookCalendarStatusPayload>(`/api/integrations/outlook/status?date=${date}`, token),
        apiFetch<OutlookCalendar[]>(`/api/integrations/outlook/calendars?date=${date}`, token),
        apiFetch<OutlookCalendarEvent[]>(`/api/integrations/outlook/events/preview?${eventsQuery}`, token)
      ]);
      setGovernance(governancePayload);
      setStatus(statusPayload);
      setCalendars(calendarRows);
      setEvents(eventRows);
      setSelectedEventId((current) => current || eventRows[0]?.id || "");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't load Outlook calendars right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [eventsQuery, token]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const clearLiveMessage = () => window.setTimeout(() => setLiveMessage(""), 2400);
    const onRefresh = () => {
      setLiveMessage("Live update: Outlook calendar preview refreshed against the current schedule.");
      void load();
      clearLiveMessage();
    };

    socket.on("schedule_changed", onRefresh);
    socket.on("attendance_changed", onRefresh);
    return () => {
      socket.off("schedule_changed", onRefresh);
      socket.off("attendance_changed", onRefresh);
    };
  }, [eventsQuery, socket, token]);

  const activeAccount = status?.account;
  const graphStub = status?.graph_stub;
  const graphConfigured = isGraphConfigured(graphStub);
  const graphConnected = activeAccount?.provider_mode === "graph_live" && activeAccount?.connection_status === "connected";
  const providerMode = activeAccount?.provider_mode ?? (graphConfigured ? "graph_live" : "mock");
  const accountState = activeAccount?.connection_status ?? "disconnected";
  const activeCalendars = calendars.filter((calendar) => calendar.visible_in_app);
  const calendarsReturned = calendars.length > 0;
  const liveCalendarsAvailable = graphConnected && calendarsReturned;
  const mockPreviewConnected = providerMode === "mock" && accountState === "connected";
  const pilotState = getOutlookPilotState(activeAccount, graphConfigured, calendarsReturned);
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? events[0] ?? null;
  const providerCards = governance?.providers ?? [];
  const outlookProvider = providerCards.find((provider) => provider.provider === "outlook") ?? null;
  const zendeskProvider = providerCards.find((provider) => provider.provider === "zendesk") ?? null;
  const mondayProvider = providerCards.find((provider) => provider.provider === "monday") ?? null;
  const showLiveConnectCta = graphConfigured && !liveCalendarsAvailable;
  const showUseMockPreviewCta = graphConfigured && !graphConnected && !mockPreviewConnected;
  const showConnectMockPreviewCta = !graphConfigured && accountState !== "connected";
  const primaryConnectLabel = getMicrosoft365ConnectLabel(activeAccount, graphConfigured, calendarsReturned);
  const syncLabel = activeAccount?.provider_mode === "graph_live" ? "Refresh Live Preview" : "Refresh Mock Preview";
  const disconnectLabel = providerMode === "mock" ? "Disconnect Mock Preview" : "Disconnect";

  async function connect(provider: "mock" | "graph") {
    setWorking(true);
    setError("");
    try {
      const payload = await apiFetch<OutlookCalendarConnectResponse>(`/api/integrations/outlook/connect?date=${date}&provider=${provider}`, token, {
        method: "POST"
      });
      if (payload.connect_mode === "oauth_redirect" && payload.authorization_url) {
        setNotice("Redirecting to Microsoft sign-in...");
        window.location.assign(payload.authorization_url);
        return;
      }
      setStatus(payload);
      setNotice(provider === "graph" ? "Microsoft Outlook calendars connected." : "Mock Outlook calendar preview connected.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't connect Outlook calendars.");
    } finally {
      setWorking(false);
    }
  }

  async function performAction(action: "disconnect" | "sync") {
    setWorking(true);
    setError("");
    try {
      const payload = await apiFetch<any>(`/api/integrations/outlook/${action}?date=${date}`, token, { method: "POST" });
      setStatus(payload);
      setNotice(
        action === "disconnect"
          ? graphConnected
            ? "Microsoft Outlook calendars disconnected."
            : "Mock Outlook calendar preview disconnected."
          : payload.account?.provider_mode === "graph_live"
            ? "Live Outlook preview refreshed."
            : "Mock Outlook preview refreshed."
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `We couldn't ${action} Outlook calendars.`);
    } finally {
      setWorking(false);
      setPendingAction(null);
    }
  }

  async function performReset(scope: OutlookResetScope) {
    setWorking(true);
    setError("");
    try {
      const payload = await apiFetch<OutlookCalendarStatusPayload>(`/api/integrations/outlook/reset?date=${date}`, token, {
        method: "POST",
        body: JSON.stringify({ scope })
      });
      setStatus(payload);
      setNotice(
        scope === "mock_preview"
          ? "Mock preview state reset."
          : scope === "graph_live_connection"
            ? "Live Microsoft 365 connection state reset."
            : "Local Outlook pilot test data reset."
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't reset Outlook pilot state.");
    } finally {
      setWorking(false);
      setPendingAction(null);
    }
  }

  async function updateVisibility(calendar: OutlookCalendar, visibleInApp: boolean) {
    setVisibilityWorkingId(calendar.id);
    setError("");
    try {
      const nextCalendars = await apiFetch<OutlookCalendar[]>(
        `/api/integrations/outlook/calendars/${encodeURIComponent(calendar.id)}/visibility?date=${date}`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({ visible_in_app: visibleInApp })
        }
      );
      setCalendars(nextCalendars);
      setNotice(
        visibleInApp
          ? `${calendar.name} is now visible on the dashboard.`
          : `${calendar.name} is now hidden in Mission Control. It remains connected in Outlook.`
      );
      const refreshedEvents = await apiFetch<OutlookCalendarEvent[]>(`/api/integrations/outlook/events/preview?${eventsQuery}`, token);
      setEvents(refreshedEvents);
      setSelectedEventId((current) => current || refreshedEvents[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't update calendar visibility.");
    } finally {
      setVisibilityWorkingId("");
    }
  }

  async function runZendeskAction(action: "test" | "sync") {
    setZendeskWorking(true);
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
      setZendeskWorking(false);
    }
  }

  async function replaySyncOperation(operationId: string) {
    setWorking(true);
    setError("");
    try {
      await apiFetch(`/api/integrations/sync-operations/${operationId}/replay`, token, {
        method: "POST"
      });
      setNotice("Sync replay queued.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't replay that sync operation.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">Admin Integrations</div>
          <h2>Outlook Delegated Pilot</h2>
          <p>This route keeps the delegated Outlook calendar pilot front and center while still showing the wider integration governance picture for Zendesk and Monday coexistence.</p>
        </div>
        <div className="page-intro-actions">
          <div className="metric-pill">Viewer: {currentUser.fullName}</div>
          <label className="filter-field">
            <span>Reference Date</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <button className="secondary-button" onClick={() => void load()}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </section>

      <section className="metrics-grid">
        <article className="stat-card panel">
          <div className="eyebrow">Connected Systems</div>
          <strong>{governance?.summary.connected_count ?? 0} of {governance?.summary.provider_count ?? 3}</strong>
          <span className="muted">Connectors that are currently active or configured for this tenant.</span>
          <div className="outlook-connection-card__meta">
            <span className="metric-pill">Last updated: {governance?.summary.last_updated_at ? new Date(governance.summary.last_updated_at).toLocaleString() : "Loading..."}</span>
            <span className="metric-pill">Freshness: {governance?.summary.freshness.label ?? "Recently Updated"}</span>
          </div>
        </article>

        <article className="stat-card panel">
          <div className="eyebrow">Manual Review</div>
          <strong>{governance?.summary.unresolved_conflict_count ?? 0} open conflicts</strong>
          <span className="muted">Conflict review stays explicit so no protected field gets silently overwritten during coexistence.</span>
          <div className="outlook-connection-card__meta">
            <span className="metric-pill">Pending sync: {governance?.summary.pending_sync_count ?? 0}</span>
            <span className="metric-pill">Linked records: {governance?.summary.linked_record_count ?? 0}</span>
          </div>
        </article>

        <article className="stat-card panel">
          <div className="eyebrow">Connector Health</div>
          <strong>{governance?.summary.warning_count ?? 0} warning / {governance?.summary.failing_count ?? 0} failing</strong>
          <span className="muted">Warnings surface stale, partial, or migration-bound integrations before they start silently eroding trust.</span>
          <div className="outlook-connection-card__meta">
            <span className="metric-pill">Outlook: {outlookProvider?.health_label ?? "Loading..."}</span>
            <span className="metric-pill">Zendesk: {zendeskProvider?.health_label ?? "Loading..."}</span>
            <span className="metric-pill">Monday: {mondayProvider?.health_label ?? "Loading..."}</span>
          </div>
        </article>
      </section>

      {notice ? <section className="panel feedback-strip feedback-strip--success">{notice}</section> : null}
      {liveMessage ? <section className="panel feedback-strip feedback-strip--info">{liveMessage}</section> : null}
      {error ? <section className="panel feedback-strip feedback-strip--danger">{error}</section> : null}

      <section className="dashboard-grid">
        <div className="dashboard-main">
          <section className="panel dashboard-panel">
            <div className="section-title">Source-of-Truth Governance</div>
            <p className="section-subtitle">Every integrated field needs an explicit owner. These rules make it clear what Mission Control owns, what is mirrored, what stays external, and where coexistence still needs manual reconciliation.</p>
            <div className="outlook-list">
              {(governance?.source_of_truth_rules ?? []).map((rule: IntegrationSourceOfTruthRule) => (
                <article key={rule.id} className="outlook-item">
                  <div className="outlook-item__button outlook-item__button--static">
                    <div className="outlook-item__head">
                      <div>
                        <strong>{rule.field_group}</strong>
                        <div className="muted">{rule.summary}</div>
                      </div>
                      <span className={`risk-pill risk-pill--${rule.ownership_type === "source_of_truth" ? "normal" : rule.ownership_type === "transitional" ? "critical" : "watch"}`}>
                        {humanizeLabel(rule.ownership_type)}
                      </span>
                    </div>
                    <div className="outlook-item__meta">
                      <span className="meta-pill">Owner: {rule.owner}</span>
                      <span className="meta-pill">Sync: {rule.sync_direction}</span>
                      <span className="meta-pill">{rule.edit_policy}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel dashboard-panel">
            <div className="section-title">Conflict Review</div>
            <p className="section-subtitle">Conflicts stay visible until someone makes the ownership decision explicit. Replay is available, but the governing rule is shown first so we do not slide into silent overwrite behavior.</p>
            <div className="outlook-list">
              {(governance?.recent_conflicts ?? []).map((conflict: IntegrationConflictReview) => (
                <article key={conflict.operation_id} className="outlook-item">
                  <div className="outlook-item__button outlook-item__button--static">
                    <div className="outlook-item__head">
                      <div>
                        <strong>{conflict.title}</strong>
                        <div className="muted">{new Date(conflict.occurred_at).toLocaleString()}</div>
                      </div>
                      <span className={`risk-pill risk-pill--${conflict.status === "conflict" ? "critical" : "watch"}`}>
                        {humanizeLabel(conflict.status)}
                      </span>
                    </div>
                    <div className="muted">{conflict.summary}</div>
                    <div className="dashboard-summary-list">
                      <div className="dashboard-summary-row">
                        <span className="muted">Policy</span>
                        <strong>{conflict.source_policy}</strong>
                      </div>
                      <div className="dashboard-summary-row">
                        <span className="muted">Local</span>
                        <strong>{conflict.local_value ?? "Not captured"}</strong>
                      </div>
                      <div className="dashboard-summary-row">
                        <span className="muted">External</span>
                        <strong>{conflict.external_value ?? "Not captured"}</strong>
                      </div>
                    </div>
                    <div className="outlook-item__meta">
                      {conflict.resolution_paths.map((path) => (
                        <span key={path} className="meta-pill">{path}</span>
                      ))}
                    </div>
                    <div className="muted">Recommended action: {conflict.recommended_action}</div>
                    {conflict.can_replay ? (
                      <div className="schedule-card-actions">
                        <button className="secondary-button" disabled={working} onClick={() => void replaySyncOperation(conflict.operation_id)}>
                          {working ? "Queueing..." : "Replay Sync"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
              {!governance?.recent_conflicts.length ? <div className="empty-state empty-state--panel">No unresolved conflicts are active right now.</div> : null}
            </div>
          </section>

          <TeamsOperationalAlertsPanel token={token} />
          <MicrosoftIntegrationDiagnosticsPanel token={token} />
        </div>

        <aside className="panel dashboard-sidebar">
          <div className="section-title">Connector Health</div>
          <p className="section-subtitle">Each integration shows its authority boundary, sync mode, health, and the safe action path for Phase 1.</p>
          <div className="outlook-list">
            {providerCards.map((provider: IntegrationGovernanceProviderSummary) => (
              <article key={provider.provider} className="outlook-item">
                <div className="outlook-item__button outlook-item__button--static">
                  <div className="outlook-item__head">
                    <div>
                      <strong>{provider.display_name}</strong>
                      <div className="muted">{provider.source_of_truth_summary}</div>
                    </div>
                    <span className={`status-pill status-pill--${mapHealthTone(provider.health_state)}`}>
                      {provider.health_label}
                    </span>
                  </div>
                  <div className="outlook-item__meta">
                    <span className="meta-pill">{provider.sync_mode_label}</span>
                    <span className="meta-pill">{provider.external_label}</span>
                  </div>
                  <div className="dashboard-summary-list">
                    <div className="dashboard-summary-row">
                      <span className="muted">Owner</span>
                      <strong>{provider.owner_contact}</strong>
                    </div>
                    <div className="dashboard-summary-row">
                      <span className="muted">Last success</span>
                      <strong>{provider.last_successful_sync_at ? new Date(provider.last_successful_sync_at).toLocaleString() : "Not synced yet"}</strong>
                    </div>
                    <div className="dashboard-summary-row">
                      <span className="muted">Conflicts</span>
                      <strong>{provider.unresolved_conflict_count}</strong>
                    </div>
                    <div className="dashboard-summary-row">
                      <span className="muted">Mapping</span>
                      <strong>{provider.mapping_status}</strong>
                    </div>
                  </div>
                  <div className="schedule-card-actions">
                    {provider.provider === "outlook" ? (
                        <>
                          {showLiveConnectCta ? (
                            <button className="primary-button" disabled={working} onClick={() => void connect("graph")}>
                              {working ? "Connecting..." : primaryConnectLabel}
                            </button>
                          ) : null}
                          {showConnectMockPreviewCta ? (
                            <button className="primary-button" disabled={working} onClick={() => void connect("mock")}>
                              {working ? "Connecting..." : "Connect Mock Preview"}
                            </button>
                          ) : null}
                          {showUseMockPreviewCta ? (
                            <button className="secondary-button" disabled={working} onClick={() => void connect("mock")}>
                              Use Mock Preview
                            </button>
                          ) : null}
                          {accountState === "connected" ? (
                            <>
                              <button className="secondary-button" disabled={working} onClick={() => setPendingAction("sync")}>
                                {working ? "Working..." : syncLabel}
                              </button>
                              <button className="danger-button" disabled={working} onClick={() => setPendingAction("disconnect")}>
                                {disconnectLabel}
                              </button>
                            </>
                          ) : null}
                        </>
                    ) : null}
                    {provider.provider === "zendesk" ? (
                      <>
                        <button className="secondary-button" disabled={zendeskWorking} onClick={() => void runZendeskAction("test")}>
                          {zendeskWorking ? "Working..." : "Test Integration"}
                        </button>
                        <button className="secondary-button" disabled={zendeskWorking} onClick={() => void runZendeskAction("sync")}>
                          {zendeskWorking ? "Working..." : "Sync Zendesk"}
                        </button>
                      </>
                    ) : null}
                    {provider.provider === "monday" && provider.replayable_operation_id ? (
                      <button className="secondary-button" disabled={working} onClick={() => void replaySyncOperation(provider.replayable_operation_id!)}>
                        {working ? "Queueing..." : "Replay Last Failed Sync"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>

          <section className="sidebar-section">
            <div className="section-title">Linked Records</div>
            <div className="outlook-list">
              {(governance?.linked_records ?? []).map((record: IntegrationLinkedRecordSummary) => (
                <article key={`${record.provider}-${record.local_record_id}-${record.external_record_id ?? "local"}`} className="outlook-item">
                  <div className="outlook-item__button outlook-item__button--static">
                    <div className="outlook-item__head">
                      <div>
                        <strong>{record.local_label}</strong>
                        <div className="muted">{record.source_ownership_summary}</div>
                      </div>
                      <span className={`risk-pill risk-pill--${record.sync_state === "sync_failed" || record.sync_state === "conflict_detected" ? "critical" : record.sync_state === "sync_pending" || record.sync_state === "partially_synced" ? "watch" : "normal"}`}>
                        {record.sync_state_label}
                      </span>
                    </div>
                    <div className="outlook-item__meta">
                      <span className="meta-pill">{humanizeLabel(record.provider)}</span>
                      <span className="meta-pill">{humanizeLabel(record.record_type)}</span>
                      {record.external_record_id ? <span className="meta-pill">External ID: {record.external_record_id}</span> : null}
                    </div>
                    <div className="muted">
                      {record.last_sync_at ? `Last sync: ${new Date(record.last_sync_at).toLocaleString()}` : "No successful sync recorded yet."}
                    </div>
                    {record.conflict_banner ? <div className="muted">{record.conflict_banner}</div> : null}
                    {record.recommended_action ? <div className="muted">Next step: {record.recommended_action}</div> : null}
                    {record.external_url ? (
                      <a href={record.external_url} target="_blank" rel="noreferrer">
                        Open external record
                      </a>
                    ) : null}
                  </div>
                </article>
              ))}
              {!governance?.linked_records.length ? <div className="empty-state">No linked records need review right now.</div> : null}
            </div>
          </section>
        </aside>
      </section>

      <section className="dashboard-grid outlook-layout">
        <div className="dashboard-main">
          <section className="panel dashboard-panel">
            <div className="section-title">Calendar Preview Integrity</div>
            <p className="section-subtitle">Leadership controls which Outlook calendars remain visible inside Mission Control. This Phase 1 pilot stays delegated and read-only: hidden calendars stay connected, previews can be refreshed on demand, and background writeback remains out of scope.</p>
            <div className="outlook-connection-card__meta">
              <span className={`status-pill status-pill--${pilotState.tone}`}>
                {pilotState.label}
              </span>
              <span className="metric-pill">Provider mode: {providerMode}</span>
              <span className="metric-pill">Account state: {accountState}</span>
              <span className="metric-pill">Health: {humanizeLabel(activeAccount?.health_state ?? "disconnected")}</span>
              <span className="metric-pill">Warnings: {activeAccount?.warning_count ?? 0}</span>
              <span className="metric-pill">Errors: {activeAccount?.error_count ?? 0}</span>
              <span className="metric-pill">Calendars returned: {calendarsReturned ? `Yes (${calendars.length})` : "No"}</span>
              <span className="metric-pill">Visible: {activeCalendars.length} / {calendars.length}</span>
              <span className="metric-pill">Preview events: {events.length}</span>
            </div>
            <div className="muted">{pilotState.summary}</div>
            {activeAccount?.degraded_reason ? (
              <div className="request-card">
                <strong>Degraded mode</strong>
                <div className="muted">{activeAccount.degraded_reason}</div>
              </div>
            ) : null}
            <div className="schedule-card-actions">
              {showLiveConnectCta ? (
                <button className="primary-button" disabled={working} onClick={() => void connect("graph")}>
                  {working ? "Connecting..." : primaryConnectLabel}
                </button>
              ) : null}
              {showConnectMockPreviewCta ? (
                <button className="primary-button" disabled={working} onClick={() => void connect("mock")}>
                  {working ? "Connecting..." : "Connect Mock Preview"}
                </button>
              ) : null}
              {showUseMockPreviewCta ? (
                <button className="secondary-button" disabled={working} onClick={() => void connect("mock")}>
                  Use Mock Preview
                </button>
              ) : null}
              {accountState === "connected" ? (
                <>
                  <button className="secondary-button" disabled={working} onClick={() => setPendingAction("sync")}>
                    {working ? "Working..." : syncLabel}
                  </button>
                  <button className="danger-button" disabled={working} onClick={() => setPendingAction("disconnect")}>
                    {disconnectLabel}
                  </button>
                </>
              ) : null}
            </div>
            {loading ? <div className="empty-state empty-state--panel">Loading calendar visibility…</div> : null}
            {!loading && !calendars.length ? (
              <div className="empty-state empty-state--panel">
                {pilotState.emptyCalendarsMessage}
              </div>
            ) : null}
            {!loading && calendars.length ? (
              <div className="outlook-list">
                {calendars.map((calendar) => {
                  const isWorking = visibilityWorkingId === calendar.id;
                  return (
                    <article key={calendar.id} className="outlook-item">
                      <div className="outlook-item__button outlook-item__button--static">
                        <div className="outlook-item__head">
                          <div className="outlook-item__identity">
                            <div className="outlook-color-swatch" style={{ backgroundColor: calendar.color_hex }} />
                            <div>
                              <strong>{calendar.name}</strong>
                              <div className="muted">{calendar.owner_label ?? "Microsoft 365"}</div>
                            </div>
                          </div>
                          <div className="outlook-item__meta">
                            {calendar.is_primary ? <span className="meta-pill">Primary</span> : null}
                            <span className={`risk-pill risk-pill--${calendar.visible_in_app ? "normal" : "watch"}`}>
                              {calendar.visible_in_app ? "Visible in app" : "Hidden in app"}
                            </span>
                            {calendar.overlaps_with_shoots ? <span className="meta-pill">Shoot overlap</span> : null}
                          </div>
                        </div>
                        <div className="outlook-visibility-row">
                          <div className="muted">
                            {calendar.upcoming_count} upcoming event{calendar.upcoming_count === 1 ? "" : "s"} in the current preview window
                          </div>
                          <label className="toggle-label">
                            <input
                              type="checkbox"
                              checked={calendar.visible_in_app}
                              disabled={Boolean(isWorking) || activeAccount?.connection_status !== "connected"}
                              onChange={(event) => void updateVisibility(calendar, event.target.checked)}
                            />
                            {isWorking ? "Saving..." : calendar.visible_in_app ? "Shown on dashboard" : "Hidden from dashboard"}
                          </label>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}
          </section>

          <section className="panel dashboard-panel">
            <div className="section-title">Read-Only Sync Preview</div>
            <p className="section-subtitle">Preview draws only from calendars that are turned on for this viewer. This is a verification surface, not a separate scheduling workspace.</p>
            <div className="outlook-filter-row">
              <div className="report-tab-row">
                <button className={previewWindow === "today" ? "is-active" : ""} onClick={() => setPreviewWindow("today")}>
                  Today
                </button>
                <button className={previewWindow === "3day" ? "is-active" : ""} onClick={() => setPreviewWindow("3day")}>
                  3 Day
                </button>
                <button className={previewWindow === "week" ? "is-active" : ""} onClick={() => setPreviewWindow("week")}>
                  Week
                </button>
              </div>
              <label className="toggle-label">
                <input type="checkbox" checked={overlapOnly} onChange={(event) => setOverlapOnly(event.target.checked)} />
                Overlap with shoots only
              </label>
            </div>
            {loading ? <div className="empty-state empty-state--panel">Loading Outlook calendar preview…</div> : null}
            {!loading && accountState !== "connected" ? (
              <div className="empty-state empty-state--panel">{pilotState.previewMessage}</div>
            ) : null}
            {!loading && accountState === "connected" && !calendarsReturned ? (
              <div className="empty-state empty-state--panel">{pilotState.previewMessage}</div>
            ) : null}
            {!loading && accountState === "connected" && calendarsReturned && !activeCalendars.length ? (
              <div className="empty-state empty-state--panel">All calendars are hidden right now. Turn at least one calendar on to populate the preview and dashboard.</div>
            ) : null}
            {!loading && accountState === "connected" && activeCalendars.length && !events.length ? (
              <div className="empty-state empty-state--panel">No calendar events matched the current filters.</div>
            ) : null}
            {!loading && events.length ? (
              <div className="outlook-list">
                {events.map((event) => (
                  <article key={event.id} className={`outlook-item${selectedEventId === event.id ? " outlook-item--selected" : ""}`}>
                    <button className="outlook-item__button" onClick={() => setSelectedEventId(event.id)}>
                      <div className="outlook-item__head">
                        <div className="outlook-item__identity">
                          <div className="outlook-color-swatch" style={{ backgroundColor: event.calendar_color_hex }} />
                          <div>
                            <strong>{event.subject}</strong>
                            <div className="muted">{formatWindow(event.starts_at, event.ends_at)}</div>
                          </div>
                        </div>
                        <div className="outlook-item__meta">
                          <span className="meta-pill">{event.calendar_name}</span>
                          <span className={`risk-pill risk-pill--${event.overlaps_with_shoots ? "watch" : "normal"}`}>
                            {event.overlaps_with_shoots ? event.shoot_code ? `Shoot match · ${event.shoot_code}` : "Shoot match" : "Calendar hold"}
                          </span>
                        </div>
                      </div>
                      <div className="outlook-event-meta">
                        <span>{event.location || "No location listed"}</span>
                        {event.location_intelligence?.location ? (
                          <span>
                            {event.location_intelligence.location.name} | {event.location_intelligence.location.photo_count} photos |{" "}
                            {event.location_intelligence.location.stats.evaluation_count} evals
                          </span>
                        ) : event.location_intelligence?.suggestions?.[0] ? (
                          <span>Suggested guide match: {event.location_intelligence.suggestions[0].name}</span>
                        ) : null}
                        {event.web_link ? (
                          <a href={event.web_link} target="_blank" rel="noreferrer" onClick={(eventClick) => eventClick.stopPropagation()}>
                            Open in Outlook
                          </a>
                        ) : null}
                      </div>
                    </button>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        </div>

        <aside className="panel dashboard-sidebar outlook-rail">
          <div className="section-title">Outlook Detail Rail</div>
          <p className="section-subtitle">This rail keeps the Outlook-specific visibility, preview, and recent connector activity close at hand while the broader governance model stays visible above.</p>
          <div className="dashboard-summary-list">
            <div className="dashboard-summary-row">
              <span className="muted">Provider mode</span>
              <strong>{providerMode}</strong>
            </div>
            <div className="dashboard-summary-row">
              <span className="muted">Account state</span>
              <strong>{accountState}</strong>
            </div>
            <div className="dashboard-summary-row">
              <span className="muted">Warning count</span>
              <strong>{activeAccount?.warning_count ?? 0}</strong>
            </div>
            <div className="dashboard-summary-row">
              <span className="muted">Error count</span>
              <strong>{activeAccount?.error_count ?? 0}</strong>
            </div>
            <div className="dashboard-summary-row">
              <span className="muted">Last successful sync</span>
              <strong>{activeAccount?.last_sync_at ? new Date(activeAccount.last_sync_at).toLocaleString() : "Not synced yet"}</strong>
            </div>
            <div className="dashboard-summary-row">
              <span className="muted">Calendars returned</span>
              <strong>{calendarsReturned ? `Yes (${calendars.length})` : "No"}</strong>
            </div>
            <div className="dashboard-summary-row">
              <span className="muted">Events in view</span>
              <strong>{events.length}</strong>
            </div>
            <div className="dashboard-summary-row">
              <span className="muted">Recent sync runs</span>
              <strong>{status?.sync_runs.length ?? 0}</strong>
            </div>
          </div>

          <div className="section-title with-divider">Recent Sync Runs</div>
          <div className="outlook-list">
            {(status?.sync_runs ?? []).map((run) => (
              <article key={run.id} className="outlook-item">
                <div className="outlook-item__button outlook-item__button--static">
                  <div className="outlook-item__head">
                    <div>
                      <strong>{humanizeLabel(run.status)} sync</strong>
                      <div className="muted">{new Date(run.started_at).toLocaleString()}</div>
                    </div>
                    <span className={`risk-pill risk-pill--${run.status === "error" ? "critical" : run.status === "warning" ? "watch" : "normal"}`}>
                      {run.records_synced} records
                    </span>
                  </div>
                  <div className="muted">{run.warnings[0] ?? run.errors[0]?.message ?? "No warnings or errors recorded."}</div>
                </div>
              </article>
            ))}
            {!status?.sync_runs.length ? <div className="empty-state">No sync runs have been recorded yet.</div> : null}
          </div>

          <div className="section-title with-divider">Recent Integration Operations</div>
          <div className="outlook-list">
            {(governance?.recent_operations ?? []).slice(0, 8).map((operation) => (
              <article key={operation.id} className="outlook-item">
                <div className="outlook-item__button outlook-item__button--static">
                  <div className="outlook-item__head">
                    <div>
                      <strong>{humanizeLabel(operation.entity_type)} {humanizeLabel(operation.operation_type)}</strong>
                      <div className="muted">{new Date(operation.created_at).toLocaleString()}</div>
                    </div>
                    <span
                      className={`risk-pill risk-pill--${
                        operation.status === "failed" || operation.status === "conflict"
                          ? "critical"
                          : operation.status === "processing" || operation.status === "pending"
                            ? "watch"
                            : "normal"
                      }`}
                    >
                      {humanizeLabel(operation.status)}
                    </span>
                  </div>
                  <div className="muted">
                    {operation.message ?? operation.external_id ?? "Waiting for the next sync step."}
                  </div>
                  <div className="outlook-item__meta">
                    <span className="meta-pill">{humanizeLabel(operation.provider)}</span>
                    <span className="meta-pill">{humanizeLabel(operation.direction)}</span>
                    <span className="meta-pill">Attempts: {operation.attempt_count}</span>
                    <span className="meta-pill">{humanizeLabel(operation.source_system)}</span>
                  </div>
                  {(operation.status === "failed" || operation.status === "conflict") && (
                    <div className="schedule-card-actions">
                      <button className="secondary-button" disabled={working} onClick={() => void replaySyncOperation(operation.id)}>
                        {working ? "Queueing..." : "Replay"}
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
            {!governance?.recent_operations.length ? <div className="empty-state">No sync operations have been recorded yet.</div> : null}
          </div>

          {selectedEvent ? (
            <>
              <article className="detail-card">
                <div className="eyebrow">Selected Event</div>
                <strong>{selectedEvent.subject}</strong>
                <div className="muted">{formatWindow(selectedEvent.starts_at, selectedEvent.ends_at)}</div>
                <div className="muted">{selectedEvent.location}</div>
                <div className="outlook-connection-card__meta">
                  <span className="meta-pill">{selectedEvent.calendar_name}</span>
                  {selectedEvent.shoot_code ? <span className="meta-pill">{selectedEvent.shoot_code}</span> : null}
                </div>
                <div className="detail-json">{selectedEvent.preview_note}</div>
                {selectedEvent.web_link ? (
                  <a href={selectedEvent.web_link} target="_blank" rel="noreferrer">
                    Open selected event in Outlook
                  </a>
                ) : null}
              </article>

              <LocationIntelligencePanel
                token={token}
                currentUser={currentUser}
                intelligence={selectedEvent.location_intelligence}
                context={{
                  shootId: selectedEvent.shoot_id ?? null,
                  outlookEventId: selectedEvent.id,
                  outlookCalendarId: selectedEvent.calendar_id,
                  shootCode: selectedEvent.shoot_code ?? null,
                  shootName: selectedEvent.subject,
                  eventSubject: selectedEvent.subject,
                  eventLocation: selectedEvent.location,
                  shootDate: selectedEvent.starts_at.slice(0, 10),
                  photographerName: currentUser.fullName
                }}
                compact
                onRefresh={() => load()}
              />
            </>
          ) : null}

          <section className="sidebar-section">
            <div className="section-title">Provider Boundary</div>
            <div className="request-card">
              <strong>Current path</strong>
              <div className="muted">{activeAccount?.connection_label ?? "Loading provider state..."}</div>
            </div>
            {activeAccount?.degraded_reason ? (
              <div className="request-card">
                <strong>Failure guidance</strong>
                <div className="muted">{activeAccount.degraded_reason}</div>
              </div>
            ) : null}
            <div className="request-card">
              <strong>Microsoft Graph readiness</strong>
              <div className="muted">{graphStub?.connection_label ?? "Loading Graph diagnostics..."}</div>
            </div>
            <div className="request-card">
              <strong>Scope of this pass</strong>
              <div className="muted">This Outlook surface is a delegated read-only calendar pilot. Mail preview, writeback, and app-permission background sync stay disabled in this pass.</div>
            </div>
            <div className="request-card">
              <strong>Safe Reset</strong>
              <div className="muted">Use these only for isolated Outlook pilot cleanup. Each reset is provider-scoped and audited before the next manual consent test.</div>
              <div className="schedule-card-actions">
                <button className="secondary-button" disabled={working} onClick={() => setPendingAction("reset_mock_preview")}>
                  Reset Mock Preview
                </button>
                <button className="secondary-button" disabled={working} onClick={() => setPendingAction("reset_graph_live_connection")}>
                  Reset Live Connection
                </button>
                <button className="danger-button" disabled={working} onClick={() => setPendingAction("reset_pilot_tenant_test_data")}>
                  Reset Local Pilot Data
                </button>
              </div>
            </div>
          </section>
        </aside>
      </section>

      <MondaySchoolAdminPanel
        token={token}
        initialEntityType={routeContext.entityType}
        initialEntityId={routeContext.entityId}
        onCompleted={() => {
          void load();
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={getPendingActionConfig(pendingAction, graphConnected, disconnectLabel, syncLabel).title}
        body={getPendingActionConfig(pendingAction, graphConnected, disconnectLabel, syncLabel).body}
        confirmLabel={getPendingActionConfig(pendingAction, graphConnected, disconnectLabel, syncLabel).confirmLabel}
        tone={getPendingActionConfig(pendingAction, graphConnected, disconnectLabel, syncLabel).tone}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          if (pendingAction) {
            const resetScope = getResetScopeForPendingAction(pendingAction);
            if (resetScope) {
              void performReset(resetScope);
              return;
            }
            if (pendingAction === "disconnect" || pendingAction === "sync") {
              void performAction(pendingAction);
            }
          }
        }}
      />
    </>
  );
}

function mapStatusTone(status?: string) {
  if (status === "connected") {
    return "connected";
  }
  if (status === "attention") {
    return "error";
  }
  if (status === "disconnected") {
    return "watch";
  }
  return "connecting";
}

function getResetScopeForPendingAction(action: PendingAction): OutlookResetScope | null {
  if (action === "reset_mock_preview") {
    return "mock_preview";
  }
  if (action === "reset_graph_live_connection") {
    return "graph_live_connection";
  }
  if (action === "reset_pilot_tenant_test_data") {
    return "pilot_tenant_test_data";
  }
  return null;
}

function getPendingActionConfig(
  action: PendingAction,
  graphConnected: boolean,
  disconnectLabel: string,
  syncLabel: string
) {
  if (action === "disconnect") {
    return {
      title: "Disconnect Outlook calendars?",
      body: graphConnected
        ? "This removes the saved Microsoft Outlook calendar connection for this tenant until leadership reconnects it."
        : "This turns off the mock Outlook calendar preview for the tenant until leadership reconnects it.",
      confirmLabel: disconnectLabel,
      tone: "danger" as const
    };
  }
  if (action === "reset_mock_preview") {
    return {
      title: "Reset mock preview state?",
      body: "This clears stored mock preview connection state, mock sync runs, and mock calendar visibility preferences for this tenant without touching the live Microsoft connection.",
      confirmLabel: "Reset Mock Preview",
      tone: "danger" as const
    };
  }
  if (action === "reset_graph_live_connection") {
    return {
      title: "Reset live Microsoft connection state?",
      body: "This clears the delegated Microsoft connection state, stored tokens, live visibility preferences, and live preview history for this tenant without touching the mock preview path.",
      confirmLabel: "Reset Live Connection",
      tone: "danger" as const
    };
  }
  if (action === "reset_pilot_tenant_test_data") {
    return {
      title: "Reset local pilot tenant test data?",
      body: "This clears local Outlook pilot connection state, sync runs, visibility preferences, and Outlook integration operation history for this tenant so you can start the next pilot pass cleanly.",
      confirmLabel: "Reset Local Pilot Data",
      tone: "danger" as const
    };
  }
  return {
    title: "Refresh Outlook preview?",
    body: graphConnected
      ? "This runs a bounded read-only refresh and updates the live Outlook preview for leadership."
      : "This refreshes the seeded mock calendar preview so leadership can review the experience locally.",
    confirmLabel: syncLabel,
    tone: "default" as const
  };
}

function mapHealthTone(status?: string) {
  if (status === "healthy") {
    return "connected";
  }
  if (status === "warning" || status === "degraded") {
    return "watch";
  }
  if (status === "failing") {
    return "error";
  }
  return "connecting";
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function humanizeLabel(value?: string | null) {
  if (!value) {
    return "Unknown";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatWindow(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const startLabel = start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const startTime = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const endTime = end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${startLabel} · ${startTime} - ${endTime}`;
}

function isGraphConfigured(graphStub?: OutlookCalendarStatusPayload["graph_stub"] | null) {
  return Boolean(graphStub && graphStub.connection_status !== "disconnected");
}

function getMicrosoft365ConnectLabel(
  account: OutlookCalendarStatusPayload["account"] | null | undefined,
  graphConfigured: boolean,
  calendarsReturned: boolean
) {
  if (!graphConfigured) {
    return "Connect Mock Preview";
  }
  if (
    account?.provider_mode === "graph_live" &&
    (account.connection_status === "attention" || (account.connection_status === "connected" && !calendarsReturned))
  ) {
    return "Reconnect Microsoft 365";
  }
  return "Connect Microsoft 365";
}

function getOutlookPilotState(
  account: OutlookCalendarStatusPayload["account"] | null | undefined,
  graphConfigured: boolean,
  calendarsReturned: boolean
) {
  if (account?.connection_status === "attention") {
    return {
      key: "connected_attention" as OutlookPilotState,
      label: "Needs Attention",
      tone: "error",
      summary: "Microsoft 365 needs attention before live calendar data can be trusted again.",
      emptyCalendarsMessage: "Microsoft 365 needs attention. Reconnect the delegated pilot before relying on live calendar visibility.",
      previewMessage: "Microsoft 365 needs attention. Reconnect before using the live Outlook preview."
    };
  }

  if (account?.provider_mode === "graph_live" && account.connection_status === "connected" && !calendarsReturned) {
    return {
      key: "connected_zero_calendars" as OutlookPilotState,
      label: "Connected / Zero Calendars",
      tone: "watch",
      summary: "Microsoft 365 connected, but no calendars were returned for this account.",
      emptyCalendarsMessage: "No live calendars were returned for this Microsoft 365 account. Reconnect Microsoft 365 or verify that the account has readable calendars.",
      previewMessage: "No live calendars were returned for this Microsoft 365 account. Reconnect before relying on the preview."
    };
  }

  if (account?.provider_mode === "graph_live" && account.connection_status === "connected") {
    return {
      key: "connected_healthy" as OutlookPilotState,
      label: "Connected and Healthy",
      tone: account.warning_count || account.error_count ? "watch" : "connected",
      summary: "Live Microsoft 365 calendars are connected and available in Mission Control.",
      emptyCalendarsMessage: "No calendars are visible yet for this connected Microsoft 365 account.",
      previewMessage: "Live Microsoft 365 is connected. Turn on at least one calendar to populate the preview."
    };
  }

  if (account?.provider_mode === "mock" && account.connection_status === "connected") {
    return {
      key: "mock_connected" as OutlookPilotState,
      label: "Mock Preview Active",
      tone: "watch",
      summary: graphConfigured
        ? "Mock preview is active. Mission Control is showing seeded Outlook data, not live Microsoft 365 calendars."
        : "Mock preview is active because live Microsoft 365 is disabled in this environment.",
      emptyCalendarsMessage: "Mock preview is connected, but no seeded calendars were returned for this snapshot.",
      previewMessage: "Mock preview is active. Turn on a visible calendar to populate the Outlook preview."
    };
  }

  if (graphConfigured) {
    return {
      key: "configured_disconnected" as OutlookPilotState,
      label: "Configured / Disconnected",
      tone: "watch",
      summary: "Microsoft 365 is configured, but this tenant is not currently connected.",
      emptyCalendarsMessage: "Microsoft 365 is configured, but this tenant is disconnected. Use Connect Microsoft 365 to finish the delegated pilot.",
      previewMessage: "Connect Microsoft 365 to preview how visible calendars will show up alongside Mission Control shoots."
    };
  }

  return {
    key: "feature_disabled" as OutlookPilotState,
    label: "Live Microsoft 365 Disabled",
    tone: "watch",
    summary: "Live Microsoft 365 is disabled in this environment. You can still use the local mock preview.",
    emptyCalendarsMessage: "Live Microsoft 365 is disabled here. Connect the mock preview to review calendar visibility locally.",
    previewMessage: "Connect the mock preview to see how delegated Outlook calendars would appear beside Mission Control shoots."
  };
}

function readIntegrationRouteContext() {
  const rawHash = window.location.hash.replace(/^#/, "");
  const [path = "", query = ""] = rawHash.split("?");
  if (path !== "admin/integrations" && path !== "outlook") {
    return {
      entityType: "school_work_item" as const,
      entityId: null as string | null
    };
  }
  const params = new URLSearchParams(query);
  const entityType = params.get("entity_type");
  return {
    entityType: entityType === "school_job" ? ("school_job" as const) : ("school_work_item" as const),
    entityId: params.get("entity_id")
  };
}

function consumeOutlookNoticeFromHash() {
  const rawHash = window.location.hash.replace(/^#/, "");
  const [path, query = ""] = rawHash.split("?");
  if (!query) {
    return "";
  }
  const params = new URLSearchParams(query);
  const notice = params.get("outlook_notice") ?? "";
  if (!notice) {
    return "";
  }
  params.delete("outlook_notice");
  const nextHash = params.toString() ? `${path}?${params.toString()}` : path;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${nextHash}`);
  return notice;
}

function describeOutlookNotice(notice: string) {
  const copy: Record<string, string> = {
    connected: "Microsoft Outlook calendars connected. You can now choose which calendars stay visible inside Mission Control.",
    callback_denied: "Microsoft sign-in was canceled before Outlook calendars were connected.",
    callback_exchange_failed: "Microsoft sign-in completed, but Mission Control could not finish the Outlook calendar connection.",
    callback_invalid_state: "The Outlook connect link expired or no longer matched this session. Start the connection again.",
    callback_missing_state: "Mission Control did not receive a valid Outlook state token. Start the connection again.",
    callback_missing_code: "Microsoft did not return an authorization code. Start the connection again."
  };
  return copy[notice] ?? "Outlook calendar connection status changed. Refresh if the latest state is not visible yet.";
}
