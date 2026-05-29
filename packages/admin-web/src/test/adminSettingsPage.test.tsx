import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminSettings } from "../pages/AdminSettings";
import type { AdminSettingsWorkspace, AdminSettingPreview, AdminSettingValueRecord } from "../adminSettingsTypes";
import type { SessionUser } from "../types";

const getAdminSettingsWorkspaceMock = vi.fn();
const previewAdminSettingChangeMock = vi.fn();
const createAdminSettingChangeMock = vi.fn();
const approveAdminSettingChangeMock = vi.fn();
const rejectAdminSettingChangeMock = vi.fn();

vi.mock("../services/adminSettingsApi", () => ({
  getAdminSettingsWorkspace: (...args: unknown[]) => getAdminSettingsWorkspaceMock(...args),
  previewAdminSettingChange: (...args: unknown[]) => previewAdminSettingChangeMock(...args),
  createAdminSettingChange: (...args: unknown[]) => createAdminSettingChangeMock(...args),
  approveAdminSettingChange: (...args: unknown[]) => approveAdminSettingChangeMock(...args),
  rejectAdminSettingChange: (...args: unknown[]) => rejectAdminSettingChangeMock(...args)
}));

const standardSessionTrust = {
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
  sessionId: "session-demo",
  email: "leadership@example.com",
  fullName: "Demo Leadership",
  status: "active",
  department: "operations",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["leadership"],
  permissions: ["dashboard.read", "shoot.read", "schedule.read", "security.manage"],
  authorityTier: "leadership",
  primaryJobFunctionProfile: "leadership_team_member",
  jobFunctionProfiles: ["leadership_team_member"],
  permissionGrants: [
    { domain: "system_settings_permissions", action: "view", scope: "organization_wide_scope" },
    { domain: "system_settings_permissions", action: "edit", scope: "organization_wide_scope" },
    { domain: "system_settings_permissions", action: "approve", scope: "organization_wide_scope" }
  ],
  effectiveScopes: ["organization_wide_scope"],
  sessionTrust: standardSessionTrust
};

const reviewOnlyUser: SessionUser = {
  ...leadershipUser,
  id: "user-audit",
  email: "audit@example.com",
  fullName: "Audit Reviewer",
  roles: ["audit"],
  permissions: ["audit.read"],
  authorityTier: "read_only_viewer",
  permissionGrants: [{ domain: "system_settings_permissions", action: "view", scope: "organization_wide_scope" }]
};

function createChange(overrides: Partial<AdminSettingValueRecord> = {}): AdminSettingValueRecord {
  return {
    id: overrides.id ?? "change-1",
    setting_key: overrides.setting_key ?? "attendance_time.early_clock_in_window_minutes",
    scope_type: overrides.scope_type ?? "global",
    scope_id: overrides.scope_id ?? null,
    scope_label: overrides.scope_label ?? "Company Default",
    value: overrides.value ?? 30,
    value_type: overrides.value_type ?? "number",
    status: overrides.status ?? "approved",
    requires_approval: overrides.requires_approval ?? false,
    is_override: overrides.is_override ?? false,
    effective_at: overrides.effective_at ?? "2026-03-30T15:00:00.000Z",
    expires_at: overrides.expires_at ?? null,
    requested_by_user_id: overrides.requested_by_user_id ?? "user-leadership",
    requested_by_name: overrides.requested_by_name ?? "Demo Leadership",
    approved_by_user_id: overrides.approved_by_user_id ?? "user-owner",
    approved_by_name: overrides.approved_by_name ?? "System Owner",
    approved_at: overrides.approved_at ?? "2026-03-30T15:05:00.000Z",
    reason: overrides.reason ?? "Initial seeded value.",
    impact_snapshot: overrides.impact_snapshot ?? { active_users: 42 },
    metadata: overrides.metadata ?? {},
    created_at: overrides.created_at ?? "2026-03-30T15:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-03-30T15:05:00.000Z"
  };
}

