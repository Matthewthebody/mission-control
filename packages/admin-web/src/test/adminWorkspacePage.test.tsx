// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminWorkspace } from "../pages/AdminWorkspace";
import type { AdminWorkspaceResponse } from "../services/adminWorkspace";
import type { SessionUser } from "../types";

const getAdminWorkspaceMock = vi.fn();

vi.mock("../services/adminWorkspace", () => ({
  getAdminWorkspace: (...args: unknown[]) => getAdminWorkspaceMock(...args)
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
  id: "user-admin",
  tenantId: "tenant-demo",
  accountId: "account-admin",
  sessionId: "session-admin",
  email: "admin@example.com",
  fullName: "Admin Demo",
  status: "active",
  department: "operations",
  isEmailVerified: true,
  authVersion: 1,
  roles: ["leadership"],
  permissions: ["access.manage", "audit.read", "security.manage", "outlook.manage", "dashboard.read", "labor.read"],
  authorityTier: "leadership",
  primaryJobFunctionProfile: "leadership_team_member",
  jobFunctionProfiles: ["leadership_team_member"],
  permissionGrants: [],
  effectiveScopes: ["organization_wide_scope"],
  sessionTrust
};

const fieldUser: SessionUser = {
  ...leadershipUser,
  id: "user-field",
  accountId: "account-field",
  sessionId: "session-field",
  email: "field@example.com",
  fullName: "Field Demo",
  roles: ["photographer"],
  permissions: ["schedule.read", "time.clock"],
  authorityTier: "standard_employee",
  primaryJobFunctionProfile: "associate_photographer",
  jobFunctionProfiles: ["associate_photographer"],
  effectiveScopes: ["self_only"]
};

const payload: AdminWorkspaceResponse = {
  generated_at: "2026-03-31T16:00:00.000Z",
  anchor_date: "2026-03-31",
  refresh_interval_seconds: 90,
  role_mode: "manage",
  summary_strip: [
    {
      id: "roles_access",
      label: "Roles / Access",
      count: 3,
      detail: "Membership follow-through is still open.",
      tone: "warning",
      action_hash: "#admin/roles"
    },
    {
      id: "integration_health",
      label: "Integrations",
      count: 2,
      detail: "One connector is failing and one conflict needs review.",
      tone: "critical",
      action_hash: "#admin/integrations"
    }
  ],
  roles_access: {
    visible: true,
    headline: "Roles and Access",
    summary_line: "Access posture still needs follow-through.",
    action_hash: "#admin/roles",
    action_label: "Open Roles & Access",
    helper_text: "Access posture belongs here.",
    cards: [
      {
        id: "pending_users",
        label: "Pending",
        count: 2,
        detail: "Pending approvals and invitations.",
        tone: "critical",
        action_hash: "#admin/roles"
      }
    ],
    items: [
      {
        id: "user-pending",
        title: "Pending Admin",
        summary: "Leadership · pending approval",
        status_label: "Pending Approval",
        tone: "critical",
        action_hash: "#admin/roles"
      }
    ]
  },
  integrations: {
    visible: true,
    headline: "Integrations",
    summary_line: "Sync failures and coexistence controls live here.",
    action_hash: "#admin/integrations",
    action_label: "Open Integrations",
    helper_text: "Operational pages should not own replay controls.",
    cards: [
      {
        id: "integration_failures",
        label: "Failing",
        count: 1,
        detail: "One connector is failing.",
        tone: "critical",
        action_hash: "#admin/integrations"
      }
    ],
    items: [
      {
        id: "provider-monday",
        title: "Monday",
        summary: "Coexistence controls and replay are centralized here.",
        status_label: "Warning",
        tone: "warning",
        action_hash: "#admin/integrations"
      }
    ]
  },
  automations: {
    visible: true,
    headline: "Automations",
    summary_line: "Retry and failure visibility live here.",
    action_hash: "#admin/automations",
    action_label: "Open Automations",
    helper_text: "Honest automation observability only.",
    cards: [],
    items: []
  },
  settings_reference: {
    visible: true,
    headline: "Settings and Reference Data",
    summary_line: "System settings are centralized here.",
    action_hash: "#admin/system",
    action_label: "Open System Configuration",
    helper_text: "Settings should be boring and auditable.",
    cards: [],
    items: []
  },
  audit_security: {
    visible: true,
    headline: "Audit and Security",
    summary_line: "Privileged activity is visible here.",
    action_hash: "#admin/audit",
    action_label: "Open Audit & Security",
    helper_text: "Dangerous actions belong in one place.",
    cards: [],
    items: [
      {
        id: "audit-1",
        title: "Break Glass Used",
        summary: "Emergency access session still needs review.",
        status_label: "Pending Review",
        tone: "warning",
        action_hash: "#admin/audit"
      }
    ]
  },
  review_tools: {
    visible: true,
    headline: "Admin Review Tools",
    summary_line: "Payroll export and mileage review are still open.",
    action_hash: "#admin/review-tools",
    action_label: "Open Review Tools",
    helper_text: "Admin-only review work lives here.",
    cards: [
      {
        id: "payroll_blocked",
        label: "Export Blocked",
        count: 1,
        detail: "One payroll row is blocked.",
        tone: "critical",
        action_hash: "#admin/review-tools"
      }
    ],
    items: [
      {
        id: "review-1",
        title: "Payroll review",
        summary: "One employee still has unresolved export blockers.",
        status_label: "Export Blocked",
        tone: "critical",
        action_hash: "#admin/review-tools"
      }
    ]
  }
};

describe("Admin workspace", () => {
  beforeEach(() => {
    getAdminWorkspaceMock.mockReset();
    window.location.hash = "#admin";
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the admin workspace summary and routes into owning admin surfaces", async () => {
    getAdminWorkspaceMock.mockResolvedValue(payload);

    render(<AdminWorkspace token="token" currentUser={leadershipUser} routeId="admin" />);

    expect(await screen.findByText("Admin workspace")).toBeInTheDocument();
    expect(await screen.findByText("Roles and Access")).toBeInTheDocument();
    expect(screen.getAllByText("Integrations").length).toBeGreaterThan(0);
    expect(screen.getByText("Admin Review Tools")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Integrations" }));
    expect(window.location.hash).toBe("#admin/integrations");

    fireEvent.click(screen.getByRole("button", { name: "Open Review Tools" }));
    expect(window.location.hash).toBe("#admin/review-tools");

    await waitFor(() => {
      expect(getAdminWorkspaceMock).toHaveBeenCalledWith("token", { date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    });
  });

  it("shows a limited fallback for non-admin users without loading the admin workspace contract", async () => {
    render(<AdminWorkspace token="token" currentUser={fieldUser} routeId="admin" />);

    expect(await screen.findByText("Admin Workspace")).toBeInTheDocument();
    expect(screen.getByText(/Admin holds roles, integrations, settings, audit posture, and admin-only review work/i)).toBeInTheDocument();
    expect(getAdminWorkspaceMock).not.toHaveBeenCalled();
  });
});
