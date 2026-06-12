// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MyAccount } from "../pages/MyAccount";
import type { SessionUser } from "../types";

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

const adminUser: SessionUser = {
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
  ...adminUser,
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

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("MyAccount settings home", () => {
  it("keeps the real account surface (heading and password change)", () => {
    render(<MyAccount token="token" user={fieldUser} onLoggedOut={vi.fn()} />);

    expect(screen.getByText("Account & Session")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save New Password" })).toBeInTheDocument();
  });

  it("exposes a real theme preference wired to persistence", () => {
    const onThemeChange = vi.fn();
    render(<MyAccount token="token" user={fieldUser} theme="dark" onThemeChange={onThemeChange} onLoggedOut={vi.fn()} />);

    expect(screen.getByText("Preferences")).toBeInTheDocument();
    const toggle = screen.getByRole("group", { name: "Theme toggle" });
    fireEvent.click(within(toggle).getByRole("button", { name: "Light" }));
    expect(onThemeChange).toHaveBeenCalledWith("light");
  });

  it("hides the preferences panel when no real theme control is wired", () => {
    render(<MyAccount token="token" user={fieldUser} onLoggedOut={vi.fn()} />);

    expect(screen.queryByText("Preferences")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Theme toggle" })).not.toBeInTheDocument();
  });

  it("reports Microsoft 365 sign-in honestly: not connected for local password sessions", () => {
    render(<MyAccount token="token" user={fieldUser} onLoggedOut={vi.fn()} />);

    expect(screen.getByText("Microsoft 365 sign-in")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
  });

  it("reports Microsoft 365 sign-in as connected for entra sessions", () => {
    const entraUser: SessionUser = {
      ...fieldUser,
      sessionTrust: { ...sessionTrust, identityProvider: "microsoft_entra" }
    };
    render(<MyAccount token="token" user={entraUser} onLoggedOut={vi.fn()} />);

    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("offers the admin workspace only to admins, separate from personal settings", () => {
    render(<MyAccount token="token" user={adminUser} onLoggedOut={vi.fn()} />);

    const adminButton = screen.getByRole("button", { name: "Open Admin Workspace" });
    expect(adminButton).toBeInTheDocument();
    fireEvent.click(adminButton);
    expect(window.location.hash).toBe("#admin");
  });

  it("does not surface admin controls to non-admin staff", () => {
    render(<MyAccount token="token" user={fieldUser} onLoggedOut={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Open Admin Workspace" })).not.toBeInTheDocument();
    expect(screen.queryByText(/System & Admin/i)).not.toBeInTheDocument();
  });
});
