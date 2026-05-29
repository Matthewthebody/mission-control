// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutlookIntegration } from "../pages/OutlookIntegration";
import type {
  IntegrationGovernancePayload,
  OutlookCalendar,
  OutlookCalendarEvent,
  OutlookCalendarStatusPayload,
  SessionUser
} from "../types";

vi.mock("../components/LocationIntelligencePanel", () => ({
  LocationIntelligencePanel: () => null
}));

vi.mock("../components/MicrosoftIntegrationDiagnosticsPanel", () => ({
  MicrosoftIntegrationDiagnosticsPanel: () => null
}));

vi.mock("../components/MondaySchoolAdminPanel", () => ({
  MondaySchoolAdminPanel: () => null
}));

vi.mock("../components/TeamsOperationalAlertsPanel", () => ({
  TeamsOperationalAlertsPanel: () => null
}));

vi.mock("../components/ConfirmDialog", () => ({
  ConfirmDialog: () => null
}));

const leadershipUser: SessionUser = {
  id: "user-leadership",
  tenantId: "tenant-demo",
  accountId: "account-leadership",
  sessionId: "session-demo",
  email: "leadership@example.com",
  fullName: "Demo Leadership",
  status: "active",
  department: "operations",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["leadership"],
  permissions: ["integrations.view", "outlook.manage", "audit.read"],
  authorityTier: "leadership",
  primaryJobFunctionProfile: "leadership_team_member",
  jobFunctionProfiles: ["leadership_team_member"],
  permissionGrants: [],
  effectiveScopes: ["organization_wide_scope"],
  sessionTrust: {
    identityProvider: "local_password",
    sessionAssurance: "standard",
    requestTransport: "bearer",
    elevatedUntil: null,
    privilegedModeUntil: null,
    breakGlassStartedAt: null,
    breakGlassUntil: null,
    breakGlassReason: null,
    breakGlassScopeType: null,
    breakGlassScopeId: null,
    elevatedSessionActive: false,
    privilegedModeActive: false,
    breakGlassModeActive: false
  }
};

const liveCalendars: OutlookCalendar[] = [
  {
    id: "calendar-live-1",
    name: "Leadership Command",
    color_hex: "#436f9f",
    is_primary: true,
    owner_label: "Leadership",
    visible_in_app: true,
    scheduling_impact_enabled: true,
    overlaps_with_shoots: true,
    upcoming_count: 1
  }
];

const liveEvents: OutlookCalendarEvent[] = [
  {
    id: "event-live-1",
    calendar_id: "calendar-live-1",
    calendar_name: "Leadership Command",
    calendar_color_hex: "#436f9f",
    subject: "Morning Shoot Hold",
    starts_at: "2026-03-24T14:00:00.000Z",
    ends_at: "2026-03-24T15:00:00.000Z",
    organizer: "Leadership",
    location: "Main Gym",
    overlaps_with_shoots: true,
    scheduling_impact: true,
    preview_note: "Aligned to DEMO-001.",
    web_link: "https://outlook.office.com/calendar/item/event-live-1",
    shoot_code: "DEMO-001"
  }
];

function buildGraphStub(configured = true): OutlookCalendarStatusPayload["graph_stub"] {
  return {
    id: "graph-stub",
    tenant_id: "tenant-demo",
    provider_mode: "graph_stub",
    connection_status: configured ? "attention" : "disconnected",
    health_state: configured ? "connected_warning" : "disconnected",
    connected_as: configured ? "Microsoft Graph credentials detected" : null,
    connection_label: configured
      ? "Microsoft Graph app credentials are present. The live read-only calendar provider is available for tenant connection."
      : "Microsoft Graph app credentials are not configured, so the Outlook calendar module stays in mock mode.",
    last_sync_at: null,
    last_failed_sync_at: null,
    records_synced: 0,
    warning_count: configured ? 1 : 0,
    error_count: 0
  };
}

