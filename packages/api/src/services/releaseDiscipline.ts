import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

export type ReleaseDisciplineState = {
  generated_at: string;
  git: {
    checked_at: string;
    branch: string | null;
    head_sha: string | null;
    is_clean: boolean;
    dirty_path_count: number;
    dirty_paths: string[];
    error: string | null;
  };
  runtime_smoke: {
    path: string;
    exists: boolean;
    passed: boolean;
    attested_at: string | null;
    commit_sha: string | null;
    core_endpoints_ok: boolean;
    core_endpoints: Array<{
      route_path: string;
      ok: boolean;
      status: number | null;
    }>;
    error: string | null;
    commit_matches_head: boolean;
  };
  pilot_mode: {
    enabled: boolean;
    eligible: boolean;
    blockers: string[];
  };
  release_ready: boolean;
};

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
const cacheTtlMs = 5_000;

let cachedState: ReleaseDisciplineState | null = null;
let cachedAt = 0;

type StateReader = () => ReleaseDisciplineState;

function readStateFromTool() {
  const raw = execFileSync(process.execPath, [releaseDisciplineScript], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env
  }).trim();
  return JSON.parse(raw) as ReleaseDisciplineState;
}

export function getReleaseDisciplineState(options: { forceRefresh?: boolean; reader?: StateReader } = {}) {
  const now = Date.now();
  if (!options.forceRefresh && cachedState && now - cachedAt < cacheTtlMs) {
    return cachedState;
  }
  const nextState = (options.reader ?? readStateFromTool)();
  cachedState = nextState;
  cachedAt = now;
  return nextState;
}

export function getPublicReleaseDisciplineSummary(options: { forceRefresh?: boolean; reader?: StateReader } = {}) {
  const state = getReleaseDisciplineState(options);
  return {
    git: state.git,
    runtime_smoke: state.runtime_smoke,
    pilot_mode: state.pilot_mode,
    release_ready: state.release_ready
  };
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
  target: "api",
  options: {
    reader?: StateReader;
    nodeEnv?: string;
    pilotModeEnabled?: boolean;
  } = {}
) {
  const state = getReleaseDisciplineState({ forceRefresh: true, reader: options.reader });
  const issues = evaluateReleaseDisciplineStartupIssues(state, {
    nodeEnv: options.nodeEnv,
    pilotModeEnabled: options.pilotModeEnabled
  });

  if (issues.length === 0) {
    return;
  }

  throw new Error(
    `Release discipline startup validation failed for ${target}: ${issues.join(", ")}. ` +
      `Pilot mode is blocked until the repo is clean and runtime smoke verifies /health, /auth/me, /api/exceptions, and /api/dashboard/owner-command.`
  );
}
