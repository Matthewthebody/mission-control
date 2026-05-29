// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Reports } from "../pages/Reports";
import type { ReportsWorkspaceResponse } from "../services/reportsWorkspace";
import type { SessionUser } from "../types";

const getReportsWorkspaceMock = vi.fn();
const downloadReportsWorkspaceCsvMock = vi.fn();

vi.mock("../services/reportsWorkspace", () => ({
  getReportsWorkspace: (...args: unknown[]) => getReportsWorkspaceMock(...args),
  downloadReportsWorkspaceCsv: (...args: unknown[]) => downloadReportsWorkspaceCsvMock(...args)
}));

vi.mock("../services/leadershipReports", () => ({
  runLeadershipSavedView: vi.fn(),
  runLeadershipPacketTemplate: vi.fn(),
  runLeadershipDeliverySchedule: vi.fn(),
  downloadLeadershipPacketRunPdf: vi.fn()
}));

const sessionTrust = {
  identityProvider: "local_password" as const,
  sessionAssurance: "standard" as const,
  requestTransport: "bearer" as const,
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
};

const leadershipUser: SessionUser = {
  id: "user-leadership",
  tenantId: "tenant-demo",
  accountId: "account-leadership",
  sessionId: "session-leadership",
  email: "leader@example.com",
  fullName: "Leader Demo",
  status: "active",
  department: "operations",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["leadership"],
  permissions: ["dashboard.read", "reports.view", "profitability_leadership.view"],
  authorityTier: "leadership",
  primaryJobFunctionProfile: "leadership_team_member",
  jobFunctionProfiles: ["leadership_team_member"],
  permissionGrants: [],
  effectiveScopes: ["organization_wide_scope"],
  sessionTrust
};