function buildStatus(
  overrides: Partial<OutlookCalendarStatusPayload["account"]>,
  options: { graphConfigured?: boolean } = {}
): OutlookCalendarStatusPayload {
  const graphConfigured = options.graphConfigured ?? true;
  return {
    account: {
      id: "outlook-account",
      tenant_id: "tenant-demo",
      provider_mode: graphConfigured ? "graph_live" : "mock",
      connection_status: "disconnected",
      health_state: "disconnected",
      connected_as: null,
      connection_label: graphConfigured
        ? "Microsoft Graph is configured, but this tenant has not connected Outlook calendars yet."
        : "Connect the mock Outlook workspace to preview leadership calendar data locally.",
      degraded_reason: null,
      last_error_message: null,
      last_sync_at: null,
      last_failed_sync_at: null,
      records_synced: 0,
      warning_count: 0,
      error_count: 0,
      ...overrides
    },
    graph_stub: buildGraphStub(graphConfigured),
    sync_runs: []
  };
}

function buildGovernance(account: OutlookCalendarStatusPayload["account"]): IntegrationGovernancePayload {
  const outlookHealthState: IntegrationGovernancePayload["providers"][number]["health_state"] =
    account.connection_status === "attention"
      ? "failing"
      : account.provider_mode === "mock" && account.connection_status === "connected"
        ? "warning"
        : account.provider_mode === "graph_live" && account.connection_status === "disconnected"
          ? "warning"
          : account.connection_status === "connected"
            ? "healthy"
            : "disabled";
  const outlookHealthLabel =
    account.connection_status === "attention"
      ? "Needs Attention"
      : account.provider_mode === "mock" && account.connection_status === "connected"
        ? "Mock Preview"
        : account.provider_mode === "graph_live" && account.connection_status === "disconnected"
          ? "Disconnected"
          : account.connection_status === "connected"
            ? "Healthy"
            : "Disabled";

  const providers = [
    {
      provider: "outlook" as const,
      display_name: "Microsoft Outlook",
      enabled: true,
      connection_status: account.connection_status,
      health_state: outlookHealthState,
      health_label: outlookHealthLabel,
      sync_mode: "read_only_import" as const,
      sync_mode_label: "Read-Only Delegated Preview",
      source_of_truth_summary:
        "Mission Control owns staffing and readiness. Outlook stays delegated and read-only in this Phase 1 pilot.",
      owner_contact: "Scheduling and operations leadership",
      last_successful_sync_at: account.last_sync_at,
      last_failed_sync_at: account.last_failed_sync_at ?? null,
      next_scheduled_sync_at: null,
      failure_count: 0,
      unresolved_conflict_count: 0,
      pending_sync_count: 0,
      linked_record_count: account.records_synced,
      mapping_status:
        account.provider_mode === "mock"
          ? "Mock preview is active."
          : account.connection_status === "connected"
            ? "Delegated read-only calendar preview and visibility preferences are active."
            : "Microsoft 365 delegated preview is configured, but this tenant is disconnected.",
      external_label:
        account.provider_mode === "mock"
          ? "Mock calendar preview active"
          : account.connected_as
            ? `Connected as ${account.connected_as}`
            : "Microsoft 365 ready to connect",
      owned_domains: ["shoot_status"],
      mirrored_domains: ["calendar_holds"],
      overlay_domains: ["staffing_health"],
      writeback_domains: [],
      replayable_operation_id: null
    },
    {
      provider: "zendesk" as const,
      display_name: "Zendesk",
      enabled: true,
      connection_status: "connected" as const,
      health_state: "healthy" as const,
      health_label: "Healthy",
      sync_mode: "read_only_import" as const,
      sync_mode_label: "Read-Only Import",
      source_of_truth_summary: "Zendesk mirrors support health.",
      owner_contact: "Customer service systems owner",
      last_successful_sync_at: null,
      last_failed_sync_at: null,
      next_scheduled_sync_at: null,
      failure_count: 0,
      unresolved_conflict_count: 0,
      pending_sync_count: 0,
      linked_record_count: 0,
      mapping_status: "Summary ingestion is active.",
      external_label: "Zendesk summary cache",
      owned_domains: [],
      mirrored_domains: [],
      overlay_domains: [],
      writeback_domains: [],
      replayable_operation_id: null
    },
    {
      provider: "monday" as const,
      display_name: "Monday.com",
      enabled: false,
      connection_status: "disconnected" as const,
      health_state: "disabled" as const,
      health_label: "Disabled",
      sync_mode: "manual_reconciliation" as const,
      sync_mode_label: "Manual Reconciliation",
      source_of_truth_summary: "Monday remains transitional.",
      owner_contact: "Operations migration owner",
      last_successful_sync_at: null,
      last_failed_sync_at: null,
      next_scheduled_sync_at: null,
      failure_count: 0,
      unresolved_conflict_count: 0,
      pending_sync_count: 0,
      linked_record_count: 0,
      mapping_status: "No active Monday-linked records were found in this tenant snapshot.",
      external_label: "Legacy coexistence view only",
      owned_domains: [],
      mirrored_domains: [],
      overlay_domains: [],
      writeback_domains: [],
      replayable_operation_id: null
    }
  ];

  return {
      summary: {
        provider_count: providers.length,
        connected_count: providers.filter((provider) => provider.connection_status === "connected").length,
        warning_count: providers.filter((provider) => provider.health_state === "warning").length,
        failing_count: providers.filter((provider) => provider.health_state === "failing").length,
        unresolved_conflict_count: 0,
      pending_sync_count: 0,
      linked_record_count: account.records_synced,
      last_updated_at: "2026-03-24T14:10:00.000Z",
      freshness: {
        state: "recently_updated",
        label: "Recently Updated"
      }
    },
    providers,
    source_of_truth_rules: [],
    recent_conflicts: [],
    linked_records: [],
    recent_operations: []
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function installFetchMock(input: {
  status: OutlookCalendarStatusPayload;
  calendars: OutlookCalendar[];
  events: OutlookCalendarEvent[];
  governance?: IntegrationGovernancePayload;
  afterConnect?: {
    status: OutlookCalendarStatusPayload;
    calendars: OutlookCalendar[];
    events: OutlookCalendarEvent[];
    governance?: IntegrationGovernancePayload;
  };
}) {
  let currentStatus = structuredClone(input.status);
  let currentCalendars = structuredClone(input.calendars);
  let currentEvents = structuredClone(input.events);
  let currentGovernance = structuredClone(input.governance ?? buildGovernance(currentStatus.account));
  const afterConnect = input.afterConnect
    ? {
        status: structuredClone(input.afterConnect.status),
        calendars: structuredClone(input.afterConnect.calendars),
        events: structuredClone(input.afterConnect.events),
        governance: structuredClone(input.afterConnect.governance ?? buildGovernance(input.afterConnect.status.account))
      }
    : null;

  const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(request));
    const path = `${url.pathname}${url.search}`;

    if (path === "/api/integrations/governance") {
      return jsonResponse(currentGovernance);
    }
    if (path.startsWith("/api/integrations/outlook/status?")) {
      return jsonResponse(currentStatus);
    }
    if (path.startsWith("/api/integrations/outlook/calendars?")) {
      return jsonResponse(currentCalendars);
    }
    if (path.startsWith("/api/integrations/outlook/events/preview?")) {
      return jsonResponse(currentEvents);
    }
    if (path.startsWith("/api/integrations/outlook/connect?") && (init?.method ?? "GET").toUpperCase() === "POST") {
      if (afterConnect) {
        currentStatus = structuredClone(afterConnect.status);
        currentCalendars = structuredClone(afterConnect.calendars);
        currentEvents = structuredClone(afterConnect.events);
        currentGovernance = structuredClone(afterConnect.governance);
      }
      return jsonResponse({
        ...currentStatus,
        connect_mode: "connected",
        authorization_url: null
      });
    }
    throw new Error(`Unexpected request in OutlookIntegration test: ${path}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("OutlookIntegration", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/#outlook");
    document.cookie = "pmc_csrf=test-csrf; path=/";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.cookie = "pmc_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  });

  it("shows a reconnect CTA when Graph is connected but calendars are empty", async () => {
    const status = buildStatus({
      provider_mode: "graph_live",
      connection_status: "connected",
      health_state: "connected_pending_sync",
      connected_as: "leader@contoso.com",
      connection_label: "Microsoft Graph is connected. Run a sync to capture the first durable read-only health snapshot."
    });

    installFetchMock({
      status,
      calendars: [],
      events: []
    });

    render(<OutlookIntegration token="token-123" currentUser={leadershipUser} socket={null} />);

    expect(await screen.findByText("Microsoft 365 connected, but no calendars were returned for this account.")).toBeInTheDocument();
    expect((await screen.findAllByRole("button", { name: "Reconnect Microsoft 365" })).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Calendars returned: No").length).toBeGreaterThan(0);
  });

  it("shows Connect Microsoft 365 and sends the request through the app client with CSRF/session headers", async () => {
    const disconnectedStatus = buildStatus({
      provider_mode: "graph_live",
      connection_status: "disconnected",
      health_state: "disconnected",
      connected_as: null
    });
    const connectedStatus = buildStatus({
      provider_mode: "graph_live",
      connection_status: "connected",
      health_state: "connected_pending_sync",
      connected_as: "leader@contoso.com",
      connection_label: "Microsoft Graph is connected. Run a sync to capture the first durable read-only health snapshot."
    });

    const fetchMock = installFetchMock({
      status: disconnectedStatus,
      calendars: [],
      events: [],
      afterConnect: {
        status: connectedStatus,
        calendars: liveCalendars,
        events: liveEvents
      }
    });

    render(<OutlookIntegration token="token-123" currentUser={leadershipUser} socket={null} />);

    const connectButtons = await screen.findAllByRole("button", { name: "Connect Microsoft 365" });
    fireEvent.click(connectButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Microsoft Outlook calendars connected.")).toBeInTheDocument();
    });

    const connectCall = fetchMock.mock.calls.find(([request, init]) => {
      return String(request).includes("/api/integrations/outlook/connect?") && init?.method === "POST";
    });
    expect(connectCall).toBeTruthy();

    const [, init] = connectCall!;
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer token-123");
    expect(headers.get("X-PMC-CSRF")).toBe("test-csrf");
    expect(init?.credentials).toBe("include");
  });

  it("shows an explicit mock badge when mock preview is active", async () => {
    const status = buildStatus(
      {
        provider_mode: "mock",
        connection_status: "connected",
        health_state: "mock",
        connected_as: "leadership.mock@kemmetmueller.local",
        connection_label: "Mock workspace connected. Leadership can preview calendars and dashboard visibility without Microsoft credentials.",
        warning_count: 1
      },
      { graphConfigured: true }
    );

    installFetchMock({
      status,
      calendars: liveCalendars,
      events: liveEvents
    });

    render(<OutlookIntegration token="token-123" currentUser={leadershipUser} socket={null} />);

    expect(await screen.findByText("Mock preview is active. Mission Control is showing seeded Outlook data, not live Microsoft 365 calendars.")).toBeInTheDocument();
    expect(screen.getAllByText("Mock Preview Active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Provider mode: mock").length).toBeGreaterThan(0);
  });

  it("renders live calendars when Microsoft 365 is connected and healthy", async () => {
    const status = buildStatus({
      provider_mode: "graph_live",
      connection_status: "connected",
      health_state: "connected_healthy",
      connected_as: "leader@contoso.com",
      connection_label: "Microsoft Graph is connected and the last read-only sync completed successfully.",
      last_sync_at: "2026-03-24T14:10:00.000Z",
      records_synced: 1
    });

    installFetchMock({
      status,
      calendars: liveCalendars,
      events: liveEvents
    });

    render(<OutlookIntegration token="token-123" currentUser={leadershipUser} socket={null} />);

    expect(await screen.findByText("Live Microsoft 365 calendars are connected and available in Mission Control.")).toBeInTheDocument();
    expect(screen.getAllByText("Read-Only Delegated Preview").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Leadership Command").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Morning Shoot Hold").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Calendars returned: Yes (1)").length).toBeGreaterThan(0);
  });

  it("shows degraded mode guidance when the live Outlook connection needs attention", async () => {
    const status = buildStatus({
      provider_mode: "graph_live",
      connection_status: "attention",
      health_state: "connected_error",
      connected_as: "leader@contoso.com",
      connection_label: "Microsoft Graph needs attention. Reconnect or retry sync to restore live previews.",
      degraded_reason: "Delegated Outlook access has expired and no refresh token is available. Reconnect Microsoft 365.",
      last_error_message: "Delegated Outlook access has expired and no refresh token is available. Reconnect Microsoft 365.",
      error_count: 1
    });

    installFetchMock({
      status,
      calendars: [],
      events: []
    });

    render(<OutlookIntegration token="token-123" currentUser={leadershipUser} socket={null} />);

    expect(await screen.findByText("Microsoft 365 needs attention before live calendar data can be trusted again.")).toBeInTheDocument();
    expect(screen.getAllByText("Delegated Outlook access has expired and no refresh token is available. Reconnect Microsoft 365.").length).toBeGreaterThan(0);
  });
});
