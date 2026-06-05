// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../app";
import type { SessionUser } from "../types";

const apiFetchMock = vi.fn();

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetchMock(...args)
  };
});

vi.mock("../realtime", () => ({
  connectRealtime: vi.fn(() => ({
    connected: false,
    on: vi.fn(),
    off: vi.fn(),
    close: vi.fn()
  }))
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

afterEach(() => {
  cleanup();
});

describe("release discipline banner", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/#account");
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })) as typeof window.matchMedia;
  });

  it("shows a DIRTY STATE banner when health reports an unclean repo", async () => {
    const user: SessionUser = {
      id: "user-release",
      tenantId: "tenant-demo",
      accountId: "account-release",
      sessionId: "session-release",
      email: "release@example.com",
      fullName: "Release User",
      status: "active",
      department: "operations",
      isEmailVerified: true,
      authVersion: 1,
      roles: ["leadership"],
      permissions: ["dashboard.read", "account.read"],
      authorityTier: "leadership",
      primaryJobFunctionProfile: "leadership_team_member",
      jobFunctionProfiles: ["leadership_team_member"],
      permissionGrants: [],
      effectiveScopes: ["organization_wide_scope"],
      sessionTrust
    };

    window.localStorage.setItem("pmc_admin_token", "release-token");
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/auth/session") {
        return { user };
      }
      if (path.startsWith("/health")) {
        return {
          ok: true,
          release_discipline: {
            git: {
              checked_at: "2026-04-28T12:00:00.000Z",
              branch: "main",
              head_sha: "abc123",
              is_clean: false,
              dirty_path_count: 4,
              dirty_paths: [" M package.json"],
              error: null
            },
            runtime_smoke: {
              path: ".codex-artifacts/release-runtime-smoke.json",
              exists: true,
              passed: false,
              attested_at: "2026-04-28T11:30:00.000Z",
              commit_sha: "abc123",
              core_endpoints_ok: false,
              core_endpoints: [],
              error: "Runtime smoke failed.",
              commit_matches_head: true
            },
            pilot_mode: {
              enabled: false,
              eligible: false,
              blockers: ["git_worktree_dirty", "runtime_smoke_failed"]
            },
            release_ready: false
          }
        };
      }
      return {};
    });

    render(<App />);

    expect(await screen.findByText("DIRTY STATE")).toBeInTheDocument();
    expect(screen.getByText("Pilot mode is blocked.")).toBeInTheDocument();
    expect(screen.getByText(/Runtime smoke must pass on a clean worktree/i)).toBeInTheDocument();
  });
});
