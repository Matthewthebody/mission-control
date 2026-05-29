import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

export type ReleaseDisciplineState = {
  git: {
    is_clean: boolean;
  };
  pilot_mode: {
    eligible: boolean;
    blockers: string[];
  };
};

type StateReader = () => ReleaseDisciplineState;

function resolveRepoRoot() {
  let current = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = path.join(current, "tools", "release-discipline-state.mjs");
    if (fs.existsSync(candidate)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Unable to locate repo root for release discipline checks.");
    }
    current = parent;
  }
}

const repoRoot = resolveRepoRoot();
const releaseDisciplineScript = path.join(repoRoot, "tools", "release-discipline-state.mjs");

function readStateFromTool() {
  const raw = execFileSync(process.execPath, [releaseDisciplineScript], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env
  }).trim();
  return JSON.parse(raw) as ReleaseDisciplineState;
}

export function evaluateReleaseDisciplineStartupIssues(
  state: ReleaseDisciplineState,
  options: {
    nodeEnv?: string;
    pilotModeEnabled?: boolean;
  } = {}
) {
  const nodeEnv = options.nodeEnv ?? config.NODE_ENV;
  const pilotModeEnabled = options.pilotModeEnabled ?? config.PILOT_MODE_ENABLED;
  const issues: string[] = [];

  if (nodeEnv !== "development" && nodeEnv !== "test" && !state.git.is_clean) {
    issues.push("git_worktree_dirty");
  }

  if (pilotModeEnabled && !state.pilot_mode.eligible) {
    issues.push(...state.pilot_mode.blockers);
  }

  return Array.from(new Set(issues));
}

export function assertReleaseDisciplineStartup(
  target: "worker",
  options: {
    reader?: StateReader;
    nodeEnv?: string;
    pilotModeEnabled?: boolean;
  } = {}
) {
  const state = (options.reader ?? readStateFromTool)();
  const issues = evaluateReleaseDisciplineStartupIssues(state, {
    nodeEnv: options.nodeEnv,
    pilotModeEnabled: options.pilotModeEnabled
  });

  if (issues.length === 0) {
    return;
  }

  throw new Error(
    `Release discipline startup validation failed for ${target}: ${issues.join(", ")}. ` +
      `Pilot mode is blocked until the repo is clean and runtime smoke verifies the core API endpoints.`
  );
}
