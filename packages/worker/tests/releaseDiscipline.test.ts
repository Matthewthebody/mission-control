import { describe, expect, it } from "vitest";
import { evaluateReleaseDisciplineStartupIssues, type ReleaseDisciplineState } from "../src/releaseDiscipline.js";

function buildState(overrides: Partial<ReleaseDisciplineState> = {}): ReleaseDisciplineState {
  return {
    git: {
      is_clean: true
    },
    pilot_mode: {
      eligible: true,
      blockers: []
    },
    ...overrides
  };
}

describe("worker release discipline", () => {
  it("fails production-like worker startup when the repo is dirty", () => {
    const issues = evaluateReleaseDisciplineStartupIssues(buildState({
      git: { is_clean: false }
    }), {
      nodeEnv: "production",
      pilotModeEnabled: false
    });

    expect(issues).toContain("git_worktree_dirty");
  });

  it("allows test boot on a dirty worktree when pilot mode is off", () => {
    const issues = evaluateReleaseDisciplineStartupIssues(buildState({
      git: { is_clean: false }
    }), {
      nodeEnv: "test",
      pilotModeEnabled: false
    });

    expect(issues).toEqual([]);
  });

  it("blocks pilot mode when shared release readiness is not eligible", () => {
    const issues = evaluateReleaseDisciplineStartupIssues(buildState({
      pilot_mode: {
        eligible: false,
        blockers: ["runtime_smoke_failed"]
      }
    }), {
      nodeEnv: "production",
      pilotModeEnabled: true
    });

    expect(issues).toContain("runtime_smoke_failed");
  });
});