function createWorkspace(): AdminSettingsWorkspace {
  const approvedChange = createChange();
  const pendingChange = createChange({
    id: "change-pending",
    setting_key: "schedule_staffing.critical_window_hours",
    scope_type: "shoot_type",
    scope_id: "schools_underclass_portraits",
    scope_label: "Schools Underclass",
    value: 18,
    status: "pending_approval",
    requires_approval: true,
    approved_by_user_id: null,
    approved_by_name: null,
    approved_at: null,
    reason: "Tighten protected staffing edits for school portrait work."
  });

  return {
    generated_at: "2026-03-30T15:00:00.000Z",
    scope_hierarchy: ["global", "department", "workflow_type", "shoot_type", "job_type", "account", "location", "role"],
    summary_strip: [
      { id: "recent_changes", label: "Recent Changes", value: 3, detail: "Last 7 days", tone: "warning" },
      { id: "pending", label: "Pending Approval", value: 1, detail: "Protected changes waiting", tone: "danger" }
    ],
    categories: [
      {
        id: "attendance_time_rules",
        label: "Attendance and Time Rules",
        description: "Clock and lateness controls.",
        setting_count: 2,
        pending_count: 0,
        override_count: 1
      }
    ],
    settings: [
      {
        definition: {
          key: "attendance_time.early_clock_in_window_minutes",
          label: "Early Clock-In Window",
          description: "How early standard employees can clock in without review.",
          why_it_matters: "This keeps time capture flexible in the field without opening the door to noisy early punches.",
          category: "attendance_time_rules",
          default_value: 30,
          value_type: "number",
          allowed_scopes: ["global", "department", "role"],
          impacted_modules: ["Attendance", "Home", "Manager Time Review"],
          editor_group: "operations_admin",
          protected_change: false,
          override_capable: true,
          enum_values: [],
          help_text: null,
          who_can_edit: "Operations Admin"
        },
        global_value: approvedChange,
        active_overrides: [],
        pending_changes: [],
        history: [approvedChange]
      },
      {
        definition: {
          key: "schedule_staffing.critical_window_hours",
          label: "Critical Schedule Edit Window",
          description: "Hours before start when staffing and schedule edits need stronger warnings and approvals.",
          why_it_matters: "This protects same-day execution from silent late-stage staffing drift.",
          category: "schedule_staffing_rules",
          default_value: 24,
          value_type: "number",
          allowed_scopes: ["global", "department", "shoot_type"],
          impacted_modules: ["Schedule", "Staffing", "Home"],
          editor_group: "scheduling_staffing_admin",
          protected_change: true,
          override_capable: true,
          enum_values: [],
          help_text: null,
          who_can_edit: "Scheduling and Staffing Admin"
        },
        global_value: createChange({
          id: "change-critical-approved",
          setting_key: "schedule_staffing.critical_window_hours",
          value: 24,
          status: "approved"
        }),
        active_overrides: [],
        pending_changes: [pendingChange],
        history: [pendingChange]
      },
      {
        definition: {
          key: "roles_access.operating_system_visibility_overrides",
          label: "Operating System Visibility Overrides",
          description: "Hide specific modules or shell widgets for a role.",
          why_it_matters: "This keeps the operating shell focused without changing the core permission model.",
          category: "roles_access_rules",
          default_value: {
            hidden_modules: [],
            hidden_home_widgets: []
          },
          value_type: "json",
          allowed_scopes: ["global", "role"],
          impacted_modules: ["Shell", "Home"],
          editor_group: "system_owner",
          protected_change: true,
          override_capable: true,
          enum_values: [],
          help_text: 'Example: { "hidden_modules": ["reports"] }',
          who_can_edit: "System Owner / Super Admin"
        },
        global_value: createChange({
          id: "change-visibility",
          setting_key: "roles_access.operating_system_visibility_overrides",
          value: {
            hidden_modules: ["reports"],
            hidden_home_widgets: ["reports_overview"]
          },
          value_type: "json"
        }),
        active_overrides: [],
        pending_changes: [],
        history: [
          createChange({
            id: "change-visibility",
            setting_key: "roles_access.operating_system_visibility_overrides",
            value: {
              hidden_modules: ["reports"],
              hidden_home_widgets: ["reports_overview"]
            },
            value_type: "json"
          })
        ]
      }
    ],
    template_summaries: [
      {
        id: "staffing_templates",
        label: "Staffing Templates",
        owner_module: "Operations",
        count: 4,
        route_hash: "#operations/staffing",
        summary: "Reusable staffing requirements and timing offsets by shoot type."
      }
    ],
    pending_approvals: [pendingChange],
    scheduled_future_changes: [],
    stale_overrides: [],
    recent_changes: [approvedChange, pendingChange],
    integration_health_issues: [],
    data_health_warnings: []
  };
}

const previewPayload: AdminSettingPreview = {
  generated_at: "2026-03-30T15:00:00.000Z",
  setting_key: "attendance_time.early_clock_in_window_minutes",
  scope_type: "global",
  scope_id: null,
  scope_label: null,
  impact_summary: "Attendance and Time Rules change would affect 42 active users and 8 upcoming shoots.",
  counts: {
    active_users: 42,
    upcoming_shoots: 8
  },
  freshness: {
    state: "live",
    label: "Live"
  }
};

