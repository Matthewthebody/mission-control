import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { evaluateReleaseDisciplineStartupIssues, type ReleaseDisciplineState } from "../src/services/releaseDiscipline.js";

function buildState(overrides: Partial<ReleaseDisciplineState> = {}): ReleaseDisciplineState {
  return {
    generated_at: "2026-04-28T12:00:00.000Z",
    git: {
      checked_at: "2026-04-28T12:00:00.000Z",
      branch: "main",
      head_sha: "abc123",
      is_clean: true,
      dirty_path_count: 0,
      dirty_paths: [],
      error: null
    },
    runtime_smoke: {
      path: ".codex-artifacts/release-runtime-smoke.json",
      exists: true,
      passed: true,
      attested_at: "2026-04-28T11:30:00.000Z",
      commit_sha: "abc123",
      core_endpoints_ok: true,
      core_endpoints: [
        { route_path: "/health", ok: true, status: 200 },
        { route_path: "/auth/me", ok: true, status: 200 },
        { route_path: "/api/exceptions", ok: true, status: 200 },
        { route_path: "/api/dashboard/owner-command", ok: true, status: 200 }
      ],
      error: null,
      commit_matches_head: true
    },
    pilot_mode: {
      enabled: false,
      eligible: true,
      blockers: []
    },
    release_ready: true,
    ...overrides
  };
}

describe("release discipline", () => {
  it("does not fail test startup for a dirty worktree while pilot mode is off", () => {
    const issues = evaluateReleaseDisciplineStartupIssues(buildState({
      git: {
        checked_at: "2026-04-28T12:00:00.000Z",
        branch: "main",
        head_sha: "abc123",
        is_clean: false,
        dirty_path_count: 3,
        dirty_paths: [" M packages/api/src/app.ts"],
        error: null
      },
      release_ready: false
    }), {
      nodeEnv: "test",
      pilotModeEnabled: false
    });

    expect(issues).toEqual([]);
  });

  it("fails production-like startup when the git worktree is dirty", () => {
    const issues = evaluateReleaseDisciplineStartupIssues(buildState({
      git: {
        checked_at: "2026-04-28T12:00:00.000Z",
        branch: "main",
        head_sha: "abc123",
        is_clean: false,
        dirty_path_count: 2,
        dirty_paths: [" M package.json"],
        error: null
      },
      release_ready: false
    }), {
      nodeEnv: "production",
      pilotModeEnabled: false
    });

    expect(issues).toContain("git_worktree_dirty");
  });

  it("blocks pilot mode when runtime smoke attestation is missing or failed", () => {
    const issues = evaluateReleaseDisciplineStartupIssues(buildState({
      pilot_mode: {
        enabled: true,
        eligible: false,
        blockers: ["runtime_smoke_missing", "core_api_endpoints_failed"]
      },
      release_ready: false
    }), {
      nodeEnv: "production",
      pilotModeEnabled: true
    });

    expect(issues).toContain("runtime_smoke_missing");
    expect(issues).toContain("core_api_endpoints_failed");
  });

  it("surfaces release discipline in the public health payload", async () => {
    const app = createApp();
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body.release_discipline).toEqual(
      expect.objectContaining({
        git: expect.objectContaining({
          is_clean: expect.any(Boolean),
          dirty_path_count: expect.any(Number)
        }),
        runtime_smoke: expect.objectContaining({
          exists: expect.any(Boolean),
          passed: expect.any(Boolean),
          core_endpoints_ok: expect.any(Boolean)
        }),
        pilot_mode: expect.objectContaining({
          enabled: expect.any(Boolean),
          eligible: expect.any(Boolean),
          blockers: expect.any(Array)
        }),
        release_ready: expect.any(Boolean)
      })
    );
  });
});
