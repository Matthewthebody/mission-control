// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MicrosoftIntegrationDiagnosticsPanel } from "../components/MicrosoftIntegrationDiagnosticsPanel";
import type { MicrosoftIntegrationEventRecord, MicrosoftIntegrationHealthPayload } from "../microsoftIntegrationTypes";
import * as observabilityApi from "../services/microsoftIntegrationObservabilityApi";

vi.mock("../services/microsoftIntegrationObservabilityApi", () => ({
  getMicrosoftIntegrationHealth: vi.fn(),
  listMicrosoftIntegrationDiagnostics: vi.fn()
}));

const getMicrosoftIntegrationHealthMock = vi.mocked(observabilityApi.getMicrosoftIntegrationHealth);
const listMicrosoftIntegrationDiagnosticsMock = vi.mocked(observabilityApi.listMicrosoftIntegrationDiagnostics);

describe("MicrosoftIntegrationDiagnosticsPanel", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("separates disabled Microsoft surfaces from enabled live diagnostics", async () => {
    const health: MicrosoftIntegrationHealthPayload = {
      generated_at: "2026-04-22T16:00:00.000Z",
      feature_flags: {
        auth_enabled: false,
        outlook_sync_enabled: true,
        teams_alerts_enabled: false,
        teams_search_enabled: false,
        teams_personal_app_enabled: false
      },
      startup_validation: {
        valid: true,
        issues: []
      },
      health_checks: [
        {
          area: "outlook_calendar_sync",
          status: "healthy",
          summary: "Delegated Outlook preview is healthy.",
          recent_failure_count: 0,
          last_event_at: "2026-04-22T15:55:00.000Z",
          details: { enabled: true }
        },
        {
          area: "auth",
          status: "disabled",
          summary: "Auth is disabled.",
          recent_failure_count: 0,
          last_event_at: null,
          details: { enabled: false }
        },
        {
          area: "teams_search",
          status: "disabled",
          summary: "Teams search is disabled.",
          recent_failure_count: 0,
          last_event_at: null,
          details: { enabled: false }
        }
      ]
    };

    const events: MicrosoftIntegrationEventRecord[] = [
      {
        id: "event-outlook",
        tenant_id: "tenant-demo",
        integration_area: "outlook_calendar_sync",
        event_level: "info",
        event_type: "outlook.preview.refreshed",
        event_status: "ok",
        summary: "Live Outlook preview refreshed.",
        detail: {},
        request_id: null,
        trace_id: null,
        actor_user_id: null,
        related_entity_type: null,
        related_entity_id: null,
        external_target: null,
        occurred_at: "2026-04-22T15:55:00.000Z"
      },
      {
        id: "event-auth",
        tenant_id: "tenant-demo",
        integration_area: "auth",
        event_level: "warning",
        event_type: "auth.disabled",
        event_status: "disabled",
        summary: "Historical Microsoft auth warning.",
        detail: {},
        request_id: null,
        trace_id: null,
        actor_user_id: null,
        related_entity_type: null,
        related_entity_id: null,
        external_target: null,
        occurred_at: "2026-04-22T15:50:00.000Z"
      }
    ];

    getMicrosoftIntegrationHealthMock.mockResolvedValue(health);
    listMicrosoftIntegrationDiagnosticsMock.mockResolvedValue(events);

    render(<MicrosoftIntegrationDiagnosticsPanel token="token-123" />);

    expect(await screen.findByText("Enabled features: 1")).toBeInTheDocument();
    expect(screen.getByText("Disabled features: 4")).toBeInTheDocument();
    expect(screen.getByText("Not part of the live surface")).toBeInTheDocument();
    expect(screen.getByText("Outlook Calendar Sync")).toBeInTheDocument();
    expect(screen.getByText("Auth is disabled.")).toBeInTheDocument();
    expect(screen.getByText("Teams search is disabled.")).toBeInTheDocument();
    expect(screen.getByText(/1 historical event/)).toBeInTheDocument();
    expect(screen.getByText("Live Outlook preview refreshed.")).toBeInTheDocument();
    expect(screen.queryByText("Historical Microsoft auth warning.")).not.toBeInTheDocument();
  });
});