beforeEach(() => {
  getAdminSettingsWorkspaceMock.mockReset();
  previewAdminSettingChangeMock.mockReset();
  createAdminSettingChangeMock.mockReset();
  approveAdminSettingChangeMock.mockReset();
  rejectAdminSettingChangeMock.mockReset();

  getAdminSettingsWorkspaceMock.mockResolvedValue(createWorkspace());
  previewAdminSettingChangeMock.mockResolvedValue(previewPayload);
  createAdminSettingChangeMock.mockResolvedValue({
    change: createChange({
      id: "change-created",
      value: 45,
      reason: "Updated from test"
    }),
    preview: previewPayload
  });
  approveAdminSettingChangeMock.mockResolvedValue(createChange({ id: "change-pending", status: "approved" }));
  rejectAdminSettingChangeMock.mockResolvedValue(createChange({ id: "change-pending", status: "rejected" }));
});

describe("AdminSettings page", () => {
  it("renders the admin configuration workspace and seeded settings", async () => {
    render(<AdminSettings token="token" currentUser={leadershipUser} routeId="admin-system" />);

    expect(await screen.findByText("System Configuration")).toBeInTheDocument();
    expect(await screen.findByText("Early Clock-In Window")).toBeInTheDocument();
    expect(screen.getByText("Admin Configuration Areas")).toBeInTheDocument();
    expect(screen.getByText("Critical Schedule Edit Window")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Audit and Change History/i }));
    expect(await screen.findByText("Pending Protected Changes")).toBeInTheDocument();
  });

  it("previews and submits a versioned change from the selected setting editor", async () => {
    render(<AdminSettings token="token" currentUser={leadershipUser} routeId="admin-system" />);

    await screen.findByText("Early Clock-In Window");
    fireEvent.click(screen.getByRole("button", { name: /Early Clock-In Window/i }));

    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Increase early arrival room for field setup." } });

    fireEvent.click(screen.getByRole("button", { name: "Preview Impact" }));
    await waitFor(() => {
      expect(previewAdminSettingChangeMock).toHaveBeenCalledWith(
        "token",
        expect.objectContaining({
          setting_key: "attendance_time.early_clock_in_window_minutes",
          scope_type: "global",
          value: 45
        })
      );
    });

    expect(await screen.findByText("Impact Preview")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Apply Change" }));
    await waitFor(() => {
      expect(createAdminSettingChangeMock).toHaveBeenCalledWith(
        "token",
        expect.objectContaining({
          setting_key: "attendance_time.early_clock_in_window_minutes",
          scope_type: "global",
          value: 45,
          reason: "Increase early arrival room for field setup."
        })
      );
    });

    expect(await screen.findByText("Setting updated and versioned successfully.")).toBeInTheDocument();
  });

  it("shows approval actions for protected changes and lets an approver approve them", async () => {
    render(<AdminSettings token="token" currentUser={leadershipUser} routeId="admin-system" />);

    const pendingHeading = await screen.findAllByText("Pending Approvals");
    expect(pendingHeading.length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[0]);

    await waitFor(() => {
      expect(approveAdminSettingChangeMock).toHaveBeenCalledWith("token", "change-pending");
    });

    expect(await screen.findByText("Pending setting change approved.")).toBeInTheDocument();
  });

  it("keeps review-only admins out of edit actions while still rendering the workspace", async () => {
    render(<AdminSettings token="token" currentUser={reviewOnlyUser} routeId="admin-system" />);

    expect(await screen.findByText("Mode: Review Only")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Early Clock-In Window/i }));
    expect(await screen.findByText("Setting Editor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview Impact" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply Change" })).toBeDisabled();

    const approveButtons = screen.queryAllByRole("button", { name: "Approve" });
    expect(approveButtons).toHaveLength(0);
    expect(screen.getByText("Viewer: Audit Reviewer")).toBeInTheDocument();
  });

  it("supports structured json settings in the editor and submits parsed objects", async () => {
    render(<AdminSettings token="token" currentUser={leadershipUser} routeId="admin-system" />);

    fireEvent.click(await screen.findByRole("button", { name: /Roles and Access/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Operating System Visibility Overrides/i }));

    expect(screen.getByText(/Example: \{ "hidden_modules": \["reports"\] \}/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Structured Value (JSON)"), {
      target: {
        value: JSON.stringify(
          {
            hidden_modules: ["reports", "operations"],
            hidden_home_widgets: ["reports_overview"]
          },
          null,
          2
        )
      }
    });
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Hide reports for a focused phase 7 dashboard." }
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview Impact" }));

    await waitFor(() => {
      expect(previewAdminSettingChangeMock).toHaveBeenCalledWith(
        "token",
        expect.objectContaining({
          setting_key: "roles_access.operating_system_visibility_overrides",
          value: {
            hidden_modules: ["reports", "operations"],
            hidden_home_widgets: ["reports_overview"]
          }
        })
      );
    });
  });
});