const workspace: ReportsWorkspaceResponse = {
  generated_at: "2026-03-31T15:00:00.000Z",
  anchor_date: "2026-03-31",
  period: "quarterly",
  period_options: ["monthly", "quarterly", "annual"],
  scope_department: null,
  refresh_interval_seconds: 300,
  freshness: {
    summary_line: "Reports is intentionally slower and calmer than Home or Operations.",
    sources: [
      {
        id: "operational_model",
        label: "Trend Model",
        detail: "Quarterly reporting window.",
        updated_at: "2026-03-31T15:00:00.000Z",
        tone: "info"
      }
    ]
  },
  operational_model: {
    generated_at: "2026-03-31T15:00:00.000Z",
    anchor_date: "2026-03-31",
    period: "quarterly",
    period_label: "Last 90 Days",
    date_range: {
      starts_at: "2026-01-01T00:00:00.000Z",
      ends_before: "2026-04-01T00:00:00.000Z",
      bucket_count: 3
    },
    scope_department: null,
    summary_strip: [
      {
        id: "watch_red",
        label: "Watch Red Breaches",
        value: "4",
        detail: "Recurring urgent risk deserves leadership review.",
        tone: "action_needed",
        action_hash: "#operations/exceptions"
      }
    ],
    watch: {
      action_hash: "#operations/exceptions",
      summary_line: "Red and yellow watch items are recurring in this period.",
      red_breaches: 4,
      overdue_count_by_type: [{ watch_type: "weather", label: "Weather & Travel", count: 2 }],
      average_resolution_hours: 6,
      average_resolution_label: "Average resolution 6h",
      reason_code_trends: [{ reason_code: "travel", label: "Travel", count: 3 }],
      trend: [
        {
          bucket: { key: "jan", label: "Jan", starts_at: "2026-01-01T00:00:00.000Z", ends_before: "2026-02-01T00:00:00.000Z" },
          metrics: [
            { key: "red", label: "Red", value: 2 },
            { key: "yellow", label: "Yellow", value: 4 }
          ]
        }
      ]
    },
    attendance: {
      action_hash: "#operations/attendance",
      summary_line: "Attendance drift is driving recurring staffing pressure.",
      tracked_assignments: 42,
      on_time_rate: 89,
      late_rate: 7,
      no_show_rate: 2,
      callout_rate: 2,
      average_resolution_hours: 2,
      average_resolution_label: "Average resolution 2h",
      staffing_incidents_driven_by_attendance: 5,
      trend: [
        {
          bucket: { key: "jan", label: "Jan", starts_at: "2026-01-01T00:00:00.000Z", ends_before: "2026-02-01T00:00:00.000Z" },
          metrics: [
            { key: "on_time", label: "On Time", value: 89 },
            { key: "late", label: "Late", value: 7 }
          ]
        }
      ]
    },
    production: {
      action_hash: "#production",
      summary_line: "Production review and QC queues are drifting.",
      jobs_completed: 12,
      average_turnaround_hours: 28,
      average_turnaround_label: "Average turnaround 28h",
      overdue_tasks: 6,
      blocked_reasons: [{ blocker_type: "asset", label: "Missing Assets", count: 3 }],
      peer_review_backlog: 4,
      qc_backlog: 2,
      rework_rate: 8,
      send_back_rate: 5,
      trend: [
        {
          bucket: { key: "jan", label: "Jan", starts_at: "2026-01-01T00:00:00.000Z", ends_before: "2026-02-01T00:00:00.000Z" },
          metrics: [
            { key: "overdue", label: "Overdue", value: 6 },
            { key: "qc", label: "QC", value: 2 }
          ]
        }
      ]
    },
    approvals: {
      action_hash: "#approvals",
      summary_line: "Approval aging is climbing in this period.",
      volume_by_type: [{ request_type: "pto", label: "PTO", count: 7 }],
      average_decision_hours: 11,
      average_decision_label: "Average decision 11h",
      overdue_count: 3,
      escalation_count: 1,
      rejection_rate: 4,
      send_back_rate: 3,
      trend: [
        {
          bucket: { key: "jan", label: "Jan", starts_at: "2026-01-01T00:00:00.000Z", ends_before: "2026-02-01T00:00:00.000Z" },
          metrics: [
            { key: "overdue", label: "Overdue", value: 3 },
            { key: "escalated", label: "Escalated", value: 1 }
          ]
        }
      ]
    },
    schools: {
      action_hash: "#schools",
      summary_line: "Schools follow-through is stable.",
      open_work_count: 8,
      overdue_count: 1,
      due_today_count: 2,
      blocked_count: 0,
      waiting_on_school_count: 2,
      waiting_on_internal_count: 1,
      deliveries_ready_count: 3,
      average_resolution_hours: 20,
      average_resolution_label: "Average resolution 20h",
      trend: []
    }
  },
  delivery_summary: {
    saved_view_count: 2,
    packet_template_count: 1,
    active_schedule_count: 1,
    failed_schedule_count: 0,
    recent_run_count: 1,
    failed_export_count: 1
  },
  saved_views: [
    {
      id: "saved-view-1",
      label: "Quarterly Executive View",
      summary: "Leadership summary for recurring risk and performance drift.",
      report_id: "executive_overview",
      window: "last_90_days",
      visibility: "leadership_shared",
      department: null,
      is_default: true,
      is_pinned: true,
      updated_at: "2026-03-30T15:00:00.000Z",
      share_hash: "#reports?saved_view_id=saved-view-1"
    }
  ],
  packet_templates: [
    {
      id: "packet-template-1",
      name: "Weekly Executive Review",
      audience: "Leadership weekly review",
      description: "Weekly packet for risk, drift, and ownership review.",
      visibility: "private",
      default_window: "last_7_days",
      is_pinned: true,
      updated_at: "2026-03-29T12:00:00.000Z"
    }
  ],
  recent_packet_runs: [
    {
      id: "packet-run-1",
      run_label: "Weekly Executive Review",
      source_type: "packet_template",
      template_name: "Weekly Executive Review",
      saved_view_name: null,
      status: "completed",
      anchor_date: "2026-03-31",
      created_at: "2026-03-31T15:00:00.000Z",
      completed_at: "2026-03-31T15:01:00.000Z",
      pdf_available: true
    }
  ],
  export_history: [
    {
      id: "export-1",
      export_name: "Quarterly Executive View",
      format: "csv",
      status: "failed",
      requested_by_name: "Leader Demo",
      requested_at: "2026-03-31T14:00:00.000Z",
      completed_at: null,
      record_count: null
    }
  ],
  delivery_schedules: [
    {
      id: "schedule-1",
      label: "Monday Leadership Packet",
      source_type: "packet_template",
      template_name: "Weekly Executive Review",
      saved_view_name: null,
      cadence: "weekly",
      delivery_channel: "email_link",
      active_status: true,
      last_run_at: "2026-03-30T12:00:00.000Z",
      next_run_at: "2026-04-06T12:00:00.000Z",
      last_status: "completed",
      last_error: null
    }
  ],
  history: {
    generated_at: "2026-03-31T15:00:00.000Z",
    summary_line: "Recent workflow, notification, and audit signals are composed here for investigation.",
    focus: "production",
    focus_options: [
      { id: "all", label: "All", count: 4 },
      { id: "production", label: "Production", count: 2 },
      { id: "approvals", label: "Approvals", count: 1 },
      { id: "audit", label: "Audit", count: 1 }
    ],
    items: [
      {
        id: "history-1",
        focus: "production",
        source: "workflow",
        module_label: "Production",
        title: "Task Blocked",
        summary: "Senior banners are still waiting on retouch approval.",
        note: "Release is blocked until the banner set is approved.",
        actor_label: "Manager Demo",
        created_at: "2026-03-31T14:00:00.000Z",
        action_hash: "#production",
        confidence_label: "Direct workflow event",
        chips: [{ label: "Production" }]
      }
    ]
  }
};

describe("Reports", () => {
  beforeEach(() => {
    getReportsWorkspaceMock.mockReset();
    downloadReportsWorkspaceCsvMock.mockReset();
    window.history.replaceState(null, "", "#reports?date=2026-03-31&period=quarterly&focus=production");
    getReportsWorkspaceMock.mockResolvedValue(workspace);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the reports workspace without reintroducing Business Health language", async () => {
    render(<Reports token="token" currentUser={leadershipUser} />);

    expect(await screen.findByText("Trend, Performance, And Audit")).toBeInTheDocument();
    expect(screen.getByText("Exceptions / Risk Trends")).toBeInTheDocument();
    expect(screen.getByText("Attendance / Staffing Trends")).toBeInTheDocument();
    expect(screen.getByText("Saved Views, Packets, And Exports")).toBeInTheDocument();
    expect(screen.getByText("Audit And History Investigation")).toBeInTheDocument();
    expect(screen.queryByText(/Business Health/i)).not.toBeInTheDocument();
    expect(getReportsWorkspaceMock).toHaveBeenCalledWith("token", expect.objectContaining({ focus: "production" }));
  });

  it("stays mounted when the history contract is absent instead of crashing on a null access", async () => {
    getReportsWorkspaceMock.mockResolvedValue({
      ...workspace,
      history: undefined
    } as unknown as ReportsWorkspaceResponse);

    render(<Reports token="token" currentUser={leadershipUser} />);

    expect(await screen.findByText("Trend, Performance, And Audit")).toBeInTheDocument();
    expect(screen.getByText("Saved Views, Packets, And Exports")).toBeInTheDocument();
    expect(screen.queryByText("Audit And History Investigation")).toBeInTheDocument();
  });

  it("stays mounted when the operational model contract is absent instead of crashing on a null access", async () => {
    getReportsWorkspaceMock.mockResolvedValue({
      ...workspace,
      operational_model: undefined
    } as unknown as ReportsWorkspaceResponse);

    render(<Reports token="token" currentUser={leadershipUser} />);

    expect(await screen.findByText("Trend, Performance, And Audit")).toBeInTheDocument();
    expect(screen.getByText("Top Summary Strip")).toBeInTheDocument();
    expect(screen.getByText("Reporting window pending")).toBeInTheDocument();
  });

  it("stays mounted when delivery reporting fields are absent instead of crashing on partial contracts", async () => {
    getReportsWorkspaceMock.mockResolvedValue({
      ...workspace,
      delivery_summary: undefined,
      saved_views: undefined,
      packet_templates: undefined,
      delivery_schedules: undefined,
      recent_packet_runs: undefined,
      export_history: undefined
    } as unknown as ReportsWorkspaceResponse);

    render(<Reports token="token" currentUser={leadershipUser} />);

    expect(await screen.findByText("Trend, Performance, And Audit")).toBeInTheDocument();
    expect(screen.getByText("Saved Views, Packets, And Exports")).toBeInTheDocument();
    expect(screen.getByText("No saved reporting views exist yet.")).toBeInTheDocument();
  });

  it("updates the history focus through the workspace contract instead of stitching locally", async () => {
    render(<Reports token="token" currentUser={leadershipUser} />);
    await screen.findByText("Trend, Performance, And Audit");

    fireEvent.click(screen.getByRole("button", { name: /Approvals 1/i }));

    await waitFor(() => {
      expect(getReportsWorkspaceMock).toHaveBeenLastCalledWith(
        "token",
        expect.objectContaining({ focus: "approvals" })
      );
    });
  });

  it("uses the workspace export path for the current reporting scope", async () => {
    render(<Reports token="token" currentUser={leadershipUser} />);
    await screen.findByText("Trend, Performance, And Audit");

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => {
      expect(downloadReportsWorkspaceCsvMock).toHaveBeenCalledWith(
        "token",
        expect.objectContaining({ period: "quarterly", focus: "production" })
      );
    });
  });
});
